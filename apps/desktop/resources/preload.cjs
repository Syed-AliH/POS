const { contextBridge, ipcRenderer } = require('electron');

const APP_UPDATE_STATUS = 'app:update-status';
const APP_UPDATE_CHECK = 'app:update-check';
const APP_UPDATE_INSTALL = 'app:update-install';

contextBridge.exposeInMainWorld('electron', {
  ipcRenderer: {
    invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  },
  shortcuts: {
    onKey: (callback) => {
      const handler = (_event, key) => callback(key);
      ipcRenderer.on('pos:shortcut', handler);
      return () => ipcRenderer.removeListener('pos:shortcut', handler);
    },
  },
  updater: {
    onStatus: (callback) => {
      const handler = (_event, status) => callback(status);
      ipcRenderer.on(APP_UPDATE_STATUS, handler);
      return () => ipcRenderer.removeListener(APP_UPDATE_STATUS, handler);
    },
    checkForUpdates: () => ipcRenderer.invoke(APP_UPDATE_CHECK),
    installUpdate: () => ipcRenderer.invoke(APP_UPDATE_INSTALL),
  },
});
