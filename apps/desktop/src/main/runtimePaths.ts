import { app } from 'electron';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const RUNTIME_SUBDIR = 'runtime';

function runtimeDir(): string {
  return join(app.getPath('userData'), RUNTIME_SUBDIR);
}

export function getUserConfigPath(): string {
  return join(runtimeDir(), 'config.json');
}

export function getUserSecretsPath(): string {
  return join(runtimeDir(), 'secrets.json');
}

/**
 * Admin-supplied database password override, encrypted at rest. Kept out of
 * secrets.json so app updates never overwrite it and it is never bundled.
 */
export function getDbCredentialsPath(): string {
  return join(runtimeDir(), 'db-credentials.json');
}

export function ensureRuntimeDir(): string {
  const dir = runtimeDir();
  mkdirSync(dir, { recursive: true });
  return dir;
}

function bundledConfigPath(): string {
  return join(process.resourcesPath, 'config.json');
}

function bundledSecretsPath(): string {
  return join(process.resourcesPath, 'secrets.json');
}

/** Copy bundled config/secrets into userData on first run so updates do not overwrite them. */
export function ensureRuntimeConfigMigrated(): void {
  if (!app.isPackaged) return;

  mkdirSync(runtimeDir(), { recursive: true });

  const pairs: Array<[string, string]> = [
    [bundledConfigPath(), getUserConfigPath()],
    [bundledSecretsPath(), getUserSecretsPath()],
  ];

  for (const [from, to] of pairs) {
    if (!existsSync(to) && existsSync(from)) {
      copyFileSync(from, to);
      console.log('[runtime] Migrated', from, '→', to);
    }
  }
}

export function resolveConfigPath(): string {
  if (app.isPackaged) {
    const user = getUserConfigPath();
    if (existsSync(user)) return user;
    const bundled = bundledConfigPath();
    if (existsSync(bundled)) return bundled;
    return user;
  }

  const candidates = [
    join(process.cwd(), 'resources/config.json'),
    join(process.cwd(), 'apps/desktop/resources/config.json'),
    join(__dirname, '../../../resources/config.json'),
  ];
  return candidates.find((p) => existsSync(p)) ?? candidates[0];
}

export function resolveSecretsPath(): string {
  if (app.isPackaged) {
    const user = getUserSecretsPath();
    if (existsSync(user)) return user;
    const bundled = bundledSecretsPath();
    if (existsSync(bundled)) return bundled;
    return user;
  }

  const candidates = [
    join(process.cwd(), 'resources/secrets.json'),
    join(process.cwd(), 'apps/desktop/resources/secrets.json'),
    join(__dirname, '../../../resources/secrets.json'),
  ];
  return candidates.find((p) => existsSync(p)) ?? candidates[0];
}
