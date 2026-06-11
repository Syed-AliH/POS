import { desc, eq } from 'drizzle-orm';
import { syncQueue } from '@mama-babi/db-schema';
import type { ApiResult, SyncQueueItem } from '@shared/types';
import { getDb } from '../db';
import { requireRole } from '../session';

export function handleSyncStatus(): ApiResult<{ enabled: boolean; pending: number; lastSync: string | null }> {
  try {
    requireRole('super_admin', 'manager');
    const db = getDb();
    const pending = db.select().from(syncQueue).where(eq(syncQueue.status, 'pending')).all().length;
    return { success: true, data: { enabled: false, pending, lastSync: null } };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Sync status failed' };
  }
}

export function handleSyncQueueList(limit = 50): ApiResult<SyncQueueItem[]> {
  try {
    requireRole('super_admin');
    const db = getDb();
    const rows = db.select().from(syncQueue).orderBy(desc(syncQueue.createdAt)).limit(limit).all();
    return {
      success: true,
      data: rows.map((r) => ({
        id: r.id,
        tableName: r.tableName,
        recordId: r.recordId,
        operation: r.operation,
        status: r.status,
        createdAt: r.createdAt,
      })),
    };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Queue list failed' };
  }
}
