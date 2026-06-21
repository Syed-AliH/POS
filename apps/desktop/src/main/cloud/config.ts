import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function loadEnvFile(): void {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.env.DOTENV_PATH,
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '../../.env'),
    path.resolve(here, '../../../../../.env'),
    path.resolve(here, '../../../../../../.env'),
  ].filter((p): p is string => !!p && existsSync(p));

  if (candidates.length > 0) {
    config({ path: candidates[0] });
  }
}

loadEnvFile();

export function getCloudApiUrl(): string | null {
  const url = process.env.CLOUD_API_URL?.trim();
  return url || null;
}

export function isCloudMode(): boolean {
  return !!getCloudApiUrl();
}
