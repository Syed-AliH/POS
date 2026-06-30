/// <reference types="vite/client" />

import type { UpdateStatusPayload } from '@shared/update';

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
  };
  showShortcutHelp?: () => void;
}
