import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import { loadEnv } from 'vite';
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, resolve('../..'), '');
  // Only bake CLOUD_API_URL for dev — production installers must use config.json / setup screen
  const cloudApiUrlForBuild = mode === 'production' ? '' : (env.CLOUD_API_URL ?? '');

  return {
  main: {
    define: {
      'process.env.CLOUD_API_URL': JSON.stringify(cloudApiUrlForBuild),
    },
    plugins: [
      externalizeDepsPlugin({ exclude: ['@mama-babi/db-schema', '@mama-babi/barcode', '@mama-babi/printer', '@mama-babi/reports', '@mama-babi/sync-engine'] }),
      {
        name: 'copy-label-print-assets',
        closeBundle() {
          const src = resolve('src/main/print');
          const dest = resolve('out/main/print');
          if (!existsSync(src)) return;
          mkdirSync(dest, { recursive: true });
          cpSync(src, dest, { recursive: true });
        },
      },
    ],
    build: {
      watch: {
        include: ['src/main/**', '../../packages/printer/src/**'],
      },
    },
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        output: {
          format: 'cjs',
          entryFileNames: 'index.js',
        },
      },
    },
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
      },
    },
  },
  renderer: {
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
        '@renderer': resolve('src/renderer'),
        '@mama-babi/ui': resolve('../../packages/ui/src/index.ts'),
      },
      dedupe: ['react', 'react-dom'],
    },
    server: {
      fs: {
        allow: ['../..'],
      },
    },
    plugins: [react({ include: '**/*.{jsx,tsx}' })],
  },
};
});
