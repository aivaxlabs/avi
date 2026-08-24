import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { traceError } from './trace-log.js';

const ID_PATTERN = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/i;
export const PLUGIN_CAPABILITIES = Object.freeze([
  'threads.read', 'threads.readMessages', 'threads.create', 'threads.update',
  'threads.run', 'threads.delete', 'bots.read', 'bots.manage', 'bots.run',
  'bots.readState', 'bots.approvals.resolve', 'tools.register', 'tools.intercept',
  'events.subscribe', 'events.readContent', 'events.readReasoning',
  'panels.register', 'panels.manage', 'providers.read', 'providers.manage',
  'providers.types.register', 'providers.usages.register', 'providers.credentials.write', 'context.read',
  'context.readContents', 'context.register', 'storage',
]);
const CAPABILITY_SET = new Set(PLUGIN_CAPABILITIES);
const CHAT_EVENT_NAMES = Object.freeze({
  message: 'message.updated',
  'message-delete': 'message.deleted',
  conversation: 'thread.updated',
  'run-state': 'run.state.changed',
  'queue-order': 'thread.queue.changed',
  tasks: 'thread.tasks.changed',
  'block-state': 'thread.work-status.changed',
  'permission-request': 'tool.approval.requested',
  'permission-resolved': 'tool.approval.resolved',
  'permission-cancelled': 'tool.approval.cancelled',
  'question-request': 'question.requested',
  'question-cancelled': 'question.cancelled',
  'mcp-waiting': 'mcp.waiting.changed',
  'semaphore-state': 'semaphore.state.changed',
  error: 'run.error',
});

export class AviError extends Error {
  constructor(code, message, { details, retryable = false } = {}) {
    super(message);
    this.name = 'AviError';
    this.code = code;
    this.details = details;
    this.retryable = retryable;
  }
}

export function clonePluginValue(value) {
  return value == null ? value : structuredClone(value);
}

export function assertPluginSerializable(value, label = 'Value') {
  const seen = new Set();
  const visit = (item, path) => {
    if (item === null || ['string', 'boolean'].includes(typeof item)) return;
    if (typeof item === 'number' && Number.isFinite(item)) return;
    if (typeof item !== 'object') throw new AviError('VALIDATION_FAILED', `${path} is not serializable.`);
    if (seen.has(item)) throw new AviError('VALIDATION_FAILED', `${path} contains a circular reference.`);
    const prototype = Object.getPrototypeOf(item);
    if (!Array.isArray(item) && prototype !== Object.prototype && prototype !== null) {
      throw new AviError('VALIDATION_FAILED', `${path} must contain only plain objects and arrays.`);
    }
    seen.add(item);
    if (Array.isArray(item)) item.forEach((child, index) => visit(child, `${path}[${index}]`));
    else Object.entries(item).forEach(([key, child]) => visit(child, `${path}.${key}`));
    seen.delete(item);
  };
  visit(value, label);
}

export function requirePluginId(value, label) {
  const id = String(value ?? '').trim();
  if (!ID_PATTERN.test(id)) throw new AviError('VALIDATION_FAILED', `${label} "${id}" is invalid.`);
  return id;
}

export function createPluginDisposable(dispose) {
  let disposed = false;
  return Object.freeze({
    get disposed() { return disposed; },
    dispose() {
      if (disposed) return;
      disposed = true;
      return Promise.resolve(dispose());
    },
  });
}

function withTimeout(value, milliseconds, label) {
  let timer;
  return Promise.race([
    Promise.resolve(value),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new AviError('TIMEOUT', `${label} timed out after ${milliseconds} ms.`)), milliseconds);
    }),
  ]).finally(() => clearTimeout(timer));
}

function validateSchema(value, schema, path = 'input') {
  if (!schema || typeof schema !== 'object') return;
  const type = schema.type;
  const valid = type == null || Array.isArray(type)
    || (type === 'object' && value && typeof value === 'object' && !Array.isArray(value))
    || (type === 'array' && Array.isArray(value))
    || (type === 'string' && typeof value === 'string')
    || (type === 'boolean' && typeof value === 'boolean')
    || (type === 'number' && typeof value === 'number' && Number.isFinite(value))
    || (type === 'integer' && Number.isInteger(value))
    || (type === 'null' && value === null);
  if (!valid) throw new AviError('VALIDATION_FAILED', `${path} does not match schema type "${type}".`);
  if (Array.isArray(schema.enum) && !schema.enum.some((item) => Object.is(item, value))) {
    throw new AviError('VALIDATION_FAILED', `${path} must be one of the allowed values.`);
  }
  if (schema.const !== undefined && !Object.is(value, schema.const)) {
    throw new AviError('VALIDATION_FAILED', `${path} must be the const value.`);
  }
  if (Array.isArray(schema.type)) {
    const types = new Set(schema.type);
    const ok = (types.has('null') && value === null)
      || (types.has('string') && typeof value === 'string')
      || (types.has('number') && typeof value === 'number' && Number.isFinite(value))
      || (types.has('integer') && Number.isInteger(value))
      || (types.has('boolean') && typeof value === 'boolean')
      || (types.has('array') && Array.isArray(value))
      || (types.has('object') && value && typeof value === 'object' && !Array.isArray(value));
    if (!ok) throw new AviError('VALIDATION_FAILED', `${path} does not match any allowed type.`);
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (schema.minimum !== undefined && value < schema.minimum) throw new AviError('VALIDATION_FAILED', `${path} is below minimum ${schema.minimum}.`);
    if (schema.maximum !== undefined && value > schema.maximum) throw new AviError('VALIDATION_FAILED', `${path} is above maximum ${schema.maximum}.`);
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) throw new AviError('VALIDATION_FAILED', `${path} length is below minLength ${schema.minLength}.`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) throw new AviError('VALIDATION_FAILED', `${path} length exceeds maxLength ${schema.maxLength}.`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) throw new AviError('VALIDATION_FAILED', `${path} does not match pattern.`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) throw new AviError('VALIDATION_FAILED', `${path} has fewer items than minItems ${schema.minItems}.`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) throw new AviError('VALIDATION_FAILED', `${path} has more items than maxItems ${schema.maxItems}.`);
    if (schema.uniqueItems && new Set(value.map((item) => JSON.stringify(item))).size !== value.length) {
      throw new AviError('VALIDATION_FAILED', `${path} items are not unique.`);
    }
  }
  if (type === 'object') {
    for (const key of schema.required ?? []) {
      if (key.startsWith('__')) continue;
      if (!Object.hasOwn(value, key)) throw new AviError('VALIDATION_FAILED', `${path}.${key} is required.`);
    }
    if (schema.additionalProperties === false) {
      const allowed = new Set(Object.keys(schema.properties ?? {}));
      const unknown = Object.keys(value).find((key) => !allowed.has(key));
      if (unknown) throw new AviError('VALIDATION_FAILED', `${path}.${unknown} is not allowed.`);
    }
    for (const [key, child] of Object.entries(value)) {
      if (schema.properties?.[key]) validateSchema(child, schema.properties[key], `${path}.${key}`);
    }
  }
  if (type === 'array') value.forEach((child, index) => validateSchema(child, schema.items, `${path}[${index}]`));
}

export class PluginRuntime {
  constructor({ pluginsDir, services = {}, interceptorTimeoutMs = 3_000 } = {}) {
    this.pluginsDir = resolve(pluginsDir);
    this.services = services;
    this.interceptorTimeoutMs = interceptorTimeoutMs;
    this.records = new Map();
    this.tools = new Map();
    this.panels = new Map();
    this.providerTypes = new Map();
    this.usageProviders = new Map();
    this.contextResources = new Map();
    this.interceptors = new Map();
    this.listeners = new Map();
  }

  setServices(services) {
    this.services = { ...this.services, ...services };
  }

  validateCapabilities(capabilities) {
    if (!Array.isArray(capabilities)) throw new Error('Plugin capabilities must be an array.');
    const normalized = capabilities.map((item) => String(item ?? '').trim());
    const unknown = normalized.find((item) => !CAPABILITY_SET.has(item));
    if (unknown) throw new Error(`Unknown plugin capability "${unknown}".`);
    if (normalized.length !== new Set(normalized).size) throw new Error('Plugin capabilities must not contain duplicates.');
    return normalized;
  }

  require(record, capability) {
    this.assertActive(record);
    if (!record.capabilities.has(capability)) {
      throw new AviError('CAPABILITY_REQUIRED', `Plugin "${record.id}" requires capability "${capability}".`, {
        details: { capability },
      });
    }
  }

  assertActive(record) {
    if (!record.active) throw new AviError('DISPOSED', `Plugin "${record.id}" is not active.`);
  }

  track(record, resource) {
    record.resources.push(resource);
    return resource;
  }

  async activate(definition) {
    const key = definition.id.toLowerCase();
    if (this.records.has(key)) throw new AviError('CONFLICT', `Plugin "${definition.id}" is already active.`);
    const record = {
      id: definition.id,
      definition,
      capabilities: new Set(definition.capabilities),
      controller: new AbortController(),
      resources: [],
      deactivationHandlers: [],
      active: true,
      api: null,
    };
    this.records.set(key, record);
    record.api = this.#createApi(record);
    try {
      if (typeof definition.activate === 'function') {
        await withTimeout(definition.activate(record.api), 10_000, `Plugin "${definition.id}" activation`);
      }
      this.emit('plugin.activated', { pluginId: definition.id, data: { pluginId: definition.id } });
      return record.api;
    } catch (error) {
      record.active = false;
      await this.#disposeResources(record);
      this.records.delete(record.id.toLowerCase());
      throw error;
    }
  }

  async deactivate(pluginId, reason = 'shutdown') {
    const record = this.records.get(String(pluginId).toLowerCase());
    if (!record) return false;
    await this.#deactivateRecord(record, reason);
    return true;
  }

  async deactivateAll(reason = 'shutdown') {
    for (const record of [...this.records.values()].reverse()) await this.#deactivateRecord(record, reason);
  }

  listTools(threadId = null) {
    return [...new Map([...this.tools.values()]
      .filter((entry) => entry.threadId == null || entry.threadId === threadId)
      .sort((left, right) => Number(left.threadId != null) - Number(right.threadId != null))
      .map((entry) => [entry.tool.name.toLowerCase(), entry])).values()]
      .map((entry) => ({ ...entry.tool, pluginId: entry.pluginId }));
  }

  listPanels() {
    return [...this.panels.values()].map((entry) => ({ pluginId: entry.pluginId, ...entry.descriptor }));
  }

  getPanel(id) {
    return this.panels.get(String(id).toLowerCase()) ?? null;
  }

  listProviderTypes() {
    return [...this.providerTypes.values()].map((entry) => entry.definition);
  }

  listUsageProviders() {
    return [...this.usageProviders.values()].map((entry) => ({
      ...entry.descriptor,
      source: 'plugin',
      pluginId: entry.pluginId,
    }));
  }

  getUsageProvider(id) {
    return this.usageProviders.get(String(id).toLowerCase()) ?? null;
  }

  listContextResources() {
    return [...this.contextResources.values()].map((entry) => clonePluginValue(entry));
  }

  emit(type, source = {}) {
    const event = Object.freeze({
      id: randomUUID(), type, version: 1, timestamp: new Date().toISOString(),
      ...(source.pluginId ? { pluginId: source.pluginId } : {}),
      ...(source.threadId ? { threadId: source.threadId } : {}),
      ...(source.runId ? { runId: source.runId } : {}),
      ...(source.botId ? { botId: source.botId } : {}),
      ...(source.providerId ? { providerId: source.providerId } : {}),
      data: clonePluginValue(source.data ?? {}),
    });
    for (const entry of [...(this.listeners.get(type) ?? []), ...(this.listeners.get('*') ?? [])]) {
      if (entry.filter && Object.entries(entry.filter).some(([key, value]) => event[key] !== value)) continue;
      const record = this.records.get(entry.pluginId.toLowerCase());
      const delivered = clonePluginValue(event);
      const message = delivered.data?.message;
      if (message && !record?.capabilities.has('events.readContent')) {
        delete message.content;
        delete message.attachments;
        delete message.edits;
        delete message.segments;
      } else if (Array.isArray(message?.segments) && !record?.capabilities.has('events.readReasoning')) {
        message.segments = message.segments.filter((segment) => segment?.type !== 'reasoning');
      }
      if (!record?.capabilities.has('events.readContent')) {
        if (delivered.data?.input) delete delivered.data.input;
        if (delivered.data?.questions) delete delivered.data.questions;
        if (Array.isArray(delivered.data?.tasks)) {
          delivered.data.tasks = delivered.data.tasks.map((task) => ({
            done: Boolean(task?.done),
            status: task?.status ?? (task?.done ? 'completed' : 'pending'),
          }));
        }
        if (Array.isArray(delivered.data?.semaphores)) {
          delivered.data.semaphores = delivered.data.semaphores.map((semaphore) => ({
            ...semaphore,
            holders: semaphore.holders.map((holder) => ({
              ...holder,
              ...(holder.blocked ? { blocked: true } : {}),
            })),
          }));
        }
        if (delivered.data?.invocationSummary) delete delivered.data.invocationSummary;
        if (delivered.data?.workspacePath) delete delivered.data.workspacePath;
        if (typeof delivered.data?.message === 'string') delete delivered.data.message;
        const snapshot = delivered.data?.conversation ?? delivered.data?.thread;
        if (snapshot && typeof snapshot === 'object') {
          delete snapshot.messages;
          delete snapshot.content;
          delete snapshot.initialPrompt;
          delete snapshot.contextCheckpoint;
          delete snapshot.firstPrompt;
          delete snapshot.projectPath;
          delete snapshot.goal;
        }
        if (delivered.data?.error && typeof delivered.data.error === 'object') {
          delete delivered.data.error.message;
          delete delivered.data.error.stack;
          delete delivered.data.error.details;
        }
        if (delivered.data?.bot && typeof delivered.data.bot === 'object') delete delivered.data.bot.payload;
        if (delivered.data?.log && typeof delivered.data.log === 'object') delete delivered.data.log.payload;
      }
      const inferenceEvent = delivered.data?.event;
      if (inferenceEvent?.type === 'content' && !record?.capabilities.has('events.readContent')) {
        delivered.data.event = { type: 'content', redacted: true };
      }
      if (inferenceEvent?.type === 'tool-call' && !record?.capabilities.has('events.readContent')) {
        delivered.data.event = { type: 'tool-call', name: inferenceEvent.name, redacted: true };
      }
      if (inferenceEvent?.type === 'reasoning' && !record?.capabilities.has('events.readReasoning')) {
        delivered.data.event = { type: 'reasoning', redacted: true };
      }
      Object.freeze(delivered);
      queueMicrotask(() => Promise.resolve(entry.listener(delivered)).catch((error) => traceError('plugin.event-error', {
        plugin_id: entry.pluginId,
        event: type,
        error: error instanceof Error ? error.message : String(error),
      })));
    }
    return event;
  }

  emitChatEvent(payload) {
    const threadId = payload.conversationId ?? payload.conversation?.id ?? payload.message?.conversationId;
    const type = CHAT_EVENT_NAMES[payload.type] ?? `chat.${String(payload.type).replaceAll('-', '.')}`;
    this.emit(type, { threadId, data: payload });
    if (payload.type === 'run-state') this.emit(payload.running ? 'run.started' : 'run.completed', { threadId, data: payload });
  }

  listen(record, type, listener, options = {}) {
    this.require(record, 'events.subscribe');
    return this.#listen(record, type, listener, options);
  }

  async beforeTool(invocation) {
    let input = clonePluginValue(invocation.input);
    let requireApproval = false;
    let inputChanged = false;
    for (const entry of this.#orderedInterceptors()) {
      const result = await withTimeout(entry.beforeExecute(Object.freeze({
        ...clonePluginValue(invocation), input: clonePluginValue(input),
      })), this.interceptorTimeoutMs, `Tool interceptor "${entry.id}"`);
      if (result == null || result.action === 'continue') continue;
      if (result.action === 'deny') throw new AviError('PERMISSION_DENIED', String(result.reason ?? 'Tool execution denied by an interceptor.'));
      if (result.action === 'requireApproval') {
        requireApproval = true;
        continue;
      }
      if (result.action === 'replaceInput') {
        assertPluginSerializable(result.input, 'Interceptor input');
        input = clonePluginValue(result.input);
        inputChanged = true;
        requireApproval = true;
        continue;
      }
      throw new AviError('VALIDATION_FAILED', `Tool interceptor "${entry.id}" returned an unsupported action.`);
    }
    validateSchema(input, invocation.tool.inputSchema);
    return { input, requireApproval, inputChanged };
  }

  async afterTool(invocation) {
    let output = invocation.output;
    for (const entry of this.#orderedInterceptors()) {
      if (typeof entry.afterExecute !== 'function') continue;
      const result = await withTimeout(entry.afterExecute(Object.freeze({
        ...clonePluginValue(invocation), output: clonePluginValue(output),
      })), this.interceptorTimeoutMs, `Tool interceptor "${entry.id}"`);
      if (result == null || result.action === 'continue') continue;
      if (result.action !== 'replaceOutput') throw new AviError('VALIDATION_FAILED', `Tool interceptor "${entry.id}" returned an unsupported action.`);
      assertPluginSerializable(result.output, 'Interceptor output');
      output = clonePluginValue(result.output);
    }
    return output;
  }

  #orderedInterceptors() {
    return [...this.interceptors.values()].sort((left, right) => (
      left.priority - right.priority || left.pluginId.localeCompare(right.pluginId, 'en') || left.id.localeCompare(right.id, 'en')
    ));
  }

  #listen(record, type, listener, options = {}) {
    this.assertActive(record);
    if (typeof type !== 'string' || !type.trim()) throw new AviError('VALIDATION_FAILED', 'Event type is required.');
    if (typeof listener !== 'function') throw new AviError('VALIDATION_FAILED', 'Event listener must be a function.');
    const entry = { pluginId: record.id, listener, filter: options?.filter ? clonePluginValue(options.filter) : null };
    const collection = this.listeners.get(type) ?? [];
    collection.push(entry);
    this.listeners.set(type, collection);
    return this.track(record, createPluginDisposable(() => {
      const next = (this.listeners.get(type) ?? []).filter((item) => item !== entry);
      if (next.length) this.listeners.set(type, next);
      else this.listeners.delete(type);
    }));
  }

  #storage(record) {
    const runtime = this;
    const path = join(this.pluginsDir, '.avi-storage', record.id, 'storage.json');
    let queue = Promise.resolve();
    const read = async () => {
      try {
        const value = JSON.parse(await readFile(path, 'utf8'));
        return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
      } catch (error) {
        if (error?.code === 'ENOENT') return {};
        if (error instanceof SyntaxError) throw new AviError('VALIDATION_FAILED', 'Plugin storage file is corrupted.');
        throw error;
      }
    };
    const mutate = (mutation) => {
      const operation = queue.then(async () => {
        const state = await read();
        const result = mutation(state);
        assertPluginSerializable(state, 'Plugin storage');
        const serialized = `${JSON.stringify(state, null, 2)}\n`;
        if (Buffer.byteLength(serialized) > 1_048_576) throw new AviError('VALIDATION_FAILED', 'Plugin storage exceeds 1 MiB.');
        await mkdir(dirname(path), { recursive: true });
        const temporary = `${path}.${randomUUID()}.tmp`;
        await writeFile(temporary, serialized, 'utf8');
        await rename(temporary, path);
        return result;
      });
      queue = operation.catch(() => {});
      return operation;
    };
    return Object.freeze({
      async get(key) {
        this;
        runtime.assertActive(record);
        return clonePluginValue((await read())[String(key)] ?? null);
      },
      async set(key, value) {
        runtime.assertActive(record);
        assertPluginSerializable(value, 'Storage value');
        return mutate((state) => { state[String(key)] = clonePluginValue(value); });
      },
      async delete(key) {
        runtime.assertActive(record);
        return mutate((state) => {
          const exists = Object.hasOwn(state, String(key));
          delete state[String(key)];
          return exists;
        });
      },
      async list({ prefix = '' } = {}) {
        runtime.assertActive(record);
        return Object.keys(await read()).filter((key) => key.startsWith(prefix)).sort();
      },
      async clear() {
        runtime.assertActive(record);
        return mutate((state) => Object.keys(state).forEach((key) => delete state[key]));
      },
    });
  }

  #createApi(record) {
    const runtime = this;
    const storage = this.#storage(record);
    const domain = this.services.createDomainApi?.({ runtime, record, storage }) ?? {};
    return Object.freeze({
      apiVersion: 2,
      plugin: Object.freeze({ id: record.id }),
      app: Object.freeze({
        getInfo: () => {
          runtime.assertActive(record);
          return clonePluginValue(runtime.services.appInfo?.() ?? {});
        },
      }),
      threads: domain.threads ?? Object.freeze({}),
      semaphores: domain.semaphores ?? Object.freeze({}),
      bots: domain.bots ?? Object.freeze({}),
      panels: domain.panels ?? Object.freeze({}),
      providers: domain.providers ?? Object.freeze({}),
      context: domain.context ?? Object.freeze({}),
      tools: Object.freeze({
        register(tool) {
          runtime.require(record, 'tools.register');
          return runtime.services.registerTool({ runtime, record, tool, threadId: null, storage });
        },
      }),
      interceptors: Object.freeze({
        tools: Object.freeze({
          register(definition) {
            runtime.require(record, 'tools.intercept');
            const id = requirePluginId(definition?.id, 'Tool interceptor ID');
            if (typeof definition.beforeExecute !== 'function' && typeof definition.afterExecute !== 'function') throw new AviError('VALIDATION_FAILED', 'Tool interceptor requires beforeExecute or afterExecute.');
            const key = `${record.id.toLowerCase()}\0${id.toLowerCase()}`;
            if (runtime.interceptors.has(key)) throw new AviError('CONFLICT', `Tool interceptor "${id}" is already registered.`);
            runtime.interceptors.set(key, {
              id, pluginId: record.id,
              priority: Number.isInteger(definition.priority) ? definition.priority : 1000,
              beforeExecute: definition.beforeExecute ?? (() => ({ action: 'continue' })),
              afterExecute: definition.afterExecute,
            });
            return runtime.track(record, createPluginDisposable(() => runtime.interceptors.delete(key)));
          },
        }),
      }),
      events: Object.freeze({
        on(type, listener, options) {
          runtime.require(record, 'events.subscribe');
          return runtime.#listen(record, type, listener, options);
        },
      }),
      storage: new Proxy(storage, {
        get(target, property) {
          runtime.require(record, 'storage');
          runtime.assertActive(record);
          return target[property];
        },
      }),
      lifecycle: Object.freeze({
        signal: record.controller.signal,
        onDeactivate(handler) {
          runtime.assertActive(record);
          if (typeof handler !== 'function') throw new AviError('VALIDATION_FAILED', 'Deactivation handler must be a function.');
          record.deactivationHandlers.push(handler);
          return runtime.track(record, createPluginDisposable(() => {
            record.deactivationHandlers = record.deactivationHandlers.filter((item) => item !== handler);
          }));
        },
        track(resource) {
          runtime.assertActive(record);
          if (!resource || typeof resource.dispose !== 'function') throw new AviError('VALIDATION_FAILED', 'Tracked resource must expose dispose().');
          return runtime.track(record, resource);
        },
      }),
    });
  }

  async #deactivateRecord(record, reason) {
    if (!record.active) return;
    record.active = false;
    record.controller.abort(new AviError('PLUGIN_DEACTIVATING', `Plugin "${record.id}" is deactivating.`));
    for (const handler of [...record.deactivationHandlers].reverse()) {
      try { await withTimeout(handler(reason), 5_000, `Plugin "${record.id}" deactivation handler`); }
      catch (error) { traceError('plugin.deactivation-error', { plugin_id: record.id, error: error instanceof Error ? error.message : String(error) }); }
    }
    if (typeof record.definition.deactivate === 'function') {
      try { await withTimeout(record.definition.deactivate(reason), 5_000, `Plugin "${record.id}" deactivation`); }
      catch (error) { traceError('plugin.deactivation-error', { plugin_id: record.id, error: error instanceof Error ? error.message : String(error) }); }
    }
    await this.#disposeResources(record);
    this.records.delete(record.id.toLowerCase());
    this.emit('plugin.deactivated', { pluginId: record.id, data: { pluginId: record.id, reason } });
  }

  async #disposeResources(record) {
    for (const resource of [...record.resources].reverse()) {
      try { await withTimeout(resource.dispose(), 5_000, `Plugin "${record.id}" resource dispose`); }
      catch (error) { traceError('plugin.resource-dispose-error', { plugin_id: record.id, error: error instanceof Error ? error.message : String(error) }); }
    }
  }
}
