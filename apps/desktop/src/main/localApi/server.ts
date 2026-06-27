import { app } from 'electron';
import { config as loadDotenv } from 'dotenv';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { BUNDLED_API_PORT, BUNDLED_API_URL } from '@shared/deployment';
import { isBundledDeployment } from '../cloud/config';

interface ApiSecrets {
  DATABASE_URL: string;
  JWT_SECRET: string;
  JWT_EXPIRES_IN?: string;
  CORS_ORIGIN?: string;
}

let apiProcess: ChildProcess | null = null;

function monorepoRootFromMain(): string {
  // out/main/index.js → repo root (dev + packaged layouts differ; walk up to find pnpm-workspace)
  let dir = join(__dirname, '..');
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    dir = join(dir, '..');
  }
  return join(__dirname, '../../../../..');
}

function getSecretsPath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'secrets.json');
  }
  const candidates = [
    join(process.cwd(), 'resources/secrets.json'),
    join(process.cwd(), 'apps/desktop/resources/secrets.json'),
    join(__dirname, '../../../resources/secrets.json'),
  ];
  return candidates.find((p) => existsSync(p)) ?? candidates[0];
}

export function loadApiSecrets(): ApiSecrets {
  const secretsPath = getSecretsPath();
  if (existsSync(secretsPath)) {
    try {
      const parsed = JSON.parse(readFileSync(secretsPath, 'utf-8')) as Partial<ApiSecrets>;
      if (parsed.DATABASE_URL && parsed.JWT_SECRET) {
        return {
          DATABASE_URL: parsed.DATABASE_URL,
          JWT_SECRET: parsed.JWT_SECRET,
          JWT_EXPIRES_IN: parsed.JWT_EXPIRES_IN ?? 'never',
          CORS_ORIGIN: parsed.CORS_ORIGIN ?? '*',
        };
      }
    } catch (err) {
      console.warn('[localApi] Failed to parse secrets.json:', err);
    }
  }

  // Dev fallback: root .env (same values used for local API development)
  const root = monorepoRootFromMain();
  loadDotenv({ path: join(root, '.env') });

  const DATABASE_URL = process.env.DATABASE_URL?.trim();
  const JWT_SECRET = process.env.JWT_SECRET?.trim();
  if (!DATABASE_URL || !JWT_SECRET) {
    throw new Error(
      'Database credentials missing. Add resources/secrets.json (see secrets.example.json) or set DATABASE_URL and JWT_SECRET in the project .env file.',
    );
  }

  return {
    DATABASE_URL,
    JWT_SECRET,
    JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN ?? 'never',
    CORS_ORIGIN: process.env.CORS_ORIGIN ?? '*',
  };
}

function resolveApiBundle(): { entry: string; cwd: string } {
  if (app.isPackaged) {
    const cwd = join(process.resourcesPath, 'api');
    return { entry: join(cwd, 'dist', 'server.js'), cwd };
  }

  const root = monorepoRootFromMain();
  const cwd = join(root, 'apps', 'api');
  return { entry: join(cwd, 'dist', 'server.js'), cwd };
}

function killProcessOnPort(port: number): void {
  try {
    if (process.platform === 'win32') {
      const out = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf8' });
      const pids = new Set<string>();
      for (const line of out.split('\n')) {
        if (!line.includes('LISTENING')) continue;
        const pid = line.trim().split(/\s+/).pop();
        if (pid && pid !== '0') pids.add(pid);
      }
      for (const pid of pids) {
        try {
          execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' });
        } catch {
          // process may have already exited
        }
      }
      return;
    }
    execSync(`lsof -ti :${port} | xargs kill -9`, { stdio: 'ignore' });
  } catch {
    // nothing listening
  }
}

async function runningApiBuild(entry: string): Promise<string | null> {
  try {
    const res = await fetch(`${BUNDLED_API_URL}/api/v1/health`);
    if (!res.ok) return null;
    const json = (await res.json()) as { build?: string };
    return json.build ?? null;
  } catch {
    return null;
  }
}

async function waitForHealth(timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const url = `${BUNDLED_API_URL}/api/v1/health`;

  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // API still starting
    }
    await new Promise((r) => setTimeout(r, 400));
  }

  throw new Error('Local API did not become ready in time.');
}

export async function startBundledApiIfNeeded(): Promise<void> {
  if (!isBundledDeployment()) return;

  if (apiProcess) return;

  const secrets = loadApiSecrets();
  const { entry, cwd } = resolveApiBundle();

  if (!existsSync(entry)) {
    throw new Error(
      `API runtime not found at ${entry}. Run "pnpm build:api" (dev) or rebuild the installer.`,
    );
  }

  const buildStamp = String(statSync(entry).mtimeMs);
  const runningBuild = await runningApiBuild(entry);

  if (runningBuild === buildStamp) {
    console.log('[localApi] API already running on', BUNDLED_API_URL);
    return;
  }

  if (runningBuild != null) {
    console.log('[localApi] Restarting API — build changed or stale instance detected');
    killProcessOnPort(BUNDLED_API_PORT);
    await new Promise((r) => setTimeout(r, 600));
  }

  console.log('[localApi] Starting bundled API:', entry);

  apiProcess = spawn(process.execPath, [entry], {
    cwd,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      NODE_ENV: 'production',
      API_HOST: '127.0.0.1',
      PORT: String(BUNDLED_API_PORT),
      API_BUILD_STAMP: buildStamp,
      DATABASE_URL: secrets.DATABASE_URL,
      JWT_SECRET: secrets.JWT_SECRET,
      JWT_EXPIRES_IN: secrets.JWT_EXPIRES_IN ?? 'never',
      CORS_ORIGIN: secrets.CORS_ORIGIN ?? '*',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  apiProcess.stdout?.on('data', (chunk: Buffer) => {
    console.log('[api]', chunk.toString().trimEnd());
  });
  apiProcess.stderr?.on('data', (chunk: Buffer) => {
    console.error('[api]', chunk.toString().trimEnd());
  });
  apiProcess.on('exit', (code, signal) => {
    console.warn('[localApi] API process exited', { code, signal });
    apiProcess = null;
  });

  await waitForHealth();
  console.log('[localApi] API ready at', BUNDLED_API_URL);
}

export function stopBundledApi(): void {
  if (!apiProcess) return;
  apiProcess.kill();
  apiProcess = null;
}
