import {
  chmod,
  readFile,
  stat,
  writeFile,
} from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const utf8Decoder = new TextDecoder('utf-8', { fatal: true });
const MAX_EXACT_PREVIEWS = 5;
const MAX_FUZZY_MATCHES = 3;
const MAX_FUZZY_CANDIDATES = 30;
const MAX_FUZZY_LINES = 20;
const MAX_FUZZY_CHARS = 4_000;
const MIN_FUZZY_SIMILARITY = 0.55;
const MAX_SNIPPET_LINES = 8;
const MAX_SNIPPET_LINE_LENGTH = 200;

function getLineEntries(content) {
  const lines = [];
  const lineBreakPattern = /\r\n|\n|\r/g;
  let start = 0;
  for (const match of content.matchAll(lineBreakPattern)) {
    lines.push({
      start,
      end: match.index,
      text: content.slice(start, match.index),
    });
    start = match.index + match[0].length;
  }
  lines.push({ start, end: content.length, text: content.slice(start) });
  return lines;
}

function normalizeForSimilarity(value) {
  return value
    .normalize('NFC')
    .trim()
    .replace(/\s+/gu, ' ')
    .slice(0, MAX_FUZZY_CHARS);
}

function createBigramProfile(value) {
  const pairs = new Map();
  for (let index = 0; index < value.length - 1; index += 1) {
    const pair = value.slice(index, index + 2);
    pairs.set(pair, (pairs.get(pair) ?? 0) + 1);
  }
  return {
    value,
    pairs,
    total: Math.max(value.length - 1, value.length),
  };
}

function compareBigramProfiles(left, right) {
  if (left.value === right.value) return 1;
  if (left.total === 0 || right.total === 0) return 0;

  let overlap = 0;
  for (const [pair, rightCount] of right.pairs) {
    overlap += Math.min(left.pairs.get(pair) ?? 0, rightCount);
  }
  return (2 * overlap) / (left.total + right.total);
}

function formatMatchSnippet(content, start, end) {
  const lines = getLineEntries(content);
  const lastMatchedOffset = Math.max(start, end - 1);
  let startLineIndex = lines.length - 1;
  let endLineIndex = lines.length - 1;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const nextStart = lines[lineIndex + 1]?.start ?? Number.POSITIVE_INFINITY;
    if (start < nextStart) {
      startLineIndex = lineIndex;
      break;
    }
  }
  for (let lineIndex = startLineIndex; lineIndex < lines.length; lineIndex += 1) {
    const nextStart = lines[lineIndex + 1]?.start ?? Number.POSITIVE_INFINITY;
    if (lastMatchedOffset < nextStart) {
      endLineIndex = lineIndex;
      break;
    }
  }

  const rangeStart = Math.max(0, startLineIndex - 2);
  const rangeEnd = Math.min(lines.length - 1, endLineIndex + 2);
  const indexes = Array.from(
    { length: rangeEnd - rangeStart + 1 },
    (_, index) => rangeStart + index,
  );
  const displayedIndexes = indexes.length <= MAX_SNIPPET_LINES
    ? indexes
    : [...indexes.slice(0, 4), null, ...indexes.slice(-3)];
  const numberWidth = String(rangeEnd + 1).length;
  const snippet = displayedIndexes.map((lineIndex) => {
    if (lineIndex === null) return `  ${'…'.padStart(numberWidth)} | …`;

    const line = lines[lineIndex];
    const isMatched = lineIndex >= startLineIndex && lineIndex <= endLineIndex;
    let text = line.text;
    if (text.length > MAX_SNIPPET_LINE_LENGTH) {
      const matchColumn = lineIndex === startLineIndex ? start - line.start : 0;
      const sliceStart = Math.min(
        Math.max(0, matchColumn - 60),
        text.length - MAX_SNIPPET_LINE_LENGTH,
      );
      const sliceEnd = Math.min(text.length, sliceStart + MAX_SNIPPET_LINE_LENGTH);
      text = `${sliceStart > 0 ? '…' : ''}${text.slice(sliceStart, sliceEnd)}${sliceEnd < line.text.length ? '…' : ''}`;
    }
    return `${isMatched ? '>' : ' '} ${String(lineIndex + 1).padStart(numberWidth)} | ${text}`;
  }).join('\n');

  return {
    location: startLineIndex === endLineIndex
      ? `line ${startLineIndex + 1}`
      : `lines ${startLineIndex + 1}-${endLineIndex + 1}`,
    snippet,
  };
}

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

  const normalizedReplacements = [];
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

    const occurrence = replacement.occurrence ?? 'unique';
    if (!['unique', 'all'].includes(occurrence)) {
      throw new Error(`Replacement ${index + 1} occurrence must be "unique" or "all".`);
    }
    if (replacement.expectedOccurrences !== undefined) {
      if (!Number.isInteger(replacement.expectedOccurrences) || replacement.expectedOccurrences < 1) {
        throw new Error(`Replacement ${index + 1} expectedOccurrences must be a positive integer.`);
      }
      if (occurrence !== 'all') {
        throw new Error(`Replacement ${index + 1} expectedOccurrences can only be used when occurrence is "all".`);
      }
    }
    normalizedReplacements.push({ ...replacement, occurrence });
  }

  const files = new Map();
  const results = [];
  let occurrencesReplaced = 0;
  for (const [index, replacement] of normalizedReplacements.entries()) {
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

    const matchIndexes = [];
    let searchFrom = 0;
    while (searchFrom <= file.after.length - replacement.oldString.length) {
      const matchIndex = file.after.indexOf(replacement.oldString, searchFrom);
      if (matchIndex < 0) break;
      matchIndexes.push(matchIndex);
      searchFrom = matchIndex + replacement.oldString.length;
    }

    const stateNote = index === 0
      ? ''
      : `\n\nDiagnostics reflect the in-memory state after replacements 1-${index}; no files were written.`;
    if (matchIndexes.length === 0) {
      const fileLines = getLineEntries(file.after);
      const oldLines = getLineEntries(replacement.oldString);
      const oldLineCount = Math.max(
        1,
        oldLines.length - (/\r\n$|\n$|\r$/.test(replacement.oldString) ? 1 : 0),
      );
      const fuzzyCandidates = [];
      if (oldLineCount <= MAX_FUZZY_LINES && oldLineCount <= fileLines.length) {
        const normalizedOldString = normalizeForSimilarity(replacement.oldString);
        const oldProfile = createBigramProfile(normalizedOldString);
        const lowerOldProfile = createBigramProfile(normalizedOldString.toLocaleLowerCase('en-US'));
        for (let lineIndex = 0; lineIndex <= fileLines.length - oldLineCount; lineIndex += 1) {
          const endLineIndex = lineIndex + oldLineCount - 1;
          const candidateStart = fileLines[lineIndex].start;
          const candidateEnd = fileLines[endLineIndex].end;
          const normalizedCandidate = normalizeForSimilarity(
            file.after.slice(candidateStart, candidateEnd),
          );
          if (normalizedCandidate === '') continue;

          const candidateProfile = createBigramProfile(normalizedCandidate);
          const lowerCandidateProfile = createBigramProfile(
            normalizedCandidate.toLocaleLowerCase('en-US'),
          );
          const similarity = (
            compareBigramProfiles(oldProfile, candidateProfile) * 0.85
            + compareBigramProfiles(lowerOldProfile, lowerCandidateProfile) * 0.15
          );
          if (similarity < MIN_FUZZY_SIMILARITY) continue;

          fuzzyCandidates.push({
            start: candidateStart,
            end: candidateEnd,
            startLineIndex: lineIndex,
            endLineIndex,
            similarity,
          });
          fuzzyCandidates.sort((left, right) => (
            right.similarity - left.similarity
            || left.startLineIndex - right.startLineIndex
          ));
          if (fuzzyCandidates.length > MAX_FUZZY_CANDIDATES) fuzzyCandidates.pop();
        }
      }

      const fuzzyMatches = [];
      for (const candidate of fuzzyCandidates) {
        const overlapsSelected = fuzzyMatches.some((selected) => (
          candidate.startLineIndex <= selected.endLineIndex
          && candidate.endLineIndex >= selected.startLineIndex
        ));
        if (!overlapsSelected) fuzzyMatches.push(candidate);
        if (fuzzyMatches.length === MAX_FUZZY_MATCHES) break;
      }
      const fuzzyDetails = fuzzyMatches.length === 0
        ? '  No sufficiently similar text was found.'
        : fuzzyMatches.map((match, matchIndex) => {
          const preview = formatMatchSnippet(file.after, match.start, match.end);
          return `Match ${matchIndex + 1} (${preview.location}, similarity ${Math.round(match.similarity * 100)}%):\n${preview.snippet}`;
        }).join('\n\n');
      const oldStringPreview = formatMatchSnippet(
        replacement.oldString,
        0,
        replacement.oldString.length,
      );
      const expectedNote = replacement.expectedOccurrences === undefined
        ? ''
        : ` Expected ${replacement.expectedOccurrences} exact occurrences.`;
      throw new Error(
        `Replacement ${index + 1} failed: oldString was not found in ${filePath}.${expectedNote}\n\nClosest matches (fuzzy):\n${fuzzyDetails}\n\nYour oldString was:\n${oldStringPreview.snippet}${stateNote}\n\nNo files were modified.`,
      );
    }

    const hasCountMismatch = replacement.occurrence === 'unique'
      ? matchIndexes.length > 1
      : replacement.expectedOccurrences !== undefined
        && matchIndexes.length !== replacement.expectedOccurrences;
    if (hasCountMismatch) {
      const reason = replacement.occurrence === 'unique'
        ? `oldString occurs ${matchIndexes.length} times in ${filePath}. Add more unique context, or set occurrence to "all" to replace every exact occurrence.`
        : `expectedOccurrences is ${replacement.expectedOccurrences}, but oldString occurs ${matchIndexes.length} ${matchIndexes.length === 1 ? 'time' : 'times'} in ${filePath}.`;
      const previews = matchIndexes.slice(0, MAX_EXACT_PREVIEWS).map((matchIndex, previewIndex) => {
        const preview = formatMatchSnippet(
          file.after,
          matchIndex,
          matchIndex + replacement.oldString.length,
        );
        return `Occurrence ${previewIndex + 1} (${preview.location}):\n${preview.snippet}`;
      });
      if (matchIndexes.length > MAX_EXACT_PREVIEWS) {
        previews.push(`Showing ${MAX_EXACT_PREVIEWS} of ${matchIndexes.length} occurrences.`);
      }
      throw new Error(
        `Replacement ${index + 1} failed: ${reason}\n\n${previews.join('\n\n')}${stateNote}\n\nNo files were modified.`,
      );
    }

    const selectedIndexes = replacement.occurrence === 'all'
      ? matchIndexes
      : [matchIndexes[0]];
    const parts = [];
    let unchangedStart = 0;
    for (const matchIndex of selectedIndexes) {
      parts.push(file.after.slice(unchangedStart, matchIndex), replacement.newString);
      unchangedStart = matchIndex + replacement.oldString.length;
    }
    parts.push(file.after.slice(unchangedStart));
    file.after = parts.join('');
    occurrencesReplaced += selectedIndexes.length;
    results.push({
      replacement: index + 1,
      occurrencesReplaced: selectedIndexes.length,
    });
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
    replacementsApplied: normalizedReplacements.length,
    occurrencesReplaced,
    results,
    filesChanged: changedFiles.length,
    files: changedFiles.map((file) => file.filePath),
    fileChanges: changedFiles.map((file) => ({
      filePath: file.filePath,
      before: file.before,
      after: file.after,
    })),
  };
}
