import { v4 as uuid } from 'uuid';
import { auditLogs } from '@mama-babi/db-pg';
import type { PostgresClient } from '@mama-babi/db-pg';

export interface AuditEventInput {
  userId: string | null;
  module: string;
  action: string;
  recordId?: string | null;
  oldValue?: string | null;
  newValue?: string | null;
  ip?: string | null;
}

export async function logAuditEvent(db: PostgresClient, event: AuditEventInput): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      id: uuid(),
      userId: event.userId ?? null,
      module: event.module,
      action: event.action,
      recordId: event.recordId ?? null,
      oldValue: event.oldValue ?? null,
      newValue: event.newValue ?? null,
      ip: event.ip ?? null,
      deviceId: 'cloud',
      branchId: 'main',
      createdAt: new Date().toISOString(),
    });
  } catch {
    // Audit failures must never break the main operation
  }
}
