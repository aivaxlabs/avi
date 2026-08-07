import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  shell,
  Tray,
} from 'electron';
import { spawn, spawnSync } from 'node:child_process';
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
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
} from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import {
  archiveConversation,
  closeDatabase,
  createConversation,
  deleteConversation,
  deleteProviderCredentials,
  deleteRemoteApiKey,
  forkConversation,
  flushSecureStorage,
  getArchiveSettings,
  getArchiveStats,
  getComposerState,
  getConversation,
  getMessages,
  getPreferences,
  getProviderCredentials,
  getRemoteApiKey,
  getRemoteSettings,
  initializeSecureStorage,
  listAllConversations,
  listArchivedConversations,
  listConversations,
  listFavorites,
  listProviders,
  listSideChats,
  listSubagents,
  listTasks,
  restoreConversation,
  runArchiveMaintenance,
  setArchiveSettings,
  setDefaultModels,
  setDesktopSettings,
  setComposerState,
  setFavorite,
  setProviderCredentials,
  setProviders,
  setRemoteApiKey,
  setRemoteSettings,
  setTuningSettings,
  updateConversation,
} from './database.js';
import { ChatRunner } from './chat-runner.js';
import { QuickChatRunner } from './quick-chat-runner.js';
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
  readWorkspaceFileDiff,
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
let quickChatRunner;
let mcpManager;
let remoteMcpServer;
let remoteStartError = '';
const quickChatWindows = new Map();
let shutdownStarted = false;
let shutdownReady = false;
let isQuitting = false;
let lastCpuUsage = process.cpuUsage();
let resourceSnapshotInterval;
const ipcHandlers = new Map();
const applicationIpc = { handle: (channel, handler) => ipcHandlers.set(channel, handler) };

app.on('before-quit', (event) => {
  isQuitting = true;
  if (shutdownReady) return;
  event.preventDefault();
  if (shutdownStarted) return;
  shutdownStarted = true;
  clearInterval(resourceSnapshotInterval);
  for (const sessionId of quickChatWindows.keys()) quickChatRunner?.close(sessionId);
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
app.on('web-contents-created', (_event, contents) => {
  contents.on('render-process-gone', (_event, details) => {
    traceError('renderer.process-gone', {
      status: details.reason,
      code: details.exitCode,
    });
  });
  contents.on('unresponsive', () => traceError('renderer.unresponsive'));
  contents.on('did-fail-load', (_event, code, description) => {
    traceError('renderer.load-failed', { code, error: description });
  });
  if (process.env.CHAT_APP_OPEN_DEVTOOLS === '1') {
    contents.on('before-input-event', (_inputEvent, input) => {
      if (input.type === 'keyDown' && input.key === 'F12') contents.toggleDevTools();
    });
  }
});
app.on('child-process-gone', (_event, details) => {
  traceError('app.child-process-gone', {
    operation: details.type,
    status: details.reason,
    code: details.exitCode,
  });
});

await app.whenReady();
if (process.platform === 'darwin' && app.getLoginItemSettings().wasOpenedAtLogin) startHidden = true;
await initializeSecureStorage();
runArchiveMaintenance();
setTraceLevel(getPreferences().tuning.logLevel);
traceVerbose('app.started', { log_level: getPreferences().tuning.logLevel });
resourceSnapshotInterval = setInterval(() => {
  const memory = process.memoryUsage();
  const cpuUsage = process.cpuUsage(lastCpuUsage);
  lastCpuUsage = process.cpuUsage();
  traceVerbose('app.resource-snapshot', {
    rss_mb: Math.round(memory.rss / 1_048_576),
    heap_used_mb: Math.round(memory.heapUsed / 1_048_576),
    external_mb: Math.round(memory.external / 1_048_576),
    cpu_user_ms: Math.round(cpuUsage.user / 1_000),
    cpu_system_ms: Math.round(cpuUsage.system / 1_000),
  });
}, 60_000);
resourceSnapshotInterval.unref();
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

function openMainView(payload) {
  showMainWindow();
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const sendNavigation = () => mainWindow?.webContents.send('app:navigate', payload);
  if (mainWindow.webContents.isLoadingMainFrame()) {
    mainWindow.webContents.once('did-finish-load', sendNavigation);
  } else {
    sendNavigation();
  }
}

function sendQuickChatEvent(sessionId, payload) {
  const quickWindow = quickChatWindows.get(sessionId);
  if (quickWindow && !quickWindow.isDestroyed()) {
    quickWindow.webContents.send('quick-chat:event', payload);
  }
}

function createQuickChatWindow() {
  initializeServices();
  const session = quickChatRunner.createSession();
  const icon = nativeImage.createFromPath(join(__dirname, '../../assets/icon/avi-bg.png'));
  const quickWindow = new BrowserWindow({
    title: 'Quick chat',
    width: 540,
    height: 680,
    minWidth: 380,
    minHeight: 460,
    frame: true,
    show: false,
    maximizable: false,
    fullscreenable: false,
    icon,
    webPreferences: {
      preload: join(__dirname, '../preload/preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  quickChatWindows.set(session.id, quickWindow);
  quickWindow.setMenu(null);
  quickWindow.on('closed', () => {
    quickChatWindows.delete(session.id);
    quickChatRunner.close(session.id);
  });
  quickWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  quickWindow.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedRendererUrl(url)) {
      event.preventDefault();
      if (/^https?:/.test(url)) void shell.openExternal(url);
    }
  });
  quickWindow.once('ready-to-show', () => quickWindow.show());
  if (process.env.VITE_DEV_SERVER_URL) {
    const url = new URL(process.env.VITE_DEV_SERVER_URL);
    url.searchParams.set('window', 'quick-chat');
    url.searchParams.set('session', session.id);
    void quickWindow.loadURL(url.href);
  } else {
    void quickWindow.loadFile(join(app.getAppPath(), 'dist', 'index.html'), {
      query: { window: 'quick-chat', session: session.id },
    });
  }
  return { sessionId: session.id };
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
      sendEvent: (payload) => {
        sendRendererEvent('chat:event', payload);
        if (
          ['conversation', 'run-state', 'question-request', 'question-cancelled', 'permission-request', 'permission-cancelled']
            .includes(payload.type)
          || (payload.type === 'message' && payload.message?.role === 'user')
        ) refreshTrayMenu();
      },
      sendCompletionNotification: ({ conversation, message }) => {
        if (!getPreferences().desktop?.notifyOnCompletion || !Notification.isSupported()) return;
        try {
          new Notification({
            title: conversation?.title || 'Avi',
            body: message.content,
          }).show();
        } catch (error) {
          traceError('desktop.completion-notification-error', {
            conversation_id: conversation?.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      },
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
  if (!quickChatRunner) {
    quickChatRunner = new QuickChatRunner({
      registry: providerRegistry,
      mcpManager,
      chatRunner,
      getPreferences,
      sendEvent: sendQuickChatEvent,
      stopBackgroundTasks: stopConversationTerminals,
    });
  }
  if (!remoteMcpServer) {
    remoteMcpServer = new RemoteMcpServer({ chatRunner, providerRegistry, getPreferences, getApiKey: getRemoteApiKey });
    const settings = getRemoteSettings();
    if (settings.enabled && !getRemoteApiKey()) setRemoteSettings({ ...settings, enabled: false });
    else if (settings.enabled) remoteMcpServer.start(settings.port).catch((error) => {
      if (error?.code === 'EADDRINUSE') {
        remoteStartError = `Remote control could not start in this Avi instance because port ${settings.port} is already in use.`;
      } else {
        setRemoteSettings({ ...settings, enabled: false });
      }
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
  refreshTrayMenu();
  tray.on('click', showMainWindow);
}

function refreshTrayMenu() {
  if (!tray) return;
  const recentChats = listConversations().slice(0, 5).map((conversation) => {
    const run = chatRunner?.runs.get(conversation.id);
    const status = ['approval', 'question'].includes(run?.phase)
      ? 'input required'
      : run
        ? 'working'
        : 'done';
    return {
      label: `${conversation.title} - ${status}`,
      click: () => openMainView({ view: 'conversation', conversationId: conversation.id }),
    };
  });
  tray.setContextMenu(Menu.buildFromTemplate([
    ...(recentChats.length > 0 ? [...recentChats, { type: 'separator' }] : []),
    { label: 'Quick chat', click: createQuickChatWindow },
    { label: 'Open Avi', click: showMainWindow },
    { type: 'separator' },
    { label: 'Settings', click: () => openMainView({ view: 'settings' }) },
    { label: 'Exit', click: () => { isQuitting = true; app.quit(); } },
  ]));
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
  const ownedQuickChatSession = (event, sessionId) => {
    const quickWindow = quickChatWindows.get(sessionId);
    if (!quickWindow || quickWindow.webContents !== event.sender) {
      throw new Error('Quick chat session is not owned by this window.');
    }
    return sessionId;
  };
  applicationIpc.handle('quick-chat:open', () => createQuickChatWindow());
  applicationIpc.handle('quick-chat:state', (event, sessionId) => (
    quickChatRunner.state(ownedQuickChatSession(event, sessionId))
  ));
  applicationIpc.handle('quick-chat:send', (event, payload) => quickChatRunner.send({
    ...payload,
    sessionId: ownedQuickChatSession(event, payload?.sessionId),
  }));
  applicationIpc.handle('quick-chat:stop', (event, sessionId) => (
    quickChatRunner.stop(ownedQuickChatSession(event, sessionId))
  ));
  applicationIpc.handle('quick-chat:answer-question', (event, payload) => (
    quickChatRunner.answerQuestion({
      ...payload,
      sessionId: ownedQuickChatSession(event, payload?.sessionId),
    })
  ));


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
    const shells = listInstalledTerminalShells();
    let automaticShell;
    try {
      automaticShell = resolveTerminalShell();
    } catch (error) {
      traceError('terminal-shell.automatic-resolution-failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return [
      {
        id: 'auto',
        label: automaticShell ? `Automatic · ${automaticShell.label}` : 'Automatic',
        executable: automaticShell?.executable ?? null,
      },
      ...shells,
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
      startError: remoteStartError,
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
      remoteStartError = '';
      setRemoteSettings(validated);
      return remoteState();
    }
    if (!getRemoteApiKey()) await setRemoteApiKey();
    try {
      await remoteMcpServer.start(validated.port);
      remoteStartError = '';
      setRemoteSettings({ ...validated, enabled: true });
      return remoteState();
    } catch (error) {
      if (error?.code === 'EADDRINUSE' && !remoteMcpServer.running) {
        remoteStartError = `Remote control could not start in this Avi instance because port ${validated.port} is already in use.`;
        setRemoteSettings({ ...validated, enabled: true });
        return remoteState();
      }
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
    remoteStartError = '';
    setRemoteSettings({ ...getRemoteSettings(), enabled: false });
    await deleteRemoteApiKey();
    return remoteState();
  });

  const archiveState = (query = '') => ({
    settings: getArchiveSettings(),
    conversations: listArchivedConversations(query).map(refreshConversationProject),
    stats: getArchiveStats(),
  });
  applicationIpc.handle('archive:state', (_event, query = '') => archiveState(query));
  applicationIpc.handle('archive:save', (_event, settings) => ({
    ...archiveState(),
    settings: setArchiveSettings(settings),
  }));
  applicationIpc.handle('archive:restore', (_event, conversationId) => {
    restoreConversation(conversationId);
    return archiveState();
  });
  applicationIpc.handle('archive:delete', (_event, conversationId) => {
    deleteConversation(conversationId, { hard: true });
    return archiveState();
  });
  applicationIpc.handle('archive:maintenance', () => ({
    ...archiveState(),
    maintenance: runArchiveMaintenance(),
    stats: getArchiveStats(),
    conversations: listArchivedConversations().map(refreshConversationProject),
  }));

  applicationIpc.handle('conversations:list', () => listConversationsWithProjects());
  applicationIpc.handle('conversations:create', (_event, payload = {}) => (
    refreshConversationProject(createConversation(payload))
  ));
  applicationIpc.handle('conversations:update', (_event, payload = {}) => (
    refreshConversationProject(updateConversation(payload.id, payload))
  ));
  applicationIpc.handle('conversations:messages', (_event, conversationId) => getMessages(conversationId));
  applicationIpc.handle('composer-state:get', (_event, conversationId) => (
    getComposerState(conversationId)
  ));
  applicationIpc.handle('composer-state:save', (_event, payload = {}) => (
    setComposerState(payload.conversationId, payload)
  ));
  applicationIpc.handle('tasks:list', (_event, conversationId) => listTasks(conversationId));
  applicationIpc.handle('conversations:archive', (_event, conversationId) => {
    chatRunner.stop(conversationId, { includeSubagents: true });
    for (const sideChat of listSideChats(conversationId)) {
      chatRunner.stop(sideChat.id);
    }
    archiveConversation(conversationId);
    return listConversationsWithProjects();
  });
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
  let searchWorker = null;
  let searchSequence = 0;
  const pendingSearches = new Map();
  const runChatSearch = (query) => new Promise((resolve, reject) => {
    if (!searchWorker) {
      searchWorker = new Worker(new URL('./search-worker.js', import.meta.url));
      searchWorker.unref();
      searchWorker.on('message', ({ id, results, error }) => {
        const settle = pendingSearches.get(id);
        if (!settle) return;
        pendingSearches.delete(id);
        if (error) settle.reject(new Error(error));
        else settle.resolve(results);
      });
      searchWorker.on('error', (error) => {
        searchWorker = null;
        for (const settle of pendingSearches.values()) settle.reject(error);
        pendingSearches.clear();
      });
    }
    const id = ++searchSequence;
    pendingSearches.set(id, { resolve, reject });
    searchWorker.postMessage({ id, query });
  });
  applicationIpc.handle('conversations:search', (_event, query) => runChatSearch(query));
  applicationIpc.handle('orchestration:overview', (_event, range = {}) => {
    const conversations = listAllConversations();
    const now = Date.now();
    const defaultFrom = new Date();
    defaultFrom.setHours(0, 0, 0, 0);
    const requestedFrom = new Date(range.from).getTime();
    const requestedTo = new Date(range.to).getTime();
    const from = Number.isFinite(requestedFrom) ? requestedFrom : defaultFrom.getTime();
    const to = Number.isFinite(requestedTo) ? requestedTo : now;
    const isInRange = (value) => {
      const timestamp = new Date(value).getTime();
      return Number.isFinite(timestamp) && timestamp >= from && timestamp <= to;
    };
    const tasks = conversations.map((conversation) => {
      const messages = getMessages(conversation.id).filter((message) => !message.hidden);
      const latestMessage = messages.at(-1) ?? null;
      const latestAssistant = messages.findLast((message) => message.role === 'assistant') ?? null;
      const goalStatus = conversation.goal?.status ?? null;
      const ongoing = ['active', 'paused'].includes(goalStatus)
        || latestAssistant?.status === 'streaming'
        || latestMessage?.status === 'queued';
      const requiresAttention = !ongoing && (
        goalStatus === 'blocked'
        || ['error', 'aborted'].includes(latestAssistant?.status)
        || ['error', 'aborted'].includes(latestMessage?.status)
      );

      return {
        ...conversation,
        messages,
        latestMessage,
        latestAssistant,
        ongoing,
        requiresAttention,
      };
    });
    const messagesInRange = tasks.flatMap((task) => (
      task.messages
        .filter((message) => isInRange(message.createdAt))
        .map((message) => ({ ...message, conversationModel: task.model }))
    ));
    const modelUsage = new Map();

    for (const message of messagesInRange.filter((item) => item.role === 'assistant')) {
      const model = message.model || message.conversationModel || 'Unknown model';
      const inputTokens = Number(message.usage?.inputTokens) || 0;
      const cachedInputTokens = Number(message.usage?.cachedInputTokens) || 0;
      const outputTokens = Number(message.usage?.outputTokens) || 0;
      const totalTokens = Number(message.usage?.totalTokens) || inputTokens + outputTokens;
      const usage = modelUsage.get(model) ?? {
        id: model,
        messages: 0,
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        durationMs: 0,
        timedMessages: 0,
        tokens: 0,
      };
      usage.messages += 1;
      usage.inputTokens += inputTokens;
      usage.cachedInputTokens += cachedInputTokens;
      usage.outputTokens += outputTokens;
      if (Number.isFinite(message.usage?.durationMs)) {
        usage.durationMs += message.usage.durationMs;
        usage.timedMessages += 1;
      }
      usage.tokens += totalTokens;
      modelUsage.set(model, usage);
    }

    return {
      metrics: {
        responses: messagesInRange.filter((message) => message.role === 'assistant').length,
        modelsUsed: modelUsage.size,
        tokens: [...modelUsage.values()].reduce((total, usage) => total + usage.tokens, 0),
        topModels: [...modelUsage.values()]
          .sort((a, b) => b.messages - a.messages || b.tokens - a.tokens)
          .slice(0, 10),
      },
      ongoing: tasks
        .filter((task) => task.ongoing)
        .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
        .map(({ messages, latestMessage, latestAssistant, ongoing, requiresAttention, ...task }) => task),
      requiresAttention: tasks
        .filter((task) => task.requiresAttention)
        .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
        .map(({ messages, latestMessage, latestAssistant, ongoing, requiresAttention, ...task }) => task),
      recentlyCompleted: tasks
        .filter((task) => (
          !task.ongoing
          && !task.requiresAttention
          && (
            task.goal?.status === 'completed'
            || task.latestAssistant?.status === 'completed'
          )
        ))
        .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
        .slice(0, 8)
        .map(({ messages, latestMessage, latestAssistant, ongoing, requiresAttention, ...task }) => task),
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
  applicationIpc.handle('chat:resolve-approval', async (_event, payload) => {
    const result = await chatRunner.resolveApproval(payload);
    refreshTrayMenu();
    return result;
  });
  applicationIpc.handle('chat:answer-question', (_event, payload) => {
    const result = chatRunner.answerQuestion(payload);
    refreshTrayMenu();
    return result;
  });
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
  applicationIpc.handle('files:diff', (_event, payload = {}) => (
    readWorkspaceFileDiff(payload.folderPath, payload.filePath)
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
  applicationIpc.handle('attachments:image-action', async (_event, payload = {}) => {
    const imagePath = payload.path;
    if (typeof imagePath !== 'string' || !isAbsolute(imagePath)) {
      throw new TypeError('Image path must be absolute.');
    }
    const resolvedImagePath = resolve(imagePath);
    if (!resolvedImagePath.replaceAll('\\', '/').includes('/.aivax/generated-images/')) {
      throw new TypeError('Image must be a generated attachment.');
    }
    if (!['.gif', '.jpeg', '.jpg', '.png', '.webp'].includes(extname(resolvedImagePath).toLowerCase())) {
      throw new TypeError('Attachment must be a supported image file.');
    }
    await access(resolvedImagePath);

    switch (payload.action) {
      case 'open': {
        const error = await shell.openPath(resolvedImagePath);
        if (error) throw new Error(`Could not open image: ${error}`);
        return true;
      }
      case 'reveal':
        shell.showItemInFolder(resolvedImagePath);
        return true;
      case 'copy-image': {
        const image = nativeImage.createFromPath(resolvedImagePath);
        if (image.isEmpty()) throw new Error('Could not read image for clipboard.');
        clipboard.writeImage(image);
        return true;
      }
      case 'copy-path':
        clipboard.writeText(resolvedImagePath);
        return true;
      default:
        throw new TypeError('Unsupported image action.');
    }
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
  applicationIpc.handle('shell:open-terminal', (_event, targetPath) => {
    openTerminalAt(resolve(targetPath));
    return true;
  });

}

function openTerminalAt(folderPath) {
  const terminalShell = resolveTerminalShell(
    process.env,
    process.platform,
    getPreferences().tuning?.terminalShell,
  );
  const shellName = terminalShell.executable.replaceAll('\\', '/').split('/').at(-1).toLowerCase();

  if (process.platform === 'darwin') {
    spawn('open', ['-a', 'Terminal', folderPath], { shell: false });
    return;
  }
  if (process.platform === 'linux') {
    const linuxTerminals = [
      ['gnome-terminal', [`--working-directory=${folderPath}`]],
      ['konsole', ['--workdir', folderPath]],
      ['xfce4-terminal', [`--working-directory=${folderPath}`]],
      ['mate-terminal', [`--working-directory=${folderPath}`]],
      ['kitty', ['--directory', folderPath]],
      ['alacritty', ['--working-directory', folderPath]],
      ['x-terminal-emulator', []],
      ['xterm', []],
    ];
    for (const [command, args] of linuxTerminals) {
      if (spawnSync('which', [command], { stdio: 'ignore' }).status !== 0) continue;
      const child = spawn(command, args, { shell: false, detached: true });
      child.once('error', () => {});
      child.unref();
      return;
    }
  }

  const quotedPath = `'${folderPath.replaceAll("'", "'\\''")}'`;
  const args = shellName.includes('powershell') || shellName === 'pwsh'
    ? ['-NoLogo', '-NoProfile', '-NoExit', '-Command', `Set-Location -LiteralPath ${quotedPath}`]
    : shellName === 'cmd'
      ? ['/K', 'cd', '/d', folderPath]
      : ['-c', `cd ${quotedPath} && exec ${terminalShell.executable}`];
  const child = spawn(terminalShell.executable, args, {
    cwd: folderPath,
    detached: process.platform === 'linux',
    env: process.env,
    shell: false,
    windowsHide: false,
  });
  if (process.platform === 'linux') child.unref();
  child.once('error', (error) => {
    traceError('shell.open-terminal-error', {
      error: error instanceof Error ? error.message : String(error),
    });
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
