import { searchSemanticGrep } from '../semantic-grep.js';

export const semanticGrepTools = [
  {
    name: 'file_search',
    description: 'Search indexed source files by meaning under the current chat directory, including indexed subfolders. Use this as the first search when looking for behavior or related code. It does not replace exact search: if it returns no matches, use rg or a similar tool. Results are file paths and source line ranges, not file contents.',
    approval: 'never',
    canEditFile: false,
    canPerformDestructiveActions: false,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: {
          type: 'string',
          minLength: 1,
          description: 'What to find, in natural language or with the symbols you expect.',
        },
        top: {
          type: 'integer',
          minimum: 1,
          maximum: 30,
          description: 'Maximum number of files to return. Defaults to 20.',
        },
      },
      required: ['query'],
    },
    execute: ({ query, top }, { aivax, signal, workspacePath }) => searchSemanticGrep({
      query,
      directory: workspacePath,
      top,
      signal,
      settings: aivax,
    }),
  },
];
