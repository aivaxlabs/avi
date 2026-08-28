import { createHash } from 'node:crypto';
import { answerTextFromTextualBlocks } from '../shared/textual-blocks.js';

export const THREAD_SEARCH_SYNC_INTERVAL_MS = 15 * 60 * 1_000;
export const THREAD_SEARCH_COMPONENT_CHAR_LIMIT = 256 * 4;
export const THREAD_SEARCH_TURN_LIMIT = 3;

const truncateComponent = (value) => String(value ?? '').trim().slice(0, THREAD_SEARCH_COMPONENT_CHAR_LIMIT);

export function buildThreadSearchDocuments(messages) {
  const threads = new Map();
  for (const message of messages) {
    if (message.hidden) continue;
    const thread = threads.get(message.conversationId) ?? {
      id: message.conversationId,
      title: message.conversationTitle,
      pendingUser: null,
      turns: [],
    };
    threads.set(message.conversationId, thread);
    if (
      message.role === 'user'
      && !message.fromAgent
      && ['sent', 'completed'].includes(message.status)
    ) {
      thread.pendingUser = message;
    } else if (
      message.role === 'assistant'
      && message.status === 'completed'
      && thread.pendingUser
    ) {
      const userText = truncateComponent(thread.pendingUser.content);
      const assistantText = truncateComponent(answerTextFromTextualBlocks(message.content));
      if (userText && assistantText) {
        thread.turns.push({
          userMessageId: thread.pendingUser.id,
          assistantMessageId: message.id,
          userText,
          assistantText,
          updatedAt: message.updatedAt,
        });
      }
      thread.pendingUser = null;
    }
  }

  return [...threads.values()].flatMap((thread) => (
    thread.turns.slice(-THREAD_SEARCH_TURN_LIMIT).map((turn) => {
      const title = truncateComponent(thread.title);
      const docid = `avi-thread:${thread.id}:${turn.userMessageId}`;
      return {
        docid,
        text: [`Title: ${title}`, `User: ${turn.userText}`, `Assistant: ${turn.assistantText}`].join('\n'),
        __ref: thread.id,
        __tags: ['avi', 'thread-search'],
        __meta: {
          source: 'avi-thread-search',
          formatVersion: 1,
          threadId: thread.id,
          userMessageId: turn.userMessageId,
          assistantMessageId: turn.assistantMessageId,
          title,
          updatedAt: turn.updatedAt,
        },
      };
    })
  ));
}

export function createThreadSearchManifest(documents) {
  return Object.fromEntries(documents.map((document) => [
    document.docid,
    createHash('sha256').update(JSON.stringify(document)).digest('hex'),
  ]));
}

export function compareThreadSearchManifests(previous = {}, next = {}) {
  let added = 0;
  let updated = 0;
  let skipped = 0;
  for (const [docid, hash] of Object.entries(next)) {
    if (!(docid in previous)) added += 1;
    else if (previous[docid] === hash) skipped += 1;
    else updated += 1;
  }
  return {
    added,
    updated,
    skipped,
    removed: Object.keys(previous).filter((docid) => !(docid in next)).length,
  };
}
