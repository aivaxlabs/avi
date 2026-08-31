import { hasOpenBotUserAction } from '../shared/bot-work-items.js';
import { answerTextFromTextualBlocks } from '../shared/textual-blocks.js';
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  protocol,
  shell,
  Tray,
} from 'electron';
import { spawn, spawnSync } from 'node:child_process';
import {
  access,
  appendFile,
  copyFile,
  lstat,
  mkdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { homedir, release } from 'node:os';
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
  abortInterruptedMessages,
  archiveConversation,
  closeDatabase,
  countArchivedConversations,
  createConversation,
  deleteAivaxAccessToken,
  deleteConversation,
  deleteProviderCredentials,
  deleteRemoteApiKey,
  forkConversation,
  flushSecureStorage,
  getArchiveSettings,
  getArchiveStats,
  getAivaxAccessToken,
  getAivaxSettings,
  getComposerState,
  getConversation,
  getMessages,
  getPreferences,
  getProviderCredentials,
  getRemoteApiKey,
  getRemoteSettings,
  getThreadSearchManifest,
  initializeSecureStorage,
  listAllConversations,
  listArchivedConversations,
  listConversations,
  listFavorites,
  listForcedCleanupConversationIds,
  listInferenceUsage,
  listModelRouters,
  listProviders,
  listRubberDucks,
  listSideChats,
  listSubagents,
  listTasks,
  listThreadSearchMessages,
  restoreConversation,
  runArchiveMaintenance,
  setArchiveSettings,
  setAivaxAccessToken,
  setAivaxSettings,
  setChatTags,
  setComposerState,
  setConversationTags,
  setDefaultModels,
  setDesktopSettings,
  setFavorite,
  setFolderColor,
  setModelRouters,
  setProviderCredentials,
  setProviders,
  setRemoteApiKey,
  setRemoteSettings,
  setThreadSearchManifest,
  setTuningSettings,
  updateConversation,
  updateMessage,
} from './database.js';
import { indexAivaxDocuments, loginToAivax, requestAivax } from './aivax-client.js';
import { listAivaxUsageProviders } from './aivax-usage-provider.js';
import { ChatRunner } from './chat-runner.js';
import { BotManager } from './bot-manager.js';
import { QuickChatRunner } from './quick-chat-runner.js';
import { validateDefaultModels } from './default-models.js';
import { CLIENT_TOOLS, stopConversationTerminals } from './client-tools.js';
import { clearTemporaryStorage, getTemporaryStorage } from './temporary-storage.js';
import { getFaviconDataUrl } from './favicons.js';
import {
  listContextItems,
  resolveInstallationContextPath,
} from './context-injection.js';
import {
  createVideoFileResponse,
  filePathToAttachment,
  inspectWorkspaceFiles,
  materializeLegacyVideoAttachments,
  materializeVideoAttachment,
  listWorkspaceDirectory,
  readWorkspaceFile,
  readWorkspaceFileDiff,
  resolveWorkspacePath,
  searchWorkspaceFiles,
} from './files.js';
import {
  commitGitPlan,
  pushGitRepository,
  reviewGitWorkspace,
} from './git-review.js';
import { ModelProviderRegistry } from './model-provider.js';
import { ProviderUsageService } from './provider-usage-service.js';
import { ModelRouterService } from './model-router.js';
import { rankAivaxPricingModels } from './model-pricing.js';
import { McpManager } from './mcp-manager.js';
import { PluginManager } from './plugin-manager.js';
import { createPluginDomainApi, registerPluginTool } from './plugin-domain-api.js';
import { RemoteMcpServer } from './remote-mcp-server.js';
import {
  listInstalledTerminalShells,
  resolveTerminalShell,
} from './terminal-shell.js';
import {
  setTraceLevel,
  traceError,
  traceInfo,
  traceVerbose,
} from './trace-log.js';
import {
  buildThreadSearchDocuments,
  compareThreadSearchManifests,
  createThreadSearchManifest,
  THREAD_SEARCH_SYNC_INTERVAL_MS,
} from './thread-search-index.js';
import { providerTypes } from '../providers/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const chatBackgroundMimeTypes = Object.freeze({
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
});
const pluginsDirectory = app.isPackaged
  ? join(dirname(process.execPath), 'plugins')
  : join(app.getAppPath(), 'plugins');
const pluginManager = new PluginManager({
  pluginsDir: pluginsDirectory,
  reservedToolNames: [
    ...CLIENT_TOOLS.map((tool) => tool.name),
    'openai_subscription_generate_or_edit_image',
  ],
  reservedIds: {
    providers: providerTypes.map((provider) => provider.descriptor.id),
    themes: ['axion', 'monokai', 'absolute', 'code', 'goblin'],
    personalities: ['candid', 'cynical', 'friendly', 'pragmatic', 'quirky'],
  },
});
let providerRegistry;
let providerUsageService;
let routerService;
let startHidden = process.argv.includes('--hidden');
const inactiveBots = process.argv.includes('--inactive-bots');
const memoryTraceEnabled = process.argv.includes('--memory-trace');
let mainWindow;
let tray;
let chatRunner;
let botManager;
let quickChatRunner;
let mcpManager;
let remoteMcpServer;
let remoteStartError = '';
let reloadSnapshot = null;
let forcedCleanupRunning = false;
const quickChatWindows = new Map();
let shutdownStarted = false;
let shutdownReady = false;
let isQuitting = false;
let lastCpuUsage = process.cpuUsage();
let lastResourceUsage = process.resourceUsage();
let lastResourceSampleAt = Date.now();
let resourceSnapshotInterval;
let memoryTraceProcess;
let aivaxModelCatalog = [];
let aivaxModelCatalogExpiresAt = 0;
let aivaxModelCatalogRequest = null;
let threadSearchSyncInterval;
let threadSearchSyncPromise = null;
const botInitialization = Promise.withResolvers();
const ipcHandlers = new Map();
const attachmentPreviews = new Map();
const legacyVideoMigrations = new Map();
const attachmentPreviewLifetimeMs = 60 * 60 * 1_000;
const attachmentPreviewExtensions = new Set([
  '.avi',
  '.avif',
  '.bmp',
  '.gif',
  '.jpeg',
  '.jpg',
  '.m4v',
  '.mkv',
  '.mov',
  '.mp4',
  '.png',
  '.webm',
  '.webp',
]);
const applicationIpc = { handle: (channel, handler) => ipcHandlers.set(channel, handler) };

function deleteAttachmentPreview(token) {
  const preview = attachmentPreviews.get(token);
  if (!preview) return;
  clearTimeout(preview.expiry);
  attachmentPreviews.delete(token);
}

function traceMemorySample(io = {}) {
  const sampledAt = Date.now();
  const sampleInterval = Math.max(1, sampledAt - lastResourceSampleAt);
  const cpuUsage = process.cpuUsage(lastCpuUsage);
  const memory = process.memoryUsage();
  const resourceUsage = process.resourceUsage();
  traceInfo('app.memory-trace', {
    process_id: process.pid,
    scope: 'process',
    sample_interval_ms: sampleInterval,
    cpu_percent: Math.round(
      ((cpuUsage.user + cpuUsage.system) / 1_000 / sampleInterval) * 10_000,
    ) / 100,
    cpu_user_ms: Math.round(cpuUsage.user / 1_000),
    cpu_system_ms: Math.round(cpuUsage.system / 1_000),
    rss_mb: Math.round((memory.rss / 1_048_576) * 100) / 100,
    heap_used_mb: Math.round((memory.heapUsed / 1_048_576) * 100) / 100,
    external_mb: Math.round((memory.external / 1_048_576) * 100) / 100,
    io_read_ops: Math.max(0, resourceUsage.fsRead - lastResourceUsage.fsRead),
    io_write_ops: Math.max(0, resourceUsage.fsWrite - lastResourceUsage.fsWrite),
    major_page_faults: Math.max(
      0,
      resourceUsage.majorPageFault - lastResourceUsage.majorPageFault,
    ),
    ...io,
  });
  lastCpuUsage = process.cpuUsage();
  lastResourceUsage = process.resourceUsage();
  lastResourceSampleAt = sampledAt;
}

app.on('before-quit', (event) => {
  isQuitting = true;
  if (shutdownReady) return;
  event.preventDefault();
  if (shutdownStarted) return;
  shutdownStarted = true;
  clearInterval(resourceSnapshotInterval);
  memoryTraceProcess?.kill();
  clearInterval(threadSearchSyncInterval);
  botManager?.stop();
  for (const sessionId of quickChatWindows.keys()) quickChatRunner?.close(sessionId);
  Promise.resolve(pluginManager.deactivateAll('shutdown'))
    .then(() => chatRunner?.shutdown())
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
runArchiveMaintenance();
const configuredTraceLevel = getPreferences().tuning.logLevel;
setTraceLevel(memoryTraceEnabled && configuredTraceLevel === 'disabled'
  ? 'minimal'
  : configuredTraceLevel);
await pluginManager.initialize();
for (const failure of pluginManager.getFailures()) {
  traceError('plugin.load-error', {
    operation: 'startup',
    plugin: failure.pluginId ?? failure.fileName,
    error: failure.error,
  });
}
providerRegistry = new ModelProviderRegistry({
  getProviders: listProviders,
  providerTypes: () => [...providerTypes, ...pluginManager.getProviderTypes()],
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
routerService = new ModelRouterService({
  getRouters: listModelRouters,
  setRouters: setModelRouters,
  resolveModel: (modelId) => providerRegistry.resolve(modelId),
});
providerRegistry.routerService = routerService;
providerUsageService = new ProviderUsageService({
  providerRegistry,
  pluginRuntime: pluginManager.runtime,
  getApplicationUsageProviders: () => listAivaxUsageProviders({
    accessToken: getAivaxAccessToken(),
    settings: getAivaxSettings(),
    requestBalance: () => requestAivax('/api/v1/information/balance', {
      responseType: 'object',
    }),
  }),
});
traceVerbose('app.started', { log_level: getPreferences().tuning.logLevel });
if (memoryTraceEnabled) {
  lastCpuUsage = process.cpuUsage();
  lastResourceUsage = process.resourceUsage();
  lastResourceSampleAt = Date.now();
  traceInfo('app.memory-trace-started', {
    process_id: process.pid,
    scope: 'process',
    sample_interval_ms: 250,
    status: configuredTraceLevel === 'disabled' ? 'forced-by-flag' : 'enabled',
  });
  if (process.platform === 'win32') {
    const memoryTraceScript = `
$targetPid = [int]$env:AVI_MEMORY_TRACE_PID
$previous = Get-CimInstance Win32_Process -Filter "ProcessId=$targetPid" -ErrorAction Stop
$previousAt = [Diagnostics.Stopwatch]::GetTimestamp()
$frequency = [Diagnostics.Stopwatch]::Frequency
$nextSampleAt = $previousAt + [math]::Round($frequency / 4)
while ($null -ne $previous) {
  $remainingMilliseconds = [math]::Ceiling(($nextSampleAt - [Diagnostics.Stopwatch]::GetTimestamp()) * 1000 / $frequency)
  if ($remainingMilliseconds -gt 0) { Start-Sleep -Milliseconds $remainingMilliseconds }
  $current = Get-CimInstance Win32_Process -Filter "ProcessId=$targetPid" -ErrorAction Stop
  if ($null -eq $current) { break }
  $currentAt = [Diagnostics.Stopwatch]::GetTimestamp()
  $elapsed = [math]::Max(0.001, ($currentAt - $previousAt) / $frequency)
  $readRate = [math]::Round(([double]$current.ReadTransferCount - [double]$previous.ReadTransferCount) / $elapsed)
  $writeRate = [math]::Round(([double]$current.WriteTransferCount - [double]$previous.WriteTransferCount) / $elapsed)
  $otherRate = [math]::Round(([double]$current.OtherTransferCount - [double]$previous.OtherTransferCount) / $elapsed)
  [Console]::Out.WriteLine(('{0}|{1}|{2}' -f $readRate, $writeRate, $otherRate))
  [Console]::Out.Flush()
  $previous = $current
  $previousAt = $currentAt
  $nextSampleAt += [math]::Round($frequency / 4)
  if ($nextSampleAt -lt $currentAt) { $nextSampleAt = $currentAt + [math]::Round($frequency / 4) }
}`;
    let outputBuffer = '';
    let errorOutput = '';
    memoryTraceProcess = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', memoryTraceScript],
      {
        env: { ...process.env, AVI_MEMORY_TRACE_PID: String(process.pid) },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );
    memoryTraceProcess.stdout.on('data', (chunk) => {
      outputBuffer += chunk.toString();
      const lines = outputBuffer.replaceAll('\r\n', '\n').split('\n');
      outputBuffer = lines.pop() ?? '';
      for (const line of lines) {
        const [readRate, writeRate, otherRate] = line.split('|').map(Number);
        if (![readRate, writeRate, otherRate].every(Number.isFinite)) continue;
        traceMemorySample({
          io_read_bytes_per_second: Math.max(0, readRate),
          io_write_bytes_per_second: Math.max(0, writeRate),
          io_other_bytes_per_second: Math.max(0, otherRate),
        });
      }
    });
    memoryTraceProcess.stderr.on('data', (chunk) => {
      errorOutput = `${errorOutput}${chunk}`.slice(-4_000);
    });
    memoryTraceProcess.on('error', (error) => traceError('app.memory-trace-error', {
      operation: 'start-io-sampler',
      error: error instanceof Error ? error.message : String(error),
    }));
    memoryTraceProcess.on('close', (code) => {
      memoryTraceProcess = null;
      if (!isQuitting && code !== 0) {
        traceError('app.memory-trace-error', {
          operation: 'sample-io',
          error: errorOutput || `I/O sampler exited with code ${code}.`,
        });
      }
    });
    memoryTraceProcess.unref();
  } else {
    resourceSnapshotInterval = setInterval(() => traceMemorySample(), 250);
    resourceSnapshotInterval.unref();
  }
} else {
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
}
logDefaultModelWarnings('startup');
protocol.handle('avi-attachment', async (request) => {
  const token = new URL(request.url).hostname;
  const preview = attachmentPreviews.get(token);
  if (!preview || preview.expiresAt <= Date.now()) {
    deleteAttachmentPreview(token);
    return new Response(null, { status: 404 });
  }
  try {
    const path = await realpath(preview.path);
    if (!(await lstat(path)).isFile() || !attachmentPreviewExtensions.has(extname(path).toLowerCase())) {
      deleteAttachmentPreview(token);
      return new Response(null, { status: 404 });
    }
    return createVideoFileResponse(path, request.headers.get('range'));
  } catch {
    deleteAttachmentPreview(token);
    return new Response(null, { status: 404 });
  }
});
registerIpc();
ipcMain.handle('avi:invoke', invokeApplicationRequest);
await applyLoginSettings();
const abortedInterruptedMessages = abortInterruptedMessages({
  preserveActiveBots: !inactiveBots,
});
if (abortedInterruptedMessages > 0) {
  traceInfo('database.interrupted-messages-aborted', {
    message_count: abortedInterruptedMessages,
    operation: 'startup',
  });
}
createTray();
createWindow();
await pluginManager.activateAll();
mcpManager.setManagedServers(pluginManager.getContributions('mcps').map((server) => ({
  name: `plugin-${server.pluginId}-${server.id}`,
  config: server.config,
})));
const globalMcpInitialization = mcpManager.initializeGlobal().catch((error) => sendRendererEvent('mcp:event', {
  type: 'configuration-error',
  message: error instanceof Error ? error.message : String(error),
}));
const startBots = inactiveBots ? Promise.resolve() : globalMcpInitialization
  .then(() => botManager.start())
  .catch((error) => traceError('bots.start-error', {
  error: error instanceof Error ? error.message : String(error),
  }));
void startBots.finally(() => botInitialization.resolve());
if (inactiveBots) {
  traceInfo('bots.initialization-skipped', { operation: 'startup', status: 'inactive-by-flag' });
}
for (const failure of pluginManager.getFailures().filter((item) => String(item.error).startsWith('Plugin activation failed:'))) {
  traceError('plugin.activation-error', {
    plugin: failure.pluginId ?? failure.fileName,
    error: failure.error,
  });
}
threadSearchSyncInterval = setInterval(() => void synchronizeThreadSearchIndex(), THREAD_SEARCH_SYNC_INTERVAL_MS);
threadSearchSyncInterval.unref();

async function synchronizeThreadSearchIndex() {
  const settings = getAivaxSettings();
  const collectionId = settings.threadSearchCollectionId;
  if (!getAivaxAccessToken() || !collectionId) return null;
  if (threadSearchSyncPromise) return threadSearchSyncPromise;

  threadSearchSyncPromise = (async () => {
    const startedAt = Date.now();
    const documents = buildThreadSearchDocuments(listThreadSearchMessages());
    const nextManifest = createThreadSearchManifest(documents);
    const changes = compareThreadSearchManifests(
      getThreadSearchManifest(collectionId),
      nextManifest,
    );
    try {
      const response = await indexAivaxDocuments(collectionId, documents);
      setThreadSearchManifest(collectionId, nextManifest);
      traceInfo('aivax.thread-search-index-completed', {
        consumed_credits: response.consumedCredits,
        document_count: documents.length,
        documents_indexed: changes.added,
        documents_updated: changes.updated,
        documents_skipped: response.data.skipped ?? changes.skipped,
        documents_removed: changes.removed,
        duration_ms: Date.now() - startedAt,
      });
      return response;
    } catch (error) {
      traceError('aivax.thread-search-index-error', {
        document_count: documents.length,
        duration_ms: Date.now() - startedAt,
        status: error?.status,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  })().finally(() => {
    threadSearchSyncPromise = null;
  });
  return threadSearchSyncPromise;
}

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
    ...getNativeWindowOptions(),
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
  }
  if (!chatRunner) {
    chatRunner = new ChatRunner({
      registry: providerRegistry,
      mcpManager,
      getPreferences: runtimePreferences,
      getPluginTools,
      getPluginContext: pluginInvocationContext,
      getBotRuntimeContext: (conversationId) => botManager?.getBotRuntimeContext(conversationId),
      getBotManager: () => botManager,
      describeInvocationBot: (conversationId) => botManager?.describeInvocationBot(conversationId),
      queueBotToolApproval: (request) => botManager?.queueToolApproval(request),
      noteBotUserInteraction: (conversationId) => botManager?.noteUserInteraction(conversationId),
      noteBotRunStarted: (conversationId, assistantMessageId) => (
        botManager?.noteRunStarted(conversationId, assistantMessageId)
      ),
      noteBotRunFinished: (conversationId, assistantMessageId) => (
        botManager?.noteRunFinished(conversationId, assistantMessageId)
      ),
      noteBotRunStopped: (conversationId) => botManager?.noteRunStopped(conversationId),
      canCreateDisposableConversation: () => !forcedCleanupRunning,
      beforeToolExecute: (invocation) => pluginManager.runtime.beforeTool(invocation),
      afterToolExecute: (invocation) => pluginManager.runtime.afterTool(invocation),
      sendPluginEvent: (type, payload) => pluginManager.runtime.emit(type, payload),
      sendEvent: (payload) => {
        pluginManager.runtime.emitChatEvent(payload);
        sendRendererEvent('chat:event', payload);
        if (
          ['conversation', 'run-state', 'semaphore-state', 'question-request', 'question-cancelled', 'permission-request', 'permission-cancelled', 'permission-resolved']
            .includes(payload.type)
          || (payload.type === 'message' && payload.message?.role === 'user')
        ) refreshTrayMenu();
      },
      sendCompletionNotification: ({ conversation, message }) => {
        if (!getPreferences().desktop?.notifyOnCompletion || !Notification.isSupported()) return;
        try {
          const body = answerTextFromTextualBlocks(message.content)
            .replace(/```+[^\n`]*/g, '')
            .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
            .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
            .replace(/\*\*([^*]+)\*\*/g, '$1')
            .replace(/__([^_]+)__/g, '$1')
            .replace(/^#{1,6}\s+/gm, '')
            .replace(/^\s*([-*_]\s*){3,}$/gm, '')
            .replace(/^>\s?/gm, '')
            .replace(/^\s*[-*+]\s+/gm, '')
            .replace(/^\s*\d+[.)]\s+/gm, '')
            .replace(/\*([^*\n]+)\*/g, '$1')
            .replace(/`([^`]+)`/g, '$1')
            .replace(/\s+/g, ' ')
            .trim();
          new Notification({
            title: conversation?.title || 'Avi',
            body: body || 'Response completed.',
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
  if (!botManager) {
    botManager = new BotManager({
      sendEvent: (channel, payload) => {
        if (channel === 'bots:event') {
          pluginManager.runtime.emit(`bot.${String(payload.type ?? 'updated').replace(/^bots:/, '').replaceAll(':', '.')}`, {
            botId: payload.botId,
            data: payload,
          });
        }
        sendRendererEvent(channel, payload);
      },
    });
    botManager.attachChatRunner(chatRunner);
  }
  if (!quickChatRunner) {
    quickChatRunner = new QuickChatRunner({
      registry: providerRegistry,
      mcpManager,
      chatRunner,
      getPreferences: runtimePreferences,
      getPluginTools,
      getPluginContext: pluginInvocationContext,
      getBotManager: () => botManager,
      sendEvent: sendQuickChatEvent,
      stopBackgroundTasks: stopConversationTerminals,
    });
  }
  pluginManager.setRuntimeServices({
    appInfo: () => ({ name: app.getName(), version: app.getVersion(), platform: process.platform }),
    chatRunner,
    botManager,
    providerRegistry,
    reservedToolNames: new Set([
      ...pluginManager.reservedToolNames,
      ...pluginManager.getContributions('tools').map((tool) => tool.name.toLowerCase()),
    ]),
    reservedProviderIds: new Set(pluginManager.getProviderTypes().map((type) => type.descriptor.id.toLowerCase())),
    reservedPanelIds: new Set(pluginManager.getContributions('auxiliaryPanels').map((panel) => (
      `plugin:${panel.pluginId}:${panel.id}`.toLowerCase()
    ))),
    cleanupConversation,
    createDomainApi: createPluginDomainApi,
    registerTool: registerPluginTool,
    listContextRoots: () => [
      { id: 'global', name: 'Global', path: join(homedir(), '.agents') },
      { id: 'installation', name: 'Installation', path: resolveInstallationContextPath() },
      ...pluginContextRoots(),
      ...pluginManager.runtime.listContextResources().map((item) => ({ id: item.id, name: item.title, path: item.root })),
    ],
    listContextItems: async ({ path } = {}) => path ? listContextItems(path) : [],
    readContextItem: async (targetPath) => {
      const target = resolve(String(targetPath ?? ''));
      const roots = [
        join(homedir(), '.agents'),
        resolveInstallationContextPath(),
        ...pluginContextRoots().map((root) => root.path),
        ...pluginManager.runtime.listContextResources().map((item) => item.root),
      ].map((root) => resolve(root));
      if (!roots.some((root) => {
        const relation = relative(root, target);
        return relation === '' || (!relation.startsWith('..') && !isAbsolute(relation));
      })) {
        throw new Error('Context item path is outside the available context roots.');
      }
      return { path: target, content: await readFile(target, 'utf8') };
    },
  });
  if (!remoteMcpServer) {
    remoteMcpServer = new RemoteMcpServer({ chatRunner, botManager, providerRegistry, getPreferences, getApiKey: getRemoteApiKey });
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

function getPluginTools(conversationId = null) {
  return [
    ...pluginManager.getContributions('tools').map((tool) => ({
      ...tool,
      ...pluginManager.getHandlers('tools', tool.name),
    })),
    ...pluginManager.runtime.listTools(conversationId),
  ];
}

function pluginContextRoots() {
  const plugins = new Map(pluginManager.list().map((plugin) => [plugin.id, plugin]));
  return [...new Map(pluginManager.getContributions('context').map((item) => [
    item.pluginId,
    {
      id: item.pluginId,
      name: plugins.get(item.pluginId)?.name ?? item.pluginId,
      path: item.root,
    },
  ])).values()];
}

function pluginInvocationContext({ conversationId = null, workspacePath = null, botId = null } = {}) {
  const runtimeRoots = pluginManager.runtime.listContextResources()
    .filter((item) => item.scope.type === 'global'
      || (item.scope.type === 'thread' && item.scope.threadId === conversationId)
      || (item.scope.type === 'bot' && item.scope.botId === botId)
      || (item.scope.type === 'workspace' && resolve(item.scope.path) === resolve(workspacePath ?? '.')))
    .map((item) => ({ id: item.id, name: item.title, path: item.root }));
  return {
    pluginContextRoots: [...pluginContextRoots(), ...runtimeRoots],
    pluginPersonalities: pluginManager.getContributions('personalities'),
  };
}

function runtimePreferences() {
  const preferences = getPreferences();
  const personalityIds = new Set([
    'candid',
    'cynical',
    'friendly',
    'pragmatic',
    'quirky',
    ...pluginManager.getContributions('personalities').map((personality) => personality.id),
  ]);
  return personalityIds.has(preferences.tuning.personality)
    ? preferences
    : { ...preferences, tuning: { ...preferences.tuning, personality: null } };
}

function resolvePluginPanel(panelId) {
  const runtimePanel = pluginManager.runtime.getPanel(panelId);
  if (runtimePanel) return runtimePanel.handlers;
  const match = /^plugin:([^:]+):(.+)$/.exec(String(panelId ?? ''));
  return match ? pluginManager.getHandlers('auxiliaryPanels', match[2]) : null;
}

function cleanupConversation(conversationId) {
  chatRunner.stop(conversationId, { includeSubagents: true });
  const children = [
    ...listSubagents(conversationId),
    ...listSideChats(conversationId),
    ...listRubberDucks(conversationId),
  ];
  for (const child of children) chatRunner.stop(child.id);
  chatRunner.removeConversationSemaphores([
    conversationId,
    ...children.map((child) => child.id),
  ]);
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
      : chatRunner?.semaphores.waitSnapshot(conversation.id)
        ? 'sleeping'
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
  const options = { transparent: false, titleBarStyle: 'default' };
  if (!getPreferences().desktop.sidebarTransparency) return options;
  if (process.platform === 'win32') {
    const windowsBuild = Number(release().split('.')[2] ?? 0);
    return {
      ...options,
      backgroundColor: '#00000000',
      backgroundMaterial: windowsBuild >= 22_000 ? 'tabbed' : 'acrylic',
    };
  }
  if (process.platform === 'darwin') {
    return {
      ...options,
      backgroundColor: '#00000000',
      vibrancy: 'sidebar',
      visualEffectState: 'followWindow',
    };
  }
  return options;
}

function applyNativeWindowEffect() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const options = getNativeWindowOptions();
  if (process.platform === 'win32') {
    mainWindow.setBackgroundColor(options.backgroundColor ?? '#00000000');
    mainWindow.setBackgroundMaterial(options.backgroundMaterial ?? 'none');
  } else if (process.platform === 'darwin') {
    mainWindow.setBackgroundColor(options.backgroundColor ?? '#00000000');
    mainWindow.setVibrancy(options.vibrancy ?? null);
  }
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
    ...runtimePreferences(),
    defaultModelWarnings: validateDefaultModels(
      getPreferences().defaultModels,
      providerRegistry.listModels(),
    ),
    pluginCatalog: {
      themes: pluginManager.getContributions('themes'),
      personalities: pluginManager.getContributions('personalities').map(({ instructions, ...personality }) => personality),
    },
    pluginFailures: pluginManager.getFailures().map(({ sourcePath, pluginId, ...failure }) => ({
      ...failure,
      id: pluginId,
    })),
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
  applicationIpc.handle('app:favicon', (_event, url) => getFaviconDataUrl(url));
  applicationIpc.handle('appearance:select-background', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      defaultPath: homedir(),
      properties: ['openFile'],
      filters: [{
        name: 'Images',
        extensions: ['gif', 'jpeg', 'jpg', 'png', 'webp'],
      }],
    });
    if (canceled) return null;

    const sourcePath = filePaths[0];
    const extension = extname(sourcePath).toLowerCase();
    if (!chatBackgroundMimeTypes[extension]) {
      throw new TypeError('Select a GIF, JPEG, PNG, or WebP image.');
    }

    const backgroundDirectory = join(homedir(), '.aivax', 'chat-backgrounds');
    const fileName = `chat-background${extension}`;
    const destinationPath = join(backgroundDirectory, fileName);
    await mkdir(backgroundDirectory, { recursive: true });
    if (resolve(sourcePath) !== resolve(destinationPath)) {
      await copyFile(sourcePath, destinationPath);
    }
    await Promise.all(Object.keys(chatBackgroundMimeTypes)
      .filter((otherExtension) => otherExtension !== extension)
      .map((otherExtension) => rm(
        join(backgroundDirectory, `chat-background${otherExtension}`),
        { force: true },
      )));
    return fileName;
  });
  applicationIpc.handle('appearance:background', async (_event, fileName) => {
    const extension = extname(String(fileName ?? '')).toLowerCase();
    if (fileName !== `chat-background${extension}` || !chatBackgroundMimeTypes[extension]) {
      throw new TypeError('Invalid managed background image.');
    }
    const image = await readFile(join(homedir(), '.aivax', 'chat-backgrounds', fileName));
    return `data:${chatBackgroundMimeTypes[extension]};base64,${image.toString('base64')}`;
  });
  applicationIpc.handle('appearance:remove-background', async () => {
    const backgroundDirectory = join(homedir(), '.aivax', 'chat-backgrounds');
    await Promise.all(Object.keys(chatBackgroundMimeTypes).map((extension) => rm(
      join(backgroundDirectory, `chat-background${extension}`),
      { force: true },
    )));
    return true;
  });
  applicationIpc.handle('desktop:save', async (_event, settings) => {
    const saved = setDesktopSettings(settings);
    await applyLoginSettings();
    applyNativeWindowEffect();
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
    const personalityIds = new Set([
      null,
      'candid',
      'cynical',
      'friendly',
      'pragmatic',
      'quirky',
      ...pluginManager.getContributions('personalities').map((personality) => personality.id),
    ]);
    if (!personalityIds.has(tuning?.personality ?? null)) {
      throw new Error('Choose an available personality.');
    }
    resolveTerminalShell(process.env, process.platform, tuning?.terminalShell);
    const saved = setTuningSettings(tuning);
    setTraceLevel(memoryTraceEnabled && saved.logLevel === 'disabled' ? 'minimal' : saved.logLevel);
    traceVerbose('logging.configuration-changed', { log_level: saved.logLevel });
    return saved;
  });
  applicationIpc.handle('default-models:save', (_event, settings) => {
    const validationWarnings = validateDefaultModels(settings, providerRegistry.listModels());
    const blockingWarnings = validationWarnings.filter((warning) => (
      warning.role === 'intelligence'
      && ['invalid level count', 'duplicate selection'].includes(warning.reason)
    ));
    if (blockingWarnings.length > 0) {
      throw new Error(blockingWarnings.map((warning) => warning.message).join(' '));
    }
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

  const aivaxState = async () => {
    const connected = Boolean(getAivaxAccessToken());
    if (!connected) return { connected, account: null, settings: getAivaxSettings() };
    try {
      const account = await requestAivax('/api/v1/information/balance', { responseType: 'object' });
      return { connected, account, settings: getAivaxSettings() };
    } catch (error) {
      if (error?.status !== 401) throw error;
      deleteAivaxAccessToken();
      const settings = setAivaxSettings({
        ...getAivaxSettings(),
        memoryEnabled: false,
        advancedFetchEnabled: false,
        webSearchEnabled: false,
        mediaDescriptionsEnabled: false,
      });
      return { connected: false, account: null, settings };
    }
  };
  applicationIpc.handle('aivax:state', aivaxState);
  applicationIpc.handle('aivax:connect', async (_event, loginKey) => {
    const login = await loginToAivax(loginKey);
    if (typeof login.accessToken !== 'string' || !login.accessToken) {
      throw new Error('AIVAX did not return an access token.');
    }
    const account = await requestAivax('/api/v1/information/balance', {
      accessToken: login.accessToken,
      responseType: 'object',
    });
    setAivaxAccessToken(login.accessToken);
    void synchronizeThreadSearchIndex();
    return { connected: true, account, settings: getAivaxSettings() };
  });
  applicationIpc.handle('aivax:disconnect', () => {
    deleteAivaxAccessToken();
    const settings = setAivaxSettings({
      ...getAivaxSettings(),
      memoryEnabled: false,
      advancedFetchEnabled: false,
      webSearchEnabled: false,
      mediaDescriptionsEnabled: false,
    });
    return { connected: false, account: null, settings };
  });
  applicationIpc.handle('aivax:save', (_event, settings) => {
    if (!getAivaxAccessToken()) throw new Error('Connect an AIVAX account first.');
    const previousCollectionId = getAivaxSettings().threadSearchCollectionId;
    const saved = setAivaxSettings(settings);
    if (
      saved.threadSearchCollectionId
      && saved.threadSearchCollectionId !== previousCollectionId
    ) void synchronizeThreadSearchIndex();
    return saved;
  });
  applicationIpc.handle('aivax:collections', () => requestAivax('/api/v1/collections', {
    responseType: 'array',
  }));
  applicationIpc.handle('aivax:collections:create', async (_event, name) => {
    const collectionName = String(name ?? '').trim();
    if (!collectionName) throw new Error('Collection name is required.');
    const created = await requestAivax('/api/v1/collections', {
      body: { collectionName },
      responseType: 'object',
    });
    const collections = await requestAivax('/api/v1/collections', { responseType: 'array' });
    return {
      collection: collections.find((collection) => collection.id === created?.collectionId) ?? null,
      collections,
    };
  });

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

  const archiveState = (options = {}) => {
    const query = typeof options === 'string' ? options : String(options?.query ?? '');
    const pageSize = Math.min(100, Math.max(1, Math.trunc(Number(options?.pageSize)) || 20));
    const total = countArchivedConversations(query);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(totalPages, Math.max(1, Math.trunc(Number(options?.page)) || 1));
    return {
      settings: getArchiveSettings(),
      conversations: listArchivedConversations(query, {
        limit: pageSize,
        offset: (page - 1) * pageSize,
      }).map(refreshConversationProject),
      pagination: { page, pageSize, total, totalPages },
      stats: getArchiveStats(),
    };
  };
  applicationIpc.handle('archive:state', (_event, options = {}) => archiveState(options));
  applicationIpc.handle('archive:save', (_event, settings, options = {}) => ({
    ...archiveState(options),
    settings: setArchiveSettings(settings),
  }));
  applicationIpc.handle('archive:restore', (_event, conversationId, options = {}) => {
    restoreConversation(conversationId);
    return archiveState(options);
  });
  applicationIpc.handle('archive:delete', (_event, conversationId, options = {}) => {
    chatRunner.removeConversationSemaphores([conversationId]);
    deleteConversation(conversationId, { hard: true });
    chatRunner.semaphores.cleanMissingConversations();
    return archiveState(options);
  });
  applicationIpc.handle('archive:maintenance', async (_event, options = {}) => {
    if (forcedCleanupRunning) throw new Error('Forced cleanup is already running.');
    forcedCleanupRunning = true;
    try {
      const maintenanceNow = new Date();
      const conversationIds = listForcedCleanupConversationIds({ now: maintenanceNow });
      const activeRuns = conversationIds.flatMap((conversationId) => {
        const run = chatRunner.runs.get(conversationId);
        return run ? [run] : [];
      });
      for (const conversationId of conversationIds) {
        chatRunner.stop(conversationId, { includeSubagents: true, stoppedByUser: true });
      }
      await Promise.allSettled(activeRuns.map((run) => run.completion));
      chatRunner.removeConversationSemaphores(conversationIds);
      const maintenance = runArchiveMaintenance({
        now: maintenanceNow,
        forced: true,
        activeConversationIds: [...chatRunner.runs.keys()],
      });
      chatRunner.semaphores.cleanMissingConversations();
      return {
        ...archiveState(options),
        maintenance,
      };
    } finally {
      forcedCleanupRunning = false;
    }
  });
  applicationIpc.handle('archive:temporary-storage', () => getTemporaryStorage());
  applicationIpc.handle('archive:clear-temporary-storage', () => clearTemporaryStorage());

  const semaphoreState = () => chatRunner.semaphores.globalSnapshot().map((semaphore) => ({
    ...semaphore,
    holders: semaphore.holders.map((holder) => ({
      ...holder,
      conversation: getConversation(holder.conversationId),
    })),
    queue: semaphore.queue.map((entry) => ({
      ...entry,
      conversation: getConversation(entry.conversationId),
    })),
  }));
  applicationIpc.handle('semaphores:state', semaphoreState);
  applicationIpc.handle('semaphores:reset', (_event, name) => {
    const result = chatRunner.semaphores.reset(name);
    for (const holder of result.released) {
      chatRunner.emit(holder.conversationId, {
        type: 'block-state',
        blocked: chatRunner.isConversationBlocked(holder.conversationId),
      });
    }
    return { ...result, semaphores: semaphoreState() };
  });

  applicationIpc.handle('conversations:list', () => listConversationsWithProjects());
  applicationIpc.handle('conversations:create', (_event, payload = {}) => (
    refreshConversationProject(createConversation(payload))
  ));
  applicationIpc.handle('conversations:update', (_event, payload = {}) => (
    refreshConversationProject(updateConversation(payload.id, payload))
  ));
  applicationIpc.handle('conversations:messages', async (_event, conversationId) => {
    const messages = getMessages(conversationId);
    return Promise.all(messages.map(async (message) => {
      if (!message.attachments.some((attachment) => (
        attachment?.kind === 'video_url' && typeof attachment.dataUrl === 'string'
      ))) return message;

      if (!legacyVideoMigrations.has(message.id)) {
        const migration = materializeLegacyVideoAttachments(message.attachments)
          .then((attachments) => updateMessage(message.id, { attachments }, { touch: false }))
          .finally(() => legacyVideoMigrations.delete(message.id));
        legacyVideoMigrations.set(message.id, migration);
      }
      return legacyVideoMigrations.get(message.id);
    }));
  });
  applicationIpc.handle('conversations:set-tags', (_event, payload = {}) => (
    refreshConversationProject(setConversationTags(payload.conversationId, payload.tags))
  ));
  applicationIpc.handle('tags:save', (_event, tags) => ({
    tags: setChatTags(tags),
    conversations: listConversationsWithProjects(),
  }));
  applicationIpc.handle('folders:save-color', (_event, payload = {}) => (
    setFolderColor(payload.path, payload.color)
  ));
  applicationIpc.handle('composer-state:get', async (_event, conversationId) => {
    const state = getComposerState(conversationId);
    if (!state) return null;
    const attachments = await materializeLegacyVideoAttachments(state.attachments);
    return attachments.some((attachment, index) => attachment !== state.attachments[index])
      ? setComposerState(conversationId, { ...state, attachments })
      : state;
  });
  applicationIpc.handle('composer-state:save', (_event, payload = {}) => (
    setComposerState(payload.conversationId, payload)
  ));
  applicationIpc.handle('tasks:list', (_event, conversationId) => listTasks(conversationId));
  applicationIpc.handle('bots:list', async () => {
    const workStateByBot = await botManager.listWorkStateByBot();
    return {
      bots: botManager.describeBots().map((bot) => ({
        ...bot,
        attentionCount: (workStateByBot[bot.id]?.items ?? []).filter(hasOpenBotUserAction).length,
      })),
      workStateByBot,
      schedulerSnooze: botManager.getSchedulerSnooze(),
    };
  });
  applicationIpc.handle('bots:snooze', (_event, options = {}) => (
    botManager.setSchedulerSnooze(options)
  ));
  applicationIpc.handle('bots:snooze-one', (_event, payload = {}) => (
    botManager.setBotSnooze(payload.botId, payload.options)
  ));
  applicationIpc.handle('bots:create', (_event, config = {}) => (
    botManager.createBotFromConfig(config)
  ));
  applicationIpc.handle('bots:update', (_event, payload = {}) => (
    botManager.updateBotConfig(payload.id, payload.changes)
  ));
  applicationIpc.handle('bots:delete', (_event, botId) => botManager.deleteBotById(botId));
  applicationIpc.handle('bots:clear-thread', (_event, botId) => (
    botManager.clearBotThread(botId)
  ));
  applicationIpc.handle('bots:full-reset', (_event, botId) => botManager.fullResetBot(botId));
  applicationIpc.handle('bots:activate', (_event, botId) => (
    botManager.activateBot(botId, { trigger: 'manual' })
  ));
  applicationIpc.handle('bots:resolve-approval', (_event, payload = {}) => (
    botManager.resolveApproval(payload.approvalId, payload.decision)
  ));
  applicationIpc.handle('bots:update-work-item', (_event, payload = {}) => (
    botManager.setBotWorkItemState(String(payload.botId ?? ''), String(payload.workItemId ?? ''), payload.state)
  ));
  applicationIpc.handle('bots:choose-folder', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      defaultPath: homedir(),
      properties: ['openDirectory'],
    });
    return canceled ? null : filePaths[0];
  });
  applicationIpc.handle('conversations:archive', (_event, conversationId) => {
    cleanupConversation(conversationId);
    archiveConversation(conversationId);
    chatRunner.semaphores.cleanMissingConversations();
    return listConversationsWithProjects();
  });
  applicationIpc.handle('conversations:delete', (_event, conversationId) => {
    cleanupConversation(conversationId);
    deleteConversation(conversationId);
    chatRunner.semaphores.cleanMissingConversations();
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
  applicationIpc.handle('conversations:search', async (_event, query) => {
    const collectionId = getAivaxAccessToken() && getAivaxSettings().threadSearchCollectionId;
    if (!collectionId) return runChatSearch(query);
    const startedAt = Date.now();
    try {
      const response = await requestAivax('/api/v1/query', {
        body: {
          terms: [String(query)],
          collections: [collectionId],
          top: 20,
          includeReferences: false,
          reranker: 'rrf',
          minScore: 0.2,
        },
        includeResponseMetadata: true,
        responseType: 'array',
      });
      const seenConversations = new Set();
      const results = response.data.flatMap((result) => {
        const conversationId = result.metadata?.threadId;
        const conversation = conversationId ? getConversation(conversationId) : null;
        if (!conversation || conversation.conversationType !== 'thread' || seenConversations.has(conversationId)) return [];
        seenConversations.add(conversationId);
        return [{
          score: result.score,
          conversationId,
          messageId: result.metadata?.assistantMessageId ?? null,
          title: conversation.title,
          role: 'assistant',
          content: String(result.documentContent ?? ''),
          updatedAt: result.metadata?.updatedAt ?? conversation.updatedAt,
          folderPath: conversation.projectPath,
          folderName: conversation.projectName,
          folderDisplayPath: conversation.projectDisplayPath,
        }];
      });
      traceInfo('aivax.thread-search-completed', {
        consumed_credits: response.consumedCredits,
        duration_ms: Date.now() - startedAt,
        item_count: results.length,
      });
      return results;
    } catch (error) {
      traceError('aivax.thread-search-error', {
        duration_ms: Date.now() - startedAt,
        status: error?.status,
        error: error instanceof Error ? error.message : String(error),
      });
      return runChatSearch(query);
    }
  });
  applicationIpc.handle('orchestration:overview', async (_event, range = {}) => {
    if (Date.now() >= aivaxModelCatalogExpiresAt) {
      aivaxModelCatalogRequest ??= requestAivax('/api/v1/information/models.json', {
        accessToken: null,
        responseType: 'array',
      })
        .then((providers) => {
          aivaxModelCatalog = providers.flatMap((provider) => (
            Array.isArray(provider?.models) ? provider.models : []
          ));
          aivaxModelCatalogExpiresAt = Date.now() + 6 * 60 * 60_000;
        })
        .catch((error) => {
          traceError('orchestration.model-pricing-error', {
            error: error instanceof Error ? error.message : String(error),
          });
        })
        .finally(() => {
          aivaxModelCatalogRequest = null;
        });
      await aivaxModelCatalogRequest;
    }

    const configuredModels = new Map(
      providerRegistry.listModels().map((model) => [model.id, model]),
    );
    const allConversations = listAllConversations();
    const conversations = allConversations
      .filter((conversation) => conversation.conversationType === 'thread');
    const now = Date.now();
    const defaultFrom = new Date();
    defaultFrom.setDate(1);
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
    const projectDetails = new Map(allConversations.map((conversation) => [
      conversation.projectPath,
      {
        path: conversation.projectPath,
        name: conversation.projectName,
        displayPath: conversation.projectDisplayPath,
      },
    ]));
    const inferenceRecords = [];
    for (const conversation of allConversations) {
      for (const message of getMessages(conversation.id)) {
        if (message.hidden || message.role !== 'assistant' || !isInRange(message.createdAt)) {
          continue;
        }
        inferenceRecords.push({
          type: conversation.isSubagent
            ? 'subagent'
            : conversation.isRubberDuck
              ? 'supervision'
              : conversation.isBot
                ? 'bot'
                : 'inference',
          model: message.model || conversation.model || 'Unknown model',
          projectPath: conversation.projectPath,
          project: projectDetails.get(conversation.projectPath),
          usage: message.usage,
          createdAt: message.createdAt,
        });
      }
    }
    for (const inference of listInferenceUsage(
      new Date(from).toISOString(),
      new Date(to).toISOString(),
    )) {
      const project = projectDetails.get(inference.projectPath) ?? {
        path: inference.projectPath,
        name: inference.projectPath ? basename(inference.projectPath) : 'Unknown project',
        displayPath: inference.projectPath ?? 'Unknown project',
      };
      inferenceRecords.push({ ...inference, project });
    }

    const modelUsage = new Map();
    const pricingModels = new Map();
    const dailyModelUsage = new Map();
    const usageByType = new Map([
      ['subagent', { id: 'subagent', responses: 0, tokens: 0 }],
      ['bot', { id: 'bot', responses: 0, tokens: 0 }],
      ['inference', { id: 'inference', responses: 0, tokens: 0 }],
      ['auxiliary', { id: 'auxiliary', responses: 0, tokens: 0 }],
      ['supervision', { id: 'supervision', responses: 0, tokens: 0 }],
    ]);
    const usageByProject = new Map();

    for (const record of inferenceRecords) {
      const model = record.model;
      const inputTokens = Number(record.usage?.inputTokens) || 0;
      const cachedInputTokens = Number(record.usage?.cachedInputTokens) || 0;
      const outputTokens = Number(record.usage?.outputTokens) || 0;
      const reasoningTokens = Number(record.usage?.reasoningTokens) || 0;
      const totalTokens = Number(record.usage?.totalTokens) || inputTokens + outputTokens;
      const configuredModel = configuredModels.get(model);
      const catalogModelId = configuredModel?.modelId ?? model;
      if (!pricingModels.has(model)) {
        pricingModels.set(model, rankAivaxPricingModels(
          catalogModelId,
          aivaxModelCatalog,
          configuredModel?.providerId,
        )[0] ?? null);
      }
      const pricedModel = pricingModels.get(model);
      const pricingTiers = Array.isArray(pricedModel?.pricing)
        ? [...pricedModel.pricing].sort(
          (left, right) => Number(right.tokenThreshold || 0) - Number(left.tokenThreshold || 0),
        )
        : [];
      const appliedPricing = pricingTiers.find(
        (pricing) => inputTokens >= Number(pricing.tokenThreshold || 0),
      ) ?? null;
      const inputRate = Number(appliedPricing?.inputPerMillionTokens);
      const cachedInputRate = Number(appliedPricing?.cachedInputPerMillionTokens);
      const outputRate = Number(appliedPricing?.outputPerMillionTokens);
      const hasPricing = Number.isFinite(inputRate)
        && Number.isFinite(cachedInputRate)
        && Number.isFinite(outputRate);
      const recordCost = hasPricing
        ? (
          Math.max(0, inputTokens - cachedInputTokens) * inputRate
          + cachedInputTokens * cachedInputRate
          + outputTokens * outputRate
        ) / 1_000_000
        : 0;
      const displayPricing = pricingTiers.at(-1) ?? null;
      const usage = modelUsage.get(model) ?? {
        id: model,
        messages: 0,
        pricedMessages: 0,
        cost: 0,
        pricing: displayPricing && {
          inputPerMillionTokens: Number(displayPricing.inputPerMillionTokens),
          cachedInputPerMillionTokens: Number(displayPricing.cachedInputPerMillionTokens),
          outputPerMillionTokens: Number(displayPricing.outputPerMillionTokens),
        },
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        durationMs: 0,
        timedMessages: 0,
        tokens: 0,
      };
      usage.messages += 1;
      usage.pricedMessages += hasPricing ? 1 : 0;
      usage.cost += recordCost;
      usage.inputTokens += inputTokens;
      usage.cachedInputTokens += cachedInputTokens;
      usage.outputTokens += outputTokens;
      usage.reasoningTokens += reasoningTokens;
      if (Number.isFinite(record.usage?.durationMs)) {
        usage.durationMs += record.usage.durationMs;
        usage.timedMessages += 1;
      }
      usage.tokens += totalTokens;
      modelUsage.set(model, usage);

      const typeUsage = usageByType.get(record.type);
      if (typeUsage) {
        typeUsage.responses += 1;
        typeUsage.tokens += totalTokens;
      }

      if (record.projectPath) {
        const projectUsage = usageByProject.get(record.projectPath) ?? {
          ...record.project,
          responses: 0,
          tokens: 0,
          latestAt: 0,
        };
        projectUsage.responses += 1;
        projectUsage.tokens += totalTokens;
        projectUsage.latestAt = Math.max(
          projectUsage.latestAt,
          new Date(record.createdAt).getTime() || 0,
        );
        usageByProject.set(record.projectPath, projectUsage);
      }

      const createdAt = new Date(record.createdAt);
      const day = new Date(
        createdAt.getFullYear(),
        createdAt.getMonth(),
        createdAt.getDate(),
      ).getTime();
      const modelsForDay = dailyModelUsage.get(day) ?? new Map();
      const usageForDay = modelsForDay.get(model) ?? { id: model, tokens: 0 };
      usageForDay.tokens += totalTokens;
      modelsForDay.set(model, usageForDay);
      dailyModelUsage.set(day, modelsForDay);
    }

    return {
      metrics: {
        responses: inferenceRecords.length,
        modelsUsed: modelUsage.size,
        tokens: [...modelUsage.values()].reduce((total, usage) => total + usage.tokens, 0),
        inputTokens: [...modelUsage.values()].reduce((total, usage) => total + usage.inputTokens, 0),
        cachedInputTokens: [...modelUsage.values()]
          .reduce((total, usage) => total + usage.cachedInputTokens, 0),
        outputTokens: [...modelUsage.values()].reduce((total, usage) => total + usage.outputTokens, 0),
        reasoningTokens: [...modelUsage.values()]
          .reduce((total, usage) => total + usage.reasoningTokens, 0),
        cost: [...modelUsage.values()].reduce((total, usage) => total + usage.cost, 0),
        pricedResponses: [...modelUsage.values()]
          .reduce((total, usage) => total + usage.pricedMessages, 0),
        topModels: [...modelUsage.values()]
          .sort((a, b) => b.tokens - a.tokens || b.messages - a.messages),
        dailyTokens: [...dailyModelUsage.entries()]
          .sort(([left], [right]) => left - right)
          .map(([date, modelsForDay]) => ({
            date,
            models: [...modelsForDay.values()].sort((a, b) => b.tokens - a.tokens),
          })),
        usageByType: [...usageByType.values()],
        usageByProject: [...usageByProject.values()]
          .sort((a, b) => b.latestAt - a.latestAt)
          .slice(0, 5),
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
    if (forcedCleanupRunning) throw new Error('Side chats cannot be created during forced cleanup.');
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
    chatRunner.removeConversationSemaphores([sideChat.id]);
    deleteConversation(sideChat.id, { hard: true });
    return true;
  });
  applicationIpc.handle('subagents:list', (_event, parentConversationId) => (
    listSubagents(parentConversationId).map(refreshConversationProject)
  ));
  applicationIpc.handle('rubber-ducks:list', (_event, parentConversationId) => (
    listRubberDucks(parentConversationId).map(refreshConversationProject)
  ));

  applicationIpc.handle('providers:list', () => listProviders());
  applicationIpc.handle('providers:types', () => providerRegistry.listTypes());
  applicationIpc.handle('providers:normalize', (_event, payload) => (
    providerRegistry.normalizeConfig(payload)
  ));
  applicationIpc.handle('providers:import-from-url', async (_event, value) => {
    let url;
    try {
      url = new URL(String(value ?? '').trim());
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
    } catch {
      throw new Error('Provider import URL must be a valid HTTP or HTTPS URL.');
    }

    const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) {
      throw new Error(`Provider import failed with HTTP ${response.status}.`);
    }
    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > 1_048_576) {
      throw new Error('Provider import response exceeds the 1 MB limit.');
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('Provider import returned an empty response.');
    const chunks = [];
    let totalLength = 0;
    while (true) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      totalLength += chunk.byteLength;
      if (totalLength > 1_048_576) {
        await reader.cancel();
        throw new Error('Provider import response exceeds the 1 MB limit.');
      }
      chunks.push(chunk);
    }
    const bytes = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder().decode(bytes);
  });
  applicationIpc.handle('providers:save', async (_event, payload) => {
    const provider = providerRegistry.normalizeConfig(payload);
    const providers = listProviders();
    const index = providers.findIndex((item) => item.id === provider.id);
    const saved = setProviders(index < 0
      ? [...providers, provider]
      : providers.map((item) => item.id === provider.id ? provider : item));
    try {
      await providerRegistry.refresh(provider.id);
    } catch (error) {
      setProviders(providers);
      throw error;
    }
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
  applicationIpc.handle('providers:usages', () => providerUsageService.list());
  applicationIpc.handle('providers:usage', (_event, usageProviderId) => (
    providerUsageService.read(usageProviderId)
  ));
  applicationIpc.handle('providers:usage-reset', (_event, payload = {}) => (
    providerUsageService.reset(payload.usageProviderId, payload.resetId)
  ));
  applicationIpc.handle('providers:auxiliary-panels', (_event, payload = {}) => {
    const conversation = payload.conversationId
      ? getConversation(payload.conversationId)
      : null;
    return [
      ...providerRegistry.listAuxiliaryPanels({
        conversation,
        workspacePath: conversation?.projectPath ?? null,
      }),
      ...pluginManager.getContributions('auxiliaryPanels').map((panel) => ({
        id: `plugin:${panel.pluginId}:${panel.id}`,
        title: panel.title,
        icon: panel.icon ?? null,
        providerId: `plugin:${panel.pluginId}`,
        providerName: panel.pluginId,
      })),
      ...pluginManager.runtime.listPanels().map((panel) => ({
        id: panel.id,
        title: panel.title,
        icon: panel.icon ?? null,
        providerId: `plugin:${panel.pluginId}`,
        providerName: panel.pluginId,
      })),
    ];
  });
  applicationIpc.handle('providers:auxiliary-panel', (_event, payload = {}) => {
    const conversation = payload.conversationId
      ? getConversation(payload.conversationId)
      : null;
    const pluginPanel = resolvePluginPanel(payload.panelId);
    if (pluginPanel) {
      return pluginPanel.load({
        conversation,
        workspacePath: conversation?.projectPath ?? null,
      });
    }
    return providerRegistry.readAuxiliaryPanel(payload.panelId, {
      conversation,
      workspacePath: conversation?.projectPath ?? null,
    });
  });
  applicationIpc.handle('providers:auxiliary-panel-action', (_event, payload = {}) => {
    const conversation = payload.conversationId
      ? getConversation(payload.conversationId)
      : null;
    const pluginPanel = resolvePluginPanel(payload.panelId);
    if (pluginPanel) {
      if (typeof pluginPanel.invokeAction !== 'function') {
        throw new Error('The plugin panel action is unavailable.');
      }
      return pluginPanel.invokeAction(payload.action, payload.input, {
        conversation,
        workspacePath: conversation?.projectPath ?? null,
      });
    }
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

  applicationIpc.handle('routers:list', () => routerService.list());
  applicationIpc.handle('routers:save', (_event, payload) => routerService.save(payload));
  applicationIpc.handle('routers:remove', (_event, routerId) => routerService.remove(routerId));

  applicationIpc.handle('models:list', () => providerRegistry.listModels());
  applicationIpc.handle('models:favorites', () => listFavorites());
  applicationIpc.handle('models:favorite', (_event, { modelId, favorited }) => setFavorite(modelId, favorited));

  applicationIpc.handle('plugins:list', () => {
    const status = pluginManager.getStatus();
    return {
      ...status,
      failures: status.failures.map(({ sourcePath, pluginId, ...failure }) => ({
        ...failure,
        id: pluginId,
      })),
    };
  });
  applicationIpc.handle('plugins:sideload', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      defaultPath: homedir(),
      properties: ['openFile'],
      filters: [{ name: 'Plugin packages', extensions: ['js', 'zip'] }],
    });
    if (canceled) return null;
    return pluginManager.sideload(filePaths[0], {
      confirmDowngrade: async ({ name, installedVersion, incomingVersion }) => {
        const { response } = await dialog.showMessageBox(mainWindow, {
          type: 'warning',
          title: 'Install older plugin version?',
          message: `${name} ${incomingVersion} is older than the installed version ${installedVersion}.`,
          detail: 'Installing it replaces the entire plugin folder. The currently loaded version remains active until Avi restarts.',
          buttons: ['Cancel', 'Install older version'],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
        });
        return response === 1;
      },
    });
  });
  applicationIpc.handle('plugins:set-enabled', (_event, { id, enabled }) => (
    pluginManager.setEnabled(id, enabled)
  ));
  applicationIpc.handle('plugins:settings', (_event, { id }) => pluginManager.getSettings(id));
  applicationIpc.handle('plugins:set-setting', (_event, {
    id,
    sectionIndex,
    optionIndex,
    value,
  }) => pluginManager.setSetting(id, sectionIndex, optionIndex, value));
  applicationIpc.handle('plugins:remove', async (_event, { id }) => {
    const plugin = pluginManager.list().find((entry) => entry.id === id);
    if (!plugin) throw new Error(`Plugin "${String(id ?? '')}" is not managed by Avi.`);
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      title: 'Remove plugin?',
      message: `Remove ${plugin.name || plugin.id}?`,
      detail: `This permanently deletes the entire ${plugin.id} plugin folder.`,
      buttons: ['Cancel', 'Remove'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    return response === 1 ? pluginManager.remove(id) : null;
  });
  applicationIpc.handle('plugins:docs', async () => {
    const docsPath = app.isPackaged
      ? join(process.resourcesPath, 'docs', 'Plugins.md')
      : join(app.getAppPath(), 'docs', 'Plugins.md');
    const error = await shell.openPath(docsPath);
    if (error) throw new Error(`Could not open plugin documentation: ${error}`);
    return true;
  });
  applicationIpc.handle('plugins:restart-avi', () => {
    app.relaunch();
    app.quit();
    return true;
  });
  applicationIpc.handle('plugins:restore-reload', () => reloadSnapshot);
  applicationIpc.handle('plugins:complete-reload', () => {
    const snapshot = reloadSnapshot;
    if (!snapshot) return null;
    const current = chatRunner.reloadSnapshot();
    const snapshotIds = new Set(snapshot.conversationIds);
    reloadSnapshot = null;
    return {
      conversationIds: current.conversationIds.filter((id) => snapshotIds.has(id)),
      runsStartedAt: Object.fromEntries(Object.entries(current.runsStartedAt ?? {})
        .filter(([id]) => snapshotIds.has(id))),
      approvals: current.approvals.filter((request) => snapshotIds.has(request.conversationId)),
      questions: current.questions.filter((request) => snapshotIds.has(request.conversationId)),
      semaphoreWaits: current.semaphoreWaits,
    };
  });
  applicationIpc.handle('plugins:create', () => {
    openMainView({
      view: 'new-conversation',
      project: inspectProjectFolder(homedir()),
      draftText: '/create-plugin Create a plugin that does...',
    });
    return true;
  });

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
  const resolveBotMcpTarget = (botId) => {
    const bot = botManager.describeBots().find((item) => item.id === botId);
    if (!bot) throw new Error('Bot not found.');
    return {
      folderPath: bot.resolvedWorkingFolder,
      options: mcpManager.botScopeOptions(bot.resolvedWorkingFolder, bot.id),
    };
  };
  applicationIpc.handle('mcp:bot', (_event, payload = {}) => {
    const target = resolveBotMcpTarget(payload.botId);
    return mcpManager.listFolder(target.folderPath, target.options);
  });
  applicationIpc.handle('mcp:save', (_event, payload = {}) => {
    const target = payload.botId
      ? resolveBotMcpTarget(payload.botId)
      : { folderPath: payload.folderPath, options: {} };
    return mcpManager.saveServer(
      target.folderPath,
      payload.previousName,
      payload.server,
      target.options,
    );
  });
  applicationIpc.handle('mcp:remove', (_event, payload = {}) => {
    const target = payload.botId
      ? resolveBotMcpTarget(payload.botId)
      : { folderPath: payload.folderPath, options: {} };
    return mcpManager.removeServer(target.folderPath, payload.name, target.options);
  });
  applicationIpc.handle('mcp:enabled', (_event, payload = {}) => (
    mcpManager.setServerEnabled(payload.serverKey, payload.enabled)
  ));
  applicationIpc.handle('mcp:restart', (_event, serverKey) => mcpManager.restartServer(serverKey));
  applicationIpc.handle('mcp:restart-all', (_event, folderPath) => mcpManager.restartAll(folderPath));
  applicationIpc.handle('mcp:inspect', (_event, serverKey) => mcpManager.inspectServer(serverKey));
  applicationIpc.handle('mcp:authenticate', (_event, serverKey) => mcpManager.authenticate(serverKey));

  applicationIpc.handle('chat:state', () => chatRunner.reloadSnapshot());
  applicationIpc.handle('chat:send', async (_event, payload) => {
    const result = await chatRunner.send({
      ...payload,
      userInitiated: true,
    });
    return {
      ...result,
      conversation: refreshConversationProject(result.conversation),
    };
  });
  applicationIpc.handle('chat:replace-user-message', async (_event, payload) => {
    const result = await chatRunner.replaceUserMessage(payload);
    return {
      ...result,
      conversation: refreshConversationProject(result.conversation),
    };
  });
  applicationIpc.handle('chat:retry', (_event, payload) => chatRunner.retry(payload));
  applicationIpc.handle('chat:expand-prompt', (_event, payload) => chatRunner.expandPrompt(payload));
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
  applicationIpc.handle('chat:context-usage', (_event, payload) => chatRunner.contextUsage({
    conversationId: payload?.conversationId,
    model: payload?.model,
    contextLimit: payload?.contextLimit,
  }));
  applicationIpc.handle('chat:compress-quick', (_event, payload) => chatRunner.compressQuick({
    conversationId: payload?.conversationId,
  }));
  applicationIpc.handle('chat:compress', (_event, payload) => chatRunner.compress({
    conversationId: payload?.conversationId,
    model: payload?.model,
  }));
  applicationIpc.handle('chat:cancel-queued', (_event, payload) => chatRunner.cancelQueuedMessage(payload));
  applicationIpc.handle('chat:reorder-queued', (_event, payload) => chatRunner.reorderQueuedMessages(payload));
  applicationIpc.handle('chat:run-semaphore-now', (_event, conversationId) => (
    chatRunner.runSemaphoreNow(conversationId)
  ));
  applicationIpc.handle('chat:cancel-semaphore', (_event, conversationId) => (
    chatRunner.cancelSemaphore(conversationId)
  ));
  applicationIpc.handle('chat:stop', (_event, conversationId) => {
    chatRunner.stop(conversationId, { includeSubagents: true, stoppedByUser: true });
    return true;
  });
  applicationIpc.handle('git-review:state', (_event, conversationId) => {
    const conversation = getConversation(conversationId);
    if (!conversation) throw new Error('Start a conversation before opening Git Review.');
    return reviewGitWorkspace(conversation.projectPath);
  });
  applicationIpc.handle('git-review:plan', async (_event, payload = {}) => {
    const conversation = getConversation(payload.conversationId);
    if (!conversation) throw new Error('Conversation not found.');
    const review = await reviewGitWorkspace(conversation.projectPath);
    const repository = review.repositories.find((item) => item.path === payload.repositoryPath);
    if (!repository) throw new Error('Repository not found. Refresh Git Review.');
    if (!repository.commitPlanAvailable) {
      throw new Error('This repository is too large to create a safe commit plan.');
    }
    return chatRunner.createCommitPlan({ model: payload.model, repository });
  });
  applicationIpc.handle('git-review:commit', (_event, payload = {}) => {
    const conversation = getConversation(payload.conversationId);
    if (!conversation) throw new Error('Conversation not found.');
    return commitGitPlan(
      conversation.projectPath,
      payload.repositoryPath,
      payload.commits,
    );
  });
  applicationIpc.handle('git-review:push', (_event, payload = {}) => {
    const conversation = getConversation(payload.conversationId);
    if (!conversation) throw new Error('Conversation not found.');
    return pushGitRepository(conversation.projectPath, payload.repositoryPath);
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
  applicationIpc.handle('goals:resume', async () => {
    await botInitialization.promise;
    await chatRunner.resumeGoals();
    return true;
  });

  applicationIpc.handle('files:select', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      defaultPath: homedir(),
      properties: ['openFile', 'multiSelections'],
    });
    return canceled ? [] : filePaths.map(filePathToAttachment);
  });
  applicationIpc.handle('files:materialize-video', (_event, attachment) => (
    materializeVideoAttachment(attachment)
  ));
  applicationIpc.handle('attachments:preview', async (event, attachment = {}) => {
    if (
      !['image_url', 'video_url'].includes(attachment.kind)
      || typeof attachment.path !== 'string'
    ) {
      throw new Error('A local image or video attachment is required.');
    }
    const path = await realpath(attachment.path);
    if (!(await lstat(path)).isFile() || !attachmentPreviewExtensions.has(extname(path).toLowerCase())) {
      throw new Error('The attachment is not a supported image or video file.');
    }
    const token = crypto.randomUUID();
    const preview = {
      path,
      ownerId: event.sender.id,
      expiresAt: Date.now() + attachmentPreviewLifetimeMs,
      expiry: null,
    };
    attachmentPreviews.set(token, preview);
    preview.expiry = setTimeout(() => deleteAttachmentPreview(token), attachmentPreviewLifetimeMs);
    preview.expiry.unref();
    return {
      token,
      url: `avi-attachment://${token}/${attachment.kind === 'video_url' ? 'video' : 'image'}`,
      expiresAt: preview.expiresAt,
    };
  });
  applicationIpc.handle('attachments:release-preview', (event, token) => {
    const preview = attachmentPreviews.get(token);
    if (preview?.ownerId === event.sender.id) deleteAttachmentPreview(token);
    return true;
  });
  applicationIpc.handle('files:workspace', (_event, folderPath) => (
    inspectWorkspaceFiles(folderPath)
  ));
  applicationIpc.handle('files:directory', (_event, payload = {}) => (
    listWorkspaceDirectory(payload.folderPath, payload.directoryPath)
  ));
  applicationIpc.handle('files:read', (_event, payload = {}) => (
    readWorkspaceFile(payload.folderPath, payload.filePath, {
      allowExternalReference: payload.allowExternalReference === true,
    })
  ));
  applicationIpc.handle('files:diff', (_event, payload = {}) => (
    readWorkspaceFileDiff(payload.folderPath, payload.filePath)
  ));
  applicationIpc.handle('files:search', (_event, payload = {}) => (
    searchWorkspaceFiles(payload.folderPath, payload.query)
  ));
  applicationIpc.handle('files:open', async (_event, payload = {}) => {
    const filePath = resolveWorkspacePath(
      payload.folderPath,
      payload.filePath,
      {
        allowExternalSymlinks: true,
        allowOutsideRoot: payload.allowExternalReference === true,
      },
    );
    const error = await shell.openPath(filePath);
    if (error) throw new Error(`Could not open "${payload.filePath}": ${error}`);
    return true;
  });
  applicationIpc.handle('files:reveal', (_event, payload = {}) => {
    shell.showItemInFolder(resolveWorkspacePath(
      payload.folderPath,
      payload.filePath,
      {
        allowExternalSymlinks: true,
        allowOutsideRoot: payload.allowExternalReference === true,
      },
    ));
    return true;
  });
  applicationIpc.handle('files:copy-path', (_event, payload = {}) => {
    clipboard.writeText(resolveWorkspacePath(
      payload.folderPath,
      payload.filePath,
      {
        allowExternalSymlinks: true,
        allowOutsideRoot: payload.allowExternalReference === true,
      },
    ));
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
    const folders = new Map([
      ...pluginContextRoots().map((plugin) => [plugin.path.toLowerCase(), {
        path: plugin.path,
        name: plugin.name,
        displayPath: `Plugin: ${plugin.id}`,
      }]),
      [globalPath.toLowerCase(), {
        path: globalPath,
        name: 'Global',
        displayPath: '~/.agents',
      }],
    ]);
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
    const pluginRoot = pluginContextRoots().find((item) => resolve(item.path) === resolve(folderPath));
    const scope = pluginRoot
      ? 'plugin'
      : resolve(folderPath) === resolve(installationPath) ? 'installation' : 'folder';
    traceVerbose('context.folder-opened', { operation: 'context:folder', scope });
    try {
      const result = await listContextItems(folderPath, {
        includeRootCatalog: scope === 'installation' || scope === 'plugin',
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
      { path: installationPath, scope: 'installation', includeRootCatalog: true },
      ...pluginContextRoots().map((plugin) => ({
        path: plugin.path,
        scope: 'plugin',
        includeRootCatalog: true,
      })),
    ]
      .filter((root, index, items) => (
        root
        && items.findIndex((item) => item?.path.toLowerCase() === root.path.toLowerCase()) === index
      ));
    const contexts = await Promise.all(roots.map((root) => listContextItems(root.path, {
      includeRootCatalog: root.includeRootCatalog === true,
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
  const shellName = terminalShell.executable
    .replaceAll('\\', '/')
    .split('/')
    .at(-1)
    .toLowerCase()
    .replace(/\.exe$/, '');

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
      child.once('error', () => { });
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
  const child = process.platform === 'win32'
    ? spawn(process.env.ComSpec || 'cmd.exe', [
      '/d',
      '/s',
      '/c',
      'start',
      '',
      '/D',
      folderPath,
      terminalShell.executable,
      ...args,
    ], {
      cwd: folderPath,
      detached: true,
      env: process.env,
      shell: false,
      stdio: 'ignore',
      windowsHide: true,
    })
    : spawn(terminalShell.executable, args, {
      cwd: folderPath,
      detached: process.platform === 'linux',
      env: process.env,
      shell: false,
      windowsHide: false,
    });
  if (process.platform === 'win32' || process.platform === 'linux') child.unref();
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
    return {
      ...conversation,
      gitBranch: project.gitBranch,
      workStatus: chatRunner?.isConversationBlocked(conversation.id) ? 'blocked' : null,
    };
  });
}

function refreshConversationProject(conversation) {
  if (!conversation) return conversation;
  const project = inspectProjectFolder(conversation.projectPath);
  return { ...conversation, gitBranch: project.gitBranch };
}
