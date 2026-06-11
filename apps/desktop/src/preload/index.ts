import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electron', {
  ipcRenderer: {
    invoke: (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args),
  },
  shortcuts: {
    onKey: (callback: (key: string) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, key: string) => callback(key);
      ipcRenderer.on('pos:shortcut', handler);
      return () => ipcRenderer.removeListener('pos:shortcut', handler);
    },
  },
});
