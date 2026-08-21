import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import packageMetadata from '../../package.json' with { type: 'json' };
import {
  getMcpOAuthSessions,
  setMcpOAuthSessions,
} from './database.js';
import { normalizeMcpServer } from './mcp-config.js';
import {
  traceError,
  traceVerbose,
} from './trace-log.js';

const GLOBAL_ROOT = resolve(homedir());
const CLIENT_INFO = Object.freeze({ name: 'Avi', version: packageMetadata.version });
const MAX_LOG_ENTRIES = 200;
const PASSIVE_LEASE_MS = 30 * 60 * 1000;

class McpOAuthProvider {
  constructor({
    redirectUrl,
    serverKey,
    config,
    sessions,
    persist,
    onRedirect,
  }) {
    this.redirectUrlValue = redirectUrl;
    this.serverKey = serverKey;
    this.config = config;
    this.sessions = sessions;
    this.persist = persist;
    this.onRedirect = onRedirect;
  }

  get redirectUrl() {
    return this.redirectUrlValue;
  }

  get clientMetadata() {
    return {
      client_name: 'Avi',
      redirect_uris: [String(this.redirectUrl)],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: this.config.clientSecret ? 'client_secret_post' : 'none',
    };
  }

  state() {
    const state = crypto.randomUUID();
    this.sessions[this.serverKey] = {
      ...this.sessions[this.serverKey],
      state,
    };
    this.persist();
    return state;
  }

  clientInformation() {
    if (this.config.clientId) {
      return {
        client_id: this.config.clientId,
        ...(this.config.clientSecret ? { client_secret: this.config.clientSecret } : {}),
      };
    }
    return this.sessions[this.serverKey]?.clientInformation;
  }

  saveClientInformation(clientInformation) {
    this.sessions[this.serverKey] = {
      ...this.sessions[this.serverKey],
      clientInformation,
    };
    this.persist();
  }

  tokens() {
    return this.sessions[this.serverKey]?.tokens;
  }

  saveTokens(tokens) {
    this.sessions[this.serverKey] = {
      ...this.sessions[this.serverKey],
      tokens,
    };
    this.persist();
  }

  redirectToAuthorization(url) {
    this.onRedirect(url, this.sessions[this.serverKey]?.state);
  }

  saveCodeVerifier(codeVerifier) {
    this.sessions[this.serverKey] = {
      ...this.sessions[this.serverKey],
      codeVerifier,
    };
    this.persist();
  }

  codeVerifier() {
    const codeVerifier = this.sessions[this.serverKey]?.codeVerifier;
    if (!codeVerifier) throw new Error('OAuth code verifier is unavailable.');
    return codeVerifier;
  }

  invalidateCredentials(scope) {
    const current = this.sessions[this.serverKey] ?? {};
    this.sessions[this.serverKey] = scope === 'all'
      ? {}
      : {
          ...current,
          ...(scope === 'tokens' ? { tokens: undefined } : {}),
          ...(scope === 'client' ? { clientInformation: undefined } : {}),
          ...(scope === 'verifier' ? { codeVerifier: undefined } : {}),
          ...(scope === 'discovery' ? { discoveryState: undefined } : {}),
        };
    this.persist();
  }

  saveDiscoveryState(discoveryState) {
    this.sessions[this.serverKey] = {
      ...this.sessions[this.serverKey],
      discoveryState,
    };
    this.persist();
  }

  discoveryState() {
    return this.sessions[this.serverKey]?.discoveryState;
  }
}

export class McpManager {
  constructor({
    sendEvent,
    openExternal,
    globalRoot = GLOBAL_ROOT,
    managedServers = [],
  }) {
    this.sendEvent = sendEvent;
    this.openExternal = openExternal;
    this.globalRoot = resolve(globalRoot);
    this.managedServers = managedServers;
    this.managedServerNames = new Set(managedServers.map((server) => server.name));
    this.scopes = new Map();
    this.records = new Map();
    this.oauthSessions = getMcpOAuthSessions();
    this.oauthStates = new Map();
    this.oauthServer = null;
    this.oauthRedirectUrl = null;
  }

  initializeGlobal() {
    return this.initializeScope(this.globalRoot, 'global');
  }

  async ensureWorkspace(workspacePath, signal, botId = null) {
    const rootPath = resolve(workspacePath || this.globalRoot);
    const pending = [
      this.initializeGlobal(),
      ...(rootPath === this.globalRoot ? [] : [this.initializeScope(rootPath, 'folder')]),
      ...(botId ? [this.initializeScope(rootPath, 'bot', this.botScopeOptions(rootPath, botId))] : []),
    ];
    const initialization = Promise.all(pending);

    if (!signal) {
      await initialization;
    } else {
      let abortWait;
      try {
        await Promise.race([
          initialization,
          new Promise((_resolve, reject) => {
            if (signal.aborted) {
              reject(signal.reason instanceof Error ? signal.reason : new Error('MCP wait aborted.'));
              return;
            }
            abortWait = () => {
              reject(signal.reason instanceof Error ? signal.reason : new Error('MCP wait aborted.'));
            };
            signal.addEventListener('abort', abortWait, { once: true });
          }),
        ]);
      } finally {
        if (abortWait) signal.removeEventListener('abort', abortWait);
      }
    }

    return botId
      ? this.runtimeForBot(rootPath, botId)
      : this.runtimeForWorkspace(rootPath);
  }

  isWorkspaceReady(workspacePath, botId = null) {
    const rootPath = resolve(workspacePath || this.globalRoot);
    const globalScope = this.scopes.get(this.scopeKey(this.globalRoot));
    const folderScope = rootPath === this.globalRoot ? null : this.scopes.get(this.scopeKey(rootPath));
    const botScope = botId
      ? this.scopes.get(this.botScopeOptions(rootPath, botId).scopeKey)
      : null;
    return Boolean(
      globalScope?.initialized
      && !globalScope.initializing
      && (
        rootPath === this.globalRoot
        || (folderScope?.initialized && !folderScope.initializing)
      )
      && (!botId || (botScope?.initialized && !botScope.initializing)),
    );
  }

  async listFolders(folderPaths = []) {
    const roots = [
      this.globalRoot,
      ...folderPaths.map((folderPath) => resolve(folderPath)),
    ].filter((folderPath, index, items) => (
      items.findIndex((item) => item.toLowerCase() === folderPath.toLowerCase()) === index
    ));

    return Promise.all(roots.map(async (rootPath) => {
      const scope = await this.loadScope(
        rootPath,
        rootPath === this.globalRoot ? 'global' : 'folder',
      );
      return {
        path: rootPath,
        configPath: scope.configPath,
        serverCount: scope.records.size,
        activeCount: [...scope.records.values()]
          .filter((record) => record.config.enabled && record.status === 'ready')
          .length,
      };
    }));
  }

  async listFolder(folderPath, options = {}) {
    const rootPath = resolve(folderPath || this.globalRoot);
    const kind = options.kind ?? (rootPath === this.globalRoot ? 'global' : 'folder');
    const scope = await this.loadScope(rootPath, kind, options);
    return {
      path: rootPath,
      configPath: scope.configPath,
      initialized: scope.initialized,
      servers: [...scope.records.values()]
        .map((record) => this.publicRecord(record, { includeConfig: true }))
        .sort((left, right) => left.name.localeCompare(right.name)),
    };
  }

  async listWorkspace(folderPath) {
    const rootPath = resolve(folderPath || this.globalRoot);
    const globalScope = await this.loadScope(this.globalRoot, 'global');
    const folderScope = rootPath === this.globalRoot
      ? null
      : await this.loadScope(rootPath, 'folder');
    const localPrefixes = new Set(
      [...(folderScope?.records.values() ?? [])]
        .filter((record) => record.config.enabled)
        .map((record) => record.prefix),
    );

    return [
      ...[...globalScope.records.values()].map((record) => this.publicRecord(record, {
        shadowed: localPrefixes.has(record.prefix),
      })),
      ...[...(folderScope?.records.values() ?? [])].map((record) => this.publicRecord(record)),
    ].sort((left, right) => (
      Number(left.scope === 'folder') - Number(right.scope === 'folder')
      || left.name.localeCompare(right.name)
    ));
  }

  async saveServer(folderPath, previousName, value, options = {}) {
    const rootPath = resolve(folderPath || this.globalRoot);
    const kind = options.kind ?? (rootPath === this.globalRoot ? 'global' : 'folder');
    const scope = await this.loadScope(rootPath, kind, options);
    const name = String(value?.name ?? '').trim();
    if (!name) throw new Error('Server name is required.');
    if (
      kind === 'global'
      && (this.managedServerNames.has(name) || this.managedServerNames.has(previousName))
    ) {
      throw new Error(`Managed MCP server "${previousName || name}" is read-only.`);
    }

    const config = this.normalizeServer(value?.config);
    const configFile = await this.readConfig(scope.configPath);
    const servers = { ...configFile.servers };
    if (name !== previousName && Object.hasOwn(servers, name)) {
      throw new Error(`An MCP server named "${name}" already exists in this scope.`);
    }
    if (previousName && previousName !== name) delete servers[previousName];

    const prefix = `mcp_${this.sanitizeName(name)}_`;
    const duplicate = Object.entries(servers).find(([serverName]) => (
      serverName !== previousName
      && serverName !== name
      && `mcp_${this.sanitizeName(serverName)}_` === prefix
    ));
    if (duplicate) {
      throw new Error(`Server name conflicts with "${duplicate[0]}" after sanitization.`);
    }

    servers[name] = config;
    await mkdir(dirname(scope.configPath), { recursive: true });
    await writeFile(
      scope.configPath,
      `${JSON.stringify({ ...configFile, servers }, null, 2)}\n`,
      'utf8',
    );

    if (previousName && previousName !== name) {
      const previous = scope.records.get(previousName);
      if (previous) {
        await this.closeRecord(previous);
        delete this.oauthSessions[previous.key];
        setMcpOAuthSessions(this.oauthSessions);
      }
    }
    const reloaded = await this.loadScope(rootPath, scope.kind, {
      ...scope.options,
      reload: true,
    });
    const record = reloaded.records.get(name);
    if (reloaded.initialized && record?.config.enabled) {
      if (record.config.lifecycle === 'passive') {
        await this.closeRecord(record);
        this.resetRecord(record);
      } else {
        await this.restartRecord(record);
      }
    }
    this.emitState();
    return this.listFolder(rootPath, options);
  }

  async removeServer(folderPath, name, options = {}) {
    const rootPath = resolve(folderPath || this.globalRoot);
    const kind = options.kind ?? (rootPath === this.globalRoot ? 'global' : 'folder');
    const scope = await this.loadScope(rootPath, kind, options);
    const configFile = await this.readConfig(scope.configPath);
    if (kind === 'global' && this.managedServerNames.has(name)) {
      throw new Error(`Managed MCP server "${name}" is read-only.`);
    }
    if (!Object.hasOwn(configFile.servers, name)) return this.listFolder(rootPath, options);

    const record = scope.records.get(name);
    if (record) {
      await this.closeRecord(record);
      delete this.oauthSessions[record.key];
      setMcpOAuthSessions(this.oauthSessions);
    }
    const servers = { ...configFile.servers };
    delete servers[name];
    await writeFile(
      scope.configPath,
      `${JSON.stringify({ ...configFile, servers }, null, 2)}\n`,
      'utf8',
    );
    await this.loadScope(rootPath, scope.kind, {
      ...scope.options,
      reload: true,
    });
    this.emitState();
    return this.listFolder(rootPath, options);
  }

  async setServerEnabled(serverKey, enabled) {
    const record = this.records.get(serverKey);
    if (!record) throw new Error('MCP server not found.');
    if (record.managed) throw new Error(`Managed MCP server "${record.name}" is read-only.`);
    return this.saveServer(record.rootPath, record.name, {
      name: record.name,
      config: { ...record.config, enabled },
    }, record.scopeState.options);
  }

  async restartServer(serverKey) {
    const record = this.records.get(serverKey);
    if (!record) throw new Error('MCP server not found.');
    if (!record.config.enabled) throw new Error('Enable the MCP server before restarting it.');
    await this.restartRecord(record);
    this.emitState();
    return this.publicRecord(record);
  }

  async restartAll(workspacePath) {
    const rootPath = resolve(workspacePath || this.globalRoot);
    await this.loadScope(this.globalRoot, 'global');
    if (rootPath !== this.globalRoot) await this.loadScope(rootPath, 'folder');
    const scopes = [...this.scopes.values()].filter((scope) => (
      scope.kind === 'global' || scope.initialized || scope.rootPath === rootPath
    ));

    await Promise.all(scopes.flatMap((scope) => (
      [...scope.records.values()].map((record) => this.closeRecord(record))
    )));
    for (const scope of scopes) {
      scope.initialized = false;
      scope.initializing = null;
      for (const record of scope.records.values()) this.resetRecord(record);
    }
    await Promise.all(scopes.map((scope) => (
      this.initializeScope(scope.rootPath, scope.kind, scope.options)
    )));
    this.emitState();
    return this.listWorkspace(rootPath);
  }

  inspectServer(serverKey) {
    const record = this.records.get(serverKey);
    if (!record) throw new Error('MCP server not found.');
    return this.publicRecord(record, { includeConfig: true, includeDetails: true });
  }

  async authenticate(serverKey) {
    const record = this.records.get(serverKey);
    if (!record?.authUrl) throw new Error('This MCP server is not waiting for OAuth authentication.');
    await this.openExternal(record.authUrl);
    return true;
  }

  runtimeForWorkspace(workspacePath) {
    return this.runtimeForScopes(workspacePath);
  }

  runtimeForBot(workspacePath, botId) {
    const rootPath = resolve(workspacePath || this.globalRoot);
    const botScope = this.scopes.get(this.botScopeOptions(rootPath, botId).scopeKey);
    return this.runtimeForScopes(rootPath, botScope);
  }

  runtimeForScopes(workspacePath, exclusiveScope = null) {
    const rootPath = resolve(workspacePath || this.globalRoot);
    const globalScope = this.scopes.get(this.scopeKey(this.globalRoot));
    const folderScope = rootPath === this.globalRoot ? null : this.scopes.get(this.scopeKey(rootPath));
    const records = new Map();

    for (const scope of [globalScope, folderScope, exclusiveScope]) {
      for (const record of scope?.records.values() ?? []) {
        if (record.config.enabled) records.set(record.prefix, record);
      }
    }

    return {
      tools: [...records.values()].flatMap((record) => {
        if (record.status === 'ready') return record.tools;
        if (record.config.lifecycle === 'passive' && record.status !== 'starting') {
          return [this.passiveEnableTool(record)];
        }
        return [];
      }),
      instructions: [...records.values()]
        .filter((record) => record.status === 'ready' && record.instructions)
        .map((record) => ({ from: record.name, text: record.instructions })),
    };
  }

  snapshot() {
    const servers = [...this.records.values()].map((record) => this.publicRecord(record));
    return {
      loadingCount: servers.filter((server) => server.status === 'starting').length,
      authRequiredCount: servers.filter((server) => server.status === 'auth-required').length,
      servers,
    };
  }

  async closeAll() {
    await Promise.all([...this.records.values()].map((record) => this.closeRecord(record)));
    if (this.oauthServer) {
      await new Promise((resolveClose) => this.oauthServer.close(resolveClose));
      this.oauthServer = null;
      this.oauthRedirectUrl = null;
    }
  }

  async initializeScope(rootPath, kind, options = {}) {
    const startedAt = Date.now();
    traceVerbose('mcp.scope-initialization-started', {
      operation: 'initialize-scope',
      scope: kind,
    });
    const scope = await this.loadScope(rootPath, kind, options);
    if (scope.initializing) {
      traceVerbose('mcp.scope-initialization-reused', {
        operation: 'initialize-scope',
        scope: kind,
        duration_ms: Date.now() - startedAt,
      });
      return scope.initializing;
    }
    if (scope.initialized) {
      traceVerbose('mcp.scope-initialization-skipped', {
        operation: 'initialize-scope',
        scope: kind,
        duration_ms: Date.now() - startedAt,
        server_count: scope.records.size,
      });
      return scope;
    }

    scope.initializing = Promise.all(
      [...scope.records.values()].map(async (record) => {
        if (!record.config.enabled) {
          record.status = 'disabled';
          record.resolveReady();
          return;
        }
        if (record.config.lifecycle === 'passive') {
          record.resolveReady();
          return;
        }
        if (record.status === 'idle' || record.status === 'error') {
          record.connecting = this.connectRecord(record);
        }
        await record.ready;
      }),
    ).then(() => {
      scope.initialized = true;
      scope.initializing = null;
      traceVerbose('mcp.scope-initialization-completed', {
        operation: 'initialize-scope',
        scope: kind,
        duration_ms: Date.now() - startedAt,
        server_count: scope.records.size,
      });
      this.emitState();
      return scope;
    }).catch((error) => {
      scope.initializing = null;
      traceError('mcp.scope-initialization-error', {
        operation: 'initialize-scope',
        scope: kind,
        duration_ms: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    });
    this.emitState();
    return scope.initializing;
  }

  async loadScope(rootPath, kind, options = {}) {
    const { reload = false } = options;
    const startedAt = Date.now();
    const normalizedRoot = resolve(rootPath || this.globalRoot);
    const key = options.scopeKey ?? this.scopeKey(normalizedRoot);
    const existing = this.scopes.get(key);
    if (existing && !reload) return existing;
    traceVerbose('mcp.scope-discovery-started', {
      operation: 'load-scope',
      scope: kind,
      phase: reload ? 'reload' : 'load',
    });

    const scope = existing ?? {
      rootPath: normalizedRoot,
      kind,
      configPath: options.configPath ?? join(normalizedRoot, '.agents', 'mcpconfig.json'),
      options,
      initialized: false,
      initializing: null,
      records: new Map(),
    };
    const configFile = await this.readConfig(scope.configPath);
    if (kind === 'global') {
      const collision = Object.keys(configFile.servers)
        .find((name) => this.managedServerNames.has(name));
      if (collision) {
        throw new Error(`Global MCP server "${collision}" conflicts with a managed plugin server.`);
      }
    }
    const servers = kind === 'global'
      ? {
          ...Object.fromEntries(this.managedServers.map((server) => [server.name, server.config])),
          ...configFile.servers,
        }
      : configFile.servers;
    const configuredNames = new Set(Object.keys(servers));

    for (const [name, record] of scope.records) {
      if (configuredNames.has(name)) continue;
      await this.closeRecord(record);
      scope.records.delete(name);
      this.records.delete(record.key);
    }

    for (const [name, value] of Object.entries(servers)) {
      const config = this.normalizeServer(value);
      const current = scope.records.get(name);
      if (current && JSON.stringify(current.config) === JSON.stringify(config)) continue;
      if (current) await this.closeRecord(current);

      let resolveReady;
      const ready = new Promise((resolvePromise) => {
        resolveReady = resolvePromise;
      });
      const record = {
        key: `${key}:${name}`,
        rootPath: normalizedRoot,
        scope: kind,
        scopeState: scope,
        name,
        prefix: `mcp_${this.sanitizeName(name)}_`,
        managed: kind === 'global' && this.managedServerNames.has(name),
        config,
        status: config.enabled ? 'idle' : 'disabled',
        tools: [],
        instructions: '',
        logs: [],
        error: '',
        authUrl: '',
        client: null,
        transport: null,
        oauthProvider: null,
        connecting: null,
        leaseTimer: null,
        activeUntil: null,
        ready,
        resolveReady,
      };
      if (!config.enabled) record.resolveReady();
      scope.records.set(name, record);
      this.records.set(record.key, record);
    }

    this.scopes.set(key, scope);
    traceVerbose('mcp.scope-discovery-completed', {
      operation: 'load-scope',
      scope: kind,
      phase: reload ? 'reload' : 'load',
      duration_ms: Date.now() - startedAt,
      server_count: scope.records.size,
    });
    return scope;
  }

  async connectRecord(record) {
    const startedAt = Date.now();
    let phase = 'transport';
    let phaseStartedAt = startedAt;
    traceVerbose('mcp.server-connection-started', {
      operation: 'connect-server',
      scope: record.scope,
      mcp_server: record.name,
      phase,
    });
    record.status = 'starting';
    record.error = '';
    record.authUrl = '';
    this.appendLog(record, 'info', 'Starting MCP server.');
    this.emitState();

    try {
      let transport;
      if (record.config.type === 'stdio') {
        transport = new StdioClientTransport({
          command: record.config.command,
          args: record.config.args,
          cwd: record.config.cwd
            ? resolve(record.rootPath, record.config.cwd)
            : record.rootPath,
          env: {
            ...getDefaultEnvironment(),
            ...record.config.env,
          },
          stderr: 'pipe',
        });
        transport.stderr?.on('data', (chunk) => {
          for (const line of String(chunk).split(/\r?\n/).filter(Boolean)) {
            this.appendLog(record, 'error', line);
          }
          this.emitState();
        });
      } else {
        const baseHeaders = {
          ...record.config.headers,
          ...(record.config.auth.type === 'bearer' && record.config.auth.token
            ? { Authorization: `Bearer ${record.config.auth.token}` }
            : {}),
        };
        const fetchWithHeaders = (url, init = {}) => fetch(url, {
          ...init,
          headers: {
            ...baseHeaders,
            ...Object.fromEntries(new Headers(init.headers).entries()),
          },
        });
        const useOAuth = ['auto', 'oauth2'].includes(record.config.auth.type);
        if (useOAuth) {
          await this.ensureOAuthServer();
          record.oauthProvider = new McpOAuthProvider({
            redirectUrl: this.oauthRedirectUrl,
            serverKey: record.key,
            config: record.config.auth,
            sessions: this.oauthSessions,
            persist: () => setMcpOAuthSessions(this.oauthSessions),
            onRedirect: (url, state) => {
              record.authUrl = url.toString();
              if (state) this.oauthStates.set(state, record.key);
              record.status = 'auth-required';
              this.appendLog(record, 'info', 'OAuth authentication is required.');
              this.sendEvent({
                type: 'auth-required',
                server: this.publicRecord(record),
              });
              this.emitState();
            },
          });
        }
        const options = {
          fetch: fetchWithHeaders,
          ...(record.oauthProvider ? { authProvider: record.oauthProvider } : {}),
        };
        transport = record.config.type === 'sse'
          ? new SSEClientTransport(new URL(record.config.url), {
              ...options,
              eventSourceInit: { fetch: fetchWithHeaders },
            })
          : new StreamableHTTPClientTransport(new URL(record.config.url), options);
      }

      traceVerbose('mcp.server-phase-completed', {
        operation: 'connect-server',
        scope: record.scope,
        mcp_server: record.name,
        phase,
        duration_ms: Date.now() - phaseStartedAt,
      });
      record.transport = transport;
      phase = 'handshake';
      phaseStartedAt = Date.now();
      const client = new Client(CLIENT_INFO, {
        listChanged: {
          tools: {
            onChanged: (error, tools) => {
              if (error) {
                this.appendLog(record, 'error', `Could not refresh tools: ${error.message}`);
                return;
              }
              record.tools = this.mapTools(record, tools ?? []);
              this.appendLog(record, 'info', `Tool list refreshed (${record.tools.length}).`);
              this.emitState();
            },
          },
        },
      });
      record.client = client;
      await client.connect(transport);
      traceVerbose('mcp.server-phase-completed', {
        operation: 'connect-server',
        scope: record.scope,
        mcp_server: record.name,
        phase,
        duration_ms: Date.now() - phaseStartedAt,
      });

      phase = 'list-tools';
      phaseStartedAt = Date.now();
      const listedTools = [];
      let cursor;
      do {
        const result = await client.listTools(cursor ? { cursor } : undefined);
        listedTools.push(...result.tools);
        cursor = result.nextCursor;
      } while (cursor);

      record.tools = this.mapTools(record, listedTools);
      traceVerbose('mcp.server-phase-completed', {
        operation: 'connect-server',
        scope: record.scope,
        mcp_server: record.name,
        phase,
        duration_ms: Date.now() - phaseStartedAt,
        tool_count: record.tools.length,
      });
      record.instructions = client.getInstructions() ?? '';
      record.status = 'ready';
      record.error = '';
      record.authUrl = '';
      if (record.config.lifecycle === 'passive') this.touchPassiveLease(record);
      this.appendLog(record, 'info', `Connected with ${record.tools.length} tool(s).`);
      traceVerbose('mcp.server-connection-completed', {
        operation: 'connect-server',
        scope: record.scope,
        mcp_server: record.name,
        duration_ms: Date.now() - startedAt,
        tool_count: record.tools.length,
        status: record.status,
      });
      record.resolveReady();
      this.emitState();
    } catch (error) {
      if (error instanceof UnauthorizedError && record.oauthProvider) {
        record.status = 'auth-required';
        traceVerbose('mcp.server-connection-completed', {
          operation: 'connect-server',
          scope: record.scope,
          mcp_server: record.name,
          phase,
          duration_ms: Date.now() - startedAt,
          status: record.status,
        });
        this.emitState();
        return;
      }

      await this.closeRecord(record, { settle: false });
      record.status = 'error';
      record.error = error instanceof Error ? error.message : String(error);
      traceError('mcp.server-connection-error', {
        operation: 'connect-server',
        scope: record.scope,
        mcp_server: record.name,
        phase,
        duration_ms: Date.now() - startedAt,
        status: record.status,
        error: record.error,
      });
      this.appendLog(record, 'error', record.error);
      record.resolveReady();
      this.sendEvent({
        type: 'server-failed',
        server: this.publicRecord(record),
      });
      this.emitState();
    }
  }

  mapTools(record, tools) {
    const names = new Set();
    return tools.map((tool) => {
      const safeToolName = this.sanitizeName(tool.name);
      const exposedName = `${record.prefix}${safeToolName}`;
      if (names.has(exposedName)) {
        throw new Error(`MCP server "${record.name}" exposes conflicting tool names.`);
      }
      names.add(exposedName);
      return {
        name: exposedName,
        description: tool.description || tool.title || `Tool from ${record.name}`,
        inputSchema: tool.inputSchema ?? { type: 'object', properties: {} },
        canEditFile: tool.annotations?.readOnlyHint !== true,
        canPerformDestructiveActions: tool.annotations?.destructiveHint === true,
        mcp: {
          serverKey: record.key,
          serverName: record.name,
          toolName: tool.name,
        },
        execute: async (input, { signal }) => {
          if (record.status !== 'ready' || !record.client) {
            throw new Error(
              `MCP server "${record.name}" is not connected.`
              + (record.config.lifecycle === 'passive'
                ? ` Call ${record.prefix}enable_mcp to activate it.`
                : ''),
            );
          }
          if (record.config.lifecycle === 'passive') this.touchPassiveLease(record);
          try {
            const argumentsValue = { ...input };
            delete argumentsValue.__requires_human_approval;
            delete argumentsValue.__invocation_goal;
            const result = await record.client.callTool(
              { name: tool.name, arguments: argumentsValue },
              undefined,
              { signal },
            );
            if (result.isError) {
              const message = result.content
                ?.filter((item) => item.type === 'text')
                .map((item) => item.text)
                .join('\n');
              throw new Error(message || `MCP tool "${tool.name}" returned an error.`);
            }
            const parts = [];
            const mediaFiles = [];
            const timestamp = Date.now();
            let mediaDir = null;
            for (const item of result.content ?? []) {
              if (item.type === 'text') {
                parts.push(item.text);
              } else if (item.type === 'image' || item.type === 'audio') {
                const ext = (item.mimeType ?? '').split('/')[1]?.split(';')[0] ?? 'bin';
                const id = randomBytes(6).toString('base64url');
                if (!mediaDir) {
                  mediaDir = join(tmpdir(), '.avi', 'media', String(timestamp));
                  await mkdir(mediaDir, { recursive: true });
                }
                const filePath = join(mediaDir, `${id}.${ext}`);
                await writeFile(filePath, Buffer.from(item.data, 'base64'));
                mediaFiles.push(filePath);
              } else if (item.type === 'resource') {
                if (item.resource?.text) {
                  parts.push(item.resource.text);
                } else if (item.resource?.blob) {
                  const ext = (item.resource.mimeType ?? '').split('/')[1]?.split(';')[0] ?? 'bin';
                  const id = randomBytes(6).toString('base64url');
                  if (!mediaDir) {
                    mediaDir = join(tmpdir(), '.avi', 'media', String(timestamp));
                    await mkdir(mediaDir, { recursive: true });
                  }
                  const filePath = join(mediaDir, `${id}.${ext}`);
                  await writeFile(filePath, Buffer.from(item.resource.blob, 'base64'));
                  mediaFiles.push(filePath);
                } else {
                  parts.push(`[resource: ${item.resource?.uri ?? 'unknown'}]`);
                }
              } else if (item.type === 'resource_link') {
                parts.push(`[resource_link: ${item.uri ?? 'unknown'}]`);
              } else {
                parts.push(`[${item.type}]`);
              }
            }
            const outputSections = [];
            if (parts.length > 0) {
              outputSections.push(parts.join('\n'));
            }
            if (result.structuredContent !== undefined) {
              outputSections.push(JSON.stringify(result.structuredContent));
            }
            if (mediaFiles.length > 0) {
              const fileList = mediaFiles.map((f) => `- ${f.replace(/\\/g, '/')}`).join('\n');
              outputSections.push(`Files created from tool response:\n${fileList}`);
            }
            return outputSections.join('\n\n') || JSON.stringify(result);
          } catch (error) {
            this.appendLog(
              record,
              'error',
              `Tool "${tool.name}" failed: ${error instanceof Error ? error.message : String(error)}`,
            );
            this.emitState();
            throw error;
          }
        },
      };
    });
  }

  passiveEnableTool(record) {
    const leaseMinutes = Math.round(PASSIVE_LEASE_MS / 60000);
    return {
      name: `${record.prefix}enable_mcp`,
      description: `Activate the passive MCP server "${record.name}" (${record.config.type}). Its real tools stay hidden until this tool is called. After activation the server stays connected for ${leaseMinutes} minutes of inactivity, renewed by every tool call.`,
      inputSchema: { type: 'object', properties: {} },
      canEditFile: false,
      canPerformDestructiveActions: false,
      mcp: {
        serverKey: record.key,
        serverName: record.name,
        toolName: 'enable_mcp',
      },
      execute: async () => {
        const status = await this.activatePassiveRecord(record);
        if (status === 'ready') {
          return `MCP server "${record.name}" is active with ${record.tools.length} tool(s). Its tools are now available and stay live for ${leaseMinutes} minutes; every tool call renews the window.`;
        }
        if (status === 'auth-required') {
          return `MCP server "${record.name}" requires OAuth authentication. The user was asked to authenticate in the browser. Once they finish, call ${record.prefix}enable_mcp again.`;
        }
        throw new Error(
          `MCP server "${record.name}" could not be activated: ${record.error || 'unknown error'}`,
        );
      },
    };
  }

  async activatePassiveRecord(record) {
    if (record.status === 'ready') {
      this.touchPassiveLease(record);
      return 'ready';
    }
    if (record.connecting) {
      await record.connecting;
    } else if (record.status === 'idle' || record.status === 'error') {
      record.connecting = this.connectRecord(record);
      await record.connecting;
    }
    return record.status;
  }

  touchPassiveLease(record) {
    record.activeUntil = Date.now() + PASSIVE_LEASE_MS;
    if (record.leaseTimer) clearTimeout(record.leaseTimer);
    record.leaseTimer = setTimeout(() => {
      this.deactivatePassiveRecord(record);
    }, PASSIVE_LEASE_MS);
  }

  clearPassiveLease(record) {
    if (record.leaseTimer) clearTimeout(record.leaseTimer);
    record.leaseTimer = null;
    record.activeUntil = null;
  }

  async deactivatePassiveRecord(record) {
    if (this.records.get(record.key) !== record) return;
    this.clearPassiveLease(record);
    await this.closeRecord(record);
    this.resetRecord(record);
    this.appendLog(record, 'info', 'Passive MCP server deactivated after inactivity.');
    this.emitState();
  }

  async restartRecord(record) {
    await this.closeRecord(record);
    this.resetRecord(record);
    if (!record.config.enabled) {
      record.resolveReady();
      return;
    }
    record.connecting = this.connectRecord(record);
    await record.ready;
  }

  resetRecord(record) {
    let resolveReady;
    record.ready = new Promise((resolvePromise) => {
      resolveReady = resolvePromise;
    });
    record.resolveReady = resolveReady;
    record.status = record.config.enabled ? 'idle' : 'disabled';
    record.tools = [];
    record.instructions = '';
    record.error = '';
    record.authUrl = '';
    this.clearPassiveLease(record);
  }

  async closeRecord(record, { settle = true } = {}) {
    this.clearPassiveLease(record);
    record.connecting = null;
    const client = record.client;
    record.client = null;
    record.transport = null;
    for (const [state, serverKey] of this.oauthStates) {
      if (serverKey === record.key) this.oauthStates.delete(state);
    }
    if (settle) record.resolveReady();
    if (client) {
      try {
        await client.close();
      } catch (error) {
        this.appendLog(
          record,
          'error',
          `Could not close server cleanly: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  async ensureOAuthServer() {
    if (this.oauthServer && this.oauthRedirectUrl) return;

    this.oauthServer = createServer((request, response) => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (url.pathname !== '/mcp/oauth/callback') {
        response.writeHead(404).end('Not found');
        return;
      }

      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const error = url.searchParams.get('error');
      const serverKey = state ? this.oauthStates.get(state) : null;
      const record = serverKey ? this.records.get(serverKey) : null;
      if (!record || !code || error) {
        response.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end('<h1>Authentication failed</h1><p>Return to Avi and try again.</p>');
        return;
      }

      this.oauthStates.delete(state);
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end('<h1>Authentication complete</h1><p>You can close this window and return to Avi.</p>');
      this.finishOAuth(record, code);
    });
    await new Promise((resolveListen, reject) => {
      this.oauthServer.once('error', reject);
      this.oauthServer.listen(0, '127.0.0.1', () => {
        this.oauthServer.off('error', reject);
        resolveListen();
      });
    });
    const address = this.oauthServer.address();
    this.oauthRedirectUrl = `http://127.0.0.1:${address.port}/mcp/oauth/callback`;
  }

  async finishOAuth(record, code) {
    if (this.records.get(record.key) !== record || !record.transport) return;
    try {
      await record.transport.finishAuth(code);
      await this.closeRecord(record, { settle: false });
      record.status = 'idle';
      record.tools = [];
      record.instructions = '';
      record.error = '';
      record.authUrl = '';
      record.connecting = this.connectRecord(record);
      await record.connecting;
      if (record.status !== 'ready') return;
      this.sendEvent({
        type: 'auth-complete',
        server: this.publicRecord(record),
      });
    } catch (error) {
      await this.closeRecord(record, { settle: false });
      record.status = 'error';
      record.error = error instanceof Error ? error.message : String(error);
      this.appendLog(record, 'error', `OAuth failed: ${record.error}`);
      record.resolveReady();
      this.sendEvent({
        type: 'server-failed',
        server: this.publicRecord(record),
      });
      this.emitState();
    }
  }

  normalizeServer(value) {
    return normalizeMcpServer(value);
  }

  async readConfig(configPath) {
    try {
      const parsed = JSON.parse(await readFile(configPath, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('MCP config must be a JSON object.');
      }
      if (parsed.servers != null && (
        typeof parsed.servers !== 'object'
        || Array.isArray(parsed.servers)
      )) {
        throw new Error('"servers" must be a JSON object.');
      }
      return { ...parsed, servers: parsed.servers ?? {} };
    } catch (error) {
      if (error?.code === 'ENOENT') return { servers: {} };
      if (error instanceof SyntaxError) {
        throw new Error(`Invalid JSON in ${configPath}: ${error.message}`);
      }
      throw error;
    }
  }

  publicRecord(record, {
    includeConfig = false,
    includeDetails = false,
    shadowed = false,
  } = {}) {
    return {
      key: record.key,
      name: record.name,
      scope: record.scope,
      rootPath: record.rootPath,
      type: record.config.type,
      enabled: record.config.enabled,
      lifecycle: record.config.lifecycle ?? 'active',
      managed: record.managed === true,
      status: shadowed ? 'shadowed' : record.status,
      toolCount: record.tools.length,
      error: record.error,
      activeUntil: record.activeUntil ?? null,
      ...(includeConfig ? { config: record.config } : {}),
      ...(includeDetails
        ? {
            instructions: record.instructions,
            tools: record.tools.map((tool) => ({
              name: tool.mcp.toolName,
              exposedName: tool.name,
              description: tool.description,
              inputSchema: tool.inputSchema,
            })),
            logs: record.logs,
          }
        : {}),
    };
  }

  sanitizeName(value) {
    return String(value)
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'unnamed';
  }

  scopeKey(rootPath) {
    const resolved = resolve(rootPath);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  }

  botScopeOptions(rootPath, botId) {
    const normalizedBotId = String(botId ?? '').trim();
    if (!/^[a-zA-Z0-9_-]+$/.test(normalizedBotId)) throw new Error('Invalid bot id.');
    const rootKey = this.scopeKey(rootPath);
    return {
      kind: 'bot',
      botId: normalizedBotId,
      scopeKey: `${rootKey}:bot:${normalizedBotId}`,
      configPath: join(resolve(rootPath), '.agents', 'bots', normalizedBotId, 'mcpconfig.json'),
    };
  }

  appendLog(record, level, message) {
    record.logs.push({
      at: new Date().toISOString(),
      level,
      message: String(message),
    });
    if (record.logs.length > MAX_LOG_ENTRIES) {
      record.logs.splice(0, record.logs.length - MAX_LOG_ENTRIES);
    }
    if (level === 'error') {
      traceError('mcp.error', {
        mcp_server: record.name,
        error: String(message),
      });
    } else {
      traceVerbose('mcp.status', {
        mcp_server: record.name,
        status: level,
      });
    }
  }

  emitState() {
    this.sendEvent({ type: 'state', state: this.snapshot() });
  }
}
