import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  nativeTheme,
  shell,
} from 'electron';
import { spawnSync } from 'node:child_process';
import {
  appendFile,
  mkdir,
  readFile,
  writeFile,
} from 'node:fs/promises';
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
  closeDatabase,
  createConversation,
  deleteConversation,
  deleteProviderCredentials,
  forkConversation,
  getConversation,
  getMessages,
  getPreferences,
  getProviderCredentials,
  listConversations,
  listFavorites,
  listProviders,
  listSideChats,
  listSubagents,
  searchChats,
  setFavorite,
  setProviderCredentials,
  setProviders,
  updateConversation,
} from './database.js';
import { ChatRunner } from './chat-runner.js';
import { stopConversationTerminals } from './client-tools.js';
import { listContextItems } from './context-injection.js';
import { filePathToAttachment } from './files.js';
import { ModelProviderRegistry } from './model-provider.js';
import { McpManager } from './mcp-manager.js';
import { providerTypes } from '../providers/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const appIconPath = join(
  __dirname,
  process.platform === 'win32' ? '../../assets/icon/aivchat.ico' : '../../assets/icon/aivchat.png',
);
const providerRegistry = new ModelProviderRegistry({
  getProviders: listProviders,
  providerTypes,
  services: {
    credentials: {
      get: getProviderCredentials,
      set: setProviderCredentials,
      delete: deleteProviderCredentials,
    },
    clipboard,
    shell,
  },
});
let mainWindow;
let chatRunner;
let mcpManager;
let shutdownStarted = false;
let shutdownReady = false;

app.setName('AIVAX');
if (process.env.CHAT_APP_SMOKE_PROFILE) {
  app.setPath('userData', resolve(process.env.CHAT_APP_SMOKE_PROFILE));
}

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

app.on('before-quit', (event) => {
  if (shutdownReady) return;
  event.preventDefault();
  if (shutdownStarted) return;
  shutdownStarted = true;
  Promise.resolve(chatRunner?.shutdown())
    .then(() => mcpManager?.closeAll())
    .catch((error) => console.error('Shutdown failed:', error))
    .finally(() => {
      closeDatabase();
      shutdownReady = true;
      app.quit();
    });
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

  if (!mcpManager) {
    mcpManager = new McpManager({
      sendEvent: (payload) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('mcp:event', payload);
        }
      },
      openExternal: (url) => shell.openExternal(url),
    });
    mcpManager.initializeGlobal().catch((error) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('mcp:event', {
          type: 'configuration-error',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    });
  }
  if (!chatRunner) {
    chatRunner = new ChatRunner({
      registry: providerRegistry,
      mcpManager,
      sendEvent: (payload) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('chat:event', payload);
        }
      },
      savePermissionGuidance: async ({ workspacePath, invocationSummary }) => {
        const agentsPath = join(homedir(), '.agents');
        const guidancePath = join(agentsPath, 'MEMORY.permissionguidance.md');
        const line = `On folder ${workspacePath || process.cwd()}, user classified tools like ${invocationSummary} are not dangerous and should be always approved`;
        await mkdir(agentsPath, { recursive: true });
        const current = await readFile(guidancePath, 'utf8').catch(() => '');
        if (!current.split(/\r?\n/).includes(line)) {
          await appendFile(
            guidancePath,
            `${current && !current.endsWith('\n') ? '\n' : ''}${line}\n`,
          );
        }
      },
      stopBackgroundTasks: stopConversationTerminals,
      debugStream: process.env.CHAT_APP_OPEN_DEVTOOLS === '1',
    });
  }

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
          const check = async () => {
            const appReady = document.querySelector('.settings-button, .settings-page');
            const settingsReady = models.length > 0 || document.querySelector('.settings-page');
            if (appReady && settingsReady) {
              document.querySelector('.settings-button')?.click();
              await new Promise((next) => window.setTimeout(next, 50));
              const mcpButton = [...document.querySelectorAll('.settings-navigation button')]
                .find((button) => button.textContent.includes('MCP servers'));
              mcpButton?.click();
              while (
                Date.now() < deadline
                && !document.querySelector('.mcp-settings .settings-entity-main')
              ) {
                await new Promise((next) => window.setTimeout(next, 50));
              }
              document.querySelector('.mcp-settings .settings-entity-main')?.click();
              while (
                Date.now() < deadline
                && !document.querySelector('.settings-page-header .settings-inline-back')
              ) {
                await new Promise((next) => window.setTimeout(next, 50));
              }
              document.querySelector('.settings-page-header .settings-add-provider')?.click();
              while (
                Date.now() < deadline
                && !document.querySelector('.mcp-editor-actions .primary-mini')
              ) {
                await new Promise((next) => window.setTimeout(next, 50));
              }
              const saveButton = document.querySelector('.mcp-editor-actions .primary-mini');
              const saveButtonRect = saveButton?.getBoundingClientRect();
              resolve(Boolean(
                document.querySelector('.mcp-settings')
                && document.querySelector('.settings-page-header .settings-inline-back')
                && !document.querySelector('.settings-content .settings-inline-back')
                && saveButtonRect?.height <= 36
                && getComputedStyle(saveButton).whiteSpace === 'nowrap'
              ));
            } else if (Date.now() >= deadline) {
              resolve(false);
            } else {
              window.setTimeout(check, 50);
            }
          };
          check();
        })
      `);
      if (smokePassed && process.env.CHAT_APP_SMOKE_SCREENSHOT) {
        mainWindow.show();
        await new Promise((resolveCapture) => setTimeout(resolveCapture, 150));
        const image = await mainWindow.webContents.capturePage();
        await writeFile(resolve(process.env.CHAT_APP_SMOKE_SCREENSHOT), image.toPNG());
      }
      console.log(smokePassed ? 'Chat app smoke test passed.' : 'Chat app smoke test failed.');
      await mcpManager.closeAll();
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
    chatRunner.stop(conversationId, { includeSubagents: true });
    for (const sideChat of listSideChats(conversationId)) {
      chatRunner.stop(sideChat.id);
    }
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
  ipcMain.handle('side-chats:list', (_event, parentConversationId) => (
    listSideChats(parentConversationId).map(refreshConversationProject)
  ));
  ipcMain.handle('side-chats:create', (_event, { parentConversationId } = {}) => {
    const parent = getConversation(parentConversationId);
    if (!parent || parent.isSideChat || parent.isSubagent) return null;
    const result = forkConversation(parent.id, { sideChat: true });
    return result
      ? { ...result, conversation: refreshConversationProject(result.conversation) }
      : null;
  });
  ipcMain.handle('side-chats:close', (_event, sideChatId) => {
    const sideChat = getConversation(sideChatId);
    if (!sideChat?.isSideChat) return false;
    chatRunner.stop(sideChat.id);
    deleteConversation(sideChat.id, { hard: true });
    return true;
  });
  ipcMain.handle('subagents:list', (_event, parentConversationId) => (
    listSubagents(parentConversationId).map(refreshConversationProject)
  ));

  ipcMain.handle('providers:list', () => listProviders());
  ipcMain.handle('providers:types', () => providerRegistry.listTypes());
  ipcMain.handle('providers:save', (_event, payload) => {
    const provider = providerRegistry.normalizeConfig(payload);
    const providers = listProviders();
    const index = providers.findIndex((item) => item.id === provider.id);
    return setProviders(index < 0
      ? [...providers, provider]
      : providers.map((item) => item.id === provider.id ? provider : item));
  });
  ipcMain.handle('providers:remove', async (_event, providerId) => {
    const providers = listProviders();
    await providerRegistry.remove(providerId);
    return setProviders(providers.filter((provider) => provider.id !== providerId));
  });
  ipcMain.handle('providers:state', (_event, providerId) => providerRegistry.getState(providerId));
  ipcMain.handle('providers:action', (_event, payload = {}) => (
    providerRegistry.invokeAction(payload.providerId, payload.action, payload.input)
  ));
  ipcMain.handle('providers:auxiliary-panels', (_event, payload = {}) => {
    const conversation = payload.conversationId
      ? getConversation(payload.conversationId)
      : null;
    return providerRegistry.listAuxiliaryPanels({
      conversation,
      workspacePath: conversation?.projectPath ?? null,
    });
  });
  ipcMain.handle('providers:auxiliary-panel', (_event, payload = {}) => {
    const conversation = payload.conversationId
      ? getConversation(payload.conversationId)
      : null;
    return providerRegistry.readAuxiliaryPanel(payload.panelId, {
      conversation,
      workspacePath: conversation?.projectPath ?? null,
    });
  });
  ipcMain.handle('providers:auxiliary-panel-action', (_event, payload = {}) => {
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

  ipcMain.handle('models:list', () => providerRegistry.listModels());
  ipcMain.handle('models:favorites', () => listFavorites());
  ipcMain.handle('models:favorite', (_event, { modelId, favorited }) => setFavorite(modelId, favorited));

  ipcMain.handle('mcp:state', () => mcpManager.snapshot());
  ipcMain.handle('mcp:folders', async () => {
    const folderPaths = listConversations().map((conversation) => conversation.projectPath);
    const folders = await mcpManager.listFolders(folderPaths);
    return folders.map((folder) => {
      const project = inspectProjectFolder(folder.path);
      const global = resolve(folder.path) === resolve(homedir());
      return {
        ...folder,
        name: global ? 'Global' : project.name,
        displayPath: global ? '~/.agents' : project.displayPath,
      };
    });
  });
  ipcMain.handle('mcp:folder', (_event, folderPath) => mcpManager.listFolder(folderPath));
  ipcMain.handle('mcp:workspace', (_event, folderPath) => mcpManager.listWorkspace(folderPath));
  ipcMain.handle('mcp:save', (_event, payload = {}) => mcpManager.saveServer(
    payload.folderPath,
    payload.previousName,
    payload.server,
  ));
  ipcMain.handle('mcp:remove', (_event, payload = {}) => (
    mcpManager.removeServer(payload.folderPath, payload.name)
  ));
  ipcMain.handle('mcp:enabled', (_event, payload = {}) => (
    mcpManager.setServerEnabled(payload.serverKey, payload.enabled)
  ));
  ipcMain.handle('mcp:restart', (_event, serverKey) => mcpManager.restartServer(serverKey));
  ipcMain.handle('mcp:restart-all', (_event, folderPath) => mcpManager.restartAll(folderPath));
  ipcMain.handle('mcp:inspect', (_event, serverKey) => mcpManager.inspectServer(serverKey));
  ipcMain.handle('mcp:authenticate', (_event, serverKey) => mcpManager.authenticate(serverKey));

  ipcMain.handle('chat:send', async (_event, payload) => {
    const result = await chatRunner.send(payload);
    return {
      ...result,
      conversation: refreshConversationProject(result.conversation),
    };
  });
  ipcMain.handle('chat:retry', (_event, payload) => chatRunner.retry(payload));
  ipcMain.handle('chat:resolve-approval', (_event, payload) => chatRunner.resolveApproval(payload));
  ipcMain.handle('chat:answer-question', (_event, payload) => chatRunner.answerQuestion(payload));
  ipcMain.handle('chat:compress', (_event, payload) => chatRunner.compress({
    conversationId: payload?.conversationId,
    model: payload?.model,
  }));
  ipcMain.handle('chat:cancel-queued', (_event, payload) => chatRunner.cancelQueuedMessage(payload));
  ipcMain.handle('chat:reorder-queued', (_event, payload) => chatRunner.reorderQueuedMessages(payload));
  ipcMain.handle('chat:stop', (_event, conversationId) => {
    chatRunner.stop(conversationId, { includeSubagents: true });
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
  ipcMain.handle('context:folders', async () => {
    const globalPath = join(homedir(), '.agents');
    const folders = new Map([
      [globalPath.toLowerCase(), {
        path: globalPath,
        name: 'Global',
        displayPath: '~/.agents',
      }],
    ]);
    for (const conversation of listConversations()) {
      const project = inspectProjectFolder(conversation.projectPath);
      if (!folders.has(project.path.toLowerCase())) {
        folders.set(project.path.toLowerCase(), project);
      }
    }

    return Promise.all([...folders.values()].map(async (folder) => {
      const { itemCount, tokenCount } = await listContextItems(folder.path);
      return { ...folder, itemCount, tokenCount };
    }));
  });
  ipcMain.handle('context:folder', (_event, folderPath) => (
    listContextItems(folderPath)
  ));
  ipcMain.handle('context:commands', async (_event, folderPath) => {
    const globalPath = join(homedir(), '.agents');
    const roots = [resolve(folderPath || homedir()), globalPath]
      .filter((root, index, items) => (
        items.findIndex((item) => item.toLowerCase() === root.toLowerCase()) === index
      ));
    const contexts = await Promise.all(roots.map((root) => listContextItems(root)));
    const commands = new Map();

    for (const command of contexts.flatMap((context) => context.commands)) {
      if (!commands.has(command.id)) commands.set(command.id, command);
    }

    return [...commands.values()];
  });
  ipcMain.handle('context:open', async (_event, targetPath) => {
    const error = await shell.openPath(resolve(targetPath));
    if (error) throw new Error(error);
    return true;
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
