import { createApi, type MamaBabiAPI } from '@shared/api';

let api: MamaBabiAPI | null = null;
let bridgeReady = false;

export async function ensureBridge(timeoutMs = 8000): Promise<void> {
  if (bridgeReady) return;

  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (typeof window !== 'undefined' && window.electron?.ipcRenderer?.invoke) {
      bridgeReady = true;
      return;
    }
    await new Promise((r) => setTimeout(r, 50));
  }

  throw new Error('Electron preload bridge is not available. Close all POS windows and run: pnpm dev');
}

export function getApi(): MamaBabiAPI {
  if (!bridgeReady) {
    throw new Error('API not ready — bridge not initialized');
  }
  if (!api) api = createApi();
  return api;
}
