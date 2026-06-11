const { contextBridge, ipcRenderer } = require('electron');

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
});
