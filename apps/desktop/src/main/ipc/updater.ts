import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc-channels';
import { checkForUpdates, installDownloadedUpdate } from '../updater/autoUpdater';

export function registerUpdaterHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.APP_UPDATE_CHECK, () => checkForUpdates());
  ipcMain.handle(IPC_CHANNELS.APP_UPDATE_INSTALL, () => {
    installDownloadedUpdate();
    return { success: true };
  });
}
