import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import {
  archiveConversation,
  createConversation,
  deleteConversation,
  deleteProviderCredentials,
  forkConversation,
  getBot,
  getConversation,
  getMessage,
  getMessages,
  getProviderCredentials,
  listAllConversations,
  listArchivedConversations,
  listBots,
  listProviders,
  restoreConversation,
  setProviderCredentials,
  setProviders,
  updateConversation,
  updateConversationProject,
} from './database.js';
import {
  AviError,
  assertPluginSerializable,
  clonePluginValue,
  createPluginDisposable,
  requirePluginId,
} from './plugin-runtime.js';

function providerSnapshot(provider) {
  if (!provider) return null;
  const { apiKey: _apiKey, ...snapshot } = provider;
  return { ...snapshot, hasCredentials: Boolean(provider.apiKey || getProviderCredentials(provider.id)) };
}

function page(items, { limit = 100, cursor = null } = {}) {
  const offset = Math.max(0, Number.parseInt(cursor, 10) || 0);
  const size = Math.min(500, Math.max(1, Number(limit) || 100));
  return {
    items: clonePluginValue(items.slice(offset, offset + size)),
    nextCursor: offset + size < items.length ? String(offset + size) : null,
  };
}

export function registerPluginTool({ runtime, record, tool, threadId = null, storage }) {
  runtime.assertActive(record);
  const name = requirePluginId(tool?.name, 'Tool name');
  if (typeof tool?.description !== 'string' || !tool.description.trim()) {
    throw new AviError('VALIDATION_FAILED', 'Tool description is required.');
  }
  if (!tool.inputSchema || typeof tool.inputSchema !== 'object' || Array.isArray(tool.inputSchema)) {
    throw new AviError('VALIDATION_FAILED', 'Tool inputSchema must be an object.');
  }
  if (typeof tool.execute !== 'function') throw new AviError('VALIDATION_FAILED', 'Tool execute must be a function.');
  const key = `${threadId ?? '*'}\0${name.toLowerCase()}`;
  if (runtime.tools.has(key) || runtime.services.reservedToolNames?.has(name.toLowerCase())) {
    throw new AviError('CONFLICT', `Tool "${name}" is already registered in this scope.`);
  }
  const annotations = clonePluginValue(tool.annotations ?? {});
  const wrapped = {
    name,
    description: tool.description.trim(),
    inputSchema: clonePluginValue(tool.inputSchema),
    approval: annotations.destructive === true ? 'required' : undefined,
    forceApproval: annotations.destructive === true,
    async execute(input, context) {
      return tool.execute(clonePluginValue(input), {
        signal: context.signal,
        pluginId: record.id,
        invocationId: randomUUID(),
        runId: context.chatRunner?.runs.get(context.conversationId)?.assistantMessageId ?? null,
        threadId: context.conversationId,
        botId: context.botRuntime?.bot?.id ?? null,
        workspacePath: context.workspacePath ?? null,
        model: clonePluginValue(context.models?.find((item) => item.id === context.model) ?? null),
        reasoningEffort: context.reasoningEffort ?? null,
        permissionMode: context.permissionMode,
        workMode: context.workMode,
        ultraMode: context.ultraMode,
        thread: createThreadHandle({ runtime, record, threadId: context.conversationId, storage }),
        storage,
      });
    },
  };
  runtime.tools.set(key, { pluginId: record.id, threadId, tool: wrapped });
  return runtime.track(record, createPluginDisposable(() => runtime.tools.delete(key)));
}

function createRunHandle({ runtime, record, threadId, completion, runId }) {
  return Object.freeze({
    id: runId ?? randomUUID(),
    threadId,
    async getSnapshot() {
      runtime.require(record, 'threads.read');
      const run = runtime.services.chatRunner.runs.get(threadId);
      return run ? clonePluginValue({
        threadId,
        startedAt: run.startedAt,
        phase: run.phase,
        model: run.model,
        running: true,
      }) : { threadId, running: false };
    },
    async wait() {
      runtime.require(record, 'threads.run');
      if (completion) await completion;
      return clonePluginValue({ thread: getConversation(threadId), messages: getMessages(threadId) });
    },
    async stop() {
      runtime.require(record, 'threads.run');
      return runtime.services.chatRunner.stop(threadId, { includeSubagents: true, stoppedByUser: true });
    },
    events: Object.freeze({
      on(type, listener) {
        runtime.require(record, 'events.subscribe');
        return runtime.listen(record, type, listener, { filter: { threadId } });
      },
    }),
  });
}

function createThreadHandle({ runtime, record, threadId, storage }) {
  const read = () => {
    runtime.assertActive(record);
    const thread = getConversation(threadId);
    if (!thread) throw new AviError('NOT_FOUND', 'Thread not found.');
    return thread;
  };
  return Object.freeze({
    id: threadId,
    async getSnapshot() {
      runtime.require(record, 'threads.read');
      return clonePluginValue(read());
    },
    async update(patch = {}) {
      runtime.require(record, 'threads.update');
      read();
      const allowed = new Set(['title', 'model', 'orchestrationMode', 'projectPath']);
      const unknown = Object.keys(patch).find((key) => !allowed.has(key));
      if (unknown) throw new AviError('VALIDATION_FAILED', `Thread update field "${unknown}" is not supported.`);
      if (patch.projectPath !== undefined) updateConversationProject(threadId, patch.projectPath);
      return clonePluginValue(updateConversation(threadId, patch));
    },
    messages: Object.freeze({
      async list(options = {}) {
        runtime.require(record, 'threads.readMessages');
        read();
        return page(getMessages(threadId), options);
      },
      async get(messageId) {
        runtime.require(record, 'threads.readMessages');
        const message = getMessage(messageId);
        return message?.conversationId === threadId ? clonePluginValue(message) : null;
      },
    }),
    async send(input, options = {}) {
      runtime.require(record, 'threads.run');
      const thread = read();
      const content = typeof input === 'string' ? input : input?.content;
      if (typeof content !== 'string' || !content.trim()) throw new AviError('VALIDATION_FAILED', 'Message content is required.');
      await runtime.services.chatRunner.send({
        conversationId: threadId,
        model: options.model ?? thread.model,
        reasoningEffort: options.reasoningEffort ?? null,
        permissionMode: options.permissionMode ?? 'approve_for_me',
        workMode: options.workMode ?? null,
        ultraMode: options.ultraMode ?? false,
        text: content,
        attachments: Array.isArray(input?.attachments) ? input.attachments : [],
        project: { path: thread.projectPath },
        fromAgent: true,
      });
      const run = runtime.services.chatRunner.runs.get(threadId);
      return createRunHandle({
        runtime,
        record,
        threadId,
        completion: run?.completion ?? null,
        runId: run?.assistantMessageId ?? null,
      });
    },
    async retry(options = {}) {
      runtime.require(record, 'threads.run');
      const thread = read();
      await runtime.services.chatRunner.retry({
        conversationId: threadId,
        model: options.model ?? thread.model,
        permissionMode: options.permissionMode ?? 'approve_for_me',
      });
      const run = runtime.services.chatRunner.runs.get(threadId);
      return createRunHandle({
        runtime,
        record,
        threadId,
        completion: run?.completion ?? null,
        runId: run?.assistantMessageId ?? null,
      });
    },
    async stop() {
      runtime.require(record, 'threads.run');
      return runtime.services.chatRunner.stop(threadId, { includeSubagents: true, stoppedByUser: true });
    },
    async compress(options = {}) {
      runtime.require(record, 'threads.run');
      const thread = read();
      return clonePluginValue(await runtime.services.chatRunner.compress({
        conversationId: threadId,
        model: options.model ?? thread.model,
      }));
    },
    async fork(options = {}) {
      runtime.require(record, 'threads.create');
      const forked = forkConversation(threadId, { throughMessageId: options.throughMessageId ?? null });
      if (!forked) throw new AviError('CONFLICT', 'Thread could not be forked.');
      return createThreadHandle({ runtime, record, threadId: forked.id, storage });
    },
    async archive() {
      runtime.require(record, 'threads.delete');
      read();
      runtime.services.cleanupConversation(threadId);
      if (!archiveConversation(threadId)) throw new AviError('CONFLICT', 'Only regular threads can be archived.');
      runtime.services.chatRunner.semaphores.cleanMissingConversations();
    },
    async restore() {
      runtime.require(record, 'threads.delete');
      if (!restoreConversation(threadId)) throw new AviError('NOT_FOUND', 'Archived thread not found.');
    },
    async delete(options = {}) {
      runtime.require(record, 'threads.delete');
      read();
      runtime.services.cleanupConversation(threadId);
      deleteConversation(threadId, { hard: options.hard === true });
      runtime.services.chatRunner.semaphores.cleanMissingConversations();
    },
    tools: Object.freeze({
      register(tool) {
        runtime.require(record, 'tools.register');
        return registerPluginTool({ runtime, record, tool, threadId, storage });
      },
    }),
    events: Object.freeze({
      on(type, listener) {
        runtime.require(record, 'events.subscribe');
        return runtime.listen(record, type, listener, { filter: { threadId } });
      },
    }),
  });
}

function createBotHandle({ runtime, record, botId, storage }) {
  const read = () => {
    runtime.assertActive(record);
    const bot = getBot(botId);
    if (!bot) throw new AviError('NOT_FOUND', 'Bot not found.');
    return bot;
  };
  return Object.freeze({
    id: botId,
    async getSnapshot() {
      runtime.require(record, 'bots.read');
      return clonePluginValue(read());
    },
    async update(patch) {
      runtime.require(record, 'bots.manage');
      read();
      return clonePluginValue(await runtime.services.botManager.updateBotConfig(botId, patch));
    },
    async activate(options = {}) {
      runtime.require(record, 'bots.run');
      await runtime.services.botManager.activateBot(botId, { trigger: options.trigger ?? 'plugin' });
      return createThreadHandle({ runtime, record, threadId: read().conversationId, storage });
    },
    async pause() {
      runtime.require(record, 'bots.manage');
      return clonePluginValue(await runtime.services.botManager.updateBotConfig(botId, { status: 'paused' }));
    },
    async resume() {
      runtime.require(record, 'bots.manage');
      return clonePluginValue(await runtime.services.botManager.updateBotConfig(botId, { status: 'active' }));
    },
    async enable() {
      runtime.require(record, 'bots.manage');
      return clonePluginValue(await runtime.services.botManager.updateBotConfig(botId, { enabled: true }));
    },
    async disable() {
      runtime.require(record, 'bots.manage');
      return clonePluginValue(await runtime.services.botManager.updateBotConfig(botId, { enabled: false }));
    },
    async getThread() {
      runtime.require(record, 'bots.read');
      return createThreadHandle({ runtime, record, threadId: read().conversationId, storage });
    },
    async clearThread() {
      runtime.require(record, 'bots.manage');
      return clonePluginValue(await runtime.services.botManager.clearBotThread(botId));
    },
    async delete() {
      runtime.require(record, 'bots.manage');
      return runtime.services.botManager.deleteBotById(botId);
    },
    workState: Object.freeze({
      async get() {
        runtime.require(record, 'bots.readState');
        const states = await runtime.services.botManager.listWorkStateByBot();
        return clonePluginValue(states[botId] ?? { items: [], activity: [], untrackedWorkers: [] });
      },
    }),
    approvals: Object.freeze({
      list() {
        runtime.require(record, 'bots.readState');
        return clonePluginValue([...runtime.services.botManager.approvals.values()]
          .filter((entry) => entry.botId === botId));
      },
      async resolve(approvalId, decision) {
        runtime.require(record, 'bots.approvals.resolve');
        const approval = runtime.services.botManager.approvals.get(approvalId);
        if (approval?.botId !== botId) throw new AviError('NOT_FOUND', 'Bot approval not found.');
        return clonePluginValue(await runtime.services.botManager.resolveApproval(approvalId, decision));
      },
    }),
    tools: Object.freeze({
      register(tool) {
        runtime.require(record, 'tools.register');
        return registerPluginTool({ runtime, record, tool, threadId: read().conversationId, storage });
      },
    }),
  });
}

export function createPluginDomainApi({ runtime, record, storage }) {
  const threads = Object.freeze({
    async list(options = {}) {
      runtime.require(record, 'threads.read');
      let items = options.archived === true
        ? listArchivedConversations('', { limit: 10_000, offset: 0 })
        : listAllConversations();
      if (Array.isArray(options.types)) items = items.filter((thread) => options.types.includes(thread.conversationType));
      if (options.projectPath) items = items.filter((thread) => thread.projectPath === resolve(options.projectPath));
      return page(items, options);
    },
    async get(id, options = {}) {
      runtime.require(record, 'threads.read');
      const exists = options.archived === true
        ? listArchivedConversations('', { limit: 10_000, offset: 0 }).some((thread) => thread.id === id)
        : Boolean(getConversation(id));
      return exists ? createThreadHandle({ runtime, record, threadId: id, storage }) : null;
    },
    async create(input = {}) {
      runtime.require(record, 'threads.create');
      const conversation = createConversation({
        title: input.title ?? 'New chat',
        model: input.model ?? '',
        projectPath: input.projectPath ?? homedir(),
        conversationType: 'thread',
        createdBy: 'agent',
        orchestrationMode: input.orchestrationMode ?? null,
        titleStatus: input.title ? 'generated' : 'pending',
      });
      runtime.emit('thread.created', { pluginId: record.id, threadId: conversation.id, data: conversation });
      return createThreadHandle({ runtime, record, threadId: conversation.id, storage });
    },
  });

  const bots = Object.freeze({
    async list(options = {}) {
      runtime.require(record, 'bots.read');
      return page(listBots(), options);
    },
    async get(id) {
      runtime.require(record, 'bots.read');
      return getBot(id) ? createBotHandle({ runtime, record, botId: id, storage }) : null;
    },
    async create(input) {
      runtime.require(record, 'bots.manage');
      const bot = await runtime.services.botManager.createBotFromConfig(input);
      runtime.emit('bot.created', { pluginId: record.id, botId: bot.id, threadId: bot.conversationId, data: bot });
      return createBotHandle({ runtime, record, botId: bot.id, storage });
    },
  });

  const panels = Object.freeze({
    list() {
      runtime.require(record, 'panels.manage');
      return clonePluginValue(runtime.listPanels());
    },
    register(descriptor) {
      runtime.require(record, 'panels.register');
      const id = requirePluginId(descriptor?.id, 'Panel ID');
      if (typeof descriptor.title !== 'string' || !descriptor.title.trim()) throw new AviError('VALIDATION_FAILED', 'Panel title is required.');
      if (typeof descriptor.load !== 'function') throw new AviError('VALIDATION_FAILED', 'Panel load must be a function.');
      const publicId = `plugin:${record.id}:${id}`;
      const key = publicId.toLowerCase();
      if (runtime.panels.has(key) || runtime.services.reservedPanelIds?.has(key)) throw new AviError('CONFLICT', `Panel "${id}" is already registered.`);
      runtime.panels.set(key, {
        pluginId: record.id,
        descriptor: { id: publicId, title: descriptor.title.trim() },
        handlers: { load: descriptor.load, invokeAction: descriptor.invokeAction },
      });
      const resource = runtime.track(record, createPluginDisposable(() => runtime.panels.delete(key)));
      return Object.freeze({
        id: publicId,
        get disposed() { return resource.disposed; },
        dispose: () => resource.dispose(),
        refresh: () => runtime.emit('panel.refresh.requested', { pluginId: record.id, data: { panelId: publicId } }),
      });
    },
  });

  const providerHandle = (id) => Object.freeze({
    id,
    async getSnapshot() {
      runtime.require(record, 'providers.read');
      const provider = listProviders().find((item) => item.id === id);
      return clonePluginValue(providerSnapshot(provider));
    },
    async getState() {
      runtime.require(record, 'providers.read');
      return clonePluginValue(await runtime.services.providerRegistry.getState(id));
    },
    async update(patch) {
      runtime.require(record, 'providers.manage');
      const hasApiKey = Object.hasOwn(patch ?? {}, 'apiKey');
      if (hasApiKey) runtime.require(record, 'providers.credentials.write');
      const providers = listProviders();
      const current = providers.find((item) => item.id === id);
      if (!current) throw new AviError('NOT_FOUND', 'Provider not found.');
      const normalized = runtime.services.providerRegistry.normalizeConfig({ ...current, ...clonePluginValue(patch), id });
      const { apiKey, ...persisted } = normalized;
      setProviders(providers.map((item) => item.id === id ? persisted : item));
      if (hasApiKey) await setProviderCredentials(id, { apiKey });
      return clonePluginValue(providerSnapshot(persisted));
    },
    async remove() {
      runtime.require(record, 'providers.manage');
      await runtime.services.providerRegistry.remove(id);
      setProviders(listProviders().filter((item) => item.id !== id));
      await deleteProviderCredentials(id);
    },
    async invokeAction(action, input) {
      runtime.require(record, 'providers.manage');
      return clonePluginValue(await runtime.services.providerRegistry.invokeAction(id, action, clonePluginValue(input)));
    },
    credentials: Object.freeze({
      async has() { return Boolean(getProviderCredentials(id)); },
      async set(credentials) {
        runtime.require(record, 'providers.credentials.write');
        assertPluginSerializable(credentials, 'Provider credentials');
        await setProviderCredentials(id, clonePluginValue(credentials));
      },
      async clear() {
        runtime.require(record, 'providers.credentials.write');
        await deleteProviderCredentials(id);
      },
    }),
  });

  const providers = Object.freeze({
    types: Object.freeze({
      list() {
        runtime.require(record, 'providers.read');
        return clonePluginValue(runtime.services.providerRegistry.listTypes());
      },
      register(definition) {
        runtime.require(record, 'providers.types.register');
        const id = requirePluginId(definition?.descriptor?.id, 'Provider type ID');
        if (typeof definition.createBody !== 'function' || typeof definition.request !== 'function' || typeof definition.eventsFrom !== 'function') {
          throw new AviError('VALIDATION_FAILED', `Provider type "${id}" requires createBody, request, and eventsFrom.`);
        }
        const key = id.toLowerCase();
        if (runtime.providerTypes.has(key) || runtime.services.reservedProviderIds?.has(key)) throw new AviError('CONFLICT', `Provider type "${id}" is already registered.`);
        runtime.providerTypes.set(key, { pluginId: record.id, definition });
        return runtime.track(record, createPluginDisposable(() => runtime.providerTypes.delete(key)));
      },
    }),
    async list(options = {}) {
      runtime.require(record, 'providers.read');
      return page(listProviders().map(providerSnapshot), options);
    },
    async get(id) {
      runtime.require(record, 'providers.read');
      return listProviders().some((item) => item.id === id) ? providerHandle(id) : null;
    },
    async create(input) {
      runtime.require(record, 'providers.manage');
      const hasApiKey = Object.hasOwn(input ?? {}, 'apiKey');
      if (hasApiKey) runtime.require(record, 'providers.credentials.write');
      const normalized = runtime.services.providerRegistry.normalizeConfig(input);
      if (listProviders().some((item) => item.id === normalized.id)) throw new AviError('CONFLICT', `Provider "${normalized.id}" already exists.`);
      const { apiKey, ...persisted } = normalized;
      setProviders([...listProviders(), persisted]);
      if (hasApiKey) await setProviderCredentials(normalized.id, { apiKey });
      return providerHandle(normalized.id);
    },
    models: Object.freeze({
      list() {
        runtime.require(record, 'providers.read');
        return clonePluginValue(runtime.services.providerRegistry.listModels());
      },
    }),
    usages: Object.freeze({
      register(descriptor) {
        runtime.require(record, 'providers.usages.register');
        const id = requirePluginId(descriptor?.id, 'Usage provider ID');
        if (typeof descriptor.title !== 'string' || !descriptor.title.trim()) {
          throw new AviError('VALIDATION_FAILED', 'Usage provider title is required.');
        }
        if (typeof descriptor.load !== 'function') {
          throw new AviError('VALIDATION_FAILED', 'Usage provider load must be a function.');
        }
        const publicId = `plugin:${record.id}:${id}`;
        const key = publicId.toLowerCase();
        if (runtime.usageProviders.has(key)) {
          throw new AviError('CONFLICT', `Usage provider "${id}" is already registered.`);
        }
        runtime.usageProviders.set(key, {
          pluginId: record.id,
          descriptor: { id: publicId, title: descriptor.title.trim() },
          handlers: { load: descriptor.load },
        });
        return runtime.track(record, createPluginDisposable(() => runtime.usageProviders.delete(key)));
      },
    }),
  });

  const context = Object.freeze({
    roots: Object.freeze({
      list(options = {}) {
        runtime.require(record, 'context.read');
        return clonePluginValue(runtime.services.listContextRoots?.(options) ?? []);
      },
    }),
    items: Object.freeze({
      async list(options = {}) {
        runtime.require(record, 'context.read');
        return clonePluginValue(await runtime.services.listContextItems?.(options) ?? []);
      },
      async read(id) {
        runtime.require(record, 'context.readContents');
        return clonePluginValue(await runtime.services.readContextItem?.(id) ?? null);
      },
    }),
    async register(descriptor) {
      runtime.require(record, 'context.register');
      const id = requirePluginId(descriptor?.id, 'Context resource ID');
      const kind = ['instructions', 'skill', 'workflow'].includes(descriptor.kind) ? descriptor.kind : 'instructions';
      if (typeof descriptor.content !== 'string') throw new AviError('VALIDATION_FAILED', 'Context content must be a string.');
      const scope = descriptor.scope ?? { type: 'global' };
      if (!['global', 'thread', 'bot', 'workspace'].includes(scope.type)) throw new AviError('VALIDATION_FAILED', 'Context scope is invalid.');
      if (scope.type === 'thread' && !getConversation(scope.threadId)) throw new AviError('NOT_FOUND', 'Context thread not found.');
      if (scope.type === 'bot' && !getBot(scope.botId)) throw new AviError('NOT_FOUND', 'Context bot not found.');
      if (scope.type === 'workspace' && typeof scope.path !== 'string') throw new AviError('VALIDATION_FAILED', 'Workspace context requires a path.');
      const key = `${record.id.toLowerCase()}\0${id.toLowerCase()}`;
      if (runtime.contextResources.has(key)) throw new AviError('CONFLICT', `Context resource "${id}" is already registered.`);
      const root = join(runtime.pluginsDir, '.avi', record.id, 'runtime-context', id);
      const relativePath = kind === 'skill' ? `skills/${id}/SKILL.md` : kind === 'workflow' ? `workflows/${id}.md` : 'AGENTS.md';
      const target = join(root, relativePath);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, descriptor.content, 'utf8');
      const entry = { id: `${record.id}:${id}`, pluginId: record.id, title: descriptor.title ?? id, kind, scope: clonePluginValue(scope), root };
      runtime.contextResources.set(key, entry);
      const resource = runtime.track(record, createPluginDisposable(() => {
        runtime.contextResources.delete(key);
        return rm(root, { recursive: true, force: true });
      }));
      return Object.freeze({ id: entry.id, get disposed() { return resource.disposed; }, dispose: () => resource.dispose() });
    },
  });

  return { threads, bots, panels, providers, context };
}
