import { config } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const monorepoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
);

config({ path: path.join(monorepoRoot, '.env') });
