import {
  ensureConversation,
  deleteMessage,
  getConversation,
  getMessages,
  getMessage,
  insertMessage,
  setLastModel,
  toOpenAiMessages,
  toOpenAiMessagesThroughUser,
  updateConversation,
  updateMessage,
} from './database.js';
import {
  authHeaders,
  chatRequestBody,
  generateContinuations,
  generateTitle,
} from './aivax-api.js';

const baseUrl = 'https://inference.aivax.net';

export class ChatRunner {
  constructor({ getToken, sendEvent, debugStream = false }) {
    this.getToken = getToken;
    this.sendEvent = sendEvent;
    this.debugStream = debugStream;
    this.getWorkspaceId = () => null;
    this.runs = new Map();
  }

  setWorkspaceGetter(getWorkspaceId) {
    this.getWorkspaceId = getWorkspaceId;
  }

  async send({ conversationId, model, text, attachments = [], steer = false }) {
    const conversation = ensureConversation(conversationId, model);
    setLastModel(model);

    if (this.runs.has(conversation.id)) {
      const queued = this.createUserMessage({
        conversationId: conversation.id,
        text,
        attachments,
        status: steer ? 'steered' : 'queued',
      });
      const run = this.runs.get(conversation.id);
      if (steer) {
        run.queue.unshift({ userMessageId: queued.id, model, text, attachments });
        run.controller.abort('steer');
      } else {
        run.queue.push({ userMessageId: queued.id, model, text, attachments });
      }
      this.emit(conversation.id, { type: 'message', message: queued });
      return { conversation: getConversation(conversation.id), message: queued, queued: true };
    }

    const userMessage = this.createUserMessage({
      conversationId: conversation.id,
      text,
      attachments,
      status: 'sent',
    });
    this.emit(conversation.id, { type: 'message', message: userMessage });
    this.start({
      conversationId: conversation.id,
      model,
      text,
      attachments,
      userMessageId: userMessage.id,
    });
    return { conversation: getConversation(conversation.id), message: userMessage, queued: false };
  }

  stop(conversationId) {
    const run = this.runs.get(conversationId);
    if (run) {
      run.queue = [];
      run.controller.abort('stop');
    }
  }

  cancelQueuedMessage({ conversationId, messageId }) {
    const run = this.runs.get(conversationId);
    if (run) {
      run.queue = run.queue.filter((item) => item.userMessageId !== messageId);
    }

    const message = getMessage(messageId);
    if (!message || !['queued', 'steered'].includes(message.status)) {
      return { conversation: getConversation(conversationId), cancelled: false };
    }

    deleteMessage(messageId);
    this.emit(conversationId, { type: 'message-delete', messageId });
    return { conversation: getConversation(conversationId), cancelled: true };
  }

  async retry({ conversationId, model, assistantMessageId }) {
    const conversation = ensureConversation(conversationId, model);
    setLastModel(model);

    if (this.runs.has(conversation.id)) {
      return { conversation: getConversation(conversation.id), message: null, queued: true };
    }

    const messages = toOpenAiMessagesThroughUser(conversation.id, assistantMessageId);
    if (messages.length === 0) {
      return { conversation: getConversation(conversation.id), message: null, queued: false };
    }

    const conversationMessages = getMessages(conversation.id);
    const assistantIndex = conversationMessages.findIndex((message) => message.id === assistantMessageId);
    const searchEnd = assistantIndex >= 0 ? assistantIndex : conversationMessages.length;
    const lastUserIndex = conversationMessages
      .slice(0, searchEnd)
      .findLastIndex((message) => message.role === 'user' && ['sent', 'completed'].includes(message.status));
    const staleMessages = lastUserIndex >= 0 ? conversationMessages.slice(lastUserIndex + 1) : [];
    for (const message of staleMessages) {
      deleteMessage(message.id);
      this.emit(conversation.id, { type: 'message-delete', messageId: message.id });
    }

    this.start({
      conversationId: conversation.id,
      model,
      retryMessages: messages,
    });

    return { conversation: getConversation(conversation.id), message: null, queued: false };
  }

  createUserMessage({ conversationId, text, attachments, status }) {
    const message = insertMessage({
      conversationId,
      role: 'user',
      status,
      content: text,
      attachments,
    });

    const conversation = getConversation(conversationId);
    if (conversation?.titleStatus === 'pending' && conversation.title === 'New chat' && text.trim()) {
      updateConversation(conversationId, {
        title: shortTitle(text),
        titleStatus: 'pending',
      });
      this.emit(conversationId, { type: 'conversation', conversation: getConversation(conversationId) });
    }

    return message;
  }

  async start({ conversationId, model, userMessageId = null, queue = [], retryMessages = null }) {
    const token = this.getToken();
    if (!token) {
      if (userMessageId) {
        const message = updateMessage(userMessageId, { status: 'error' });
        this.emit(conversationId, { type: 'message', message });
      }
      return;
    }

    const controller = new AbortController();
    const assistantMessage = insertMessage({
      conversationId,
      role: 'assistant',
      status: 'streaming',
      content: '',
    });
    const run = {
      controller,
      queue,
      assistantMessageId: assistantMessage.id,
      content: '',
      model,
    };
    this.runs.set(conversationId, run);
    this.emit(conversationId, { type: 'message', message: assistantMessage });
    this.emit(conversationId, { type: 'run-state', running: true });

    const requestStartedAt = Date.now();
    this.logChatTiming(conversationId, {
      phase: 'request-start',
      assistantMessageId: assistantMessage.id,
      model,
    });

    try {
      const messages = retryMessages ?? toOpenAiMessages(conversationId, { excludeMessageId: assistantMessage.id });
      const body = JSON.stringify(chatRequestBody({ model, messages, user: this.getWorkspaceId() }));
      this.logChatTiming(conversationId, {
        phase: 'request-body-ready',
        assistantMessageId: assistantMessage.id,
        model,
        messages: messages.length,
        bodyBytes: Buffer.byteLength(body),
        elapsedMs: Date.now() - requestStartedAt,
      });
      const response = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          ...authHeaders(token),
          'Sse-Stream-Options': 'no-ping',
        },
        body,
        signal: controller.signal,
      });
      this.logChatTiming(conversationId, {
        phase: 'response-headers',
        assistantMessageId: assistantMessage.id,
        model,
        status: response.status,
        elapsedMs: Date.now() - requestStartedAt,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || response.statusText);
      }

      await this.consumeStream(response.body, run, conversationId, requestStartedAt);
      const finalMessage = updateMessage(assistantMessage.id, {
        status: 'completed',
        content: run.content,
      });
      this.emit(conversationId, { type: 'message', message: finalMessage });
      this.logChatTiming(conversationId, {
        phase: 'message-completed',
        assistantMessageId: assistantMessage.id,
        model,
        contentChars: run.content.length,
        elapsedMs: Date.now() - requestStartedAt,
      });
      await this.finishUtilities({ conversationId, token, assistantMessageId: assistantMessage.id, requestStartedAt });
    } catch (error) {
      const aborted = controller.signal.aborted;
      const finalMessage = updateMessage(assistantMessage.id, {
        status: aborted ? 'aborted' : 'error',
        content: run.content,
      });
      this.emit(conversationId, { type: 'message', message: finalMessage });
      if (!aborted) {
        this.logChatTiming(conversationId, {
          phase: 'request-error',
          assistantMessageId: assistantMessage.id,
          model,
          elapsedMs: Date.now() - requestStartedAt,
          error: error instanceof Error ? error.message : String(error),
        });
        this.emit(conversationId, {
          type: 'error',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    } finally {
      const current = this.runs.get(conversationId);
      this.runs.delete(conversationId);
      const pendingQueue = current?.queue ?? [];
      const next = pendingQueue.shift();
      if (next) {
        const sentMessage = updateMessage(next.userMessageId, { status: 'sent' });
        this.emit(conversationId, { type: 'message', message: sentMessage });
        this.start({
          conversationId,
          model: next.model,
          text: next.text,
          attachments: next.attachments,
          userMessageId: next.userMessageId,
          queue: pendingQueue,
        });
      } else {
        this.emit(conversationId, { type: 'run-state', running: false });
      }
    }
  }

  async consumeStream(body, run, conversationId, requestStartedAt) {
    const decoder = new TextDecoder();
    const reader = body.getReader();
    let buffer = '';
    let lastPersisted = 0;
    let chunkIndex = 0;
    let payloadIndex = 0;
    let sawFirstChunk = false;
    let sawFirstPayload = false;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      chunkIndex += 1;
      if (!sawFirstChunk) {
        sawFirstChunk = true;
        this.logChatTiming(conversationId, {
          phase: 'first-stream-chunk',
          assistantMessageId: run.assistantMessageId,
          model: run.model,
          elapsedMs: Date.now() - requestStartedAt,
          chunkBytes: value.byteLength,
        });
      }
      this.logStreamChunk(conversationId, {
        kind: 'chunk',
        chunkIndex,
        text: chunk,
      });
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const rawLine of lines) {
        const line = rawLine.trimEnd();
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        payloadIndex += 1;
        if (!sawFirstPayload) {
          sawFirstPayload = true;
          this.logChatTiming(conversationId, {
            phase: 'first-sse-payload',
            assistantMessageId: run.assistantMessageId,
            model: run.model,
            elapsedMs: Date.now() - requestStartedAt,
          });
        }
        this.logStreamChunk(conversationId, {
          kind: 'payload',
          chunkIndex,
          payloadIndex,
          payload,
        });
        if (payload === '[DONE]') {
          this.logChatTiming(conversationId, {
            phase: 'stream-done',
            assistantMessageId: run.assistantMessageId,
            model: run.model,
            elapsedMs: Date.now() - requestStartedAt,
            chunks: chunkIndex,
            payloads: payloadIndex,
            contentChars: run.content.length,
          });
          this.logStreamChunk(conversationId, {
            kind: 'done',
            chunkIndex,
            payloadIndex,
          });
          return;
        }

        const payloadResult = contentFromSsePayload(payload);
        if (payloadResult.error) {
          run.content = appendStreamError(run.content, payloadResult.error);
          throw new Error(payloadResult.error.message);
        }

        if (payloadResult.content) {
          run.content += payloadResult.content;
          this.logStreamChunk(conversationId, {
            kind: 'delta',
            chunkIndex,
            payloadIndex,
            deltaContent: payloadResult.content,
            accumulatedContent: run.content,
          });
        }

        const now = Date.now();
        if (now - lastPersisted > 120) {
          lastPersisted = now;
          const message = updateMessage(run.assistantMessageId, {
            status: 'streaming',
            content: run.content,
          });
          this.emit(conversationId, { type: 'message', message });
        }
      }
    }
  }

  logChatTiming(conversationId, details) {
    console.log('[AIVAX chat timing]', {
      conversationId,
      ...details,
    });
  }

  logStreamChunk(conversationId, details) {
    if (!this.debugStream) return;
    const payload = {
      type: 'debug',
      scope: 'stream',
      conversationId,
      ...details,
    };
    console.log('[AIVAX stream]', payload);
    this.emit(conversationId, payload);
  }

  async finishUtilities({ conversationId, token, assistantMessageId, requestStartedAt }) {
    const conversation = getConversation(conversationId);
    const messages = toOpenAiMessages(conversationId);
    const assistant = getMessage(assistantMessageId);

    if (conversation?.titleStatus === 'pending' && messages.length >= 2) {
      try {
        const startedAt = Date.now();
        const title = await generateTitle(token, messages);
        this.logChatTiming(conversationId, {
          phase: 'title-generated',
          assistantMessageId,
          elapsedMs: Date.now() - requestStartedAt,
          utilityMs: Date.now() - startedAt,
        });
        if (title) {
          updateConversation(conversationId, { title, titleStatus: 'generated' });
          this.emit(conversationId, { type: 'conversation', conversation: getConversation(conversationId) });
        }
      } catch (error) {
        this.logChatTiming(conversationId, {
          phase: 'title-error',
          assistantMessageId,
          elapsedMs: Date.now() - requestStartedAt,
          error: error instanceof Error ? error.message : String(error),
        });
        updateConversation(conversationId, { titleStatus: 'failed' });
      }
    }

    if (assistant?.content?.trim()) {
      try {
        const startedAt = Date.now();
        const continuations = await generateContinuations(token, messages);
        this.logChatTiming(conversationId, {
          phase: 'continuations-generated',
          assistantMessageId,
          elapsedMs: Date.now() - requestStartedAt,
          utilityMs: Date.now() - startedAt,
          continuations: continuations.length,
        });
        const message = updateMessage(assistantMessageId, { continuations });
        this.emit(conversationId, { type: 'message', message });
      } catch (error) {
        this.logChatTiming(conversationId, {
          phase: 'continuations-error',
          assistantMessageId,
          elapsedMs: Date.now() - requestStartedAt,
          error: error instanceof Error ? error.message : String(error),
        });
        return;
      }
    }
  }

  emit(conversationId, payload) {
    this.sendEvent({ conversationId, ...payload });
  }
}

function shortTitle(text) {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > 48 ? `${normalized.slice(0, 48)}...` : normalized || 'New chat';
}

function contentFromSsePayload(payload) {
  try {
    const json = JSON.parse(payload);
    const error = streamErrorFromPayload(json);
    if (error) {
      return { content: '', error };
    }

    const content = json.choices
      ?.map((choice) => choice.delta?.content)
      .filter((content) => typeof content === 'string')
      .join('') ?? '';
    return { content, error: null };
  } catch {
    return { content: '', error: null };
  }
}

function streamErrorFromPayload(json) {
  const directError = errorFromValue(json?.error);
  if (directError) return directError;

  const erroredChoice = Array.isArray(json?.choices)
    ? json.choices.find((choice) => choice?.finish_reason === 'error')
    : null;
  if (!erroredChoice) return null;

  return {
    code: 'stream_error',
    message: 'The provider returned an error while streaming.',
  };
}

function errorFromValue(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    return { code: 'stream_error', message: value };
  }
  if (typeof value !== 'object') return null;

  const message = stringValue(value.message)
    ?? stringValue(value.error)
    ?? 'The provider returned an error while streaming.';
  return {
    code: stringValue(value.code) ?? 'stream_error',
    message,
  };
}

function appendStreamError(content, error) {
  const code = error.code ? ` (${error.code})` : '';
  const errorText = `**Streaming error${code}:** ${error.message}`;
  return content.trim() ? `${content.trimEnd()}\n\n${errorText}` : errorText;
}

function stringValue(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
