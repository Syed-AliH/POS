/**
 * Copies DATABASE_URL + JWT_SECRET from repo .env into resources/secrets.json
 * before building the installer. Run once on the build machine.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '../../..');
const envPath = join(root, '.env');
const outPath = join(__dirname, '../resources/secrets.json');

if (!existsSync(envPath)) {
  console.error('[prepare-secrets] Missing .env at', envPath);
  process.exit(1);
}

const env = Object.fromEntries(
  readFileSync(envPath, 'utf-8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const i = line.indexOf('=');
      return [line.slice(0, i), line.slice(i + 1)];
    }),
);

const DATABASE_URL = env.DATABASE_URL?.trim();
const JWT_SECRET = env.JWT_SECRET?.trim();

if (!DATABASE_URL || !JWT_SECRET) {
  console.error('[prepare-secrets] .env must define DATABASE_URL and JWT_SECRET');
  process.exit(1);
}

writeFileSync(
  outPath,
  `${JSON.stringify(
    {
      DATABASE_URL,
      JWT_SECRET,
      JWT_EXPIRES_IN: env.JWT_EXPIRES_IN?.trim() || 'never',
      CORS_ORIGIN: env.CORS_ORIGIN?.trim() || '*',
    },
    null,
    2,
  )}\n`,
);

console.log('[prepare-secrets] Wrote', outPath);
