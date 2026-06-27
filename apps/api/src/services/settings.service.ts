import { eq } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import { settings } from '@mama-babi/db-pg';
import type { PostgresClient } from '@mama-babi/db-pg';

export async function getSetting(db: PostgresClient, key: string): Promise<string | null> {
  const [row] = await db.select().from(settings).where(eq(settings.key, key)).limit(1);
  return row?.value ?? null;
}

export async function getAllSettings(db: PostgresClient): Promise<Record<string, string>> {
  const rows = await db.select().from(settings);
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export async function setSetting(db: PostgresClient, key: string, value: string): Promise<void> {
  const now = new Date().toISOString();
  const deviceId = (await getSetting(db, 'device_id')) ?? 'cloud';
  const branchId = (await getSetting(db, 'branch_id')) ?? 'main';
  const [existing] = await db.select().from(settings).where(eq(settings.key, key)).limit(1);

  if (existing) {
    await db.update(settings).set({ value, updatedAt: now }).where(eq(settings.key, key));
  } else {
    await db.insert(settings).values({
      id: uuid(),
      key,
      value,
      scope: 'global',
      deviceId,
      branchId,
      createdAt: now,
      updatedAt: now,
    });
  }
}

export async function incrementCounter(db: PostgresClient, key: string): Promise<number> {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(settings).where(eq(settings.key, key)).limit(1);
    const current = parseInt(row?.value ?? '0', 10);
    const next = current + 1;
    const now = new Date().toISOString();
    if (row) {
      await tx.update(settings).set({ value: String(next), updatedAt: now }).where(eq(settings.key, key));
    } else {
      const deviceId = 'cloud';
      const branchId = 'main';
      await tx.insert(settings).values({
        id: uuid(),
        key,
        value: String(next),
        scope: 'global',
        deviceId,
        branchId,
        createdAt: now,
        updatedAt: now,
      });
    }
    return next;
  });
}

export async function incrementSaleCounter(db: PostgresClient): Promise<string> {
  const year = new Date().getFullYear();
  const next = await incrementCounter(db, 'sale_counter');
  return `MB-${year}-${String(next).padStart(6, '0')}`;
}

export async function incrementGrnCounter(db: PostgresClient): Promise<string> {
  const year = new Date().getFullYear();
  const next = await incrementCounter(db, 'grn_counter');
  return `GRN-${year}-${String(next).padStart(4, '0')}`;
}

export async function incrementReturnCounter(db: PostgresClient): Promise<string> {
  const year = new Date().getFullYear();
  const next = await incrementCounter(db, 'return_counter');
  return `RT-${year}-${String(next).padStart(6, '0')}`;
}
