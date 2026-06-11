import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { syncColumns, timestamps } from './base';

export const inventoryMovements = sqliteTable('inventory_movements', {
  id: text('id').primaryKey(),
  productId: text('product_id').notNull(),
  type: text('type').notNull(),
  qtyChange: integer('qty_change').notNull(),
  referenceId: text('reference_id'),
  notes: text('notes'),
  ...syncColumns,
  ...timestamps,
});

export const stockAdjustments = sqliteTable('stock_adjustments', {
  id: text('id').primaryKey(),
  productId: text('product_id').notNull(),
  qtyBefore: integer('qty_before').notNull(),
  qtyAfter: integer('qty_after').notNull(),
  reason: text('reason').notNull(),
  approvedBy: text('approved_by'),
  notes: text('notes'),
  ...syncColumns,
  ...timestamps,
});

export const stocktakeSessions = sqliteTable('stocktake_sessions', {
  id: text('id').primaryKey(),
  startedBy: text('started_by').notNull(),
  status: text('status', { enum: ['in_progress', 'completed', 'cancelled'] })
    .notNull()
    .default('in_progress'),
  notes: text('notes'),
  completedAt: text('completed_at'),
  ...syncColumns,
  ...timestamps,
});

export const stocktakeItems = sqliteTable('stocktake_items', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull(),
  productId: text('product_id').notNull(),
  systemQty: integer('system_qty').notNull(),
  countedQty: integer('counted_qty'),
  ...syncColumns,
  ...timestamps,
});

export const damagedStock = sqliteTable('damaged_stock', {
  id: text('id').primaryKey(),
  productId: text('product_id').notNull(),
  qty: integer('qty').notNull(),
  reason: text('reason').notNull(),
  approvedBy: text('approved_by'),
  disposalMethod: text('disposal_method'),
  ...syncColumns,
  ...timestamps,
});
