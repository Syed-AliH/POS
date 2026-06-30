import { app } from 'electron';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isValidApiUrl } from '@shared/apiUrl';
import { BUNDLED_API_URL, isBundledMode } from '@shared/deployment';
import { resolveConfigPath } from '../runtimePaths';

interface RuntimeConfig {
  deploymentMode?: string;
  apiUrl?: string;
  environment?: string;
  updateFeedUrl?: string;
}

let _runtimeConfig: RuntimeConfig | null = null;

function loadRuntimeConfig(): RuntimeConfig {
  if (_runtimeConfig) return _runtimeConfig;

  const candidates: string[] = [];

  if (app.isPackaged) {
    candidates.push(resolveConfigPath());
    candidates.push(join(process.resourcesPath, 'config.json'));
  } else {
    // Development: search relative to source file and cwd
    try {
      const here = join(fileURLToPath(import.meta.url), '..');
      candidates.push(
        join(here, '../../../resources/config.json'),
        join(here, '../../../../resources/config.json'),
      );
    } catch { /* ESM url not available in some builds */ }
    candidates.push(
      join(process.cwd(), 'resources/config.json'),
      join(process.cwd(), '../../apps/desktop/resources/config.json'),
    );
  }

  for (const p of candidates) {
    if (existsSync(p)) {
      try {
        _runtimeConfig = JSON.parse(readFileSync(p, 'utf-8')) as RuntimeConfig;
        console.log('[config] Loaded runtime config from:', p);
        return _runtimeConfig;
      } catch (err) {
        console.warn('[config] Failed to parse config file at', p, err);
      }
    }
  }

  // Fallback: nothing found — dev will use env var
  _runtimeConfig = {};
  return _runtimeConfig;
}

export function isBundledDeployment(): boolean {
  return isBundledMode(loadRuntimeConfig().deploymentMode);
}

export function getCloudApiUrl(): string | null {
  if (isBundledDeployment()) return BUNDLED_API_URL;

  const runtimeUrl = loadRuntimeConfig().apiUrl?.trim();
  if (runtimeUrl && isValidApiUrl(runtimeUrl)) return runtimeUrl;

  // Dev fallback: compile-time env var (set via electron-vite define)
  const envUrl = (process.env.CLOUD_API_URL as string | undefined)?.trim();
  if (envUrl && isValidApiUrl(envUrl)) return envUrl;
  return null;
}

export function isCloudMode(): boolean {
  return !!getCloudApiUrl();
}

export function getAppEnvironment(): 'production' | 'staging' | 'development' {
  const env = loadRuntimeConfig().environment ?? 'development';
  return env as 'production' | 'staging' | 'development';
}

export function getUpdateFeedUrl(): string | null {
  return loadRuntimeConfig().updateFeedUrl?.trim() || null;
}

/** Reset cached config (useful for testing) */
export function _resetConfigCache(): void {
  _runtimeConfig = null;
}
