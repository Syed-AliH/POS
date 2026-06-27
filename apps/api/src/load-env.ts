import { config } from 'dotenv';
import path from 'node:path';

const monorepoRoot = path.resolve(__dirname, '../../..');

config({ path: path.join(monorepoRoot, '.env') });
