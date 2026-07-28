import { app, ipcMain } from 'electron';
import { perfEnabled, perfReport, setPerfEnabled, timeAsync } from '@shared/perf';

/**
 * Turns on the timing harness in the main process when POS_PERF is set, and
 * instruments every IPC channel by patching ipcMain.handle once — so handlers
 * themselves stay untouched.
 *
 *   POS_PERF=1 pnpm dev          # log every operation
 *   POS_PERF=1 POS_PERF_SLOW=50  # only log operations >= 50ms (all still aggregated)
 *   POS_PERF=1 POS_PERF_EVERY=30 # also print the summary table every 30s
 */
export function installMainPerf(): void {
  if (!process.env.POS_PERF) return;

  const slow = Number(process.env.POS_PERF_SLOW ?? '0');
  setPerfEnabled(true, { label: 'main', slowThresholdMs: Number.isFinite(slow) ? slow : 0 });

  const originalHandle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = ((channel: string, listener: (...args: unknown[]) => unknown) =>
    originalHandle(channel, (...args: unknown[]) =>
      timeAsync(`ipc ${channel}`, async () => listener(...args)),
    )) as typeof ipcMain.handle;

  const everySec = Number(process.env.POS_PERF_EVERY ?? '0');
  if (Number.isFinite(everySec) && everySec > 0) {
    const timer = setInterval(() => console.log(perfReport()), everySec * 1000);
    timer.unref?.();
  }

  app.on('before-quit', () => console.log(perfReport()));
  console.log('[perf:main] enabled' + (slow ? ` (logging >= ${slow}ms)` : ''));
}

export { perfEnabled };
