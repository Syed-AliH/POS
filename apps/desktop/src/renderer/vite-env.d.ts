/// <reference types="vite/client" />

import type { UpdateStatusPayload } from '@shared/update';
import type { PrintStatusPayload } from '@shared/types';

// The `import type` above makes this file a module, so the Window augmentation has to
// live inside `declare global` — otherwise `window.electron` is untyped everywhere.
declare global {
  interface Window {
    electron: {
      ipcRenderer: {
        invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
      };
      shortcuts?: {
        onKey: (callback: (key: string) => void) => () => void;
      };
      updater?: {
        onStatus: (callback: (status: UpdateStatusPayload) => void) => () => void;
        checkForUpdates: () => Promise<UpdateStatusPayload>;
        installUpdate: () => Promise<{ success: boolean }>;
      };
      print?: {
        onStatus: (callback: (status: PrintStatusPayload) => void) => () => void;
      };
    };
    showShortcutHelp?: () => void;
    posPerf?: () => void;
  }
}

export {};
