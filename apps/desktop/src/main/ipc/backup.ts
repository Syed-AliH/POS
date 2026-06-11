import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import type { ApiResult, BackupInfo } from '@shared/types';
import { getDbPath } from '../db';
import { requireRole } from '../session';
import { logAudit } from '../services/audit';

function getBackupDir(): string {
  const dir = path.join(app.getPath('userData'), 'backups');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function handleBackupCreate(): ApiResult<BackupInfo> {
  try {
    requireRole('super_admin');
    const dbPath = getDbPath();
    const backupDir = getBackupDir();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `mama-babi-${timestamp}.db`;
    const destPath = path.join(backupDir, filename);

    fs.copyFileSync(dbPath, destPath);
    const stat = fs.statSync(destPath);

    const info: BackupInfo = {
      filename,
      path: destPath,
      size: stat.size,
      createdAt: new Date().toISOString(),
    };

    logAudit('backup', 'create', undefined, undefined, { filename });
    return { success: true, data: info };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Backup failed' };
  }
}

export function handleBackupList(): ApiResult<BackupInfo[]> {
  try {
    requireRole('super_admin', 'manager');
    const backupDir = getBackupDir();
    const files = fs.readdirSync(backupDir).filter((f) => f.endsWith('.db'));

    const backups: BackupInfo[] = files.map((filename) => {
      const filePath = path.join(backupDir, filename);
      const stat = fs.statSync(filePath);
      return { filename, path: filePath, size: stat.size, createdAt: stat.mtime.toISOString() };
    }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    return { success: true, data: backups };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'List failed' };
  }
}

export function handleBackupRestore(filename: string): ApiResult<void> {
  try {
    requireRole('super_admin');
    const backupDir = getBackupDir();
    const sourcePath = path.join(backupDir, filename);
    if (!fs.existsSync(sourcePath)) return { success: false, error: 'Backup file not found' };

    const dbPath = getDbPath();
    const safetyCopy = `${dbPath}.pre-restore-${Date.now()}`;
    if (fs.existsSync(dbPath)) fs.copyFileSync(dbPath, safetyCopy);

    fs.copyFileSync(sourcePath, dbPath);
    logAudit('backup', 'restore', undefined, undefined, { filename });

    setImmediate(() => {
      app.relaunch();
      app.exit(0);
    });

    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Restore failed' };
  }
}
