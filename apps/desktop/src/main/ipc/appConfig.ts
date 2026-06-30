import { app, ipcMain } from 'electron';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { IPC_CHANNELS } from '@shared/ipc-channels';
import { apiUrlValidationError, isValidApiUrl } from '@shared/apiUrl';
import { _resetConfigCache, getCloudApiUrl } from '../cloud/config';
import { getUserConfigPath, resolveConfigPath } from '../runtimePaths';

interface AppConfig {
  deploymentMode?: string;
  apiUrl: string;
  environment: string;
  updateFeedUrl: string;
}

function getConfigPath(): string {
  if (app.isPackaged) {
    return getUserConfigPath();
  }
  return resolveConfigPath();
}

function readConfig(): AppConfig {
  const path = app.isPackaged ? resolveConfigPath() : getConfigPath();
  if (existsSync(path)) {
    try {
      return JSON.parse(readFileSync(path, 'utf-8')) as AppConfig;
    } catch { /* fall through */ }
  }
  return { deploymentMode: 'remote', apiUrl: '', environment: 'production', updateFeedUrl: '' };
}

async function pingApiServer(baseUrl?: string | null): Promise<{ ok: boolean; error?: string }> {
  const url = baseUrl ?? getCloudApiUrl();
  if (!url) {
    return { ok: false, error: 'Server URL is not configured.' };
  }
  if (!isValidApiUrl(url)) {
    return { ok: false, error: apiUrlValidationError(url) ?? 'Invalid server URL.' };
  }

  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/api/v1/health`);
    if (res.ok) return { ok: true };
    return { ok: false, error: `Server responded with HTTP ${res.status}.` };
  } catch {
    return {
      ok: false,
      error: 'Cannot reach the server. Check the URL and make sure the API is running.',
    };
  }
}

export function registerAppConfigHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.APP_GET_CONFIG, () => {
    const raw = readConfig();
    const effective = getCloudApiUrl() ?? '';
    return { ...raw, apiUrl: effective };
  });

  ipcMain.handle(IPC_CHANNELS.APP_SAVE_CONFIG, (_event, updates: Partial<AppConfig>) => {
    try {
      if (updates.apiUrl !== undefined) {
        const validationError = apiUrlValidationError(updates.apiUrl);
        if (validationError) {
          return { success: false, error: validationError };
        }
      }

      const current = readConfig();
      const merged: AppConfig = { ...current, ...updates };
      const target = getConfigPath();
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, JSON.stringify(merged, null, 2), 'utf-8');
      _resetConfigCache();
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to save config' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.APP_PING_SERVER, async () => pingApiServer());
}
