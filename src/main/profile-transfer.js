import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, stat } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';
import { pipeline } from 'node:stream/promises';
import extractZip from 'extract-zip';
import yazl from 'yazl';
import { createProfile, deleteProfile, listProfiles, profilePaths } from './profiles.js';

const archiveFormat = 'avi-profile';
const archiveVersion = 1;
const relocatedPaths = { media: 'media', archivedMedia: 'media', bots: 'bots' };

export async function exportProfile(profile, destination) {
  const paths = profilePaths(profile);
  try {
    await stat(paths.database);
  } catch {
    throw new Error(`${profile.name} has no data to export yet. Open it once first.`);
  }

  const temporaryDirectory = join(tmpdir(), '.avi', 'profile-exports', randomUUID());
  const databaseCopy = join(temporaryDirectory, 'aivax.sqlite');
  await mkdir(temporaryDirectory, { recursive: true });
  try {
    const source = new DatabaseSync(paths.database);
    try {
      await backup(source, databaseCopy);
    } finally {
      source.close();
    }

    // Credentials stay on this device: their key lives in OS-protected storage that is not exported.
    const copy = new DatabaseSync(databaseCopy);
    try {
      copy.exec('PRAGMA secure_delete = ON');
      copy.exec("DELETE FROM session_values WHERE key IN ('providerCredentialsV2', 'providerCredentialsBunBackup')");
      const remote = copy.prepare("SELECT value FROM session_values WHERE key = 'remoteSettings'").get();
      if (remote) {
        const { relayDeviceId: _device, instanceId: _instance, ...settings } = JSON.parse(remote.value);
        copy.prepare("UPDATE session_values SET value = ? WHERE key = 'remoteSettings'").run(JSON.stringify(settings));
      }
    } finally {
      copy.close();
    }

    const zip = new yazl.ZipFile();
    zip.addBuffer(Buffer.from(JSON.stringify({
      format: archiveFormat,
      version: archiveVersion,
      name: profile.name,
      color: profile.color ?? '#3e9df0',
      separator: sep,
      paths: Object.fromEntries(Object.keys(relocatedPaths).map((key) => [key, paths[key]])),
    }, null, 2)), 'profile.json');
    zip.addFile(databaseCopy, 'aivax.sqlite');
    // Archived media leaves temporary storage as active media; startup maintenance archives it again.
    for (const [folder, root] of [
      ['media', paths.media],
      ['media', paths.archivedMedia],
      ['chat-backgrounds', paths.chatBackgrounds],
      ['bots', paths.bots],
    ]) {
      let entries;
      try {
        entries = await readdir(root, { recursive: true, withFileTypes: true });
      } catch (error) {
        if (error?.code === 'ENOENT') continue;
        throw error;
      }
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        const file = join(entry.parentPath, entry.name);
        zip.addFile(file, `${folder}/${relative(root, file).split(sep).join('/')}`);
      }
    }
    zip.end();
    await pipeline(zip.outputStream, createWriteStream(destination));
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
  return { path: destination };
}

export async function importProfile(source) {
  const staging = join(homedir(), '.aivax', 'profiles', `.import-${randomUUID()}`);
  try {
    await extractZip(source, { dir: staging });
    const manifest = JSON.parse(await readFile(join(staging, 'profile.json'), 'utf8').catch(() => 'null'));
    if (manifest?.format !== archiveFormat || manifest.version !== archiveVersion) {
      throw new Error('This file is not an Avi profile export.');
    }
    await stat(join(staging, 'aivax.sqlite'));

    const takenNames = new Set(listProfiles().map((profile) => profile.name.toLowerCase()));
    const baseName = String(manifest.name || 'Imported profile').slice(0, 29);
    const profile = createProfile({
      name: takenNames.has(baseName.toLowerCase()) ? `${baseName} (imported)` : baseName,
      color: manifest.color,
    });
    const target = profilePaths(profile);
    try {
      const database = new DatabaseSync(join(staging, 'aivax.sqlite'));
      try {
        for (const [key, targetKey] of Object.entries(relocatedPaths)) {
          const from = `${manifest.paths?.[key] ?? ''}${manifest.separator ?? sep}`;
          const to = `${target[targetKey]}${sep}`;
          if (from.length <= 1 || from === to) continue;
          const [fromJson, toJson] = [from, to].map((value) => JSON.stringify(value).slice(1, -1));
          database.prepare(`
            UPDATE messages SET segments = replace(segments, ?1, ?2), attachments = replace(attachments, ?1, ?2)
            WHERE instr(segments, ?1) > 0 OR instr(attachments, ?1) > 0
          `).run(fromJson, toJson);
          database.prepare('UPDATE conversations SET project_path = replace(project_path, ?1, ?2) WHERE instr(project_path, ?1) = 1')
            .run(from, to);
          database.prepare('UPDATE bots SET working_folder = replace(working_folder, ?1, ?2) WHERE instr(working_folder, ?1) = 1')
            .run(from, to);
        }
      } finally {
        database.close();
      }
      await rm(join(staging, 'profile.json'));
      await rm(target.root, { recursive: true, force: true });
      await rename(staging, target.root);
    } catch (error) {
      deleteProfile(profile.id);
      throw error;
    }
    return profile;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
