import { app, BrowserWindow, dialog, Menu, shell } from 'electron';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { getCloudApiUrl, isBundledDeployment, isCloudMode } from './cloud/config';
import { startBundledApiIfNeeded, stopBundledApi } from './localApi/server';
import { purgeLocalBusinessData } from './cloud/purgeLocal';
import { getDbPath, initDatabase } from './db';
import { registerIpcHandlers } from './ipc';
import { ensureRuntimeConfigMigrated } from './runtimePaths';
import { initAutoUpdater } from './updater/autoUpdater';
import { seedLabelTemplatesIfEmpty } from './services/labelTemplates';
import { seedReceiptTemplatesIfEmpty } from './services/receiptTemplates';
import { seedDemoProductsIfEmpty } from './services/demoProducts';
import { ensureAuthCredentials } from './services/ensureAuth';
import { seedIfEmpty } from './services/seed';
import { syncSkuPrefixesLocal } from './services/syncSkuPrefixes';
import { ensureDefaultSettings } from './services/settings';

const isDev = !app.isPackaged;

function resolvePreloadPath(): string {
  // Static preload (not Vite-bundled) — most reliable for contextBridge
  const candidates = [
    join(app.getAppPath(), 'resources/preload.cjs'),
    join(process.resourcesPath, 'preload.cjs'),
  ];
  const staticPreload = candidates.find((p) => existsSync(p));
  if (staticPreload) return staticPreload;

  // Fallback to Vite-built preload
  const builtCandidates = [
    join(__dirname, '../preload/index.js'),
    join(__dirname, '../preload/index.mjs'),
  ];
  const built = builtCandidates.find((p) => existsSync(p));
  if (built) return built;

  console.error('[main] Preload not found. Tried:', ...candidates, ...builtCandidates);
  return candidates[0];
}

function createWindow(): void {
  const preloadPath = resolvePreloadPath();
  console.log('[main] Using preload:', preloadPath, 'exists:', existsSync(preloadPath));

  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 800,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath,
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error('[renderer] Failed to load:', errorCode, errorDescription, validatedURL);
  });

  mainWindow.webContents.on('preload-error', (_event, path, error) => {
    console.error('[preload] Error loading:', path, error);
  });

  mainWindow.on('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: 'deny' };
  });

  // Default Electron menu steals F1 (Help) and other function keys on Windows
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const fnMatch = input.key.match(/^F(\d{1,2})$/i);
    if (fnMatch) {
      event.preventDefault();
      mainWindow.webContents.send('pos:shortcut', input.key.toUpperCase());
    }
  });

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(async () => {
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.mamababi.pos');
  }

  ensureRuntimeConfigMigrated();

  if (isBundledDeployment()) {
    try {
      await startBundledApiIfNeeded();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start local API.';
      console.error('[localApi]', message);
      dialog.showErrorBox('Mama Babi POS — Server Error', message);
      app.quit();
      return;
    }
  }

  initDatabase();

  if (isCloudMode()) {
    if (isBundledDeployment()) {
      console.log('[main] Bundled mode — local API:', getCloudApiUrl());
    } else {
      console.log('[main] Cloud mode — API:', getCloudApiUrl());
    }
    purgeLocalBusinessData();
    // Designs load from cloud after login (not default seeds)
  } else {
    console.log('[main] Local mode — Database:', getDbPath());
    try {
      await seedIfEmpty();
    } catch (err) {
      console.error('[seed] seedIfEmpty failed:', err);
    }
    try {
      const sync = syncSkuPrefixesLocal();
      if (sync.categoriesUpdated > 0 || sync.productsUpdated > 0) {
        console.log(
          `[sync] SKU prefixes — categories: ${sync.categoriesUpdated}, products: ${sync.productsUpdated}`,
        );
      }
    } catch (err) {
      console.error('[sync] syncSkuPrefixesLocal failed:', err);
    }
    try {
      await ensureAuthCredentials();
    } catch (err) {
      console.error('[auth] ensureAuthCredentials failed:', err);
    }
    seedDemoProductsIfEmpty();
    ensureDefaultSettings();
    seedLabelTemplatesIfEmpty();
    seedReceiptTemplatesIfEmpty();
  }
  registerIpcHandlers();
  Menu.setApplicationMenu(null);
  createWindow();
  initAutoUpdater();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  stopBundledApi();
});
