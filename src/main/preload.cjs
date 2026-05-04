const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload);

contextBridge.exposeInMainWorld('aivax', {
  auth: {
    session: () => invoke('auth:session'),
    login: (loginKey) => invoke('auth:login', loginKey),
    logout: () => invoke('auth:logout'),
  },
  account: {
    balance: () => invoke('account:balance'),
  },
  conversations: {
    list: () => invoke('conversations:list'),
    create: (payload) => invoke('conversations:create', payload),
    update: (payload) => invoke('conversations:update', payload),
    messages: (conversationId) => invoke('conversations:messages', conversationId),
    delete: (conversationId) => invoke('conversations:delete', conversationId),
    fork: (payload) => invoke('conversations:fork', payload),
    search: (query) => invoke('conversations:search', query),
  },
  models: {
    list: () => invoke('models:list'),
    favorites: () => invoke('models:favorites'),
    favorite: (payload) => invoke('models:favorite', payload),
  },
  workspaces: {
    list: () => invoke('workspaces:list'),
    add: (id) => invoke('workspaces:add', id),
    remove: (id) => invoke('workspaces:remove', id),
    setActive: (id) => invoke('workspaces:set-active', id),
  },
  workspaceFiles: {
    list: (payload) => invoke('workspace-files:list', payload),
    details: (payload) => invoke('workspace-files:details', payload),
    preview: (payload) => invoke('workspace-files:preview', payload),
    share: (payload) => invoke('workspace-files:share', payload),
    openShare: (publicUrl) => invoke('workspace-files:open-share', publicUrl),
    download: (payload) => invoke('workspace-files:download', payload),
    upload: (payload) => invoke('workspace-files:upload', payload),
    createDirectory: (payload) => invoke('workspace-files:create-directory', payload),
    delete: (payload) => invoke('workspace-files:delete', payload),
  },
  workspaceUploads: {
    start: (payload) => invoke('workspace-uploads:start', payload),
    cancel: (id) => invoke('workspace-uploads:cancel', id),
    snapshot: () => invoke('workspace-uploads:snapshot'),
  },
  chat: {
    send: (payload) => invoke('chat:send', payload),
    retry: (payload) => invoke('chat:retry', payload),
    cancelQueued: (payload) => invoke('chat:cancel-queued', payload),
    stop: (conversationId) => invoke('chat:stop', conversationId),
  },
  files: {
    select: () => invoke('files:select'),
  },
  window: {
    minimize: () => invoke('window:minimize'),
    maximize: () => invoke('window:maximize'),
    close: () => invoke('window:close'),
    openUsageDashboard: () => invoke('window:open-usage-dashboard'),
  },
  onChatEvent(callback) {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('chat:event', handler);
    return () => ipcRenderer.removeListener('chat:event', handler);
  },
});
