const { contextBridge, ipcRenderer } = require('electron');

const listen = (channel) => (callback) => ipcRenderer.on(channel, (_event, payload) => callback(payload));

contextBridge.exposeInMainWorld('overlay', {
  onState: listen('state'),
  onCursor: listen('cursor-indicator'),
  onFlash: listen('flash'),
  setMouseCapture: (enabled) => ipcRenderer.send('mouse-capture', enabled === true),
  stop: () => ipcRenderer.send('stop-session'),
});
