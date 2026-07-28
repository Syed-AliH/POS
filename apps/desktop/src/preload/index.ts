import { contextBridge, ipcRenderer } from 'electron';
import type { UpdateStatusPayload } from '@shared/update';
import type { PrintStatusPayload } from '@shared/types';
import { IPC_CHANNELS } from '@shared/ipc-channels';

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
  updater: {
    onStatus: (callback: (status: UpdateStatusPayload) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, status: UpdateStatusPayload) => callback(status);
      ipcRenderer.on(IPC_CHANNELS.APP_UPDATE_STATUS, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.APP_UPDATE_STATUS, handler);
    },
    checkForUpdates: () => ipcRenderer.invoke(IPC_CHANNELS.APP_UPDATE_CHECK) as Promise<UpdateStatusPayload>,
    installUpdate: () => ipcRenderer.invoke(IPC_CHANNELS.APP_UPDATE_INSTALL) as Promise<{ success: boolean }>,
  },
  print: {
    onStatus: (callback: (status: PrintStatusPayload) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, status: PrintStatusPayload) => callback(status);
      ipcRenderer.on(IPC_CHANNELS.PRINT_STATUS, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.PRINT_STATUS, handler);
    },
  },
});
