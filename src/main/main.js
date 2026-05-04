import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from 'electron';
import { dirname, join } from 'node:path';
import { release } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  addWorkspace,
  cacheModels,
  createConversation,
  deleteConversation,
  forkConversation,
  getActiveWorkspaceId,
  getMessages,
  getSession,
  listWorkspaces,
  listCachedModels,
  listConversations,
  listFavorites,
  logout,
  paths,
  removeWorkspace,
  saveLogin,
  searchChats,
  setFavorite,
  setActiveWorkspace,
  updateConversation,
} from './database.js';
import { fetchBalance, fetchModels, login } from './aivax-api.js';
import { filePathToAttachment } from './files.js';
import { ChatRunner } from './chat-runner.js';
import {
  createDirectory,
  deleteDirectory,
  deleteFile,
  downloadFile,
  getFileDetails,
  getPublicAddress,
  joinRemotePath,
  listDirectory,
  openPublicAddress,
  previewFile,
  selectUploadFiles,
  uploadLocalFile,
  uploadFiles,
} from './workspace-files.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const usageDashboardUrl = 'https://console.aivax.net/dashboard/usage';
let mainWindow;
let chatRunner;
const uploadQueue = {
  items: [],
  currentId: null,
  controller: null,
  running: false,
};

app.setName('AIVAX');

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

app.whenReady().then(() => {
  nativeTheme.themeSource = 'system';
  createWindow();
  registerIpc();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

function createWindow() {
  const nativeWindow = getNativeWindowOptions();

  mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 560,
    minHeight: 640,
    show: process.env.AIVAX_SMOKE_TEST !== '1',
    frame: false,
    ...nativeWindow,
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (nativeWindow.backgroundMaterial && typeof mainWindow.setBackgroundMaterial === 'function') {
    mainWindow.setBackgroundMaterial(nativeWindow.backgroundMaterial);
  }

  chatRunner = new ChatRunner({
    getToken: () => getSession().accessToken,
    sendEvent: (payload) => mainWindow?.webContents.send('chat:event', payload),
    debugStream: process.env.AIVAX_OPEN_DEVTOOLS === '1',
  });
  chatRunner.setWorkspaceGetter(getActiveWorkspaceId);

  if (process.env.AIVAX_SMOKE_TEST === '1') {
    const smokeTimeout = setTimeout(() => {
      console.error('AIVAX smoke timed out.');
      app.exit(1);
    }, 15000);
    mainWindow.webContents.once('did-finish-load', async () => {
      clearTimeout(smokeTimeout);
      const bridgeReady = await mainWindow.webContents.executeJavaScript('Boolean(window.aivax)');
      console.log(bridgeReady ? 'AIVAX smoke OK.' : 'AIVAX smoke failed.');
      app.exit(bridgeReady ? 0 : 1);
    });
  }

  if (process.env.AIVAX_OPEN_DEVTOOLS === '1') {
    mainWindow.webContents.once('did-finish-load', () => {
      mainWindow.webContents.openDevTools({ mode: 'detach' });
    });
  }

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(join(__dirname, '../../dist/index.html'));
  }
}

function getNativeWindowOptions() {
  if (process.platform === 'win32') {
    const build = Number(release().split('.')[2] ?? 0);
    return {
      transparent: false,
      backgroundColor: '#00000000',
      backgroundMaterial: build >= 22000 ? 'tabbed' : 'acrylic',
      roundedCorners: true,
      thickFrame: true,
      titleBarStyle: 'hidden',
    };
  }

  if (process.platform === 'darwin') {
    return {
      transparent: true,
      backgroundColor: '#00000000',
      vibrancy: 'under-window',
      visualEffectState: 'active',
      titleBarStyle: 'hiddenInset',
      roundedCorners: true,
    };
  }

  return {
    transparent: false,
    backgroundColor: '#f8fafc',
    titleBarStyle: 'hidden',
  };
}

function registerIpc() {
  ipcMain.handle('auth:session', () => ({
    ...getSession(),
    paths,
    platform: process.platform,
    windowMaterial: getNativeWindowOptions().backgroundMaterial ?? null,
  }));

  ipcMain.handle('auth:login', async (_event, loginKey) => {
    const result = await login(loginKey);
    saveLogin(result);
    return getSession();
  });

  ipcMain.handle('auth:logout', () => {
    logout();
    return getSession();
  });

  ipcMain.handle('account:balance', async () => {
    const token = getSession().accessToken;
    if (!token) return null;
    return fetchBalance(token);
  });

  ipcMain.handle('conversations:list', () => listConversations());
  ipcMain.handle('conversations:create', (_event, payload = {}) => createConversation(payload));
  ipcMain.handle('conversations:update', (_event, payload = {}) => updateConversation(payload.id, payload));
  ipcMain.handle('conversations:messages', (_event, conversationId) => getMessages(conversationId));
  ipcMain.handle('conversations:delete', (_event, conversationId) => {
    chatRunner.stop(conversationId);
    deleteConversation(conversationId);
    return listConversations();
  });
  ipcMain.handle('conversations:fork', (_event, payload) => {
    const conversationId = typeof payload === 'string' ? payload : payload?.conversationId;
    return forkConversation(conversationId, { throughMessageId: payload?.throughMessageId ?? null });
  });
  ipcMain.handle('conversations:search', (_event, query) => searchChats(query));

  ipcMain.handle('models:list', async () => {
    const token = getSession().accessToken;
    if (!token) return listCachedModels();
    const models = await fetchModels(token);
    cacheModels(models);
    return models;
  });
  ipcMain.handle('models:favorites', () => listFavorites());
  ipcMain.handle('models:favorite', (_event, { modelId, favorited }) => setFavorite(modelId, favorited));

  ipcMain.handle('workspaces:list', () => listWorkspaces());
  ipcMain.handle('workspaces:add', (_event, id) => listWorkspacesWithEvent(addWorkspace(id)));
  ipcMain.handle('workspaces:remove', (_event, id) => listWorkspacesWithEvent(removeWorkspace(id)));
  ipcMain.handle('workspaces:set-active', (_event, id) => listWorkspacesWithEvent(setActiveWorkspace(id)));

  ipcMain.handle('workspace-files:list', (_event, payload = {}) => withWorkspace((token, workspaceId) => (
    listDirectory({ token, workspaceId, path: payload.path ?? '/' })
  )));
  ipcMain.handle('workspace-files:details', (_event, payload = {}) => withWorkspace((token, workspaceId) => (
    getFileDetails({ token, workspaceId, path: payload.path })
  )));
  ipcMain.handle('workspace-files:preview', (_event, payload = {}) => withWorkspace((token, workspaceId) => (
    previewFile({ token, workspaceId, path: payload.path })
  )));
  ipcMain.handle('workspace-files:share', (_event, payload = {}) => withWorkspace((token, workspaceId) => (
    getPublicAddress({ token, workspaceId, path: payload.path })
  )));
  ipcMain.handle('workspace-files:open-share', (_event, publicUrl) => openPublicAddress(publicUrl));
  ipcMain.handle('workspace-files:download', (_event, payload = {}) => withWorkspace((token, workspaceId) => (
    downloadFile({ token, workspaceId, path: payload.path, window: mainWindow })
  )));
  ipcMain.handle('workspace-files:upload', (_event, payload = {}) => withWorkspace((token, workspaceId) => (
    uploadFiles({ token, workspaceId, path: payload.path ?? '/', window: mainWindow })
  )));
  ipcMain.handle('workspace-uploads:start', (_event, payload = {}) => startWorkspaceUpload(payload));
  ipcMain.handle('workspace-uploads:cancel', (_event, id) => cancelWorkspaceUpload(id));
  ipcMain.handle('workspace-uploads:snapshot', () => uploadSnapshot());
  ipcMain.handle('workspace-files:create-directory', (_event, payload = {}) => withWorkspace((token, workspaceId) => (
    createDirectory({ token, workspaceId, path: joinRemotePath(payload.parentPath ?? '/', payload.name) })
  )));
  ipcMain.handle('workspace-files:delete', (_event, payload = {}) => withWorkspace((token, workspaceId) => (
    payload.isDirectory
      ? deleteDirectory({ token, workspaceId, path: payload.path })
      : deleteFile({ token, workspaceId, path: payload.path })
  )));

  ipcMain.handle('chat:send', (_event, payload) => chatRunner.send(payload));
  ipcMain.handle('chat:retry', (_event, payload) => chatRunner.retry(payload));
  ipcMain.handle('chat:cancel-queued', (_event, payload) => chatRunner.cancelQueuedMessage(payload));
  ipcMain.handle('chat:stop', (_event, conversationId) => {
    chatRunner.stop(conversationId);
    return true;
  });

  ipcMain.handle('files:select', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'multiSelections'],
    });
    if (result.canceled) return [];
    return result.filePaths.map(filePathToAttachment);
  });

  ipcMain.handle('window:minimize', () => mainWindow?.minimize());
  ipcMain.handle('window:maximize', () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  });
  ipcMain.handle('window:close', () => mainWindow?.close());
  ipcMain.handle('window:open-usage-dashboard', () => shell.openExternal(usageDashboardUrl));
}

function listWorkspacesWithEvent(state) {
  mainWindow?.webContents.send('chat:event', { type: 'workspaces', state });
  return state;
}

function withWorkspace(action) {
  const token = getSession().accessToken;
  const workspaceId = getActiveWorkspaceId();
  if (!token) {
    throw new Error('Login is required.');
  }
  if (!workspaceId) {
    throw new Error('Select a workspace first.');
  }
  return action(token, workspaceId);
}

async function startWorkspaceUpload({ path = '/' } = {}) {
  const token = getSession().accessToken;
  const workspaceId = getActiveWorkspaceId();
  if (!token) {
    throw new Error('Login is required.');
  }
  if (!workspaceId) {
    throw new Error('Select a workspace first.');
  }
  const files = await selectUploadFiles({ window: mainWindow });
  if (files.length === 0) return uploadSnapshot();
  for (const file of files) {
    uploadQueue.items.push({
      id: crypto.randomUUID(),
      workspaceId,
      basePath: path,
      remotePath: joinRemotePath(path, file.name),
      filePath: file.filePath,
      name: file.name,
      size: file.size,
      status: 'queued',
      error: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }
  emitUploadQueue();
  processUploadQueue();
  return uploadSnapshot();
}

function cancelWorkspaceUpload(id) {
  const item = uploadQueue.items.find((current) => current.id === id);
  if (!item || !['queued', 'uploading'].includes(item.status)) {
    return uploadSnapshot();
  }
  if (item.status === 'uploading' && uploadQueue.currentId === id && uploadQueue.controller) {
    uploadQueue.controller.abort('cancelled');
    return uploadSnapshot();
  }
  item.status = 'cancelled';
  item.error = 'Cancelled';
  item.updatedAt = new Date().toISOString();
  emitUploadQueue();
  return uploadSnapshot();
}

async function processUploadQueue() {
  if (uploadQueue.running) return;
  uploadQueue.running = true;
  try {
    while (true) {
      const next = uploadQueue.items.find((item) => item.status === 'queued');
      if (!next) break;
      next.status = 'uploading';
      next.updatedAt = new Date().toISOString();
      uploadQueue.currentId = next.id;
      uploadQueue.controller = new AbortController();
      emitUploadQueue();
      try {
        await uploadLocalFile({
          token: getSession().accessToken,
          workspaceId: next.workspaceId,
          remotePath: next.remotePath,
          filePath: next.filePath,
          signal: uploadQueue.controller.signal,
        });
        next.status = 'completed';
      } catch (error) {
        next.status = uploadQueue.controller.signal.aborted ? 'cancelled' : 'error';
        next.error = uploadQueue.controller.signal.aborted
          ? 'Cancelled'
          : error instanceof Error ? error.message : String(error);
      } finally {
        next.updatedAt = new Date().toISOString();
        uploadQueue.currentId = null;
        uploadQueue.controller = null;
        emitUploadQueue();
      }
    }
  } finally {
    uploadQueue.running = false;
    emitUploadQueue();
  }
}

function uploadSnapshot() {
  return {
    running: uploadQueue.running,
    currentId: uploadQueue.currentId,
    items: uploadQueue.items.map(({ filePath, ...item }) => item),
  };
}

function emitUploadQueue() {
  mainWindow?.webContents.send('chat:event', { type: 'workspace-uploads', state: uploadSnapshot() });
}
