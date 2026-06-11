export interface SyncEngine {
  push(): Promise<void>;
  pull(): Promise<void>;
  getStatus(): { enabled: boolean; pending: number; lastSync: string | null };
}

export function createSyncEngine(): SyncEngine {
  return {
    async push() {
      // Deferred — cloud sync not enabled
    },
    async pull() {
      // Deferred — cloud sync not enabled
    },
    getStatus() {
      return { enabled: false, pending: 0, lastSync: null };
    },
  };
}
