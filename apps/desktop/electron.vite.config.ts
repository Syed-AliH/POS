import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ['@mama-babi/db-schema', '@mama-babi/barcode', '@mama-babi/printer', '@mama-babi/reports', '@mama-babi/sync-engine'] })],
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
});
