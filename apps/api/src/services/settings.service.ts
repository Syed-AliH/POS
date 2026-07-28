import { eq, sql } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import { settings } from '@mama-babi/db-pg';
import type { PostgresClient } from '@mama-babi/db-pg';

/**
 * Settings are read on nearly every request (device id, branch id, tax mode, receipt
 * config) but change rarely. The database is remote, so each uncached read costs a
 * ~120ms round trip. Cache the whole table briefly and invalidate on write.
 */
const SETTINGS_TTL_MS = 30_000;
let settingsCache: { at: number; values: Record<string, string> } | null = null;
let settingsInflight: Promise<Record<string, string>> | null = null;

export function invalidateSettingsCache(): void {
  settingsCache = null;
  settingsInflight = null;
}

export async function getSetting(db: PostgresClient, key: string): Promise<string | null> {
  const all = await getAllSettings(db);
  return all[key] ?? null;
}

export async function getAllSettings(db: PostgresClient): Promise<Record<string, string>> {
  if (settingsCache && Date.now() - settingsCache.at < SETTINGS_TTL_MS) return settingsCache.values;
  // Collapse concurrent misses into one query.
  if (settingsInflight) return settingsInflight;

  settingsInflight = (async () => {
    try {
      const rows = await db.select().from(settings);
      const values = Object.fromEntries(rows.map((r) => [r.key, r.value]));
      settingsCache = { at: Date.now(), values };
      return values;
    } finally {
      settingsInflight = null;
    }
  })();
  return settingsInflight;
}

/** Bypasses the cache — for reads that must observe a just-written value. */
export async function getSettingFresh(db: PostgresClient, key: string): Promise<string | null> {
  const [row] = await db.select().from(settings).where(eq(settings.key, key)).limit(1);
  return row?.value ?? null;
}

export async function setSetting(db: PostgresClient, key: string, value: string): Promise<void> {
  const now = new Date().toISOString();
  const all = await getAllSettings(db);
  const deviceId = all['device_id'] ?? 'cloud';
  const branchId = all['branch_id'] ?? 'main';
  invalidateSettingsCache();
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

/**
 * Increments a counter in a single statement so it can join a caller's transaction —
 * a rolled-back sale must not burn a receipt number, and the old version opened its
 * own nested transaction (4 extra remote round trips per sale).
 */
export async function nextCounterValue(db: PostgresClient, key: string): Promise<number> {
  invalidateSettingsCache();
  const updated = await db.execute<{ value: string }>(sql`
    update settings
       set value = ((coalesce(nullif(value, ''), '0'))::int + 1)::text,
           updated_at = ${new Date().toISOString()}
     where key = ${key}
    returning value
  `);
  const row = (updated as unknown as { rows?: Array<{ value: string }> }).rows?.[0];
  if (row) return parseInt(row.value, 10);

  // First use of this counter.
  const now = new Date().toISOString();
  await db.insert(settings).values({
    id: uuid(),
    key,
    value: '1',
    scope: 'global',
    deviceId: 'cloud',
    branchId: 'main',
    createdAt: now,
    updatedAt: now,
  });
  return 1;
}

export async function nextSaleNumber(db: PostgresClient): Promise<string> {
  const next = await nextCounterValue(db, 'sale_counter');
  return `MB-${new Date().getFullYear()}-${String(next).padStart(6, '0')}`;
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
