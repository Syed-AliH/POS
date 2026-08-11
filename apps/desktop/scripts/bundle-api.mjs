/**
 * Prepares a self-contained API runtime folder for the Windows installer.
 * Output: apps/desktop/api-bundle/
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopDir = join(__dirname, '..');
const root = join(desktopDir, '../..');
const bundleDir = join(desktopDir, 'api-bundle');

console.log('[bundle-api] Building API…');
execSync('pnpm build:api', { cwd: root, stdio: 'inherit' });

console.log('[bundle-api] Preparing api-bundle…');
if (existsSync(bundleDir)) {
  rmSync(bundleDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 500 });
}
mkdirSync(bundleDir, { recursive: true });

cpSync(join(root, 'apps/api/dist'), join(bundleDir, 'dist'), { recursive: true });

const apiPkg = JSON.parse(readFileSync(join(root, 'apps/api/package.json'), 'utf-8'));
const dbPgPkg = JSON.parse(readFileSync(join(root, 'packages/db-pg/package.json'), 'utf-8'));

const runtimeDependencies = {
  ...Object.fromEntries(
    Object.entries(apiPkg.dependencies).filter(([name]) => !name.startsWith('@mama-babi/')),
  ),
  pg: dbPgPkg.dependencies.pg,
};

writeFileSync(
  join(bundleDir, 'package.json'),
  `${JSON.stringify(
    {
      name: 'mama-babi-api-runtime',
      private: true,
      main: 'dist/server.js',
      dependencies: runtimeDependencies,
    },
    null,
    2,
  )}\n`,
);

console.log('[bundle-api] Installing production dependencies…');
execSync('npm install --omit=dev --no-package-lock', { cwd: bundleDir, stdio: 'inherit' });

function installWorkspacePackage(name, distPath, extra = {}) {
  const dir = join(bundleDir, 'node_modules', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify({ name, version: '0.1.0', main: 'dist/index.js', ...extra }, null, 2)}\n`);
  cpSync(distPath, join(dir, 'dist'), { recursive: true });
}

installWorkspacePackage('@mama-babi/barcode', join(root, 'packages/barcode/dist'));
installWorkspacePackage('@mama-babi/db-pg', join(root, 'packages/db-pg/dist'), {
  exports: {
    '.': './dist/index.js',
    './schema': './dist/schema/index.js',
    './client': './dist/client.js',
  },
});
installWorkspacePackage('@mama-babi/printer', join(root, 'packages/printer/dist'));

// The bundle is the only place these are resolved at runtime, so a missing one shows
// up as "Local API did not become ready in time" rather than a module error.
for (const name of Object.keys(apiPkg.dependencies).filter((n) => n.startsWith('@mama-babi/'))) {
  if (!existsSync(join(bundleDir, 'node_modules', name, 'dist'))) {
    throw new Error(
      `[bundle-api] ${name} is an API dependency but was not installed into the bundle. ` +
        'Add an installWorkspacePackage() call for it (and a build script if it has none).',
    );
  }
}

console.log('[bundle-api] Done →', bundleDir);
