import { isBundledDeployment } from '../cloud/config';
import { createBackup, listBackups } from './pgBackup';

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
/** Don't compete with the app's own startup work. */
const STARTUP_DELAY_MS = 60_000;

let timer: NodeJS.Timeout | null = null;
let running = false;
let lastError: string | null = null;

function msSinceLastBackup(): number {
  const [newest] = listBackups();
  if (!newest) return Number.POSITIVE_INFINITY;
  return Date.now() - new Date(newest.createdAt).getTime();
}

export function nextBackupDueAt(): string | null {
  const [newest] = listBackups();
  if (!newest) return null;
  return new Date(new Date(newest.createdAt).getTime() + SIX_HOURS_MS).toISOString();
}

export function lastBackupError(): string | null {
  return lastError;
}

async function runIfDue(force = false): Promise<void> {
  if (running) return;
  if (!force && msSinceLastBackup() < SIX_HOURS_MS) return;

  running = true;
  try {
    const info = await createBackup();
    lastError = null;
    console.log('[backup] Created', info.filename, `(${Math.round(info.size / 1024)} KB, ${info.method})`);
  } catch (err) {
    lastError = err instanceof Error ? err.message : 'Backup failed';
    console.error('[backup] Scheduled backup failed:', lastError);
  } finally {
    running = false;
  }
}

/**
 * Back up every six hours while the app runs. Because terminals get shut down
 * overnight, this also catches up shortly after launch when the most recent
 * backup is already older than six hours — a fixed interval alone would mean a
 * machine that is never on for six straight hours never backs up at all.
 */
export function startBackupSchedule(): void {
  // Only the bundled deployment holds database credentials; in remote mode the
  // server is responsible for its own backups.
  if (!isBundledDeployment()) return;
  if (timer) return;

  setTimeout(() => void runIfDue(), STARTUP_DELAY_MS);
  timer = setInterval(() => void runIfDue(), SIX_HOURS_MS);
}

export function stopBackupSchedule(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}

/** Manual "Back up now" — ignores the six-hour window. */
export async function runBackupNow() {
  await runIfDue(true);
  if (lastError) throw new Error(lastError);
}
