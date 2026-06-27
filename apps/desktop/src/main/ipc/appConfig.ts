import { app, ipcMain } from 'electron';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { IPC_CHANNELS } from '@shared/ipc-channels';
import { apiUrlValidationError, isValidApiUrl } from '@shared/apiUrl';
import { _resetConfigCache, getCloudApiUrl } from '../cloud/config';

interface AppConfig {
  deploymentMode?: string;
  apiUrl: string;
  environment: string;
  updateFeedUrl: string;
}

function getConfigPath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'config.json');
  }
  const candidates = [
    join(process.cwd(), 'resources/config.json'),
    join(process.cwd(), 'apps/desktop/resources/config.json'),
    join(__dirname, '../../../resources/config.json'),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return candidates[0];
}

function readConfig(): AppConfig {
  const path = getConfigPath();
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
      writeFileSync(getConfigPath(), JSON.stringify(merged, null, 2), 'utf-8');
      _resetConfigCache();
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to save config' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.APP_PING_SERVER, async () => pingApiServer());
}
