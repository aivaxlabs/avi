import { lstat, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

const defaultTemporaryStoragePath = resolve(tmpdir(), '.avi');

export async function getTemporaryStorage(directory = defaultTemporaryStoragePath) {
  const root = resolve(directory);
  const directories = [root];
  let bytes = 0;

  while (directories.length > 0) {
    const current = directories.pop();
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw error;
    }

    for (const entry of entries) {
      const entryPath = resolve(current, entry.name);
      if (entry.isDirectory()) {
        directories.push(entryPath);
        continue;
      }

      try {
        bytes += (await lstat(entryPath)).size;
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
    }
  }

  return { path: root, bytes };
}

export async function clearTemporaryStorage(directory = defaultTemporaryStoragePath) {
  const root = resolve(directory);
  await rm(root, { recursive: true, force: true });
  return getTemporaryStorage(root);
}
