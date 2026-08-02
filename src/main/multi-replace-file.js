import {
  chmod,
  readFile,
  stat,
  writeFile,
} from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const utf8Decoder = new TextDecoder('utf-8', { fatal: true });

export async function applyMultiReplaceFile(
  { replacements },
  fileSystemOverride,
) {
  const fileSystem = ['chmod', 'readFile', 'stat', 'writeFile'].every(
    (method) => typeof fileSystemOverride?.[method] === 'function',
  )
    ? fileSystemOverride
    : { chmod, readFile, stat, writeFile };

  if (!Array.isArray(replacements) || replacements.length === 0) {
    throw new Error('replacements must contain at least one replacement.');
  }

  for (const [index, replacement] of replacements.entries()) {
    if (!replacement || typeof replacement !== 'object') {
      throw new Error(`Replacement ${index + 1} must be an object.`);
    }
    if (!isAbsolute(String(replacement.filePath ?? ''))) {
      throw new Error(`Replacement ${index + 1} filePath must be absolute.`);
    }
    if (typeof replacement.oldString !== 'string' || replacement.oldString === '') {
      throw new Error(`Replacement ${index + 1} oldString must be a non-empty string.`);
    }
    if (typeof replacement.newString !== 'string') {
      throw new Error(`Replacement ${index + 1} newString must be a string.`);
    }
    if (replacement.oldString === replacement.newString) {
      throw new Error(`Replacement ${index + 1} oldString and newString must differ.`);
    }
  }

  const files = new Map();
  for (const [index, replacement] of replacements.entries()) {
    const filePath = resolve(replacement.filePath);
    const key = process.platform === 'win32' ? filePath.toLowerCase() : filePath;
    let file = files.get(key);
    if (!file) {
      let fileStat;
      let originalBytes;
      try {
        [fileStat, originalBytes] = await Promise.all([
          fileSystem.stat(filePath),
          fileSystem.readFile(filePath),
        ]);
      } catch (error) {
        throw new Error(`Could not read replacement file ${filePath}: ${error.message}`, { cause: error });
      }
      if (!fileStat.isFile()) {
        throw new Error(`Replacement file is not a regular file: ${filePath}`);
      }

      const hasBom = originalBytes.subarray(0, UTF8_BOM.length).equals(UTF8_BOM);
      const contentBytes = hasBom ? originalBytes.subarray(UTF8_BOM.length) : originalBytes;
      if (contentBytes.includes(0)) {
        throw new Error(`Replacement file is not a supported text file: ${filePath}`);
      }
      try {
        file = {
          filePath,
          originalBytes,
          before: utf8Decoder.decode(contentBytes),
          mode: fileStat.mode & 0o7777,
          hasBom,
        };
      } catch (error) {
        throw new Error(`Replacement file is not valid UTF-8 text: ${filePath}`, { cause: error });
      }
      file.after = file.before;
      files.set(key, file);
    }

    const firstMatch = file.after.indexOf(replacement.oldString);
    const secondMatch = firstMatch < 0
      ? -1
      : file.after.indexOf(replacement.oldString, firstMatch + 1);
    if (firstMatch < 0) {
      throw new Error(`Replacement ${index + 1} oldString was not found in ${filePath}. No files were modified.`);
    }
    if (secondMatch >= 0) {
      throw new Error(`Replacement ${index + 1} oldString occurs more than once in ${filePath}. Add more exact surrounding context. No files were modified.`);
    }
    file.after = `${file.after.slice(0, firstMatch)}${replacement.newString}${file.after.slice(firstMatch + replacement.oldString.length)}`;
  }

  const changedFiles = [...files.values()].filter((file) => file.before !== file.after);
  const attemptedFiles = [];
  try {
    for (const file of changedFiles) {
      attemptedFiles.push(file);
      const contentBytes = Buffer.from(file.after, 'utf8');
      await fileSystem.writeFile(
        file.filePath,
        file.hasBom ? Buffer.concat([UTF8_BOM, contentBytes]) : contentBytes,
      );
      await fileSystem.chmod(file.filePath, file.mode);
    }
  } catch (writeError) {
    const rollbackErrors = [];
    for (const file of attemptedFiles.reverse()) {
      try {
        await fileSystem.writeFile(file.filePath, file.originalBytes);
        await fileSystem.chmod(file.filePath, file.mode);
      } catch (rollbackError) {
        rollbackErrors.push(`${file.filePath}: ${rollbackError.message}`);
      }
    }
    const rollbackMessage = rollbackErrors.length === 0
      ? 'All attempted writes were rolled back.'
      : `Rollback also failed for: ${rollbackErrors.join('; ')}`;
    throw new Error(`multi_replace_file could not write all files: ${writeError.message}. ${rollbackMessage}`, { cause: writeError });
  }

  return {
    replacementsApplied: replacements.length,
    filesChanged: changedFiles.length,
    files: changedFiles.map((file) => file.filePath),
    fileChanges: changedFiles.map((file) => ({
      filePath: file.filePath,
      before: file.before,
      after: file.after,
    })),
  };
}
