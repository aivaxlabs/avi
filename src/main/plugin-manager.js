import { randomUUID } from 'node:crypto';
import {
  copyFile,
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { normalizeMcpServer } from './mcp-config.js';
import { pluginApi, PLUGIN_API_VERSION } from './plugin-api.js';

const CONTRIBUTION_TYPES = Object.freeze([
  'context',
  'mcps',
  'tools',
  'auxiliaryPanels',
  'themes',
  'personalities',
  'providers',
]);
const ID_PATTERN = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/i;
const DEFINITION_FIELDS = new Set([
  'apiVersion',
  'id',
  'name',
  'version',
  'description',
  'contributions',
]);
const CONTRIBUTION_FIELDS = Object.freeze({
  context: new Set(['path', 'content']),
  mcps: new Set(['id', 'name', 'config']),
  tools: new Set(['name', 'description', 'inputSchema', 'execute']),
  auxiliaryPanels: new Set(['id', 'title', 'load', 'invokeAction']),
  themes: new Set(['id', 'name', 'tagline', 'css', 'emptyChatBackground']),
  personalities: new Set(['id', 'name', 'description', 'instructions']),
  providers: new Set([
    'descriptor',
    'createBody',
    'request',
    'eventsFrom',
    'getContributions',
    'getState',
    'invokeAction',
    'remove',
  ]),
});
const HANDLER_KEYS = Object.freeze({
  context: new Set(),
  mcps: new Set(),
  tools: new Set(['execute']),
  auxiliaryPanels: new Set(['load', 'invokeAction']),
  themes: new Set(),
  personalities: new Set(),
  providers: new Set(['createBody', 'request', 'eventsFrom', 'getContributions', 'getState', 'invokeAction', 'remove']),
});
const EMPTY_CONTRIBUTIONS = Object.freeze(Object.fromEntries(
  CONTRIBUTION_TYPES.map((type) => [type, Object.freeze([])]),
));

export class PluginManager {
  constructor({
    pluginsDir,
    reservedIds = {},
    reservedToolNames = [],
    loadTimeoutMs = 10_000,
  }) {
    if (!pluginsDir) throw new Error('Plugin directory is required.');
    if (!Number.isFinite(loadTimeoutMs) || loadTimeoutMs <= 0) {
      throw new Error('Plugin load timeout must be a positive number.');
    }
    this.pluginsDir = resolve(pluginsDir);
    this.loadTimeoutMs = loadTimeoutMs;
    this.reservedIds = Object.fromEntries(
      ['auxiliaryPanels', 'themes', 'personalities', 'providers'].map((type) => [
        type,
        new Set((reservedIds[type] ?? []).map((id) => String(id).toLowerCase())),
      ]),
    );
    this.reservedToolNames = new Set(reservedToolNames.map((name) => String(name).toLowerCase()));
    this.plugins = new Map();
    this.failures = [];
    this.restartRequired = false;
  }

  async initialize() {
    let entries;
    try {
      await mkdir(this.pluginsDir, { recursive: true });
      entries = await readdir(this.pluginsDir, { withFileTypes: true });
    } catch (error) {
      this.plugins = new Map();
      this.failures = [{
        fileName: 'plugins',
        error: `Plugin directory is unavailable: ${error instanceof Error ? error.message : String(error)}`,
      }];
      return this.getStatus();
    }
    const files = entries
      .filter((entry) => entry.isFile() && !entry.name.startsWith('.') && extname(entry.name) === '.js')
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right, 'en'));
    const candidates = [];
    const failures = [];

    for (const fileName of files) {
      const sourcePath = join(this.pluginsDir, fileName);
      let timeout;
      try {
        candidates.push(await Promise.race([
          this.#load(sourcePath),
          new Promise((_, reject) => {
            timeout = setTimeout(() => reject(
              new Error(`Plugin "${fileName}" did not load within ${this.loadTimeoutMs} ms.`),
            ), this.loadTimeoutMs);
          }),
        ]));
      } catch (error) {
        failures.push({
          fileName,
          sourcePath,
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        clearTimeout(timeout);
      }
    }

    const duplicatePluginIds = new Set(candidates
      .map((candidate) => candidate.id.toLowerCase())
      .filter((id, index, ids) => ids.indexOf(id) !== ids.lastIndexOf(id)));
    const materialized = [];
    const claimed = Object.fromEntries([
      ['plugins', new Map()],
      ['tools', new Map([...this.reservedToolNames].map((name) => [name, 'Avi']))],
      ...['auxiliaryPanels', 'themes', 'personalities', 'providers'].map((type) => [
        type,
        new Map([...this.reservedIds[type]].map((id) => [id, 'Avi'])),
      ]),
    ]);
    for (const candidate of candidates) {
      try {
        if (duplicatePluginIds.has(candidate.id.toLowerCase())) {
          throw new Error(`Duplicate plugin ID "${candidate.id}".`);
        }
        const nextClaims = Object.fromEntries(Object.entries(claimed).map(([type, ids]) => [
          type,
          new Map(ids),
        ]));
        this.#claim(candidate, nextClaims);
        await this.#materialize(candidate);
        Object.assign(claimed, nextClaims);
        materialized.push(candidate);
      } catch (error) {
        failures.push({
          fileName: basename(candidate.sourcePath),
          sourcePath: candidate.sourcePath,
          pluginId: candidate.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    this.plugins = new Map(materialized.map((plugin) => [plugin.id.toLowerCase(), plugin]));
    this.failures = failures;
    try {
      await this.#cleanupMaterialized(new Set(materialized.map((plugin) => plugin.id.toLowerCase())));
    } catch (error) {
      this.failures.push({
        fileName: '.avi',
        error: `Managed plugin context cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
    return this.getStatus();
  }

  list() {
    return [...this.plugins.values()].map((plugin) => ({
      id: plugin.id,
      name: plugin.name,
      description: plugin.description,
      version: plugin.version,
      status: 'loaded',
      directory: this.pluginsDir,
      fileName: basename(plugin.sourcePath),
      capabilities: CONTRIBUTION_TYPES.filter((type) => plugin.contributions[type].length > 0),
      contributions: Object.fromEntries(CONTRIBUTION_TYPES.map((type) => [
        type,
        plugin.contributions[type].length,
      ])),
    }));
  }

  getStatus() {
    return {
      pluginsDir: this.pluginsDir,
      restartRequired: this.restartRequired,
      plugins: this.list(),
      failures: this.getFailures(),
    };
  }

  getFailures() {
    return this.failures.map((failure) => ({ ...failure }));
  }

  getContributions(type) {
    if (!CONTRIBUTION_TYPES.includes(type)) {
      throw new Error(`Unknown plugin contribution type "${type}".`);
    }
    return [...this.plugins.values()].flatMap((plugin) => plugin.contributions[type].map((item) => ({
      pluginId: plugin.id,
      ...item.public,
    })));
  }

  getProviderTypes() {
    return [...this.plugins.values()].flatMap((plugin) => plugin.contributions.providers.map((item) => ({
      ...item.public,
      ...item.handlers,
    })));
  }

  getHandlers(type, id) {
    if (!CONTRIBUTION_TYPES.includes(type)) {
      throw new Error(`Unknown plugin contribution type "${type}".`);
    }
    const normalizedId = String(id ?? '').toLowerCase();
    for (const plugin of this.plugins.values()) {
      const contribution = plugin.contributions[type].find((item) => {
        const itemId = type === 'providers'
          ? item.public.descriptor.id
          : item.public.id ?? item.public.name ?? '';
        return String(itemId).toLowerCase() === normalizedId;
      });
      if (contribution) return contribution.handlers;
    }
    return null;
  }

  async sideload(sourcePath) {
    const source = resolve(sourcePath);
    if (extname(source) !== '.js' || basename(source).startsWith('.')) {
      throw new Error('Only a single non-hidden .js plugin file can be sideloaded.');
    }
    const sourceStat = await lstat(source);
    if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) {
      throw new Error('The sideload source must be a regular file.');
    }
    const destination = join(this.pluginsDir, basename(source));
    if (source.toLowerCase() === destination.toLowerCase()) {
      throw new Error('The plugin is already in the plugin directory.');
    }
    await mkdir(this.pluginsDir, { recursive: true });
    try {
      await lstat(destination);
      throw new Error(`Plugin file "${basename(source)}" already exists.`);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    const temporary = `${destination}.${randomUUID()}.tmp`;
    try {
      await copyFile(source, temporary, 0x1);
      await rename(temporary, destination);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
    this.restartRequired = true;
    return { fileName: basename(source), path: destination, restartRequired: true };
  }

  async #load(sourcePath) {
    const sourceStat = await lstat(sourcePath);
    if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) {
      throw new Error('Plugin source must be a regular file.');
    }
    const moduleUrl = pathToFileURL(sourcePath);
    moduleUrl.searchParams.set('avi', `${Date.now()}-${randomUUID()}`);
    const module = await import(moduleUrl.href);
    const definition = typeof module.default === 'function'
      ? await module.default(pluginApi)
      : module.default;
    return this.#validateDefinition(definition, sourcePath);
  }

  #validateDefinition(definition, sourcePath) {
    if (!definition || typeof definition !== 'object' || Array.isArray(definition)) {
      throw new Error('Plugin default export must be an object or async factory.');
    }
    const unsupported = Object.keys(definition).filter((key) => !DEFINITION_FIELDS.has(key));
    if (unsupported.length) {
      throw new Error(`Plugin definition does not support field "${unsupported[0]}".`);
    }
    if (definition.apiVersion !== PLUGIN_API_VERSION) {
      throw new Error(`Plugin apiVersion must be ${PLUGIN_API_VERSION}.`);
    }
    const id = this.#requireId(definition.id, 'Plugin ID');
    const name = this.#requireText(definition.name, 'Plugin name');
    const version = this.#requireText(definition.version, 'Plugin version');
    const description = definition.description == null
      ? ''
      : this.#requireText(definition.description, 'Plugin description');
    const contributions = definition.contributions ?? {};
    if (!contributions || typeof contributions !== 'object' || Array.isArray(contributions)) {
      throw new Error('Plugin contributions must be an object.');
    }
    const unknown = Object.keys(contributions).filter((key) => !CONTRIBUTION_TYPES.includes(key));
    if (unknown.length) throw new Error(`Unknown contribution type "${unknown[0]}".`);

    return {
      id,
      name,
      description,
      version,
      sourcePath,
      contributions: Object.fromEntries(CONTRIBUTION_TYPES.map((type) => [
        type,
        this.#validateContributions(type, contributions[type] ?? []),
      ])),
    };
  }

  #validateContributions(type, values) {
    if (!Array.isArray(values)) throw new Error(`${type} contributions must be an array.`);
    const identifiers = new Set();
    return values.map((value, index) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`${type}[${index}] must be an object.`);
      }
      const unsupported = Object.keys(value).filter((key) => !CONTRIBUTION_FIELDS[type].has(key));
      if (unsupported.length) {
        throw new Error(`${type}[${index}] does not support field "${unsupported[0]}".`);
      }
      const descriptor = {};
      const handlers = {};
      for (const [key, item] of Object.entries(value)) {
        if (typeof item === 'function') {
          if (!HANDLER_KEYS[type].has(key)) {
            throw new Error(`${type}[${index}] does not support handler "${key}".`);
          }
          handlers[key] = item;
        } else descriptor[key] = item;
      }
      this.#assertSerializable(descriptor, `${type}[${index}]`);
      const identity = type === 'context'
        ? this.#validateContextDescriptor(descriptor, index)
        : type === 'providers'
          ? this.#requireId(descriptor.descriptor?.id, `${type}[${index}] descriptor ID`)
          : this.#requireId(descriptor.id ?? descriptor.name, `${type}[${index}] ID`);
      const normalized = identity.toLowerCase();
      if (identifiers.has(normalized)) throw new Error(`Duplicate ${type} ID "${identity}".`);
      identifiers.add(normalized);
      if (type === 'mcps') {
        this.#requireText(descriptor.name, `MCP "${identity}" name`);
        this.#requireObject(descriptor.config, `MCP "${identity}" config`);
        descriptor.config = normalizeMcpServer(descriptor.config);
      }
      if (type === 'tools') {
        this.#requireText(descriptor.name, `Tool "${identity}" name`);
        this.#requireText(descriptor.description, `Tool "${identity}" description`);
        this.#requireObject(descriptor.inputSchema, `Tool "${identity}" inputSchema`);
        if (typeof handlers.execute !== 'function') throw new Error(`Tool "${identity}" requires an execute function.`);
      }
      if (type === 'auxiliaryPanels') {
        this.#requireText(descriptor.title, `Panel "${identity}" title`);
        if (typeof handlers.load !== 'function') throw new Error(`Panel "${identity}" requires a load function.`);
      }
      if (type === 'themes') {
        this.#requireText(descriptor.name, `Theme "${identity}" name`);
        this.#requireText(descriptor.tagline, `Theme "${identity}" tagline`);
        this.#requireText(descriptor.css, `Theme "${identity}" css`);
        if (descriptor.emptyChatBackground != null && typeof descriptor.emptyChatBackground !== 'boolean') {
          throw new Error(`Theme "${identity}" emptyChatBackground must be a boolean.`);
        }
      }
      if (type === 'personalities') {
        this.#requireText(descriptor.name, `Personality "${identity}" name`);
        this.#requireText(descriptor.description, `Personality "${identity}" description`);
        this.#requireText(descriptor.instructions, `Personality "${identity}" instructions`);
      }
      if (type === 'providers') {
        this.#requireText(descriptor.descriptor.name, `Provider "${identity}" name`);
        for (const method of ['createBody', 'request', 'eventsFrom']) {
          if (typeof handlers[method] !== 'function') {
            throw new Error(`Provider "${identity}" requires a ${method} function.`);
          }
        }
      }
      return { public: descriptor, handlers };
    });
  }

  #validateContextDescriptor(descriptor, index) {
    const path = this.#requireText(descriptor.path, `context[${index}] path`).replaceAll('\\', '/');
    if (isAbsolute(path) || path.startsWith('/') || path.split('/').some((part) => part === '..')) {
      throw new Error(`Context path "${path}" escapes the plugin context root.`);
    }
    if (path.split('/').some((part) => !part || part === '.')) {
      throw new Error(`Context path "${path}" is invalid.`);
    }
    if (typeof descriptor.content !== 'string') {
      throw new Error(`Context file "${path}" content must be a string.`);
    }
    descriptor.path = path;
    return path;
  }

  #claim(plugin, claimed) {
    this.#claimId(claimed.plugins, plugin.id, plugin.id, 'plugin');
    for (const item of plugin.contributions.tools) {
      this.#claimId(claimed.tools, item.public.name ?? item.public.id, plugin.id, 'tool');
    }
    for (const type of ['auxiliaryPanels', 'themes', 'personalities', 'providers']) {
      for (const item of plugin.contributions[type]) {
        const id = type === 'providers'
          ? item.public.descriptor.id
          : item.public.id ?? item.public.name;
        this.#claimId(claimed[type], id, plugin.id, type);
      }
    }
  }

  #claimId(collection, id, pluginId, type) {
    const normalized = id.toLowerCase();
    const owner = collection.get(normalized);
    if (owner) throw new Error(`Duplicate ${type} ID "${id}" from plugins "${owner}" and "${pluginId}".`);
    collection.set(normalized, pluginId);
  }

  async #materialize(plugin) {
    const pluginRoot = join(this.pluginsDir, '.avi', plugin.id);
    const root = join(pluginRoot, 'context');
    const temporary = join(this.pluginsDir, '.avi', `${plugin.id}.${randomUUID()}.tmp`);
    const temporaryContext = join(temporary, 'context');
    const backup = `${pluginRoot}.${randomUUID()}.backup`;
    let backedUp = false;
    await mkdir(temporaryContext, { recursive: true });
    try {
      for (const item of plugin.contributions.context) {
        const target = resolve(temporaryContext, item.public.path);
        if (relative(temporaryContext, target).startsWith(`..${sep}`) || target === temporaryContext) {
          throw new Error(`Context path "${item.public.path}" escapes the plugin context root.`);
        }
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, item.public.content, { encoding: 'utf8', flag: 'wx' });
      }
      await mkdir(dirname(pluginRoot), { recursive: true });
      try {
        await rename(pluginRoot, backup);
        backedUp = true;
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
      await rename(temporary, pluginRoot);
      await rm(backup, { recursive: true, force: true });
      const canonicalRoot = await realpath(root);
      const rootStat = await stat(canonicalRoot);
      if (!rootStat.isDirectory()) throw new Error('Materialized context root is invalid.');
      plugin.contributions.context = plugin.contributions.context.map((item) => ({
        ...item,
        public: { path: item.public.path, root: canonicalRoot },
      }));
    } catch (error) {
      await rm(temporary, { recursive: true, force: true });
      if (backedUp) {
        await rm(pluginRoot, { recursive: true, force: true });
        await rename(backup, pluginRoot);
      }
      throw error;
    }
  }

  async #cleanupMaterialized(activeIds) {
    const storageRoot = join(this.pluginsDir, '.avi');
    let entries;
    try {
      entries = await readdir(storageRoot, { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.isSymbolicLink() && !activeIds.has(entry.name.toLowerCase())) {
        await rm(join(storageRoot, entry.name), { recursive: true, force: true });
      }
    }
  }

  #requireId(value, label) {
    const id = this.#requireText(value, label);
    if (!ID_PATTERN.test(id)) throw new Error(`${label} "${id}" is invalid.`);
    return id;
  }

  #requireText(value, label) {
    if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required.`);
    return value.trim();
  }

  #requireObject(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`${label} must be an object.`);
    }
    return value;
  }

  #assertSerializable(value, label) {
    const seen = new Set();
    const visit = (item, path) => {
      if (item === null || ['string', 'boolean'].includes(typeof item)) return;
      if (typeof item === 'number' && Number.isFinite(item)) return;
      if (typeof item === 'undefined' || typeof item === 'bigint' || typeof item === 'symbol' || typeof item === 'function') {
        throw new Error(`${path} is not serializable.`);
      }
      if (typeof item !== 'object') throw new Error(`${path} is not serializable.`);
      if (seen.has(item)) throw new Error(`${path} contains a circular reference.`);
      const prototype = Object.getPrototypeOf(item);
      if (!Array.isArray(item) && prototype !== Object.prototype && prototype !== null) {
        throw new Error(`${path} must contain only plain objects and arrays.`);
      }
      seen.add(item);
      if (Array.isArray(item)) item.forEach((child, index) => visit(child, `${path}[${index}]`));
      else Object.entries(item).forEach(([key, child]) => visit(child, `${path}.${key}`));
      seen.delete(item);
    };
    visit(value, label);
  }
}

export { EMPTY_CONTRIBUTIONS };
