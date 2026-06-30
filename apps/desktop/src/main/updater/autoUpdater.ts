import { app, BrowserWindow, dialog } from 'electron';
import updaterPkg from 'electron-updater';
import type { UpdateStatusPayload } from '@shared/update';
import { IPC_CHANNELS } from '@shared/ipc-channels';

const { autoUpdater } = updaterPkg;

const CHECK_DELAY_MS = 10_000;
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

let initialized = false;
let restartPromptOpen = false;

function broadcast(status: UpdateStatusPayload): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(IPC_CHANNELS.APP_UPDATE_STATUS, status);
    }
  }
}

function promptRestart(version?: string): void {
  if (restartPromptOpen) return;
  restartPromptOpen = true;

  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  const detail = version
    ? `Version ${version} is ready. Restart now to finish installing.`
    : 'A new version is ready. Restart now to finish installing.';

  const show = win && !win.isDestroyed()
    ? dialog.showMessageBox(win, {
        type: 'info',
        title: 'Update Ready',
        message: 'Restart to update Mama Babi POS?',
        detail,
        buttons: ['Restart Now', 'Later'],
        defaultId: 0,
        cancelId: 1,
      })
    : dialog.showMessageBox({
        type: 'info',
        title: 'Update Ready',
        message: 'Restart to update Mama Babi POS?',
        detail,
        buttons: ['Restart Now', 'Later'],
        defaultId: 0,
        cancelId: 1,
      });

  void show
    .then(({ response }) => {
      if (response === 0) {
        autoUpdater.quitAndInstall(false, true);
      }
    })
    .finally(() => {
      restartPromptOpen = false;
    });
}

export function initAutoUpdater(): void {
  if (!app.isPackaged || initialized) return;
  initialized = true;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowDowngrade = false;

  autoUpdater.on('checking-for-update', () => {
    console.log('[updater] Checking for updates…');
    broadcast({ phase: 'checking', currentVersion: app.getVersion() });
  });

  autoUpdater.on('update-available', (info) => {
    console.log('[updater] Update available:', info.version);
    broadcast({
      phase: 'available',
      version: info.version,
      currentVersion: app.getVersion(),
    });
  });

  autoUpdater.on('update-not-available', (info) => {
    console.log('[updater] Up to date:', info.version);
    broadcast({
      phase: 'not-available',
      version: info.version,
      currentVersion: app.getVersion(),
    });
  });

  autoUpdater.on('download-progress', (progress) => {
    broadcast({
      phase: 'downloading',
      percent: progress.percent,
      transferred: progress.transferred,
      total: progress.total,
      version: progress.version,
      currentVersion: app.getVersion(),
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log('[updater] Update downloaded:', info.version);
    broadcast({
      phase: 'downloaded',
      version: info.version,
      currentVersion: app.getVersion(),
    });
    promptRestart(info.version);
  });

  autoUpdater.on('error', (err) => {
    console.error('[updater] Error:', err.message);
    broadcast({
      phase: 'error',
      message: err.message,
      currentVersion: app.getVersion(),
    });
  });

  setTimeout(() => {
    void checkForUpdates();
  }, CHECK_DELAY_MS);

  setInterval(() => {
    void checkForUpdates();
  }, CHECK_INTERVAL_MS);
}

export async function checkForUpdates(): Promise<UpdateStatusPayload> {
  if (!app.isPackaged) {
    return { phase: 'idle', currentVersion: app.getVersion(), message: 'Updates disabled in development' };
  }

  try {
    const result = await autoUpdater.checkForUpdates();
    if (!result) {
      return { phase: 'not-available', currentVersion: app.getVersion() };
    }
    return {
      phase: 'checking',
      currentVersion: app.getVersion(),
      version: result.updateInfo?.version,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Update check failed';
    broadcast({ phase: 'error', message, currentVersion: app.getVersion() });
    return { phase: 'error', message, currentVersion: app.getVersion() };
  }
}

export function installDownloadedUpdate(): void {
  if (!app.isPackaged) return;
  autoUpdater.quitAndInstall(false, true);
}
