import { desc, eq } from 'drizzle-orm';
import { auditLogs, users } from '@mama-babi/db-schema';
import type { ApiResult, AuditLogEntry } from '@shared/types';
import { getDb } from '../db';
import { requireRole } from '../session';

export function handleAuditList(params?: { limit?: number; module?: string }): ApiResult<AuditLogEntry[]> {
  try {
    requireRole('super_admin', 'manager');
    const db = getDb();
    const limit = params?.limit ?? 100;

    let rows = db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(limit).all();
    if (params?.module) rows = rows.filter((r) => r.module === params.module);

    const entries: AuditLogEntry[] = rows.map((r) => {
      const user = r.userId ? db.select().from(users).where(eq(users.id, r.userId)).get() : null;
      return {
        id: r.id,
        userId: r.userId,
        userName: user?.name ?? null,
        module: r.module,
        action: r.action,
        recordId: r.recordId,
        oldValue: r.oldValue,
        newValue: r.newValue,
        createdAt: r.createdAt,
      };
    });

    return { success: true, data: entries };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'List failed' };
  }
}
