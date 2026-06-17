import type Database from 'better-sqlite3';

const INCREMENTAL_SQL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  id INTEGER PRIMARY KEY,
  version INTEGER NOT NULL UNIQUE,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS grn_headers (
  id TEXT PRIMARY KEY,
  grn_number TEXT NOT NULL UNIQUE,
  vendor_id TEXT NOT NULL,
  invoice_number TEXT,
  invoice_total REAL NOT NULL DEFAULT 0,
  received_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  notes TEXT,
  created_by TEXT NOT NULL,
  device_id TEXT NOT NULL DEFAULT 'local',
  branch_id TEXT NOT NULL DEFAULT 'main',
  is_deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS grn_lines (
  id TEXT PRIMARY KEY,
  grn_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  qty INTEGER NOT NULL,
  unit_cost REAL NOT NULL,
  line_total REAL NOT NULL,
  device_id TEXT NOT NULL DEFAULT 'local',
  branch_id TEXT NOT NULL DEFAULT 'main',
  is_deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS product_cost_history (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  vendor_id TEXT,
  cost_price REAL NOT NULL,
  qty INTEGER NOT NULL DEFAULT 0,
  source_type TEXT NOT NULL,
  source_id TEXT,
  device_id TEXT NOT NULL DEFAULT 'local',
  branch_id TEXT NOT NULL DEFAULT 'main',
  is_deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS eod_closings (
  id TEXT PRIMARY KEY,
  closing_date TEXT NOT NULL UNIQUE,
  total_sales REAL NOT NULL DEFAULT 0,
  transaction_count INTEGER NOT NULL DEFAULT 0,
  returns_total REAL NOT NULL DEFAULT 0,
  expenses_total REAL NOT NULL DEFAULT 0,
  cash_collected REAL NOT NULL DEFAULT 0,
  opening_float REAL NOT NULL DEFAULT 0,
  closing_float REAL,
  variance REAL,
  payment_breakdown_json TEXT,
  closed_by TEXT NOT NULL,
  closed_at TEXT NOT NULL,
  device_id TEXT NOT NULL DEFAULT 'local',
  branch_id TEXT NOT NULL DEFAULT 'main',
  is_deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_grn_lines_grn ON grn_lines(grn_id);
CREATE INDEX IF NOT EXISTS idx_product_cost_history_product ON product_cost_history(product_id);
CREATE INDEX IF NOT EXISTS idx_eod_closings_date ON eod_closings(closing_date);

CREATE TABLE IF NOT EXISTS supplier_payments (
  id TEXT PRIMARY KEY,
  payment_number TEXT NOT NULL UNIQUE,
  vendor_id TEXT NOT NULL,
  amount REAL NOT NULL,
  payment_date TEXT NOT NULL,
  notes TEXT,
  balance_after REAL NOT NULL DEFAULT 0,
  processed_by TEXT NOT NULL,
  device_id TEXT NOT NULL DEFAULT 'local',
  branch_id TEXT NOT NULL DEFAULT 'main',
  is_deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_supplier_payments_vendor ON supplier_payments(vendor_id);
`;

const ALTER_STATEMENTS = [
  'ALTER TABLE categories ADD COLUMN sku_prefix TEXT',
  'ALTER TABLE users ADD COLUMN username TEXT',
  'ALTER TABLE users ADD COLUMN password_hash TEXT',
  'ALTER TABLE grn_lines ADD COLUMN unit_retail REAL',
  'ALTER TABLE grn_headers ADD COLUMN payment_type TEXT NOT NULL DEFAULT \'cash\'',
  'ALTER TABLE vendors ADD COLUMN preferred_payment_type TEXT DEFAULT \'cash\'',
  'ALTER TABLE vendors ADD COLUMN outstanding_balance REAL NOT NULL DEFAULT 0',
  'ALTER TABLE label_templates ADD COLUMN roll_config_json TEXT',
];

export function runIncrementalMigrations(sqlite: Database.Database): void {
  sqlite.exec(INCREMENTAL_SQL);
  for (const stmt of ALTER_STATEMENTS) {
    try {
      sqlite.exec(stmt);
    } catch {
      // column already exists
    }
  }
}
