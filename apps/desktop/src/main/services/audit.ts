import { v4 as uuid } from 'uuid';
import { auditLogs } from '@mama-babi/db-schema';
import { getDb } from '../db';
import { getSession } from '../session';

export function logAudit(
  module: string,
  action: string,
  recordId?: string,
  oldValue?: unknown,
  newValue?: unknown,
): void {
  const db = getDb();
  const session = getSession();
  db.insert(auditLogs).values({
    id: uuid(),
    userId: session?.id ?? null,
    module,
    action,
    recordId: recordId ?? null,
    oldValue: oldValue ? JSON.stringify(oldValue) : null,
    newValue: newValue ? JSON.stringify(newValue) : null,
    deviceId: 'local-device',
    branchId: 'main',
    createdAt: new Date().toISOString(),
  }).run();
}
