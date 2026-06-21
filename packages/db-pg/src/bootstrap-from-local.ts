import './load-env';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { v4 as uuid } from 'uuid';
import { labelTemplates, receiptTemplates, settings, users } from './schema';
import { createPostgresDatabase } from './client';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

function resolveSqlitePath(): string {
  if (process.env.LOCAL_SQLITE_PATH?.trim()) {
    return process.env.LOCAL_SQLITE_PATH.trim();
  }

  const appData = process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming');
  const candidates = [
    path.join(appData, 'Mama Babi POS', 'mama-babi.db'),
    path.join(appData, 'mama-babi-pos', 'mama-babi.db'),
    path.join(appData, '@mama-babi', 'desktop', 'mama-babi.db'),
    path.join(appData, 'Electron', 'mama-babi.db'),
  ];

  const found = candidates.find((p) => existsSync(p));
  if (!found) {
    console.error('Local SQLite not found. Set LOCAL_SQLITE_PATH to your mama-babi.db file.');
    console.error('Tried:', candidates.join('\n  '));
    process.exit(1);
  }
  return found;
}

type SqliteRow = Record<string, unknown>;

function pickRows(sqlite: DatabaseSync, table: string): SqliteRow[] {
  return sqlite.prepare(`SELECT * FROM ${table} WHERE is_deleted = 0`).all() as SqliteRow[];
}

async function bootstrap() {
  const sqlitePath = resolveSqlitePath();
  console.log('Reading local SQLite:', sqlitePath);

  const sqlite = new DatabaseSync(sqlitePath, { readOnly: true });
  const db = createPostgresDatabase(connectionString);
  const now = new Date().toISOString();
  const deviceId = 'cloud';
  const branchId = 'main';

  const localUsers = pickRows(sqlite, 'users');
  const localReceipts = pickRows(sqlite, 'receipt_templates');
  const localLabels = pickRows(sqlite, 'label_templates');
  const localSettings = pickRows(sqlite, 'settings');

  if (!localUsers.length) {
    console.error('No users in local database.');
    process.exit(1);
  }

  // Clear cloud config data only — products/vendors/sales stay empty
  await db.delete(receiptTemplates);
  await db.delete(labelTemplates);
  await db.delete(users);
  await db.delete(settings);

  const settingKeys = new Set([
    'store_name',
    'store_address',
    'store_phone',
    'store_email',
    'currency',
    'tax_inclusive',
    'default_tax_rate',
    'auto_print_receipt',
    'device_id',
    'branch_id',
    'default_retail_markup',
    'secondary_currency',
    'exchange_rate',
    'sale_counter',
    'grn_counter',
    'return_counter',
  ]);

  for (const row of localSettings) {
    const key = String(row.key);
    if (!settingKeys.has(key)) continue;
    const value = key.endsWith('_counter') ? '0' : String(row.value);
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

  for (const row of localUsers) {
    if (!row.password_hash) continue;
    await db.insert(users).values({
      id: String(row.id),
      name: String(row.name),
      username: row.username ? String(row.username) : null,
      passwordHash: String(row.password_hash),
      pinHash: row.pin_hash ? String(row.pin_hash) : null,
      role: String(row.role),
      isActive: row.is_active !== 0,
      failedLoginAttempts: Number(row.failed_login_attempts ?? 0),
      lockedUntil: row.locked_until ? String(row.locked_until) : null,
      deviceId,
      branchId,
      createdAt: String(row.created_at ?? now),
      updatedAt: String(row.updated_at ?? now),
    });
  }

  for (const row of localReceipts) {
    await db.insert(receiptTemplates).values({
      id: String(row.id),
      name: String(row.name),
      headerJson: String(row.header_json),
      footerJson: String(row.footer_json),
      isDefault: !!row.is_default,
      deviceId,
      branchId,
      createdAt: String(row.created_at ?? now),
      updatedAt: String(row.updated_at ?? now),
    });
  }

  for (const row of localLabels) {
    await db.insert(labelTemplates).values({
      id: String(row.id),
      name: String(row.name),
      widthMm: Number(row.width_mm),
      heightMm: Number(row.height_mm),
      layoutJson: String(row.layout_json),
      rollConfigJson: row.roll_config_json ? String(row.roll_config_json) : null,
      isDefault: !!row.is_default,
      deviceId,
      branchId,
      createdAt: String(row.created_at ?? now),
      updatedAt: String(row.updated_at ?? now),
    });
  }

  sqlite.close();
  await db.$client.end();

  console.log('\nBootstrap complete (designs + admin copied from local SQLite).');
  console.log(`  Users:            ${localUsers.filter((u) => u.password_hash).length}`);
  console.log(`  Receipt templates: ${localReceipts.length}`);
  console.log(`  Label templates:   ${localLabels.length}`);
  console.log('  Products/vendors:  unchanged (empty)');
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
