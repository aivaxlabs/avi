import {
  ensureConversation,
  getConversation,
  getMessage,
  insertMessage,
  setLastModel,
  toOpenAiMessages,
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
  constructor({ getToken, sendEvent }) {
    this.getToken = getToken;
    this.sendEvent = sendEvent;
    this.runs = new Map();
  }

  async send({ conversationId, model, text, attachments = [], steer = false }) {
    const conversation = ensureConversation(conversationId, model);
    setLastModel(model);

    if (this.runs.has(conversation.id)) {
      const queued = this.createUserMessage({
        conversationId: conversation.id,
        text,
        attachments,
        status: 'queued',
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

  async start({ conversationId, model, userMessageId, queue = [] }) {
    const token = this.getToken();
    if (!token) {
      const message = updateMessage(userMessageId, { status: 'error' });
      this.emit(conversationId, { type: 'message', message });
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

    try {
      const messages = toOpenAiMessages(conversationId, { excludeMessageId: assistantMessage.id });
      const response = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          ...authHeaders(token),
          'Sse-Stream-Options': 'no-ping',
        },
        body: JSON.stringify(chatRequestBody({ model, messages })),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || response.statusText);
      }

      await this.consumeStream(response.body, run, conversationId);
      const finalMessage = updateMessage(assistantMessage.id, {
        status: 'completed',
        content: run.content,
      });
      this.emit(conversationId, { type: 'message', message: finalMessage });
      await this.finishUtilities({ conversationId, token, assistantMessageId: assistantMessage.id });
    } catch (error) {
      const aborted = controller.signal.aborted;
      const finalMessage = updateMessage(assistantMessage.id, {
        status: aborted ? 'aborted' : 'error',
        content: run.content,
      });
      this.emit(conversationId, { type: 'message', message: finalMessage });
      if (!aborted) {
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

  async consumeStream(body, run, conversationId) {
    const decoder = new TextDecoder();
    const reader = body.getReader();
    let buffer = '';
    let lastPersisted = 0;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const rawLine of lines) {
        const line = rawLine.trimEnd();
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') return;

        const deltaContent = contentFromSsePayload(payload);
        if (deltaContent) {
          run.content += deltaContent;
          console.log('[AIVAX stream] delta.content:', deltaContent);
          console.log('[AIVAX stream] accumulated content:', run.content);
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

  async finishUtilities({ conversationId, token, assistantMessageId }) {
    const conversation = getConversation(conversationId);
    const messages = toOpenAiMessages(conversationId);
    const assistant = getMessage(assistantMessageId);

    if (conversation?.titleStatus === 'pending' && messages.length >= 2) {
      try {
        const title = await generateTitle(token, messages);
        if (title) {
          updateConversation(conversationId, { title, titleStatus: 'generated' });
          this.emit(conversationId, { type: 'conversation', conversation: getConversation(conversationId) });
        }
      } catch {
        updateConversation(conversationId, { titleStatus: 'failed' });
      }
    }

    if (assistant?.content?.trim()) {
      try {
        const continuations = await generateContinuations(token, messages);
        const message = updateMessage(assistantMessageId, { continuations });
        this.emit(conversationId, { type: 'message', message });
      } catch {
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
    return json.choices
      ?.map((choice) => choice.delta?.content)
      .filter((content) => typeof content === 'string')
      .join('') ?? '';
  } catch {
    return '';
  }
}
