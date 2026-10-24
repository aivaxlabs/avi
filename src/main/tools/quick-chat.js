import { stat } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { getConversation, updateConversationProject } from '../database.js';

export const setDirectoryTool = {
  name: 'set_directory',
  description: 'Change the directory this Quick chat runs in. The next model step loads that directory\'s instructions, skills, workflows, and MCP servers, and file and terminal tools use it as the workspace. Only available in Quick chat. Sibling tool calls in the same step still use the previous directory.',
  canEditFile: false,
  canPerformDestructiveActions: false,
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        minLength: 1,
        description: 'Absolute path of an existing directory.',
      },
    },
    required: ['path'],
    additionalProperties: false,
  },
  execute: async (input, context = {}) => {
    const conversation = getConversation(context.conversationId);
    if (!conversation?.isQuickChat) {
      throw new Error('set_directory is only available in Quick chat.');
    }
    const path = resolve(String(input.path ?? ''));
    if (!isAbsolute(path)) throw new Error('Directory path must be absolute.');
    const info = await stat(path).catch(() => null);
    if (!info?.isDirectory()) throw new Error(`Directory does not exist: ${path}`);
    updateConversationProject(conversation.id, path);
    context.chatRunner?.emitConversation?.(conversation.id);
    const updated = getConversation(conversation.id);
    return {
      output: `Quick chat directory is now ${updated.projectDisplayPath} (${updated.projectPath}). Instructions, skills, workflows, and MCP servers for this directory apply on the next step.`,
    };
  },
};
