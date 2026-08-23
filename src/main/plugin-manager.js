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
import extractZip from 'extract-zip';
import semver from 'semver';
import { normalizeMcpServer } from './mcp-config.js';
import { pluginApi, PLUGIN_API_VERSION } from './plugin-api.js';
import { PluginRuntime } from './plugin-runtime.js';

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
  'capabilities',
  'activate',
  'deactivate',
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
const ENTRYPOINT = 'plugin.js';
const DISABLED_ENTRYPOINT = 'plugin.js.disabled';
const MANIFEST = '.avi-plugin.json';
const MAX_ZIP_ENTRIES = 1_000;
const MAX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;

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
    this.inventory = [];
    this.failures = [];
    this.restartRequired = false;
    this.runtime = new PluginRuntime({ pluginsDir: this.pluginsDir });
  }

  async initialize() {
    let entries;
    try {
      await mkdir(this.pluginsDir, { recursive: true });
      entries = await readdir(this.pluginsDir, { withFileTypes: true });
    } catch (error) {
      this.plugins = new Map();
      this.inventory = [];
      this.failures = [{
        fileName: 'plugins',
        error: `Plugin directory is unavailable: ${error instanceof Error ? error.message : String(error)}`,
      }];
      return this.getStatus();
    }
    const directories = entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right, 'en'));
    const candidates = [];
    const disabled = [];
    const failures = [];

    for (const directoryName of directories) {
      const directory = join(this.pluginsDir, directoryName);
      const sourcePath = join(directory, ENTRYPOINT);
      const disabledPath = join(directory, DISABLED_ENTRYPOINT);
      try {
        this.#requireId(directoryName, 'Plugin directory ID');
        const [sourceExists, disabledExists] = await Promise.all([
          this.#regularFileExists(sourcePath),
          this.#regularFileExists(disabledPath),
        ]);
        if (sourceExists && disabledExists) {
          throw new Error(`Plugin directory "${directoryName}" contains both ${ENTRYPOINT} and ${DISABLED_ENTRYPOINT}.`);
        }
        if (disabledExists) {
          disabled.push(await this.#readDisabledRecord(directoryName));
          continue;
        }
        if (!sourceExists) throw new Error(`Plugin directory "${directoryName}" does not contain ${ENTRYPOINT}.`);
        const candidate = await this.#loadWithTimeout(sourcePath, directoryName);
        if (candidate.id.toLowerCase() !== directoryName.toLowerCase()) {
          throw new Error(`Plugin ID "${candidate.id}" does not match directory "${directoryName}".`);
        }
        candidates.push(candidate);
      } catch (error) {
        failures.push({
          fileName: `${directoryName}/${ENTRYPOINT}`,
          sourcePath,
          pluginId: ID_PATTERN.test(directoryName) ? directoryName : undefined,
          error: error instanceof Error ? error.message : String(error),
        });
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
    const loadedIds = new Set(materialized.map((plugin) => plugin.id.toLowerCase()));
    this.inventory = [
      ...materialized.map((plugin) => this.#pluginRecord(plugin)),
      ...disabled,
      ...failures
        .filter((failure) => failure.pluginId && !loadedIds.has(failure.pluginId.toLowerCase()))
        .map((failure) => this.#disabledRecord(failure.pluginId, {
          fileName: ENTRYPOINT,
          enabled: true,
          status: 'error',
          error: failure.error,
        })),
    ].sort((left, right) => left.id.localeCompare(right.id, 'en'));
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
    return this.inventory.map((plugin) => ({ ...plugin }));
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
    return [
      ...[...this.plugins.values()].flatMap((plugin) => plugin.contributions.providers.map((item) => ({
        ...item.public,
        ...item.handlers,
      }))),
      ...this.runtime.listProviderTypes(),
    ];
  }

  setRuntimeServices(services) {
    this.runtime.setServices(services);
  }

  async activateAll() {
    for (const plugin of this.plugins.values()) {
      try {
        await this.runtime.activate(plugin);
        const record = this.inventory.find((item) => item.id.toLowerCase() === plugin.id.toLowerCase());
        if (record) record.status = 'active';
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.failures.push({
          fileName: basename(plugin.sourcePath),
          sourcePath: plugin.sourcePath,
          pluginId: plugin.id,
          error: `Plugin activation failed: ${message}`,
        });
        this.plugins.delete(plugin.id.toLowerCase());
        const record = this.inventory.find((item) => item.id.toLowerCase() === plugin.id.toLowerCase());
        if (record) Object.assign(record, { status: 'error', error: message, runtimeLoaded: false });
      }
    }
    return this.getStatus();
  }

  deactivateAll(reason = 'shutdown') {
    return this.runtime.deactivateAll(reason);
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

  async setEnabled(id, enabled) {
    if (typeof enabled !== 'boolean') throw new Error('Plugin enabled state must be a boolean.');
    const plugin = this.#inventoryEntry(id);
    if (plugin.enabled === enabled) return { ...plugin, restartRequired: this.restartRequired };
    const directory = plugin.directory;
    const source = join(directory, enabled ? DISABLED_ENTRYPOINT : ENTRYPOINT);
    const destination = join(directory, enabled ? ENTRYPOINT : DISABLED_ENTRYPOINT);
    await this.#assertManagedRegularFile(source);
    await this.#assertMissing(destination, `Plugin entrypoint "${basename(destination)}" already exists.`);
    if (!enabled) await this.#writeManifest(directory, plugin);
    await rename(source, destination);
    Object.assign(plugin, {
      fileName: basename(destination),
      enabled,
      status: enabled
        ? (plugin.runtimeLoaded ? 'loaded' : 'pending enable')
        : (plugin.runtimeLoaded ? 'pending disable' : 'disabled'),
    });
    this.restartRequired = true;
    return { ...plugin, restartRequired: true };
  }

  async remove(id) {
    const plugin = this.#inventoryEntry(id);
    const directory = plugin.directory;
    const directoryStat = await lstat(directory);
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
      throw new Error('The managed plugin package must be a regular directory.');
    }
    await this.runtime.deactivate(plugin.id, 'removed');
    await rm(directory, { recursive: true });
    await rm(join(this.pluginsDir, '.avi', plugin.id), { recursive: true, force: true });
    await rm(join(this.pluginsDir, '.avi-storage', plugin.id), { recursive: true, force: true });
    this.inventory = this.inventory.filter((entry) => entry !== plugin);
    if (plugin.runtimeLoaded) this.restartRequired = true;
    return { id: plugin.id, restartRequired: this.restartRequired };
  }

  async sideload(sourcePath, { confirmDowngrade = async () => false } = {}) {
    const source = resolve(sourcePath);
    const extension = extname(source).toLowerCase();
    if (!['.js', '.zip'].includes(extension) || basename(source).startsWith('.')) {
      throw new Error('Only a non-hidden .js or .zip plugin package can be sideloaded.');
    }
    const sourceStat = await lstat(source);
    if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) {
      throw new Error('The sideload source must be a regular file.');
    }
    await mkdir(this.pluginsDir, { recursive: true });
    const stagingRoot = join(this.pluginsDir, `.install-${randomUUID()}`);
    const stagedPackage = join(stagingRoot, 'package');
    let backup;
    try {
      await mkdir(stagedPackage, { recursive: true });
      if (extension === '.js') {
        await copyFile(source, join(stagedPackage, ENTRYPOINT), 0x1);
      } else {
        let entryCount = 0;
        let uncompressedBytes = 0;
        const archivePaths = new Set();
        await extractZip(source, {
          dir: stagedPackage,
          onEntry: (entry) => {
            const normalized = entry.fileName.replaceAll('\\', '/');
            const normalizedKey = normalized.toLowerCase();
            const mode = (entry.externalFileAttributes >> 16) & 0xFFFF;
            entryCount += 1;
            uncompressedBytes += Number(entry.uncompressedSize ?? 0);
            if (entryCount > MAX_ZIP_ENTRIES || uncompressedBytes > MAX_UNCOMPRESSED_BYTES) {
              throw new Error('ZIP plugin package is too large.');
            }
            if (archivePaths.has(normalizedKey)) {
              throw new Error(`ZIP entry "${entry.fileName}" is duplicated.`);
            }
            archivePaths.add(normalizedKey);
            if (normalized.startsWith('/') || /^[a-z]:\//i.test(normalized)
              || normalized.split('/').includes('..') || (mode & 0o170000) === 0o120000) {
              throw new Error(`ZIP entry "${entry.fileName}" is not safe to extract.`);
            }
          },
        });
      }
      await this.#assertPackageTree(stagedPackage);
      const stagedEntrypoint = join(stagedPackage, ENTRYPOINT);
      await this.#assertManagedRegularFile(stagedEntrypoint);
      const candidate = await this.#loadWithTimeout(stagedEntrypoint, basename(source));
      const matches = this.inventory.filter((plugin) => plugin.id.toLowerCase() === candidate.id.toLowerCase());
      if (matches.length > 1) {
        throw new Error(`Plugin ID "${candidate.id}" has multiple case-insensitive installation directories. Remove the duplicates before installing.`);
      }
      const existing = matches[0];
      const destination = existing?.directory ?? join(this.pluginsDir, candidate.id.toLowerCase());
      const installedVersion = existing ? semver.valid(String(existing.version)) : null;
      if (installedVersion && semver.lt(this.#semanticVersion(candidate.version), installedVersion)) {
        const confirmed = await confirmDowngrade({
          id: candidate.id,
          name: candidate.name,
          installedVersion: existing.version,
          incomingVersion: candidate.version,
        });
        if (!confirmed) return null;
      }
      const claimed = Object.fromEntries([
        ['plugins', new Map()],
        ['tools', new Map([...this.reservedToolNames].map((name) => [name, 'Avi']))],
        ...['auxiliaryPanels', 'themes', 'personalities', 'providers'].map((type) => [
          type,
          new Map([...this.reservedIds[type]].map((id) => [id, 'Avi'])),
        ]),
      ]);
      for (const plugin of this.plugins.values()) {
        if (plugin.id.toLowerCase() !== candidate.id.toLowerCase()) this.#claim(plugin, claimed);
      }
      this.#claim(candidate, claimed);
      const contextCheck = join(stagingRoot, 'context-check');
      await mkdir(contextCheck, { recursive: true });
      for (const item of candidate.contributions.context) {
        const target = resolve(contextCheck, item.public.path);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, item.public.content, { encoding: 'utf8', flag: 'wx' });
      }
      await this.#writeManifest(stagedPackage, candidate);
      if (existing?.enabled === false) {
        await rename(join(stagedPackage, ENTRYPOINT), join(stagedPackage, DISABLED_ENTRYPOINT));
      }
      try {
        await lstat(destination);
        backup = join(this.pluginsDir, `.backup-${candidate.id}-${randomUUID()}`);
        await rename(destination, backup);
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
      try {
        await rename(stagedPackage, destination);
      } catch (error) {
        if (backup) {
          try {
            await rename(backup, destination);
            backup = null;
          } catch (rollbackError) {
            throw new Error(
              `Plugin installation failed and the previous version could not be restored. Recovery copy: ${backup}. Install error: ${error instanceof Error ? error.message : String(error)}. Rollback error: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}.`,
            );
          }
        }
        throw error;
      }
      if (backup) {
        try {
          await rm(backup, { recursive: true, force: true });
          backup = null;
        } catch (error) {
          this.failures.push({
            fileName: basename(backup),
            error: `Plugin recovery backup cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
          });
        }
      }
      const runtimeLoaded = existing?.runtimeLoaded ?? false;
      const record = existing?.enabled === false
        ? this.#disabledRecord(candidate.id, {
            name: candidate.name,
            description: candidate.description,
            version: candidate.version,
            directory: destination,
            status: 'disabled',
          })
        : this.#pluginRecord(candidate, {
            directory: destination,
            status: runtimeLoaded ? 'pending update' : 'pending enable',
            runtimeLoaded,
          });
      this.inventory = [
        ...this.inventory.filter((plugin) => plugin.id.toLowerCase() !== candidate.id.toLowerCase()),
        record,
      ].sort((left, right) => left.id.localeCompare(right.id, 'en'));
      this.restartRequired = true;
      return {
        id: candidate.id,
        name: candidate.name,
        version: candidate.version,
        path: join(destination, ENTRYPOINT),
        replaced: !!existing,
        restartRequired: true,
      };
    } finally {
      try {
        await rm(stagingRoot, { recursive: true, force: true });
      } catch (error) {
        this.failures.push({
          fileName: basename(stagingRoot),
          error: `Plugin installation staging cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }
  }

  #pluginRecord(plugin, overrides = {}) {
    return {
      id: plugin.id,
      name: plugin.name,
      description: plugin.description,
      version: plugin.version,
      status: 'loaded',
      enabled: true,
      runtimeLoaded: true,
      directory: dirname(plugin.sourcePath),
      fileName: ENTRYPOINT,
      capabilities: [...plugin.capabilities],
      contributions: Object.fromEntries(CONTRIBUTION_TYPES.map((type) => [
        type,
        plugin.contributions[type].length,
      ])),
      ...overrides,
    };
  }

  #disabledRecord(id, overrides = {}) {
    return {
      id,
      name: id,
      description: '',
      version: '',
      status: 'disabled',
      enabled: false,
      runtimeLoaded: false,
      directory: join(this.pluginsDir, id),
      fileName: DISABLED_ENTRYPOINT,
      capabilities: [],
      contributions: Object.fromEntries(CONTRIBUTION_TYPES.map((type) => [type, 0])),
      ...overrides,
    };
  }

  #inventoryEntry(id) {
    const normalized = this.#requireId(id, 'Plugin ID');
    const plugin = this.inventory.find((entry) => entry.id.toLowerCase() === normalized.toLowerCase());
    if (!plugin) throw new Error(`Plugin "${normalized}" is not managed by Avi.`);
    return plugin;
  }

  async #assertManagedRegularFile(path) {
    const file = await lstat(path);
    if (!file.isFile() || file.isSymbolicLink()) {
      throw new Error('The managed plugin source must be a regular file.');
    }
  }

  async #assertMissing(path, message) {
    try {
      await lstat(path);
      throw new Error(message);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }

  async #regularFileExists(path) {
    try {
      const entry = await lstat(path);
      if (entry.isSymbolicLink()) throw new Error(`Plugin path "${path}" cannot be a symbolic link.`);
      return entry.isFile();
    } catch (error) {
      if (error?.code === 'ENOENT') return false;
      throw error;
    }
  }

  async #readDisabledRecord(id) {
    const directory = join(this.pluginsDir, id);
    try {
      const manifest = JSON.parse(await readFile(join(directory, MANIFEST), 'utf8'));
      if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)
        || manifest.id?.toLowerCase() !== id.toLowerCase()) {
        throw new Error('manifest metadata does not match its plugin directory');
      }
      return this.#disabledRecord(id, {
        name: this.#requireText(manifest.name, 'Plugin name'),
        description: manifest.description == null ? '' : this.#requireText(manifest.description, 'Plugin description'),
        version: this.#requireText(manifest.version, 'Plugin version'),
      });
    } catch (error) {
      return this.#disabledRecord(id, {
        error: `Disabled plugin metadata is unavailable: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  async #writeManifest(directory, plugin) {
    await writeFile(join(directory, MANIFEST), `${JSON.stringify({
      id: plugin.id,
      name: plugin.name,
      description: plugin.description ?? '',
      version: plugin.version,
    }, null, 2)}\n`, 'utf8');
  }

  async #assertPackageTree(root) {
    const visit = async (directory) => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        const info = await lstat(path);
        if (info.isSymbolicLink()) throw new Error(`Plugin package cannot contain symbolic link "${relative(root, path)}".`);
        if (info.isDirectory()) await visit(path);
        else if (!info.isFile()) throw new Error(`Plugin package entry "${relative(root, path)}" is not a regular file.`);
      }
    };
    await visit(root);
  }

  #semanticVersion(version) {
    const normalized = semver.valid(String(version));
    if (!normalized) throw new Error(`Plugin version "${version}" must be a valid semantic version.`);
    return normalized;
  }

  async #loadWithTimeout(sourcePath, label) {
    let timeout;
    try {
      return await Promise.race([
        this.#load(sourcePath),
        new Promise((_, reject) => {
          timeout = setTimeout(() => reject(
            new Error(`Plugin "${label}" did not load within ${this.loadTimeoutMs} ms.`),
          ), this.loadTimeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timeout);
    }
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
    this.#semanticVersion(version);
    const description = definition.description == null
      ? ''
      : this.#requireText(definition.description, 'Plugin description');
    const capabilities = this.runtime.validateCapabilities(definition.capabilities ?? []);
    if (definition.activate != null && typeof definition.activate !== 'function') {
      throw new Error('Plugin activate must be a function.');
    }
    if (definition.deactivate != null && typeof definition.deactivate !== 'function') {
      throw new Error('Plugin deactivate must be a function.');
    }
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
      capabilities,
      activate: definition.activate,
      deactivate: definition.deactivate,
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
