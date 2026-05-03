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
    fork: (conversationId) => invoke('conversations:fork', conversationId),
    search: (query) => invoke('conversations:search', query),
  },
  models: {
    list: () => invoke('models:list'),
    favorites: () => invoke('models:favorites'),
    favorite: (payload) => invoke('models:favorite', payload),
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
  },
  onChatEvent(callback) {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('chat:event', handler);
    return () => ipcRenderer.removeListener('chat:event', handler);
  },
});
