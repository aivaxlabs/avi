const { contextBridge, ipcRenderer } = require('electron');

const fatalErrorText = (value) => {
  if (value && typeof value === 'object') {
    if (typeof value.stack === 'string') return value.stack;
    if (typeof value.message === 'string') return value.message;
  }
  return String(value);
};
const reportRendererFatal = (type, operation, error) => {
  try {
    ipcRenderer.send('avi:renderer-fatal', {
      type,
      operation,
      error: fatalErrorText(error),
    });
  } catch {
    // Fatal reporting must not cause another renderer failure.
  }
};

process.on('uncaughtException', (error) => {
  reportRendererFatal('preload-uncaught-exception', 'preload', error);
});
process.on('unhandledRejection', (reason) => {
  reportRendererFatal('preload-unhandled-rejection', 'preload', reason);
});

const invoke = async (channel, payload) => {
  const response = await ipcRenderer.invoke('avi:invoke', { channel, payload });
  if (response?.ok) return response.value;
  const error = new Error(response?.error?.message ?? 'Application request failed.');
  error.name = response?.error?.name ?? 'Error';
  if (response?.error?.code !== undefined) error.code = response.error.code;
  if (response?.error?.status !== undefined) error.status = response.error.status;
  throw error;
};
const subscribe = (channel, callback) => {
  if (typeof callback !== 'function') throw new TypeError('Event callback must be a function.');
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('chatApp', {
  diagnostics: {
    reportWindowError: (error) => reportRendererFatal(
      'window-error',
      'window.error',
      error,
    ),
    reportWindowRejection: (error) => reportRendererFatal(
      'window-unhandled-rejection',
      'window.unhandledrejection',
      error,
    ),
    reportReactFatal: (error) => reportRendererFatal(
      'react-uncaught-error',
      'react.render',
      error,
    ),
  },
  app: {
    state: () => invoke('app:state'),
    openExternal: (url) => invoke('app:open-external', url),
    favicon: (url) => invoke('app:favicon', url),
    onNavigate: (callback) => subscribe('app:navigate', callback),
  },
  quickChat: {
    open: () => invoke('quick-chat:open'),
    state: (sessionId) => invoke('quick-chat:state', sessionId),
    send: (payload) => invoke('quick-chat:send', payload),
    stop: (sessionId) => invoke('quick-chat:stop', sessionId),
    answerQuestion: (payload) => invoke('quick-chat:answer-question', payload),
    onEvent: (callback) => subscribe('quick-chat:event', callback),
  },
  appearance: {
    selectBackground: () => invoke('appearance:select-background'),
    background: (fileName) => invoke('appearance:background', fileName),
    removeBackground: () => invoke('appearance:remove-background'),
  },
  desktop: {
    save: (settings) => invoke('desktop:save', settings),
  },
  defaultModels: {
    status: () => invoke('default-models:status'),
    save: (settings) => invoke('default-models:save', settings),
  },
  aivax: {
    state: () => invoke('aivax:state'),
    connect: (loginKey) => invoke('aivax:connect', loginKey),
    disconnect: () => invoke('aivax:disconnect'),
    save: (settings) => invoke('aivax:save', settings),
    collections: () => invoke('aivax:collections'),
    createCollection: (name) => invoke('aivax:collections:create', name),
  },
  tuning: {
    shells: () => invoke('tuning:shells'),
    save: (settings) => invoke('tuning:save', settings),
  },
  archive: {
    state: (options) => invoke('archive:state', options),
    save: (settings, options) => invoke('archive:save', settings, options),
    restore: (conversationId, options) => invoke('archive:restore', conversationId, options),
    delete: (conversationId, options) => invoke('archive:delete', conversationId, options),
    maintenance: (options) => invoke('archive:maintenance', options),
    temporaryStorage: () => invoke('archive:temporary-storage'),
    clearTemporaryStorage: () => invoke('archive:clear-temporary-storage'),
  },
  semaphores: {
    state: () => invoke('semaphores:state'),
    reset: (name) => invoke('semaphores:reset', name),
  },
  conversations: {
    list: () => invoke('conversations:list'),
    create: (payload) => invoke('conversations:create', payload),
    update: (payload) => invoke('conversations:update', payload),
    messages: (conversationId) => invoke('conversations:messages', conversationId),
    archive: (conversationId) => invoke('conversations:archive', conversationId),
    delete: (conversationId) => invoke('conversations:delete', conversationId),
    fork: (payload) => invoke('conversations:fork', payload),
    search: (query) => invoke('conversations:search', query),
    setTags: (conversationId, tags) => invoke('conversations:set-tags', { conversationId, tags }),
  },
  tags: {
    save: (tags) => invoke('tags:save', tags),
  },
  folders: {
    saveColor: (payload) => invoke('folders:save-color', payload),
  },
  composerState: {
    get: (conversationId) => invoke('composer-state:get', conversationId),
    save: (payload) => invoke('composer-state:save', payload),
  },
  orchestration: {
    overview: (range) => invoke('orchestration:overview', range),
  },
  sideChats: {
    list: (parentConversationId) => invoke('side-chats:list', parentConversationId),
    create: (payload) => invoke('side-chats:create', payload),
    close: (sideChatId) => invoke('side-chats:close', sideChatId),
  },
  subagents: {
    list: (parentConversationId) => invoke('subagents:list', parentConversationId),
  },
  bots: {
    list: () => invoke('bots:list'),
    create: (payload) => invoke('bots:create', payload),
    update: (payload) => invoke('bots:update', payload),
    delete: (botId) => invoke('bots:delete', botId),
    clearThread: (botId) => invoke('bots:clear-thread', botId),
    activate: (botId) => invoke('bots:activate', botId),
    resolveApproval: (payload) => invoke('bots:resolve-approval', payload),
    chooseFolder: () => invoke('bots:choose-folder'),
  },
  providers: {
    list: () => invoke('providers:list'),
    types: () => invoke('providers:types'),
    normalize: (provider) => invoke('providers:normalize', provider),
    importFromUrl: (url) => invoke('providers:import-from-url', url),
    save: (provider) => invoke('providers:save', provider),
    remove: (providerId) => invoke('providers:remove', providerId),
    state: (providerId) => invoke('providers:state', providerId),
    action: (payload) => invoke('providers:action', payload),
    usages: () => invoke('providers:usages'),
    usage: (usageProviderId) => invoke('providers:usage', usageProviderId),
    resetUsage: (payload) => invoke('providers:usage-reset', payload),
    auxiliaryPanels: (payload) => invoke('providers:auxiliary-panels', payload),
    auxiliaryPanel: (payload) => invoke('providers:auxiliary-panel', payload),
    auxiliaryPanelAction: (payload) => invoke('providers:auxiliary-panel-action', payload),
  },
  routers: {
    list: () => invoke('routers:list'),
    save: (router) => invoke('routers:save', router),
    remove: (routerId) => invoke('routers:remove', routerId),
  },
  models: {
    list: () => invoke('models:list'),
    favorites: () => invoke('models:favorites'),
    favorite: (payload) => invoke('models:favorite', payload),
  },
  plugins: {
    list: () => invoke('plugins:list'),
    sideload: () => invoke('plugins:sideload'),
    setEnabled: (payload) => invoke('plugins:set-enabled', payload),
    remove: (payload) => invoke('plugins:remove', payload),
    docs: () => invoke('plugins:docs'),
    restartAvi: () => invoke('plugins:restart-avi'),
    restoreReload: () => invoke('plugins:restore-reload'),
    completeReload: () => invoke('plugins:complete-reload'),
    create: () => invoke('plugins:create'),
  },
  mcp: {
    state: () => invoke('mcp:state'),
    folders: () => invoke('mcp:folders'),
    folder: (folderPath) => invoke('mcp:folder', folderPath),
    workspace: (folderPath) => invoke('mcp:workspace', folderPath),
    bot: (botId) => invoke('mcp:bot', { botId }),
    save: (payload) => invoke('mcp:save', payload),
    remove: (payload) => invoke('mcp:remove', payload),
    enabled: (payload) => invoke('mcp:enabled', payload),
    restart: (serverKey) => invoke('mcp:restart', serverKey),
    restartAll: (folderPath) => invoke('mcp:restart-all', folderPath),
    inspect: (serverKey) => invoke('mcp:inspect', serverKey),
    authenticate: (serverKey) => invoke('mcp:authenticate', serverKey),
  },
  remote: {
    state: () => invoke('remote:state'),
    save: (settings) => invoke('remote:save', settings),
    regenerateKey: () => invoke('remote:regenerate-key'),
    copyKey: () => invoke('remote:copy-key'),
    removeKey: () => invoke('remote:remove-key'),
  },
  chat: {
    state: () => invoke('chat:state'),
    send: (payload) => invoke('chat:send', payload),
    replaceUserMessage: (payload) => invoke('chat:replace-user-message', payload),
    retry: (payload) => invoke('chat:retry', payload),
    expandPrompt: (payload) => invoke('chat:expand-prompt', payload),
    resolveApproval: (payload) => invoke('chat:resolve-approval', payload),
    answerQuestion: (payload) => invoke('chat:answer-question', payload),
    compress: (payload) => invoke('chat:compress', payload),
    cancelQueued: (payload) => invoke('chat:cancel-queued', payload),
    reorderQueued: (payload) => invoke('chat:reorder-queued', payload),
    runSemaphoreNow: (conversationId) => invoke('chat:run-semaphore-now', conversationId),
    cancelSemaphore: (conversationId) => invoke('chat:cancel-semaphore', conversationId),
    stop: (conversationId) => invoke('chat:stop', conversationId),
  },
  tasks: {
    list: (conversationId) => invoke('tasks:list', conversationId),
  },
  goals: {
    start: (payload) => invoke('goals:start', payload),
    change: (payload) => invoke('goals:change', payload),
    resume: () => invoke('goals:resume'),
  },
  files: {
    select: () => invoke('files:select'),
    workspace: (folderPath) => invoke('files:workspace', folderPath),
    directory: (payload) => invoke('files:directory', payload),
    read: (payload) => invoke('files:read', payload),
    diff: (payload) => invoke('files:diff', payload),
    search: (payload) => invoke('files:search', payload),
    open: (payload) => invoke('files:open', payload),
    reveal: (payload) => invoke('files:reveal', payload),
    copyPath: (payload) => invoke('files:copy-path', payload),
  },
  gitReview: {
    state: (conversationId) => invoke('git-review:state', conversationId),
    plan: (payload) => invoke('git-review:plan', payload),
    commit: (payload) => invoke('git-review:commit', payload),
    push: (payload) => invoke('git-review:push', payload),
  },
  attachments: {
    imageAction: (payload) => invoke('attachments:image-action', payload),
  },
  projects: {
    select: (payload) => invoke('projects:select', payload),
  },
  context: {
    folders: () => invoke('context:folders'),
    folder: (folderPath) => invoke('context:folder', folderPath),
    commands: (folderPath) => invoke('context:commands', folderPath),
    open: (targetPath) => invoke('context:open', targetPath),
  },
  shell: {
    openTerminal: (targetPath) => invoke('shell:open-terminal', targetPath),
  },
  onChatEvent: (callback) => subscribe('chat:event', callback),
  onMcpEvent: (callback) => subscribe('mcp:event', callback),
  onBotsEvent: (callback) => subscribe('bots:event', callback),
});
