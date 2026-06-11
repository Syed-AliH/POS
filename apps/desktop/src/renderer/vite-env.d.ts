/// <reference types="vite/client" />

interface Window {
  electron: {
    ipcRenderer: {
      invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
    };
    shortcuts?: {
      onKey: (callback: (key: string) => void) => () => void;
    };
  };
  showShortcutHelp?: () => void;
}
