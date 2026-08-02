/**
 * Copies the label-rendering half of @mama-babi/printer into the owner portal.
 *
 * The portal lives in its own git repository and Vercel builds it standalone, so it
 * cannot resolve a `workspace:*` dependency. Rather than duplicate the logic by hand,
 * the shared sources are copied verbatim into src/vendor/printer and committed there.
 *
 * Run after changing packages/printer:
 *   node scripts/sync-portal-printer.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'packages', 'printer', 'src');
const dest = join(root, 'apps', 'owner-portal', 'src', 'vendor', 'printer');

const BANNER = `// GENERATED FILE — do not edit.
// Copied from packages/printer/src by scripts/sync-portal-printer.mjs.
`;

mkdirSync(dest, { recursive: true });

// labelRender imports its label types from the package index (type-only). The portal
// only needs those types, so they are extracted into a local types module.
const index = readFileSync(join(src, 'index.ts'), 'utf8');
const slice = (startMarker, endMarker) => {
  const start = index.indexOf(startMarker);
  const end = index.indexOf(endMarker, start);
  if (start === -1 || end === -1) {
    throw new Error(`sync-portal-printer: could not locate ${startMarker} in printer index.ts`);
  }
  return index.slice(start, end).trimEnd();
};

const types = [
  BANNER,
  "import type { LabelFontId } from './labelFonts';",
  '',
  slice('export interface LabelProduct {', 'export const SAMPLE_LABEL_PRODUCT'),
  '',
  slice('export type LabelFieldType =', "import type { LabelFontId }"),
  '',
  slice('export interface LabelElement {', 'export interface LabelPrintLine {'),
].join('\n');

writeFileSync(join(dest, 'types.ts'), `${types}\n`);

for (const file of ['labelRender.ts', 'labelFonts.ts', 'labelRollConfig.ts']) {
  const body = readFileSync(join(src, file), 'utf8')
    // The package pulls its label types from ./index; the portal copy has them locally.
    .replace(/from '\.\/index'/g, "from './types'");
  writeFileSync(join(dest, file), `${BANNER}${body}`);
}

writeFileSync(
  join(dest, 'index.ts'),
  `${BANNER}export * from './types';
export * from './labelFonts';
export * from './labelRender';
export * from './labelRollConfig';
`,
);

console.log(`Synced printer label sources → ${dest}`);
