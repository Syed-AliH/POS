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

CREATE TABLE IF NOT EXISTS promo_codes (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  description TEXT,
  type TEXT NOT NULL,
  value REAL NOT NULL,
  start_date TEXT,
  end_date TEXT,
  min_purchase REAL,
  product_ids TEXT,
  category_ids TEXT,
  usage_limit INTEGER,
  usage_count INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  device_id TEXT NOT NULL DEFAULT 'local',
  branch_id TEXT NOT NULL DEFAULT 'main',
  is_deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_promo_codes_code ON promo_codes(code);

-- Hot-path indexes (mirrors the Postgres set in packages/db-pg/drizzle/0004_*).
CREATE INDEX IF NOT EXISTS idx_products_live ON products(is_deleted, status);
CREATE INDEX IF NOT EXISTS idx_sales_status_created ON sales(status, created_at);
CREATE INDEX IF NOT EXISTS idx_sales_held_key ON sales(held_key);
CREATE INDEX IF NOT EXISTS idx_sales_customer ON sales(customer_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_product ON sale_items(product_id);
CREATE INDEX IF NOT EXISTS idx_inventory_reference ON inventory_movements(reference_id);
CREATE INDEX IF NOT EXISTS idx_inventory_prod_created ON inventory_movements(product_id, created_at);
CREATE INDEX IF NOT EXISTS idx_customers_live ON customers(is_deleted);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_grn_headers_created ON grn_headers(created_at);
CREATE INDEX IF NOT EXISTS idx_grn_lines_product ON grn_lines(product_id);
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
  'ALTER TABLE products ADD COLUMN base_retail_price REAL',
  'ALTER TABLE products ADD COLUMN base_sale_price REAL',
  'ALTER TABLE products ADD COLUMN prev_retail_price REAL',
  'ALTER TABLE products ADD COLUMN prev_sale_price REAL',
];

/** Statements that only run once the ALTERs above have added their columns. */
const BACKFILL_STATEMENTS = [
  // Existing products get their current price as the "original" baseline.
  'UPDATE products SET base_retail_price = retail_price WHERE base_retail_price IS NULL',
  'UPDATE products SET base_sale_price = sale_price WHERE base_sale_price IS NULL AND sale_price IS NOT NULL',
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
  for (const stmt of BACKFILL_STATEMENTS) {
    try {
      sqlite.exec(stmt);
    } catch {
      // table/columns not present yet — safe to skip
    }
  }
}
