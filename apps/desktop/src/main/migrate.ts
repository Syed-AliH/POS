import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { runIncrementalMigrations } from './migrate-incremental';

const MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  pin_hash TEXT,
  role TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  failed_login_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  device_id TEXT NOT NULL DEFAULT 'local',
  branch_id TEXT NOT NULL DEFAULT 'main',
  is_deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  value TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'global',
  device_id TEXT NOT NULL DEFAULT 'local',
  branch_id TEXT NOT NULL DEFAULT 'main',
  is_deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  parent_id TEXT,
  color TEXT,
  device_id TEXT NOT NULL DEFAULT 'local',
  branch_id TEXT NOT NULL DEFAULT 'main',
  is_deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS brands (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  logo_path TEXT,
  country TEXT,
  device_id TEXT NOT NULL DEFAULT 'local',
  branch_id TEXT NOT NULL DEFAULT 'main',
  is_deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS vendors (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  contact TEXT,
  email TEXT,
  address TEXT,
  payment_terms TEXT,
  device_id TEXT NOT NULL DEFAULT 'local',
  branch_id TEXT NOT NULL DEFAULT 'main',
  is_deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT UNIQUE,
  email TEXT UNIQUE,
  address TEXT,
  notes TEXT,
  loyalty_points INTEGER NOT NULL DEFAULT 0,
  total_spent REAL NOT NULL DEFAULT 0,
  visit_count INTEGER NOT NULL DEFAULT 0,
  birthday TEXT,
  segment TEXT DEFAULT 'new',
  device_id TEXT NOT NULL DEFAULT 'local',
  branch_id TEXT NOT NULL DEFAULT 'main',
  is_deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS loyalty_rules (
  id TEXT PRIMARY KEY,
  spend_threshold REAL NOT NULL,
  points_awarded INTEGER NOT NULL,
  redemption_rate REAL NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  device_id TEXT NOT NULL DEFAULT 'local',
  branch_id TEXT NOT NULL DEFAULT 'main',
  is_deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sku TEXT NOT NULL UNIQUE,
  barcode TEXT NOT NULL UNIQUE,
  category_id TEXT,
  brand_id TEXT,
  vendor_id TEXT,
  parent_id TEXT,
  cost_price REAL NOT NULL DEFAULT 0,
  retail_price REAL NOT NULL DEFAULT 0,
  sale_price REAL,
  tax_rate REAL NOT NULL DEFAULT 0,
  stock_qty INTEGER NOT NULL DEFAULT 0,
  reorder_level INTEGER NOT NULL DEFAULT 0,
  reorder_qty INTEGER NOT NULL DEFAULT 0,
  expiry_date TEXT,
  weight_grams INTEGER,
  image_path TEXT,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  device_id TEXT NOT NULL DEFAULT 'local',
  branch_id TEXT NOT NULL DEFAULT 'main',
  is_deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS promotions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  value REAL NOT NULL,
  start_date TEXT,
  end_date TEXT,
  min_purchase REAL,
  product_ids TEXT,
  category_ids TEXT,
  is_stackable INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  device_id TEXT NOT NULL DEFAULT 'local',
  branch_id TEXT NOT NULL DEFAULT 'main',
  is_deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS label_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  width_mm REAL NOT NULL,
  height_mm REAL NOT NULL,
  layout_json TEXT NOT NULL,
  roll_config_json TEXT,
  is_default INTEGER NOT NULL DEFAULT 0,
  device_id TEXT NOT NULL DEFAULT 'local',
  branch_id TEXT NOT NULL DEFAULT 'main',
  is_deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS receipt_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  header_json TEXT NOT NULL,
  footer_json TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  device_id TEXT NOT NULL DEFAULT 'local',
  branch_id TEXT NOT NULL DEFAULT 'main',
  is_deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sales (
  id TEXT PRIMARY KEY,
  sale_number TEXT NOT NULL UNIQUE,
  cashier_id TEXT NOT NULL,
  customer_id TEXT,
  subtotal REAL NOT NULL DEFAULT 0,
  discount_amount REAL NOT NULL DEFAULT 0,
  discount_reason TEXT,
  tax_amount REAL NOT NULL DEFAULT 0,
  total_amount REAL NOT NULL DEFAULT 0,
  payment_method TEXT NOT NULL,
  amount_tendered REAL,
  change_given REAL,
  status TEXT NOT NULL DEFAULT 'completed',
  held_key TEXT,
  notes TEXT,
  receipt_printed INTEGER NOT NULL DEFAULT 0,
  synced_at TEXT,
  device_id TEXT NOT NULL DEFAULT 'local',
  branch_id TEXT NOT NULL DEFAULT 'main',
  is_deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sale_items (
  id TEXT PRIMARY KEY,
  sale_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  product_sku TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  unit_price REAL NOT NULL,
  discount_percent REAL NOT NULL DEFAULT 0,
  tax_rate REAL NOT NULL DEFAULT 0,
  line_total REAL NOT NULL,
  device_id TEXT NOT NULL DEFAULT 'local',
  branch_id TEXT NOT NULL DEFAULT 'main',
  is_deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS inventory_movements (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  type TEXT NOT NULL,
  qty_change INTEGER NOT NULL,
  reference_id TEXT,
  notes TEXT,
  device_id TEXT NOT NULL DEFAULT 'local',
  branch_id TEXT NOT NULL DEFAULT 'main',
  is_deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stock_adjustments (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  qty_before INTEGER NOT NULL,
  qty_after INTEGER NOT NULL,
  reason TEXT NOT NULL,
  approved_by TEXT,
  notes TEXT,
  device_id TEXT NOT NULL DEFAULT 'local',
  branch_id TEXT NOT NULL DEFAULT 'main',
  is_deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS damaged_stock (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  qty INTEGER NOT NULL,
  reason TEXT NOT NULL,
  approved_by TEXT,
  disposal_method TEXT,
  device_id TEXT NOT NULL DEFAULT 'local',
  branch_id TEXT NOT NULL DEFAULT 'main',
  is_deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id TEXT PRIMARY KEY,
  po_number TEXT NOT NULL UNIQUE,
  vendor_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  total_cost REAL NOT NULL DEFAULT 0,
  notes TEXT,
  received_at TEXT,
  device_id TEXT NOT NULL DEFAULT 'local',
  branch_id TEXT NOT NULL DEFAULT 'main',
  is_deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS po_items (
  id TEXT PRIMARY KEY,
  po_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  qty_ordered INTEGER NOT NULL,
  qty_received INTEGER NOT NULL DEFAULT 0,
  unit_cost REAL NOT NULL,
  device_id TEXT NOT NULL DEFAULT 'local',
  branch_id TEXT NOT NULL DEFAULT 'main',
  is_deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS returns (
  id TEXT PRIMARY KEY,
  return_number TEXT NOT NULL UNIQUE,
  sale_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  refund_method TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'completed',
  total_refund REAL NOT NULL DEFAULT 0,
  processed_by TEXT NOT NULL,
  device_id TEXT NOT NULL DEFAULT 'local',
  branch_id TEXT NOT NULL DEFAULT 'main',
  is_deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS return_items (
  id TEXT PRIMARY KEY,
  return_id TEXT NOT NULL,
  sale_item_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  qty_returned INTEGER NOT NULL,
  restocked INTEGER NOT NULL DEFAULT 1,
  unit_refund REAL NOT NULL,
  device_id TEXT NOT NULL DEFAULT 'local',
  branch_id TEXT NOT NULL DEFAULT 'main',
  is_deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cash_sessions (
  id TEXT PRIMARY KEY,
  cashier_id TEXT NOT NULL,
  shift_id TEXT,
  opening_float REAL NOT NULL DEFAULT 0,
  closing_float REAL,
  expected_cash REAL,
  difference REAL,
  status TEXT NOT NULL DEFAULT 'open',
  closed_at TEXT,
  device_id TEXT NOT NULL DEFAULT 'local',
  branch_id TEXT NOT NULL DEFAULT 'main',
  is_deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS shifts (
  id TEXT PRIMARY KEY,
  cashier_id TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT,
  opening_float REAL NOT NULL DEFAULT 0,
  closing_float REAL,
  status TEXT NOT NULL DEFAULT 'open',
  device_id TEXT NOT NULL DEFAULT 'local',
  branch_id TEXT NOT NULL DEFAULT 'main',
  is_deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS expense_categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  device_id TEXT NOT NULL DEFAULT 'local',
  branch_id TEXT NOT NULL DEFAULT 'main',
  is_deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS expenses (
  id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL,
  amount REAL NOT NULL,
  paid_by TEXT NOT NULL,
  notes TEXT,
  receipt_path TEXT,
  shift_id TEXT,
  approved_by TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  device_id TEXT NOT NULL DEFAULT 'local',
  branch_id TEXT NOT NULL DEFAULT 'main',
  is_deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS gift_cards (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  initial_balance REAL NOT NULL,
  current_balance REAL NOT NULL,
  issued_by TEXT,
  customer_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  expires_at TEXT,
  device_id TEXT NOT NULL DEFAULT 'local',
  branch_id TEXT NOT NULL DEFAULT 'main',
  is_deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  module TEXT NOT NULL,
  action TEXT NOT NULL,
  record_id TEXT,
  old_value TEXT,
  new_value TEXT,
  ip TEXT,
  device_id TEXT NOT NULL DEFAULT 'local',
  branch_id TEXT NOT NULL DEFAULT 'main',
  is_deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_queue (
  id TEXT PRIMARY KEY,
  table_name TEXT NOT NULL,
  record_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  device_id TEXT NOT NULL DEFAULT 'local',
  branch_id TEXT NOT NULL DEFAULT 'main',
  is_deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);
CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);
CREATE INDEX IF NOT EXISTS idx_sales_number ON sales(sale_number);
CREATE INDEX IF NOT EXISTS idx_sales_cashier ON sales(cashier_id);
CREATE INDEX IF NOT EXISTS idx_sales_created ON sales(created_at);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_inventory_product ON inventory_movements(product_id);
CREATE INDEX IF NOT EXISTS idx_sync_queue_status ON sync_queue(status, created_at);

CREATE TABLE IF NOT EXISTS stocktake_sessions (
  id TEXT PRIMARY KEY,
  started_by TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'in_progress',
  notes TEXT,
  completed_at TEXT,
  device_id TEXT NOT NULL DEFAULT 'local',
  branch_id TEXT NOT NULL DEFAULT 'main',
  is_deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stocktake_items (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  system_qty INTEGER NOT NULL,
  counted_qty INTEGER,
  device_id TEXT NOT NULL DEFAULT 'local',
  branch_id TEXT NOT NULL DEFAULT 'main',
  is_deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_stocktake_items_session ON stocktake_items(session_id);
`;

export function runMigrations(dbPath: string): void {
  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec(MIGRATION_SQL);
  runIncrementalMigrations(sqlite);
  sqlite.close();
}
