import { app, BrowserWindow, dialog, ipcMain, nativeTheme } from 'electron';
import { dirname, join } from 'node:path';
import { release } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  cacheModels,
  createConversation,
  deleteConversation,
  forkConversation,
  getMessages,
  getSession,
  listCachedModels,
  listConversations,
  listFavorites,
  logout,
  paths,
  saveLogin,
  searchChats,
  setFavorite,
  updateConversation,
} from './database.js';
import { fetchBalance, fetchModels, login } from './aivax-api.js';
import { filePathToAttachment } from './files.js';
import { ChatRunner } from './chat-runner.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
let mainWindow;
let chatRunner;

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
    minWidth: 940,
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
  });

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
  ipcMain.handle('conversations:fork', (_event, conversationId) => forkConversation(conversationId));
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

  ipcMain.handle('chat:send', (_event, payload) => chatRunner.send(payload));
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
}
