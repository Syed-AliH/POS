import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { syncColumns, timestamps } from './base';

export const grnHeaders = sqliteTable('grn_headers', {
  id: text('id').primaryKey(),
  grnNumber: text('grn_number').notNull().unique(),
  vendorId: text('vendor_id').notNull(),
  invoiceNumber: text('invoice_number'),
  invoiceTotal: real('invoice_total').notNull().default(0),
  receivedDate: text('received_date').notNull(),
  status: text('status', { enum: ['draft', 'finalized', 'cancelled'] }).notNull().default('draft'),
  notes: text('notes'),
  createdBy: text('created_by').notNull(),
  ...syncColumns,
  ...timestamps,
});

export const grnLines = sqliteTable('grn_lines', {
  id: text('id').primaryKey(),
  grnId: text('grn_id').notNull(),
  productId: text('product_id').notNull(),
  qty: integer('qty').notNull(),
  unitCost: real('unit_cost').notNull(),
  unitRetail: real('unit_retail'),
  lineTotal: real('line_total').notNull(),
  ...syncColumns,
  ...timestamps,
});

export const productCostHistory = sqliteTable('product_cost_history', {
  id: text('id').primaryKey(),
  productId: text('product_id').notNull(),
  vendorId: text('vendor_id'),
  costPrice: real('cost_price').notNull(),
  qty: integer('qty').notNull().default(0),
  sourceType: text('source_type').notNull(),
  sourceId: text('source_id'),
  ...syncColumns,
  ...timestamps,
});

export const eodClosings = sqliteTable('eod_closings', {
  id: text('id').primaryKey(),
  closingDate: text('closing_date').notNull().unique(),
  totalSales: real('total_sales').notNull().default(0),
  transactionCount: integer('transaction_count').notNull().default(0),
  returnsTotal: real('returns_total').notNull().default(0),
  expensesTotal: real('expenses_total').notNull().default(0),
  cashCollected: real('cash_collected').notNull().default(0),
  openingFloat: real('opening_float').notNull().default(0),
  closingFloat: real('closing_float'),
  variance: real('variance'),
  paymentBreakdownJson: text('payment_breakdown_json'),
  closedBy: text('closed_by').notNull(),
  closedAt: text('closed_at').notNull(),
  ...syncColumns,
  ...timestamps,
});
