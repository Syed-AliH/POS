import { eq } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import { settings } from '@mama-babi/db-schema';
import { getDb } from '../db';

/**
 * Settings are read constantly (device id, branch id, printer config, tax mode) —
 * including inside loops and on every print — but change rarely. Cache the table in
 * memory and write through, so a read is not a SQLite query each time.
 */
let cache: Record<string, string> | null = null;

export function invalidateSettingsCache(): void {
  cache = null;
}

export function getSetting(key: string): string | null {
  return getAllSettings()[key] ?? null;
}

export function getAllSettings(): Record<string, string> {
  if (cache) return cache;
  const db = getDb();
  const rows = db.select().from(settings).all();
  cache = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return cache;
}

export function setSetting(key: string, value: string): void {
  const db = getDb();
  const now = new Date().toISOString();
  const deviceId = getSetting('device_id') ?? 'local-device';
  const branchId = getSetting('branch_id') ?? 'main';
  invalidateSettingsCache();
  const existing = db.select().from(settings).where(eq(settings.key, key)).get();

  if (existing) {
    db.update(settings).set({ value, updatedAt: now }).where(eq(settings.key, key)).run();
  } else {
    db.insert(settings)
      .values({
        id: uuid(),
        key,
        value,
        scope: 'global',
        deviceId,
        branchId,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }
}

export function incrementSaleCounter(): string {
  const db = getDb();
  const year = new Date().getFullYear();
  const key = 'sale_counter';

  return db.transaction(() => {
    const current = getSetting(key) ?? '0';
    const next = parseInt(current, 10) + 1;
    const now = new Date().toISOString();

    db.update(settings)
      .set({ value: String(next), updatedAt: now })
      .where(eq(settings.key, key))
      .run();
    invalidateSettingsCache();

    return `MB-${year}-${String(next).padStart(6, '0')}`;
  });
}

export function ensureDefaultSettings(): void {
  const defaults: Record<string, string> = {
    po_counter: '0',
    supplier_payment_counter: '0',
    secondary_currency: 'USD',
    exchange_rate: '0.0036',
  };
  for (const [key, value] of Object.entries(defaults)) {
    if (getSetting(key) == null) setSetting(key, value);
  }
}

export function incrementGrnCounter(): string {
  const year = new Date().getFullYear();
  const key = 'grn_counter';
  const current = getSetting(key) ?? '0';
  const next = parseInt(current, 10) + 1;
  setSetting(key, String(next));
  return `GRN-${year}-${String(next).padStart(4, '0')}`;
}

export function incrementPoCounter(): string {
  const db = getDb();
  const year = new Date().getFullYear();
  const key = 'po_counter';

  return db.transaction(() => {
    const current = getSetting(key) ?? '0';
    const next = parseInt(current, 10) + 1;
    const now = new Date().toISOString();

    db.update(settings)
      .set({ value: String(next), updatedAt: now })
      .where(eq(settings.key, key))
      .run();
    invalidateSettingsCache();

    return `PO-${year}-${String(next).padStart(6, '0')}`;
  });
}
