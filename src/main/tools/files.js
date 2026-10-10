import { readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { applyMultiReplaceFile } from '../multi-replace-file.js';

export const fileTools = [
  {
    name: 'multi_replace_file',
    description: 'Apply one or more exact text replacements across existing UTF-8 files as one atomic operation. Replacements run sequentially in input order and require one unique match by default. Errors include exact occurrence previews or fuzzy suggestions without applying approximate matches. Set occurrence to "all" only when every exact occurrence should be replaced, and optionally assert the count with expectedOccurrences. Use this by default for focused edits; use write_file for new files or intentional full-file replacement.',
    canEditFile: true,
    tracksFileChanges: true,
    canPerformDestructiveActions: false,
    inputSchema: {
      type: 'object',
      properties: {
        replacements: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            properties: {
              filePath: {
                type: 'string',
                minLength: 1,
                description: 'The absolute path of an existing UTF-8 text file.',
              },
              oldString: {
                type: 'string',
                minLength: 1,
                description: 'Exact text to replace in the current file state. It must occur once for occurrence "unique", or at least once for occurrence "all". Preserve whitespace and indentation.',
              },
              newString: {
                type: 'string',
                description: 'Replacement text. Whitespace, indentation, line endings, and final newline are preserved exactly as supplied.',
              },
              occurrence: {
                type: 'string',
                enum: ['unique', 'all'],
                description: 'Use "unique" (the default) to require exactly one match, or "all" to replace every non-overlapping exact match.',
              },
              expectedOccurrences: {
                type: 'integer',
                minimum: 1,
                description: 'Optional safety check for occurrence "all". The operation fails unless exactly this many matches exist.',
              },
            },
            required: ['filePath', 'oldString', 'newString'],
            additionalProperties: false,
          },
        },
      },
      required: ['replacements'],
      additionalProperties: false,
    },
    execute: async (input) => {
      const result = await applyMultiReplaceFile(input);
      return {
        output: [
          `Applied ${result.occurrencesReplaced} replacement occurrence(s) across ${result.filesChanged} file(s).`,
          ...result.files.map((filePath) => {
            const occurrences = result.results.reduce((total, item, index) => (
              resolve(input.replacements[index].filePath) === filePath
                ? total + item.occurrencesReplaced
                : total
            ), 0);
            return `- ${filePath}: ${occurrences} occurrence(s)`;
          }),
        ].join('\n'),
        fileChanges: result.fileChanges,
      };
    },
  },
  {
    name: 'write_file',
    description: 'Write complete UTF-8 text content to an absolute local file. Use this for new files or intentional full-file replacement; prefer multi_replace_file for focused edits to existing files.',
    canEditFile: true,
    tracksFileChanges: true,
    canPerformDestructiveActions: false,
    inputSchema: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: 'The absolute path of the file to create or replace.',
        },
        content: {
          type: 'string',
          description: 'The complete UTF-8 text content to write.',
        },
      },
      required: ['filePath', 'content'],
      additionalProperties: false,
    },
    execute: async ({ filePath, content }) => {
      if (!isAbsolute(String(filePath ?? ''))) throw new Error('filePath must be absolute.');
      if (typeof content !== 'string') throw new Error('content must be a string.');

      let beforeContent = null;
      try {
        beforeContent = await readFile(filePath, 'utf8');
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
      await writeFile(filePath, content, 'utf8');
      const fileChanges = beforeContent === content ? [] : [{
        filePath,
        before: beforeContent,
        after: content,
      }];
      return {
        output: fileChanges.length === 0
          ? `File unchanged: ${filePath}.`
          : `Wrote ${Buffer.byteLength(content, 'utf8')} bytes to ${filePath}.`,
        fileChanges,
      };
    },
  },
  {
    name: 'read_file',
    description: 'Read an inclusive range of lines from a local file.',
    canEditFile: false,
    canPerformDestructiveActions: false,
    inputSchema: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: 'The absolute path of the file to read.',
        },
        startLine: {
          type: 'number',
          description: 'The line number to start reading from, 1-based.',
        },
        endLine: {
          type: 'number',
          description: 'The inclusive line number to end reading at, 1-based.',
        },
      },
      required: ['filePath', 'startLine', 'endLine'],
    },
    execute: async ({ filePath, startLine, endLine }) => {
      if (!isAbsolute(String(filePath ?? ''))) throw new Error('filePath must be absolute.');
      if (!Number.isInteger(startLine) || startLine < 1) {
        throw new Error('startLine must be a positive integer.');
      }
      if (!Number.isInteger(endLine) || endLine < startLine) {
        throw new Error('endLine must be an integer greater than or equal to startLine.');
      }

      const content = await readFile(filePath, 'utf8');
      const lines = content.replaceAll('\r\n', '\n').split('\n');
      return lines.slice(startLine - 1, endLine).join('\n');
    },
  },
];
