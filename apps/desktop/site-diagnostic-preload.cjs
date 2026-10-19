const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('siteDiagnostic', Object.freeze({
  navigate: url => ipcRenderer.invoke('site-diagnostic:navigate', url),
  read: () => ipcRenderer.invoke('site-diagnostic:read'),
  status: () => ipcRenderer.invoke('site-diagnostic:status'),
  validate: () => ipcRenderer.invoke('site-diagnostic:validate'),
}));
