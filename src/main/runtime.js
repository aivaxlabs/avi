import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  shell,
  Tray,
} from 'electron';
import { spawnSync } from 'node:child_process';
import {
  access,
  appendFile,
  mkdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  closeDatabase,
  createConversation,
  deleteConversation,
  deleteProviderCredentials,
  deleteRemoteApiKey,
  forkConversation,
  flushSecureStorage,
  getConversation,
  getMessages,
  getPreferences,
  getProviderCredentials,
  getRemoteApiKey,
  getRemoteSettings,
  initializeSecureStorage,
  listAllConversations,
  listConversations,
  listFavorites,
  listProviders,
  listSideChats,
  listSubagents,
  listTasks,
  searchChats,
  setDefaultModels,
  setDesktopSettings,
  setFavorite,
  setProviderCredentials,
  setProviders,
  setRemoteApiKey,
  setRemoteSettings,
  setTuningSettings,
  updateConversation,
} from './database.js';
import { ChatRunner } from './chat-runner.js';
import { validateDefaultModels } from './default-models.js';
import { stopConversationTerminals } from './client-tools.js';
import {
  listContextItems,
  resolveInstallationContextPath,
} from './context-injection.js';
import {
  filePathToAttachment,
  inspectWorkspaceFiles,
  listWorkspaceDirectory,
  readWorkspaceFile,
  resolveWorkspacePath,
  searchWorkspaceFiles,
} from './files.js';
import { ModelProviderRegistry } from './model-provider.js';
import { McpManager } from './mcp-manager.js';
import { RemoteMcpServer } from './remote-mcp-server.js';
import {
  listInstalledTerminalShells,
  resolveTerminalShell,
} from './terminal-shell.js';
import {
  setTraceLevel,
  traceError,
  traceVerbose,
} from './trace-log.js';
import { providerTypes } from '../providers/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const providerRegistry = new ModelProviderRegistry({
  getProviders: listProviders,
  providerTypes,
  services: {
    credentials: {
      get: getProviderCredentials,
      set: setProviderCredentials,
      delete: deleteProviderCredentials,
    },
    clipboard: { writeText: (value) => clipboard.writeText(value) },
    shell: { openExternal: (url) => shell.openExternal(url) },
  },
});
let startHidden = process.argv.includes('--hidden');
let mainWindow;
let tray;
let chatRunner;
let mcpManager;
let remoteMcpServer;
let shutdownStarted = false;
let shutdownReady = false;
let isQuitting = false;
const ipcHandlers = new Map();
const applicationIpc = { handle: (channel, handler) => ipcHandlers.set(channel, handler) };

app.on('before-quit', (event) => {
  isQuitting = true;
  if (shutdownReady) return;
  event.preventDefault();
  if (shutdownStarted) return;
  shutdownStarted = true;
  Promise.resolve(chatRunner?.shutdown())
    .then(() => mcpManager?.closeAll())
    .then(() => remoteMcpServer?.close())
    .then(() => flushSecureStorage())
    .catch((error) => traceError('app.shutdown-error', {
      error: error instanceof Error ? error.message : String(error),
    }))
    .finally(() => {
      closeDatabase();
      shutdownReady = true;
      app.quit();
    });
});
app.on('activate', () => {
  if (mainWindow && !mainWindow.isDestroyed()) showMainWindow();
  else createWindow();
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && !getPreferences().desktop?.closeToTray) app.quit();
});

await app.whenReady();
if (process.platform === 'darwin' && app.getLoginItemSettings().wasOpenedAtLogin) startHidden = true;
await initializeSecureStorage();
setTraceLevel(getPreferences().tuning.logLevel);
traceVerbose('app.started', { log_level: getPreferences().tuning.logLevel });
logDefaultModelWarnings('startup');
registerIpc();
ipcMain.handle('avi:invoke', invokeApplicationRequest);
await applyLoginSettings();
createTray();
createWindow();

async function invokeApplicationRequest(event, { channel, payload } = {}) {
  if (!event.senderFrame?.url || !isTrustedRendererUrl(event.senderFrame.url)) {
    return { ok: false, error: { name: 'Error', message: 'Untrusted renderer request.' } };
  }
  const startedAt = Date.now();
  const handler = ipcHandlers.get(channel);
  if (!handler) return { ok: false, error: { name: 'Error', message: `Unknown application request: ${channel}` } };
  const threadId = payload?.conversationId
    ?? payload?.parentConversationId
    ?? (channel === 'chat:stop' && typeof payload === 'string' ? payload : null);
  const conversation = threadId ? getConversation(threadId) : null;
  const selectedModel = typeof payload?.model === 'string' ? providerRegistry.resolve(payload.model) : null;
  const details = {
    operation: channel,
    thread_id: threadId,
    parent_thread_id: conversation?.parentConversationId,
    side_chat: conversation?.isSideChat,
    subagent: conversation?.isSubagent,
    provider_id: selectedModel?.model.providerId,
    provider: selectedModel?.model.providerName,
    model: selectedModel?.model.modelId ?? payload?.model,
    interface: selectedModel?.model.interface,
  };
  traceVerbose('application.request-started', details);
  try {
    const value = await handler(event, payload);
    traceVerbose('application.request-completed', { ...details, duration_ms: Date.now() - startedAt });
    return { ok: true, value };
  } catch (error) {
    traceError('application.request-error', {
      ...details,
      duration_ms: Date.now() - startedAt,
      status: error?.status,
      code: error?.code,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      ok: false,
      error: {
        name: error?.name ?? 'Error',
        message: error instanceof Error ? error.message : String(error),
        code: error?.code,
        status: error?.status,
      },
    };
  }
}

function isTrustedRendererUrl(url) {
  try {
    const target = new URL(url);
    if (process.env.VITE_DEV_SERVER_URL) {
      return target.origin === new URL(process.env.VITE_DEV_SERVER_URL).origin;
    }
    const renderer = new URL(pathToFileURL(join(app.getAppPath(), 'dist', 'index.html')).href);
    return target.protocol === 'file:' && target.pathname === renderer.pathname;
  } catch {
    return false;
  }
}

function sendRendererEvent(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function createWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) return showMainWindow();
  const icon = nativeImage.createFromPath(join(__dirname, '../../assets/icon/avi-bg.png'));
  Menu.setApplicationMenu(null);
  mainWindow = new BrowserWindow({
    title: 'Avi',
    width: 1180,
    height: 780,
    x: 160,
    y: 100,
    show: false,
    icon,
    webPreferences: {
      preload: join(__dirname, '../preload/preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.setMenu(null);
  mainWindow.on('close', (event) => {
    if (!isQuitting && getPreferences().desktop?.closeToTray) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedRendererUrl(url)) {
      event.preventDefault();
      if (/^https?:/.test(url)) void shell.openExternal(url);
    }
  });
  mainWindow.once('ready-to-show', () => {
    if (!startHidden) mainWindow.show();
  });
  if (process.env.CHAT_APP_OPEN_DEVTOOLS === '1') {
    mainWindow.webContents.once('dom-ready', () => mainWindow.webContents.openDevTools());
  }
  if (process.env.CHAT_APP_SMOKE_TEST === '1') {
    const smokeTimeout = setTimeout(() => {
      console.error('Avi smoke test timed out.');
      process.exitCode = 1;
      app.quit();
    }, 20_000);
    mainWindow.webContents.on('did-fail-load', (_event, code, description) => {
      console.error(`Avi renderer failed to load: ${code} ${description}`);
    });
    mainWindow.webContents.once('did-finish-load', async () => {
      clearTimeout(smokeTimeout);
      try {
        const passed = await mainWindow.webContents.executeJavaScript(
          'window.chatApp?.models?.list().then(Array.isArray).catch(() => false)',
        );
        console.log(passed ? 'Avi smoke test passed.' : 'Avi smoke test failed.');
        process.exitCode = passed ? 0 : 1;
      } catch (error) {
        console.error(error);
        process.exitCode = 1;
      }
      app.quit();
    });
  }
  initializeServices();
  if (process.env.VITE_DEV_SERVER_URL) void mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  else void mainWindow.loadFile(join(app.getAppPath(), 'dist', 'index.html'));
}

function initializeServices() {
  if (!mcpManager) {
    mcpManager = new McpManager({
      sendEvent: (payload) => sendRendererEvent('mcp:event', payload),
      openExternal: (url) => shell.openExternal(url),
    });
    mcpManager.initializeGlobal().catch((error) => sendRendererEvent('mcp:event', {
      type: 'configuration-error',
      message: error instanceof Error ? error.message : String(error),
    }));
  }
  if (!chatRunner) {
    chatRunner = new ChatRunner({
      registry: providerRegistry,
      mcpManager,
      getPreferences,
      sendEvent: (payload) => sendRendererEvent('chat:event', payload),
      savePermissionGuidance: async ({ workspacePath, invocationSummary }) => {
        const agentsPath = join(homedir(), '.agents');
        const guidancePath = join(agentsPath, 'MEMORY.permissionguidance.md');
        const line = `On folder ${workspacePath || process.cwd()}, user classified tools like ${invocationSummary} are not dangerous and should be always approved`;
        await mkdir(agentsPath, { recursive: true });
        const current = await readFile(guidancePath, 'utf8').catch(() => '');
        if (!current.split(/\r?\n/).includes(line)) {
          await appendFile(guidancePath, `${current && !current.endsWith('\n') ? '\n' : ''}${line}\n`);
        }
      },
      stopBackgroundTasks: stopConversationTerminals,
    });
  }
  if (!remoteMcpServer) {
    remoteMcpServer = new RemoteMcpServer({ chatRunner, providerRegistry, getPreferences, getApiKey: getRemoteApiKey });
    const settings = getRemoteSettings();
    if (settings.enabled && !getRemoteApiKey()) setRemoteSettings({ ...settings, enabled: false });
    else if (settings.enabled) remoteMcpServer.start(settings.port).catch((error) => {
      setRemoteSettings({ ...settings, enabled: false });
      traceError('remote.start-error', { error: error instanceof Error ? error.message : String(error) });
    });
  }
}

function createTray() {
  if (tray) return;
  const iconPath = join(__dirname, '../../assets/icon/avi-bg.png');
  const trayIcon = nativeImage.createFromPath(iconPath);
  tray = new Tray(trayIcon);
  tray.setToolTip('Avi');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Avi', click: showMainWindow },
    { type: 'separator' },
    { label: 'Quit', click: () => { isQuitting = true; app.quit(); } },
  ]));
  tray.on('click', showMainWindow);
}

export function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return createWindow();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

async function applyLoginSettings() {
  const openAtLogin = Boolean(getPreferences().desktop?.openAtLogin);
  if (process.platform !== 'linux') {
    app.setLoginItemSettings({
      openAtLogin,
      openAsHidden: openAtLogin,
      args: openAtLogin ? ['--hidden'] : [],
    });
    return;
  }
  const autostartDirectory = join(homedir(), '.config', 'autostart');
  const autostartPath = join(autostartDirectory, 'net.aivax.avi.desktop');
  if (!openAtLogin) {
    await rm(autostartPath, { force: true });
    return;
  }
  await mkdir(autostartDirectory, { recursive: true });
  const executable = process.execPath.replaceAll('"', '\"');
  await writeFile(autostartPath, [
    '[Desktop Entry]',
    'Type=Application',
    'Name=Avi',
    `Exec="${executable}" --hidden`,
    'Terminal=false',
    'X-GNOME-Autostart-enabled=true',
    '',
  ].join('\n'));
}

function getNativeWindowOptions() {
  return { transparent: false, titleBarStyle: 'default' };
}

function logDefaultModelWarnings(operation) {
  const warnings = validateDefaultModels(
    getPreferences().defaultModels,
    providerRegistry.listModels(),
  );
  for (const warning of warnings) {
    traceError('model.default-unavailable', {
      operation,
      model_role: warning.role,
      requested_model: warning.modelId,
      fallback_model: warning.fallback?.modelId ?? 'unavailable',
      error: warning.reason,
    });
  }
  return warnings;
}

function registerIpc() {
  applicationIpc.handle('app:state', () => ({
    ...getPreferences(),
    defaultModelWarnings: validateDefaultModels(
      getPreferences().defaultModels,
      providerRegistry.listModels(),
    ),
    platform: process.platform,
    defaultProject: inspectProjectFolder(homedir()),
    windowMaterial: getNativeWindowOptions().backgroundMaterial ?? null,
  }));
  applicationIpc.handle('app:open-external', (_event, url) => {
    const target = new URL(url);
    if (!['http:', 'https:'].includes(target.protocol)) {
      throw new Error('Only HTTP and HTTPS links can be opened.');
    }
    return shell.openExternal(target.href);
  });
  applicationIpc.handle('desktop:save', async (_event, settings) => {
    const saved = setDesktopSettings(settings);
    await applyLoginSettings();
    return saved;
  });
  applicationIpc.handle('tuning:shells', () => {
    const automaticShell = resolveTerminalShell();
    return [
      {
        id: 'auto',
        label: `Automatic · ${automaticShell.label}`,
        executable: automaticShell.executable,
      },
      ...listInstalledTerminalShells(),
    ];
  });
  applicationIpc.handle('tuning:save', (_event, tuning) => {
    resolveTerminalShell(process.env, process.platform, tuning?.terminalShell);
    const saved = setTuningSettings(tuning);
    setTraceLevel(saved.logLevel);
    traceVerbose('logging.configuration-changed', { log_level: saved.logLevel });
    return saved;
  });
  applicationIpc.handle('default-models:save', (_event, settings) => {
    const saved = setDefaultModels(settings);
    const warnings = logDefaultModelWarnings('settings-saved');
    return { settings: saved, warnings };
  });
  applicationIpc.handle('default-models:status', () => ({
    settings: getPreferences().defaultModels,
    warnings: validateDefaultModels(
      getPreferences().defaultModels,
      providerRegistry.listModels(),
    ),
  }));

  const remoteState = () => {
    const settings = getRemoteSettings();
    return {
      ...settings,
      hasApiKey: Boolean(getRemoteApiKey()),
      running: Boolean(remoteMcpServer?.running),
      endpoint: `http://127.0.0.1:${settings.port}/mcp${getRemoteApiKey() ? `/${getRemoteApiKey()}` : ''}`,
    };
  };
  applicationIpc.handle('remote:state', remoteState);
  applicationIpc.handle('remote:save', async (_event, value) => {
    const current = getRemoteSettings();
    const next = { ...current, ...value };
    const validated = setRemoteSettings({ ...next, enabled: false });
    if (!next.enabled) {
      await remoteMcpServer?.close();
      setRemoteSettings(validated);
      return remoteState();
    }
    if (!getRemoteApiKey()) await setRemoteApiKey();
    try {
      await remoteMcpServer.start(validated.port);
      setRemoteSettings({ ...validated, enabled: true });
      return remoteState();
    } catch (error) {
      setRemoteSettings(current);
      throw error;
    }
  });
  applicationIpc.handle('remote:regenerate-key', async () => {
    await setRemoteApiKey();
    return remoteState();
  });
  applicationIpc.handle('remote:copy-key', () => {
    const apiKey = getRemoteApiKey();
    if (!apiKey) throw new Error('No Remote API key is configured.');
    clipboard.writeText(apiKey);
    return { copied: true };
  });
  applicationIpc.handle('remote:remove-key', async () => {
    await remoteMcpServer?.close();
    setRemoteSettings({ ...getRemoteSettings(), enabled: false });
    await deleteRemoteApiKey();
    return remoteState();
  });

  applicationIpc.handle('conversations:list', () => listConversationsWithProjects());
  applicationIpc.handle('conversations:create', (_event, payload = {}) => (
    refreshConversationProject(createConversation(payload))
  ));
  applicationIpc.handle('conversations:update', (_event, payload = {}) => (
    refreshConversationProject(updateConversation(payload.id, payload))
  ));
  applicationIpc.handle('conversations:messages', (_event, conversationId) => getMessages(conversationId));
  applicationIpc.handle('tasks:list', (_event, conversationId) => listTasks(conversationId));
  applicationIpc.handle('conversations:delete', (_event, conversationId) => {
    chatRunner.stop(conversationId, { includeSubagents: true });
    for (const sideChat of listSideChats(conversationId)) {
      chatRunner.stop(sideChat.id);
    }
    deleteConversation(conversationId);
    return listConversationsWithProjects();
  });
  applicationIpc.handle('conversations:fork', (_event, payload) => {
    const conversationId = typeof payload === 'string' ? payload : payload?.conversationId;
    const result = forkConversation(conversationId, {
      throughMessageId: payload?.throughMessageId ?? null,
    });
    return result
      ? { ...result, conversation: refreshConversationProject(result.conversation) }
      : null;
  });
  applicationIpc.handle('conversations:search', (_event, query) => searchChats(query));
  applicationIpc.handle('orchestration:overview', () => {
    const conversations = listAllConversations();
    const today = new Date().toDateString();
    const isToday = (value) => new Date(value).toDateString() === today;
    const tasks = conversations.map((conversation) => {
      const messages = getMessages(conversation.id).filter((message) => !message.hidden);
      const latestMessage = messages.at(-1) ?? null;
      const latestAssistant = messages.findLast((message) => message.role === 'assistant') ?? null;
      const goalStatus = conversation.goal?.status ?? null;
      const ongoing = ['active', 'paused'].includes(goalStatus)
        || latestAssistant?.status === 'streaming'
        || latestMessage?.status === 'queued';

      return {
        ...conversation,
        messages,
        latestMessage,
        latestAssistant,
        ongoing,
      };
    });
    const messagesToday = tasks.flatMap((task) => (
      task.messages
        .filter((message) => isToday(message.createdAt))
        .map((message) => ({ ...message, conversationModel: task.model }))
    ));
    const modelUsage = new Map();

    for (const message of messagesToday.filter((item) => item.role === 'assistant')) {
      const model = message.model || message.conversationModel || 'Unknown model';
      const totalTokens = Number(message.usage?.totalTokens)
        || (Number(message.usage?.inputTokens) || 0)
          + (Number(message.usage?.outputTokens) || 0);
      const usage = modelUsage.get(model) ?? { id: model, messages: 0, tokens: 0 };
      usage.messages += 1;
      usage.tokens += totalTokens;
      modelUsage.set(model, usage);
    }

    return {
      metrics: {
        messagesSent: messagesToday.filter((message) => message.role === 'user').length,
        threadsOpened: conversations.filter(
          (conversation) => conversation.conversationType === 'thread'
            && isToday(conversation.createdAt),
        ).length,
        tokens: [...modelUsage.values()].reduce((total, usage) => total + usage.tokens, 0),
        topModels: [...modelUsage.values()]
          .sort((a, b) => b.messages - a.messages || b.tokens - a.tokens)
          .slice(0, 5),
      },
      ongoing: tasks
        .filter((task) => task.ongoing)
        .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
        .map(({ messages, latestMessage, latestAssistant, ongoing, ...task }) => task),
      recentlyCompleted: tasks
        .filter((task) => (
          !task.ongoing
          && (
            task.goal?.status === 'completed'
            || task.latestAssistant?.status === 'completed'
          )
        ))
        .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
        .slice(0, 8)
        .map(({ messages, latestMessage, latestAssistant, ongoing, ...task }) => task),
    };
  });
  applicationIpc.handle('side-chats:list', (_event, parentConversationId) => (
    listSideChats(parentConversationId).map(refreshConversationProject)
  ));
  applicationIpc.handle('side-chats:create', (_event, { parentConversationId } = {}) => {
    const parent = getConversation(parentConversationId);
    if (!parent || parent.isSideChat || parent.isSubagent) return null;
    const result = forkConversation(parent.id, { sideChat: true });
    return result
      ? { ...result, conversation: refreshConversationProject(result.conversation) }
      : null;
  });
  applicationIpc.handle('side-chats:close', (_event, sideChatId) => {
    const sideChat = getConversation(sideChatId);
    if (!sideChat?.isSideChat) return false;
    chatRunner.stop(sideChat.id);
    deleteConversation(sideChat.id, { hard: true });
    return true;
  });
  applicationIpc.handle('subagents:list', (_event, parentConversationId) => (
    listSubagents(parentConversationId).map(refreshConversationProject)
  ));

  applicationIpc.handle('providers:list', () => listProviders());
  applicationIpc.handle('providers:types', () => providerRegistry.listTypes());
  applicationIpc.handle('providers:save', (_event, payload) => {
    const provider = providerRegistry.normalizeConfig(payload);
    const providers = listProviders();
    const index = providers.findIndex((item) => item.id === provider.id);
    const saved = setProviders(index < 0
      ? [...providers, provider]
      : providers.map((item) => item.id === provider.id ? provider : item));
    logDefaultModelWarnings('provider-saved');
    return saved;
  });
  applicationIpc.handle('providers:remove', async (_event, providerId) => {
    const providers = listProviders();
    await providerRegistry.remove(providerId);
    const saved = setProviders(providers.filter((provider) => provider.id !== providerId));
    logDefaultModelWarnings('provider-removed');
    return saved;
  });
  applicationIpc.handle('providers:state', (_event, providerId) => providerRegistry.getState(providerId));
  applicationIpc.handle('providers:action', (_event, payload = {}) => (
    providerRegistry.invokeAction(payload.providerId, payload.action, payload.input)
  ));
  applicationIpc.handle('providers:auxiliary-panels', (_event, payload = {}) => {
    const conversation = payload.conversationId
      ? getConversation(payload.conversationId)
      : null;
    return providerRegistry.listAuxiliaryPanels({
      conversation,
      workspacePath: conversation?.projectPath ?? null,
    });
  });
  applicationIpc.handle('providers:auxiliary-panel', (_event, payload = {}) => {
    const conversation = payload.conversationId
      ? getConversation(payload.conversationId)
      : null;
    return providerRegistry.readAuxiliaryPanel(payload.panelId, {
      conversation,
      workspacePath: conversation?.projectPath ?? null,
    });
  });
  applicationIpc.handle('providers:auxiliary-panel-action', (_event, payload = {}) => {
    const conversation = payload.conversationId
      ? getConversation(payload.conversationId)
      : null;
    return providerRegistry.invokeAuxiliaryPanelAction(
      payload.panelId,
      payload.action,
      payload.input,
      {
        conversation,
        workspacePath: conversation?.projectPath ?? null,
      },
    );
  });

  applicationIpc.handle('models:list', () => providerRegistry.listModels());
  applicationIpc.handle('models:favorites', () => listFavorites());
  applicationIpc.handle('models:favorite', (_event, { modelId, favorited }) => setFavorite(modelId, favorited));

  applicationIpc.handle('mcp:state', () => mcpManager.snapshot());
  applicationIpc.handle('mcp:folders', async () => {
    const startedAt = Date.now();
    traceVerbose('mcp.page-opened', { operation: 'mcp:folders' });
    try {
      const folderPaths = listConversations().map((conversation) => conversation.projectPath);
      const folders = await mcpManager.listFolders(folderPaths);
      const result = folders.map((folder) => {
        const project = inspectProjectFolder(folder.path);
        const global = resolve(folder.path) === resolve(homedir());
        return {
          ...folder,
          name: global ? 'Global' : project.name,
          displayPath: global ? '~/.agents' : project.displayPath,
        };
      });
      traceVerbose('mcp.page-loaded', {
        operation: 'mcp:folders',
        duration_ms: Date.now() - startedAt,
        folder_count: result.length,
        server_count: result.reduce((total, folder) => total + folder.serverCount, 0),
      });
      return result;
    } catch (error) {
      traceError('mcp.page-error', {
        operation: 'mcp:folders',
        duration_ms: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  });
  applicationIpc.handle('mcp:folder', (_event, folderPath) => mcpManager.listFolder(folderPath));
  applicationIpc.handle('mcp:workspace', (_event, folderPath) => mcpManager.listWorkspace(folderPath));
  applicationIpc.handle('mcp:save', (_event, payload = {}) => mcpManager.saveServer(
    payload.folderPath,
    payload.previousName,
    payload.server,
  ));
  applicationIpc.handle('mcp:remove', (_event, payload = {}) => (
    mcpManager.removeServer(payload.folderPath, payload.name)
  ));
  applicationIpc.handle('mcp:enabled', (_event, payload = {}) => (
    mcpManager.setServerEnabled(payload.serverKey, payload.enabled)
  ));
  applicationIpc.handle('mcp:restart', (_event, serverKey) => mcpManager.restartServer(serverKey));
  applicationIpc.handle('mcp:restart-all', (_event, folderPath) => mcpManager.restartAll(folderPath));
  applicationIpc.handle('mcp:inspect', (_event, serverKey) => mcpManager.inspectServer(serverKey));
  applicationIpc.handle('mcp:authenticate', (_event, serverKey) => mcpManager.authenticate(serverKey));

  applicationIpc.handle('chat:send', async (_event, payload) => {
    const result = await chatRunner.send(payload);
    return {
      ...result,
      conversation: refreshConversationProject(result.conversation),
    };
  });
  applicationIpc.handle('chat:retry', (_event, payload) => chatRunner.retry(payload));
  applicationIpc.handle('chat:resolve-approval', (_event, payload) => chatRunner.resolveApproval(payload));
  applicationIpc.handle('chat:answer-question', (_event, payload) => chatRunner.answerQuestion(payload));
  applicationIpc.handle('chat:compress', (_event, payload) => chatRunner.compress({
    conversationId: payload?.conversationId,
    model: payload?.model,
  }));
  applicationIpc.handle('chat:cancel-queued', (_event, payload) => chatRunner.cancelQueuedMessage(payload));
  applicationIpc.handle('chat:reorder-queued', (_event, payload) => chatRunner.reorderQueuedMessages(payload));
  applicationIpc.handle('chat:stop', (_event, conversationId) => {
    chatRunner.stop(conversationId, { includeSubagents: true });
    return true;
  });
  applicationIpc.handle('goals:start', async (_event, payload = {}) => {
    const result = await chatRunner.startGoal({
      ...payload,
      sendInitialPrompt: true,
    });
    return {
      ...result,
      conversation: refreshConversationProject(result.conversation),
    };
  });
  applicationIpc.handle('goals:change', async (_event, payload = {}) => {
    const result = await chatRunner.changeGoal(payload);
    return {
      result,
      conversation: refreshConversationProject(getConversation(payload.conversationId)),
    };
  });
  applicationIpc.handle('goals:resume', () => {
    chatRunner.resumeGoals();
    return true;
  });

  applicationIpc.handle('files:select', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      defaultPath: homedir(),
      properties: ['openFile', 'multiSelections'],
    });
    return canceled ? [] : filePaths.map(filePathToAttachment);
  });
  applicationIpc.handle('files:workspace', (_event, folderPath) => (
    inspectWorkspaceFiles(folderPath)
  ));
  applicationIpc.handle('files:directory', (_event, payload = {}) => (
    listWorkspaceDirectory(payload.folderPath, payload.directoryPath)
  ));
  applicationIpc.handle('files:read', (_event, payload = {}) => (
    readWorkspaceFile(payload.folderPath, payload.filePath)
  ));
  applicationIpc.handle('files:search', (_event, payload = {}) => (
    searchWorkspaceFiles(payload.folderPath, payload.query)
  ));
  applicationIpc.handle('files:open', async (_event, payload = {}) => {
    const filePath = resolveWorkspacePath(payload.folderPath, payload.filePath);
    const error = await shell.openPath(filePath);
    if (error) throw new Error(`Could not open "${payload.filePath}": ${error}`);
    return true;
  });
  applicationIpc.handle('files:reveal', (_event, payload = {}) => {
    shell.showItemInFolder(resolveWorkspacePath(payload.folderPath, payload.filePath));
    return true;
  });
  applicationIpc.handle('files:copy-path', (_event, payload = {}) => {
    clipboard.writeText(resolveWorkspacePath(payload.folderPath, payload.filePath));
    return true;
  });
  applicationIpc.handle('projects:select', async (_event, payload = {}) => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      defaultPath: payload.defaultPath || homedir(),
      properties: ['openDirectory'],
    });
    return canceled ? null : inspectProjectFolder(filePaths[0]);
  });
  applicationIpc.handle('context:folders', async () => {
    const startedAt = Date.now();
    traceVerbose('context.page-opened', { operation: 'context:folders' });
    const globalPath = join(homedir(), '.agents');
    const installationPath = resolveInstallationContextPath();
    const folders = new Map([
      [globalPath.toLowerCase(), {
        path: globalPath,
        name: 'Global',
        displayPath: '~/.agents',
      }],
    ]);
    try {
      await access(installationPath);
      folders.set(installationPath.toLowerCase(), {
        path: installationPath,
        name: 'Avi',
        displayPath: 'AVI/context',
      });
    } catch {}
    for (const conversation of listConversations()) {
      const projectPath = resolve(conversation.projectPath);
      if (projectPath === resolve(homedir())) continue;
      const key = projectPath.toLowerCase();
      if (folders.has(key)) continue;
      const relativePath = relative(homedir(), projectPath);
      folders.set(key, {
        path: projectPath,
        name: basename(projectPath),
        displayPath: !relativePath.startsWith('..') && !isAbsolute(relativePath)
          ? `~/${relativePath.replaceAll('\\', '/')}`
          : projectPath,
      });
    }

    try {
      const result = [...folders.values()];
      traceVerbose('context.page-loaded', {
        operation: 'context:folders',
        duration_ms: Date.now() - startedAt,
        folder_count: result.length,
        discovery_deferred: true,
      });
      return result;
    } catch (error) {
      traceError('context.page-error', {
        operation: 'context:folders',
        duration_ms: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  });
  applicationIpc.handle('context:folder', async (_event, folderPath) => {
    const startedAt = Date.now();
    const installationPath = resolveInstallationContextPath();
    const scope = resolve(folderPath) === resolve(installationPath) ? 'installation' : 'folder';
    traceVerbose('context.folder-opened', { operation: 'context:folder', scope });
    try {
      const result = await listContextItems(folderPath, {
        includeRootCatalog: scope === 'installation',
        scope,
      });
      traceVerbose('context.folder-loaded', {
        operation: 'context:folder',
        scope,
        duration_ms: Date.now() - startedAt,
        item_count: result.itemCount,
      });
      return result;
    } catch (error) {
      traceError('context.folder-error', {
        operation: 'context:folder',
        scope,
        duration_ms: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  });
  applicationIpc.handle('context:commands', async (_event, folderPath) => {
    const globalPath = join(homedir(), '.agents');
    const installationPath = resolveInstallationContextPath();
    const workspacePath = folderPath ? resolve(folderPath) : null;
    const roots = [
      workspacePath && workspacePath !== resolve(homedir())
        ? { path: workspacePath, scope: 'workspace' }
        : null,
      { path: globalPath, scope: 'global' },
      { path: installationPath, scope: 'installation' },
    ]
      .filter((root, index, items) => (
        root
        && items.findIndex((item) => item?.path.toLowerCase() === root.path.toLowerCase()) === index
      ));
    const contexts = await Promise.all(roots.map((root) => listContextItems(root.path, {
      includeRootCatalog: resolve(root.path) === resolve(installationPath),
      scope: root.scope,
    })));
    const commands = new Map();

    for (const command of contexts.flatMap((context) => context.commands)) {
      if (!commands.has(command.id)) commands.set(command.id, command);
    }

    return [...commands.values()];
  });
  applicationIpc.handle('context:open', async (_event, targetPath) => {
    const error = await shell.openPath(resolve(targetPath));
    if (error) throw new Error(`Could not open "${targetPath}": ${error}`);
    return true;
  });

}

function inspectProjectFolder(folderPath) {
  const path = resolve(folderPath || homedir());
  const relativePath = relative(homedir(), path);
  const gitResult = spawnSync('git', ['-C', path, 'branch', '--show-current'], {
    encoding: 'utf8',
    windowsHide: true,
  });

  return {
    path,
    name: relativePath === '' ? '~/' : basename(path),
    displayPath: relativePath === ''
      ? '~/'
      : !relativePath.startsWith('..') && !isAbsolute(relativePath)
        ? `~/${relativePath.replaceAll('\\', '/')}`
        : path,
    gitBranch: gitResult.status === 0 ? gitResult.stdout.trim() || null : null,
  };
}

function listConversationsWithProjects() {
  const projects = new Map();

  return listConversations().map((conversation) => {
    const project = projects.get(conversation.projectPath)
      ?? inspectProjectFolder(conversation.projectPath);
    projects.set(conversation.projectPath, project);
    return { ...conversation, gitBranch: project.gitBranch };
  });
}

function refreshConversationProject(conversation) {
  if (!conversation) return conversation;
  const project = inspectProjectFolder(conversation.projectPath);
  return { ...conversation, gitBranch: project.gitBranch };
}
