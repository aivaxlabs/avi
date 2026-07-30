import Electrobun, {
  BrowserView,
  BrowserWindow,
  Utils,
} from 'electrobun/bun';
import { spawnSync } from 'node:child_process';
import {
  appendFile,
  mkdir,
  readFile,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import {
  basename,
  isAbsolute,
  join,
  relative,
  resolve,
} from 'node:path';
import packageMetadata from '../../package.json' with { type: 'json' };
import {
  closeDatabase,
  createConversation,
  deleteConversation,
  deleteProviderCredentials,
  forkConversation,
  flushSecureStorage,
  getConversation,
  getMessages,
  getPreferences,
  getProviderCredentials,
  initializeSecureStorage,
  listAllConversations,
  listConversations,
  listFavorites,
  listProviders,
  listSideChats,
  listSubagents,
  searchChats,
  setFavorite,
  setProviderCredentials,
  setProviders,
  setTuningSettings,
  updateConversation,
} from './database.js';
import { ChatRunner } from './chat-runner.js';
import { stopConversationTerminals } from './client-tools.js';
import { listContextItems } from './context-injection.js';
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
import {
  listInstalledTerminalShells,
  resolveTerminalShell,
} from './terminal-shell.js';
import { providerTypes } from '../providers/index.js';

const ipcHandlers = new Map();
const ipcMain = {
  handle(channel, handler) {
    ipcHandlers.set(channel, handler);
  },
};
const providerRegistry = new ModelProviderRegistry({
  getProviders: listProviders,
  providerTypes,
  services: {
    credentials: {
      get: getProviderCredentials,
      set: setProviderCredentials,
      delete: deleteProviderCredentials,
    },
    clipboard: {
      writeText: Utils.clipboardWriteText,
    },
    shell: {
      openExternal: Utils.openExternal,
    },
  },
});
let mainWindow;
let chatRunner;
let mcpManager;
let shutdownStarted = false;
let shutdownReady = false;

await initializeSecureStorage();
registerIpc();

const rpc = BrowserView.defineRPC({
  maxRequestTime: Infinity,
  handlers: {
    requests: {
      invoke: ({ channel, payload }) => {
        const handler = ipcHandlers.get(channel);
        if (!handler) throw new Error(`Unknown application request: ${channel}`);
        return handler(undefined, payload);
      },
    },
    messages: {},
  },
});

createWindow();

Electrobun.events.on('before-quit', (event) => {
  if (shutdownReady) return;
  event.response = { allow: false };
  if (shutdownStarted) return;
  shutdownStarted = true;
  Promise.resolve(chatRunner?.shutdown())
    .then(() => mcpManager?.closeAll())
    .then(() => flushSecureStorage())
    .catch((error) => console.error('Shutdown failed:', error))
    .finally(() => {
      closeDatabase();
      shutdownReady = true;
      Utils.quit();
    });
});

function createWindow() {
  const nativeWindow = getNativeWindowOptions();
  const smokeTest = process.env.CHAT_APP_SMOKE_TEST === '1';

  mainWindow = new BrowserWindow({
    title: 'Avi',
    url: process.env.VITE_DEV_SERVER_URL || 'views://mainview/index.html',
    rpc,
    frame: {
      x: 160,
      y: 100,
      width: 1180,
      height: 780,
    },
    titleBarStyle: nativeWindow.titleBarStyle,
    transparent: nativeWindow.transparent,
    hidden: true,
    renderer: 'native',
  });

  mainWindow.webview.on('dom-ready', () => {
    if (smokeTest) return;

    // Electrobun 1.18.1 initially sizes the WebView from the outer window frame
    // when using a native title bar. Force its resize handler before showing the
    // window; remove this after Electrobun derives the initial client-area size.
    const { width, height } = mainWindow.getSize();
    mainWindow.setSize(width, height + 1);
    mainWindow.setSize(width, height);
    mainWindow.show();
  });

  if (!mcpManager) {
    mcpManager = new McpManager({
      sendEvent: (payload) => {
        rpc.send.event({ channel: 'mcp:event', payload });
      },
      openExternal: (url) => Utils.openExternal(url),
    });
    mcpManager.initializeGlobal().catch((error) => {
      rpc.send.event({
        channel: 'mcp:event',
        payload: {
          type: 'configuration-error',
          message: error instanceof Error ? error.message : String(error),
        },
      });
    });
  }
  if (!chatRunner) {
    chatRunner = new ChatRunner({
      registry: providerRegistry,
      mcpManager,
      getPreferences,
      sendEvent: (payload) => {
        rpc.send.event({ channel: 'chat:event', payload });
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
      console.error('Avi smoke test timed out.');
      process.exitCode = 1;
      Utils.quit();
    }, 15000);
    mainWindow.webview.on('dom-ready', async () => {
      clearTimeout(smokeTimeout);
      const smokePassed = await mainWindow.webview.rpc.request.evaluateJavascriptWithResponse({
        script: `
          return new Promise(async (resolve) => {
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
                const sidebarLogo = document.querySelector('.app-name img');
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
                const mcpPassed = Boolean(
                  document.querySelector('.mcp-settings')
                  && document.querySelector('.settings-page-header .settings-inline-back')
                  && !document.querySelector('.settings-content .settings-inline-back')
                  && saveButtonRect?.height <= 36
                  && getComputedStyle(saveButton).whiteSpace === 'nowrap'
                );
                const aboutButton = [...document.querySelectorAll('.settings-navigation button')]
                  .find((button) => button.textContent.includes('About'));
                aboutButton?.click();
                while (
                  Date.now() < deadline
                  && !document.querySelector('.settings-about')
                ) {
                  await new Promise((next) => window.setTimeout(next, 50));
                }
                const aboutLogo = document.querySelector('.settings-about-logo');
                const aboutLinks = [...document.querySelectorAll('.settings-about-link')];
                const aboutText = document.querySelector('.settings-about')?.textContent ?? '';
                resolve(Boolean(
                  mcpPassed
                  && aboutLogo?.complete
                  && aboutLogo?.naturalWidth > 0
                  && (
                    !sidebarLogo
                    || (sidebarLogo.complete && sidebarLogo.naturalWidth > 0)
                  )
                  && aboutText.includes('Avi')
                  && aboutText.includes(${JSON.stringify(packageMetadata.version)})
                  && aboutLinks.some((link) => link.href === 'https://avi.aivax.net/')
                  && aboutLinks.some((link) => link.href === 'https://github.com/aivaxlabs/avi')
                ));
              } else if (Date.now() >= deadline) {
                resolve(false);
              } else {
                window.setTimeout(check, 50);
              }
            };
            check();
          });
        `,
      });
      console.log(smokePassed ? 'Avi smoke test passed.' : 'Avi smoke test failed.');
      process.exitCode = smokePassed ? 0 : 1;
      Utils.quit();
    });
  }

  if (process.env.CHAT_APP_OPEN_DEVTOOLS === '1') {
    mainWindow.webview.on('dom-ready', () => {
      mainWindow.webview.openDevTools();
    });
  }
}

function getNativeWindowOptions() {
  return {
    transparent: false,
    titleBarStyle: 'default',
  };
}

function registerIpc() {
  ipcMain.handle('app:state', () => ({
    ...getPreferences(),
    platform: process.platform,
    defaultProject: inspectProjectFolder(homedir()),
    windowMaterial: getNativeWindowOptions().backgroundMaterial ?? null,
  }));
  ipcMain.handle('app:open-external', (_event, url) => {
    const target = new URL(url);
    if (target.protocol !== 'https:') throw new Error('Only HTTPS links can be opened.');
    return Utils.openExternal(target.href);
  });
  ipcMain.handle('tuning:shells', () => {
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
  ipcMain.handle('tuning:save', (_event, tuning) => {
    resolveTerminalShell(process.env, process.platform, tuning?.terminalShell);
    return setTuningSettings(tuning);
  });

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
  ipcMain.handle('orchestration:overview', () => {
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
  ipcMain.handle('goals:start', async (_event, payload = {}) => {
    const result = await chatRunner.startGoal({
      ...payload,
      sendInitialPrompt: true,
    });
    return {
      ...result,
      conversation: refreshConversationProject(result.conversation),
    };
  });
  ipcMain.handle('goals:change', async (_event, payload = {}) => {
    const result = await chatRunner.changeGoal(payload);
    return {
      result,
      conversation: refreshConversationProject(getConversation(payload.conversationId)),
    };
  });
  ipcMain.handle('goals:resume', () => {
    chatRunner.resumeGoals();
    return true;
  });

  ipcMain.handle('files:select', async () => {
    const filePaths = await Utils.openFileDialog({
      startingFolder: homedir(),
      canChooseFiles: true,
      canChooseDirectory: false,
      allowsMultipleSelection: true,
    });
    return filePaths.filter(Boolean).map(filePathToAttachment);
  });
  ipcMain.handle('files:workspace', (_event, folderPath) => (
    inspectWorkspaceFiles(folderPath)
  ));
  ipcMain.handle('files:directory', (_event, payload = {}) => (
    listWorkspaceDirectory(payload.folderPath, payload.directoryPath)
  ));
  ipcMain.handle('files:read', (_event, payload = {}) => (
    readWorkspaceFile(payload.folderPath, payload.filePath)
  ));
  ipcMain.handle('files:search', (_event, payload = {}) => (
    searchWorkspaceFiles(payload.folderPath, payload.query)
  ));
  ipcMain.handle('files:open', (_event, payload = {}) => {
    const filePath = resolveWorkspacePath(payload.folderPath, payload.filePath);
    if (!Utils.openPath(filePath)) throw new Error(`Could not open "${payload.filePath}".`);
    return true;
  });
  ipcMain.handle('files:reveal', (_event, payload = {}) => {
    Utils.showItemInFolder(resolveWorkspacePath(payload.folderPath, payload.filePath));
    return true;
  });
  ipcMain.handle('files:copy-path', (_event, payload = {}) => {
    Utils.clipboardWriteText(resolveWorkspacePath(payload.folderPath, payload.filePath));
    return true;
  });
  ipcMain.handle('projects:select', async (_event, payload = {}) => {
    const [folderPath] = await Utils.openFileDialog({
      startingFolder: payload.defaultPath || homedir(),
      canChooseFiles: false,
      canChooseDirectory: true,
      allowsMultipleSelection: false,
    });
    return folderPath ? inspectProjectFolder(folderPath) : null;
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
    if (!Utils.openPath(resolve(targetPath))) {
      throw new Error(`Could not open "${targetPath}".`);
    }
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
