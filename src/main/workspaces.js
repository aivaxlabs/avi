import { lstat, mkdir, readdir, readlink, realpath, rmdir, stat, symlink, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';

export class WorkspaceManager {
  constructor(root = join(homedir(), '.aivax', 'workspaces')) {
    this.root = resolve(root);
    this.pending = Promise.resolve();
  }

  isWorkspace(folderPath) {
    if (typeof folderPath !== 'string' || !isAbsolute(folderPath)) return false;
    const parent = dirname(resolve(folderPath));
    return process.platform === 'win32'
      ? parent.toLowerCase() === this.root.toLowerCase()
      : parent === this.root;
  }

  async inspect(folderPath) {
    if (!this.isWorkspace(folderPath)) throw new Error('Not a managed workspace.');
    const path = resolve(folderPath);
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Workspace must be a real directory.');
    const folders = [];
    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (!entry.isSymbolicLink()) continue;
      const linkPath = join(path, entry.name);
      const target = resolve(path, await readlink(linkPath));
      let available = false;
      try {
        if (!(await stat(linkPath)).isDirectory()) continue;
        available = true;
      } catch (error) {
        if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error;
      }
      folders.push({ name: entry.name, path: target, available });
    }
    return { path, name: basename(path), folders };
  }

  save(payload = {}) {
    const operation = this.pending.then(async () => {
      const creating = !payload.path;
      if (!creating && !this.isWorkspace(payload.path)) throw new Error('Not a managed workspace.');
      const name = creating ? payload.name?.trim() : basename(payload.path);
      if (typeof name !== 'string' || !name || name.length > 120
        || /[<>:"/\\|?*\x00-\x1f]/.test(name) || /[. ]$/.test(name)
        || name === '.' || name === '..' || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) {
        throw new Error('Enter a valid workspace name (up to 120 characters, without path separators).');
      }
      const path = creating ? join(this.root, name) : resolve(payload.path);
      if (!this.isWorkspace(path)) throw new Error('Not a managed workspace.');
      if (!Array.isArray(payload.folders)) throw new Error('Folders must be an array.');
      const existing = creating ? [] : (await this.inspect(path)).folders;
      const folders = [];
      const names = new Set();
      const targets = new Set();
      for (const folder of payload.folders) {
        if (typeof folder.path !== 'string' || !isAbsolute(folder.path)) throw new Error('Folder paths must be absolute.');
        const linkName = folder.name ?? basename(folder.path);
        if (typeof linkName !== 'string' || !linkName || linkName.startsWith('.')
          || /[<>:"/\\|?*\x00-\x1f]/.test(linkName) || /[. ]$/.test(linkName)
          || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(linkName)) {
          throw new Error('Each linked folder needs a valid, non-hidden name.');
        }
        const key = process.platform === 'win32' ? linkName.toLowerCase() : linkName;
        if (names.has(key)) throw new Error(`Duplicate link name: ${linkName}. Rename one of the links.`);
        names.add(key);
        const unchanged = existing.find((item) => item.name === linkName && item.path === resolve(folder.path));
        const target = unchanged ? unchanged.path : await realpath(folder.path);
        if (!unchanged && !(await stat(target)).isDirectory()) throw new Error('Links must point to folders.');
        const insideTarget = relative(target, path);
        if (insideTarget === '' || (!insideTarget.startsWith('..') && !isAbsolute(insideTarget))) {
          throw new Error('A workspace cannot link to itself or an ancestor folder.');
        }
        const targetKey = process.platform === 'win32' ? target.toLowerCase() : target;
        if (targets.has(targetKey)) throw new Error('A folder can only be linked once.');
        targets.add(targetKey);
        folders.push({ name: linkName, path: target });
      }
      const added = folders.filter((folder) => !existing.some((item) => item.name === folder.name && item.path === folder.path));
      const removed = existing.filter((folder) => !folders.some((item) => item.name === folder.name && item.path === folder.path));
      if (added.some((folder) => existing.some((item) => item.name === folder.name))) {
        throw new Error('Remove the old link and save before reusing its name for another folder.');
      }
      for (const folder of added) {
        try {
          await lstat(join(path, folder.name));
          throw new Error(`The workspace already contains an entry named ${folder.name}.`);
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
      }
      if (creating) {
        await mkdir(this.root, { recursive: true });
        await mkdir(path);
      }
      const created = [];
      const deleted = [];
      try {
        for (const folder of added) {
          await symlink(folder.path, join(path, folder.name), process.platform === 'win32' ? 'junction' : 'dir');
          created.push(folder);
        }
        for (const folder of removed) {
          const linkPath = join(path, folder.name);
          if (!(await lstat(linkPath)).isSymbolicLink() || resolve(path, await readlink(linkPath)) !== folder.path) {
            throw new Error(`Link changed while saving: ${folder.name}. Reload the workspace.`);
          }
          await unlink(linkPath);
          deleted.push(folder);
        }
      } catch (error) {
        for (const folder of deleted) await symlink(folder.path, join(path, folder.name), process.platform === 'win32' ? 'junction' : 'dir');
        for (const folder of created) await unlink(join(path, folder.name));
        if (creating) await rmdir(path);
        throw error;
      }
      return this.inspect(path);
    });
    this.pending = operation.catch(() => {});
    return operation;
  }
}
