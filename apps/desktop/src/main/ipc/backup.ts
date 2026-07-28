import { shell } from 'electron';
import type { ApiResult, BackupInfo } from '@shared/types';
import { requireRole } from '../session';
import { logAudit } from '../services/audit';
import { getBackupDir, listBackups } from '../services/pgBackup';
import { lastBackupError, nextBackupDueAt, runBackupNow } from '../services/backupSchedule';

export async function handleBackupCreate(): Promise<ApiResult<BackupInfo>> {
  try {
    requireRole('super_admin');
    await runBackupNow();
    const [newest] = listBackups();
    if (!newest) return { success: false, error: 'Backup completed but no file was found.' };

    logAudit('backup', 'create', undefined, undefined, { filename: newest.filename });
    return { success: true, data: newest };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Backup failed' };
  }
}

export function handleBackupList(): ApiResult<BackupInfo[]> {
  try {
    requireRole('super_admin', 'manager');
    return { success: true, data: listBackups() };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'List failed' };
  }
}

export function handleBackupStatus(): ApiResult<{
  nextDueAt: string | null;
  lastError: string | null;
  directory: string;
}> {
  try {
    requireRole('super_admin', 'manager');
    return {
      success: true,
      data: {
        nextDueAt: nextBackupDueAt(),
        lastError: lastBackupError(),
        directory: getBackupDir(),
      },
    };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Status failed' };
  }
}

/** Open the backups folder so the file can be copied off the machine. */
export function handleBackupReveal(): ApiResult<void> {
  try {
    requireRole('super_admin', 'manager');
    void shell.openPath(getBackupDir());
    return { success: true, data: undefined };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Could not open the backups folder' };
  }
}

/**
 * Restoring is deliberately not a button.
 *
 * These backups are of the shared Postgres database, so a restore would
 * overwrite live data for every terminal at once — not something that should be
 * one misclick away on a POS screen. It is a rare, deliberate operation that
 * belongs at a terminal with the right tools, so we return instructions rather
 * than doing it.
 */
export function handleBackupRestore(filename: string): ApiResult<void> {
  const isJson = filename.endsWith('.json.gz');
  return {
    success: false,
    error: isJson
      ? 'This backup restores with "pnpm --filter @mama-babi/db-pg restore-json <file>". ' +
        'Restoring overwrites the shared database for every terminal, so it is not done from this screen. ' +
        'Use "Open folder" to get the file.'
      : 'This backup restores with pg_restore --no-owner --no-privileges -d <NEW_DATABASE_URL> <file>. ' +
        'Restoring overwrites the shared database for every terminal, so it is not done from this screen. ' +
        'Use "Open folder" to get the file.',
  };
}
