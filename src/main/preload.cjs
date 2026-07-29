const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload);

contextBridge.exposeInMainWorld('chatApp', {
  app: {
    state: () => invoke('app:state'),
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
  sideChats: {
    list: (parentConversationId) => invoke('side-chats:list', parentConversationId),
    create: (payload) => invoke('side-chats:create', payload),
    close: (sideChatId) => invoke('side-chats:close', sideChatId),
  },
  providers: {
    list: () => invoke('providers:list'),
    save: (provider) => invoke('providers:save', provider),
    remove: (providerId) => invoke('providers:remove', providerId),
  },
  models: {
    list: () => invoke('models:list'),
    favorites: () => invoke('models:favorites'),
    favorite: (payload) => invoke('models:favorite', payload),
  },
  chat: {
    send: (payload) => invoke('chat:send', payload),
    retry: (payload) => invoke('chat:retry', payload),
    compress: (payload) => invoke('chat:compress', payload),
    cancelQueued: (payload) => invoke('chat:cancel-queued', payload),
    reorderQueued: (payload) => invoke('chat:reorder-queued', payload),
    stop: (conversationId) => invoke('chat:stop', conversationId),
  },
  files: {
    select: () => invoke('files:select'),
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
