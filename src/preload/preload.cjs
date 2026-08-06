const { contextBridge, ipcRenderer } = require('electron');

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
  app: {
    state: () => invoke('app:state'),
    openExternal: (url) => invoke('app:open-external', url),
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
  desktop: {
    save: (settings) => invoke('desktop:save', settings),
  },
  defaultModels: {
    status: () => invoke('default-models:status'),
    save: (settings) => invoke('default-models:save', settings),
  },
  tuning: {
    shells: () => invoke('tuning:shells'),
    save: (settings) => invoke('tuning:save', settings),
  },
  archive: {
    state: (query) => invoke('archive:state', query),
    save: (settings) => invoke('archive:save', settings),
    restore: (conversationId) => invoke('archive:restore', conversationId),
    delete: (conversationId) => invoke('archive:delete', conversationId),
    maintenance: () => invoke('archive:maintenance'),
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
  providers: {
    list: () => invoke('providers:list'),
    types: () => invoke('providers:types'),
    save: (provider) => invoke('providers:save', provider),
    remove: (providerId) => invoke('providers:remove', providerId),
    state: (providerId) => invoke('providers:state', providerId),
    action: (payload) => invoke('providers:action', payload),
    auxiliaryPanels: (payload) => invoke('providers:auxiliary-panels', payload),
    auxiliaryPanel: (payload) => invoke('providers:auxiliary-panel', payload),
    auxiliaryPanelAction: (payload) => invoke('providers:auxiliary-panel-action', payload),
  },
  models: {
    list: () => invoke('models:list'),
    favorites: () => invoke('models:favorites'),
    favorite: (payload) => invoke('models:favorite', payload),
  },
  mcp: {
    state: () => invoke('mcp:state'),
    folders: () => invoke('mcp:folders'),
    folder: (folderPath) => invoke('mcp:folder', folderPath),
    workspace: (folderPath) => invoke('mcp:workspace', folderPath),
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
    send: (payload) => invoke('chat:send', payload),
    retry: (payload) => invoke('chat:retry', payload),
    resolveApproval: (payload) => invoke('chat:resolve-approval', payload),
    answerQuestion: (payload) => invoke('chat:answer-question', payload),
    compress: (payload) => invoke('chat:compress', payload),
    cancelQueued: (payload) => invoke('chat:cancel-queued', payload),
    reorderQueued: (payload) => invoke('chat:reorder-queued', payload),
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
});
