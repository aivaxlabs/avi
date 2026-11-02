import { randomInt } from 'node:crypto';
import {
  deleteSecretVaultEntry,
  getSecretVaultValue,
  listSecretVaultEntries,
  saveSecretVaultEntry,
} from '../database.js';

const PLACEHOLDER_TTL_MS = 60_000;
const PLACEHOLDER_PATTERN = /\{\{([A-Za-z0-9_.@-]{1,128}):([A-Z0-9]{10})\}\}/g;
const MIN_REDACTED_LENGTH = 4;
// Avi's own conversation, memory, and scheduling tools persist their input into chat history,
// other threads, or remote memory, so placeholders stay unresolved there.
const UNRESOLVED_TOOL_PATTERN = /^(chat_|bots_|bot_|memory_|task_scheduler_|secret_vault_|quick_chat_)|^(ask_question|update_tasks|update_semaphore_status|start_goal|update_goal_status|dispatch_sidekick|invoke_rubber_duck|rubber_duck_ask_agent|rubber_duck_submit_report)$/;

const placeholders = new Map();
const revealedByConversation = new Map();

function issuePlaceholder(name, conversationId) {
  const now = Date.now();
  for (const [token, entry] of placeholders) {
    if (entry.expiresAt <= now) placeholders.delete(token);
  }
  let token;
  do {
    token = Array.from({ length: 10 }, () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[randomInt(36)]).join('');
  } while (placeholders.has(token));
  const expiresAt = now + PLACEHOLDER_TTL_MS;
  placeholders.set(token, { name, conversationId, expiresAt });
  return { placeholder: `{{${name}:${token}}}`, expiresAt };
}

function resolveString(text, conversationId, revealed) {
  return text.replace(PLACEHOLDER_PATTERN, (placeholder, name, token) => {
    const entry = placeholders.get(token);
    if (!entry || entry.name !== name || entry.conversationId !== conversationId) {
      throw new Error(`Secret placeholder ${placeholder} is not valid in this thread. Call secret_vault_get again.`);
    }
    if (entry.expiresAt <= Date.now()) {
      placeholders.delete(token);
      throw new Error(`Secret placeholder ${placeholder} expired. Call secret_vault_get again.`);
    }
    const value = getSecretVaultValue(name);
    if (value === null) throw new Error(`Secret "${name}" no longer exists in the Secret Vault.`);
    revealed.set(value, name);
    return value;
  });
}

function resolveValue(value, conversationId, revealed) {
  if (typeof value === 'string') return resolveString(value, conversationId, revealed);
  if (Array.isArray(value)) return value.map((item) => resolveValue(item, conversationId, revealed));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      resolveValue(item, conversationId, revealed),
    ]));
  }
  return value;
}

/**
 * Replaces Secret Vault placeholders with their values in a tool's in-memory input.
 * The persisted tool call, approvals, and interceptors keep seeing the placeholders.
 */
export function resolveSecretPlaceholders(toolName, input, conversationId) {
  if (UNRESOLVED_TOOL_PATTERN.test(toolName) || !JSON.stringify(input ?? null).includes('{{')) return input;
  const revealed = revealedByConversation.get(conversationId) ?? new Map();
  const resolved = resolveValue(input, conversationId, revealed);
  if (revealed.size > 0) revealedByConversation.set(conversationId, revealed);
  return resolved;
}

/** Masks every secret value resolved earlier in the thread before tool output reaches the model or chat. */
export function redactSecrets(text, conversationId) {
  const revealed = revealedByConversation.get(conversationId);
  if (!revealed || typeof text !== 'string') return text;
  let redacted = text;
  for (const [value, name] of [...revealed].sort(([a], [b]) => b.length - a.length)) {
    if (value.length >= MIN_REDACTED_LENGTH) redacted = redacted.replaceAll(value, `[secret:${name}]`);
  }
  return redacted;
}

export const secretVaultTools = [
  {
    name: 'secret_vault_put',
    description: [
      'Save, replace, or remove a value in the Secret Vault, the encrypted on-device store for credentials.',
      'Save every login, password, API key, token, or similar credential the user provides or that you generate, instead of keeping it in files or memory.',
      'Store one value per entry with dotted names, for example user_john_doe_gmail.email and user_john_doe_gmail.password; never combine several values in one entry.',
      'An empty or omitted content removes the entry.',
    ].join(' '),
    canEditFile: false,
    // Both flags are false so Smart Approve never forwards the raw value to a remote decision model.
    canPerformDestructiveActions: false,
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          minLength: 1,
          maxLength: 128,
          pattern: '^[A-Za-z0-9_.@-]+$',
          description: 'Entry name using letters, digits, ".", "_", "-", or "@", such as service_account.api_key.',
        },
        content: {
          type: ['string', 'null'],
          description: 'The secret value. Null, empty, or omitted removes the entry.',
        },
        description: {
          type: 'string',
          description: 'Optional non-secret note about what the value is for.',
        },
        overwrite: {
          type: 'boolean',
          description: 'Set to true to replace an existing entry. Defaults to false.',
        },
      },
      required: ['name'],
      additionalProperties: false,
    },
    execute: ({ name, content, description, overwrite }) => {
      if (!content) {
        return deleteSecretVaultEntry(name)
          ? `Secret "${name}" removed.`
          : `Secret "${name}" was not found.`;
      }
      const exists = getSecretVaultValue(name) !== null;
      if (exists && overwrite !== true) {
        throw new Error(`Secret "${name}" already exists. Set overwrite to true to replace it.`);
      }
      saveSecretVaultEntry({ name, value: content, description });
      return `Secret "${name}" ${exists ? 'replaced' : 'saved'}.`;
    },
  },
  {
    name: 'secret_vault_list',
    description: 'List Secret Vault entry names, descriptions, and dates. Values are never returned.',
    approval: 'never',
    canEditFile: false,
    canPerformDestructiveActions: false,
    inputSchema: {
      type: 'object',
      properties: {
        filter: {
          type: 'string',
          description: 'Optional case-insensitive text matched against names and descriptions.',
        },
      },
      additionalProperties: false,
    },
    execute: ({ filter }) => {
      const query = String(filter ?? '').trim().toLowerCase();
      const entries = listSecretVaultEntries().filter((entry) => !query
        || entry.name.toLowerCase().includes(query)
        || entry.description.toLowerCase().includes(query));
      if (entries.length === 0) return query ? `No secrets match "${filter}".` : 'The Secret Vault is empty.';
      return entries.map((entry) => [
        `- ${entry.name}`,
        entry.description && `  Description: ${entry.description}`,
        `  Created: ${entry.createdAt}`,
        `  Updated: ${entry.updatedAt}`,
      ].filter(Boolean).join('\n')).join('\n');
    },
  },
  {
    name: 'secret_vault_get',
    description: [
      'Export a Secret Vault entry as a temporary placeholder that is valid for 1 minute in this thread; the value itself is never returned.',
      'Put the exact placeholder anywhere in the arguments of a later tool call, such as a terminal command, request body, or environment variable assignment, and the runtime substitutes the real value only for that execution.',
      'Never print, echo, log, or write the placeholder or the resolved value to a file, chat message, or memory. Placeholders are not resolved in chat, thread, bot, memory, or scheduler tools.',
      'Tool output containing a resolved value is masked as [secret:<name>].',
    ].join(' '),
    approval: 'never',
    canEditFile: false,
    canPerformDestructiveActions: false,
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          minLength: 1,
          description: 'Exact entry name, as returned by secret_vault_list.',
        },
      },
      required: ['name'],
      additionalProperties: false,
    },
    execute: ({ name }, { conversationId }) => {
      if (getSecretVaultValue(name) === null) throw new Error(`Secret "${name}" was not found.`);
      const { placeholder, expiresAt } = issuePlaceholder(name, conversationId);
      return `Key exported as ${placeholder}, expires at ${new Date(expiresAt).toISOString()}`;
    },
  },
];
