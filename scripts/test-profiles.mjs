import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { app } from 'electron';

const home = resolve(mkdtempSync(join(tmpdir(), 'avi-profiles-test-')));
process.env.HOME = home;
process.env.USERPROFILE = home;

try {
  const profiles = await import('../src/main/profiles.js');
  const { exportProfile, importProfile } = await import('../src/main/profile-transfer.js');

  assert.equal(profiles.activeProfile.id, 'default');
  assert.equal(profiles.profilePaths().root, join(home, '.aivax'));
  assert.deepEqual(profiles.listProfiles().map((profile) => profile.id), ['default']);

  assert.throws(() => profiles.createProfile({ name: ' ', color: '#3e9df0' }), /profile name/);
  assert.throws(() => profiles.createProfile({ name: 'Work', color: 'blue' }), /color/);
  const work = profiles.createProfile({ name: ' Work ', color: '#3E9DF0' });
  assert.equal(work.name, 'Work');
  assert.equal(work.color, '#3e9df0');
  const workPaths = profiles.profilePaths(work);
  assert.equal(workPaths.root, join(home, '.aivax', 'profiles', work.id));
  assert.ok(workPaths.archivedMedia.startsWith(join(tmpdir(), '.avi', 'profiles', work.id)));
  assert.equal(profiles.updateProfile(work.id, { name: 'Office', color: '#46a758' }).name, 'Office');
  assert.throws(() => profiles.updateProfile('default', { name: 'X', color: '#46a758' }), /cannot be edited/);
  assert.throws(() => profiles.deleteProfile('default'), /cannot be removed/);
  assert.equal(profiles.isProfileRunning(work), false);
  writeFileSync(workPaths.pid, String(process.pid));
  assert.equal(profiles.isProfileRunning(work), true);
  assert.throws(() => profiles.deleteProfile(work.id), /Close Avi/);
  rmSync(workPaths.pid);
  console.log('ok - registry, validation, paths and running checks');

  const mediaFile = join(workPaths.media, 'conversation', 'image.png');
  mkdirSync(join(workPaths.media, 'conversation'), { recursive: true });
  writeFileSync(mediaFile, 'png');
  const database = new DatabaseSync(workPaths.database);
  database.exec(`
    CREATE TABLE session_values (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);
    CREATE TABLE messages (conversation_id TEXT, segments TEXT, attachments TEXT);
    CREATE TABLE conversations (id TEXT, project_path TEXT);
    CREATE TABLE bots (id TEXT, working_folder TEXT);
  `);
  database.prepare('INSERT INTO session_values VALUES (?, ?, ?)').run('providerCredentialsV2', '"secret"', '');
  database.prepare('INSERT INTO session_values VALUES (?, ?, ?)')
    .run('remoteSettings', JSON.stringify({ enabled: true, port: 1, relayDeviceId: 'device', instanceId: 'instance' }), '');
  database.prepare('INSERT INTO messages VALUES (?, ?, ?)')
    .run('conversation', JSON.stringify([{ path: mediaFile }]), '[]');
  database.prepare('INSERT INTO bots VALUES (?, ?)').run('bot', join(workPaths.bots, 'bot'));
  database.prepare('INSERT INTO conversations VALUES (?, ?)').run('bot-thread', join(workPaths.bots, 'bot'));
  database.close();

  const archive = join(home, 'office.aviprofile');
  await exportProfile(profiles.listProfiles().find((profile) => profile.id === work.id), archive);
  assert.ok(existsSync(archive));
  const imported = await importProfile(archive);
  assert.equal(imported.name, 'Office (imported)');
  assert.equal(imported.color, '#46a758');
  const importedPaths = profiles.profilePaths(imported);
  assert.ok(existsSync(join(importedPaths.media, 'conversation', 'image.png')));
  assert.ok(!existsSync(join(importedPaths.root, 'profile.json')));

  const copy = new DatabaseSync(importedPaths.database, { readOnly: true });
  assert.equal(copy.prepare("SELECT 1 FROM session_values WHERE key = 'providerCredentialsV2'").get(), undefined);
  assert.deepEqual(
    JSON.parse(copy.prepare("SELECT value FROM session_values WHERE key = 'remoteSettings'").get().value),
    { enabled: true, port: 1 },
  );
  assert.equal(
    JSON.parse(copy.prepare('SELECT segments FROM messages').get().segments)[0].path,
    join(importedPaths.media, 'conversation', 'image.png'),
  );
  assert.equal(copy.prepare('SELECT working_folder FROM bots').get().working_folder, join(importedPaths.bots, 'bot'));
  assert.equal(copy.prepare('SELECT project_path FROM conversations').get().project_path, `${importedPaths.bots}${sep}bot`);
  copy.close();
  console.log('ok - export strips device credentials and import relocates profile paths');

  const invalid = join(home, 'invalid.aviprofile');
  writeFileSync(invalid, 'not a zip');
  const before = profiles.listProfiles().length;
  await assert.rejects(importProfile(invalid));
  assert.equal(profiles.listProfiles().length, before);

  profiles.deleteProfile(imported.id);
  assert.ok(!existsSync(importedPaths.root));
  assert.ok(!profiles.listProfiles().some((profile) => profile.id === imported.id));
  console.log('ok - invalid import leaves no profile and removal deletes data');
} finally {
  rmSync(home, { recursive: true, force: true });
  app.exit(process.exitCode ?? 0);
}
