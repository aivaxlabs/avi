import { app, BrowserWindow, dialog, ipcMain, nativeTheme } from 'electron';
import { spawnSync } from 'node:child_process';
import { homedir, release } from 'node:os';
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createConversation,
  deleteConversation,
  forkConversation,
  getMessages,
  getPreferences,
  listConversations,
  listFavorites,
  listProviders,
  searchChats,
  setFavorite,
  setProviders,
  updateConversation,
} from './database.js';
import { filePathToAttachment } from './files.js';
import { ChatRunner } from './chat-runner.js';
import {
  ModelProviderRegistry,
  normalizeProviderConfig,
} from './model-provider.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const appIconPath = join(
  __dirname,
  process.platform === 'win32' ? '../../assets/icon/aivchat.ico' : '../../assets/icon/aivchat.png',
);
const providerRegistry = new ModelProviderRegistry(listProviders);
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
  const smokeTest = process.env.CHAT_APP_SMOKE_TEST === '1';

  mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 560,
    minHeight: 640,
    show: !smokeTest,
    frame: false,
    icon: appIconPath,
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
    registry: providerRegistry,
    sendEvent: (payload) => mainWindow?.webContents.send('chat:event', payload),
    debugStream: process.env.CHAT_APP_OPEN_DEVTOOLS === '1',
  });

  if (smokeTest) {
    const smokeTimeout = setTimeout(() => {
      console.error('Chat app smoke test timed out.');
      app.exit(1);
    }, 15000);
    mainWindow.webContents.once('did-finish-load', async () => {
      clearTimeout(smokeTimeout);
      const smokePassed = await mainWindow.webContents.executeJavaScript(`
        new Promise(async (resolve) => {
          let models;
          try {
            models = await window.chatApp?.models.list();
          } catch {
            resolve(false);
            return;
          }
          if (!Array.isArray(models)) {
            resolve(false);
            return;
          }
          const deadline = Date.now() + 5000;
          const check = () => {
            const appReady = document.querySelector('.settings-button, .settings-page');
            const settingsReady = models.length > 0 || document.querySelector('.settings-page');
            if (appReady && settingsReady) {
              resolve(true);
            } else if (Date.now() >= deadline) {
              resolve(false);
            } else {
              window.setTimeout(check, 50);
            }
          };
          check();
        })
      `);
      console.log(smokePassed ? 'Chat app smoke test passed.' : 'Chat app smoke test failed.');
      app.exit(smokePassed ? 0 : 1);
    });
  }

  if (process.env.CHAT_APP_OPEN_DEVTOOLS === '1') {
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
  ipcMain.handle('app:state', () => ({
    ...getPreferences(),
    platform: process.platform,
    defaultProject: inspectProjectFolder(homedir()),
    windowMaterial: getNativeWindowOptions().backgroundMaterial ?? null,
  }));

  ipcMain.handle('conversations:list', () => listConversationsWithProjects());
  ipcMain.handle('conversations:create', (_event, payload = {}) => (
    refreshConversationProject(createConversation(payload))
  ));
  ipcMain.handle('conversations:update', (_event, payload = {}) => (
    refreshConversationProject(updateConversation(payload.id, payload))
  ));
  ipcMain.handle('conversations:messages', (_event, conversationId) => getMessages(conversationId));
  ipcMain.handle('conversations:delete', (_event, conversationId) => {
    chatRunner.stop(conversationId);
    deleteConversation(conversationId);
    return listConversationsWithProjects();
  });
  ipcMain.handle('conversations:fork', (_event, payload) => {
    const conversationId = typeof payload === 'string' ? payload : payload?.conversationId;
    const result = forkConversation(conversationId, {
      throughMessageId: payload?.throughMessageId ?? null,
    });
    return result
      ? { ...result, conversation: refreshConversationProject(result.conversation) }
      : null;
  });
  ipcMain.handle('conversations:search', (_event, query) => searchChats(query));

  ipcMain.handle('providers:list', () => listProviders());
  ipcMain.handle('providers:save', (_event, payload) => {
    const provider = normalizeProviderConfig(payload);
    const providers = listProviders();
    const index = providers.findIndex((item) => item.id === provider.id);
    return setProviders(index < 0
      ? [...providers, provider]
      : providers.map((item) => item.id === provider.id ? provider : item));
  });
  ipcMain.handle('providers:remove', (_event, providerId) => (
    setProviders(listProviders().filter((provider) => provider.id !== providerId))
  ));

  ipcMain.handle('models:list', () => providerRegistry.listModels());
  ipcMain.handle('models:favorites', () => listFavorites());
  ipcMain.handle('models:favorite', (_event, { modelId, favorited }) => setFavorite(modelId, favorited));

  ipcMain.handle('chat:send', async (_event, payload) => {
    const result = await chatRunner.send(payload);
    return {
      ...result,
      conversation: refreshConversationProject(result.conversation),
    };
  });
  ipcMain.handle('chat:retry', (_event, payload) => chatRunner.retry(payload));
  ipcMain.handle('chat:compress', (_event, payload) => chatRunner.compress({
    conversationId: payload?.conversationId,
    model: payload?.model,
  }));
  ipcMain.handle('chat:cancel-queued', (_event, payload) => chatRunner.cancelQueuedMessage(payload));
  ipcMain.handle('chat:reorder-queued', (_event, payload) => chatRunner.reorderQueuedMessages(payload));
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
  ipcMain.handle('projects:select', async (_event, payload = {}) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      defaultPath: payload.defaultPath || homedir(),
      properties: ['openDirectory'],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return inspectProjectFolder(result.filePaths[0]);
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
