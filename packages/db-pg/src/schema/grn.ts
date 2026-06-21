import { doublePrecision, integer, pgTable, text } from 'drizzle-orm/pg-core';
import { syncColumns, timestamps } from './base';

export const grnHeaders = pgTable('grn_headers', {
  id: text('id').primaryKey(),
  grnNumber: text('grn_number').notNull().unique(),
  vendorId: text('vendor_id').notNull(),
  invoiceNumber: text('invoice_number'),
  invoiceTotal: doublePrecision('invoice_total').notNull().default(0),
  receivedDate: text('received_date').notNull(),
  status: text('status', { enum: ['draft', 'finalized', 'cancelled'] }).notNull().default('draft'),
  paymentType: text('payment_type', { enum: ['cash', 'credit'] }).notNull().default('cash'),
  notes: text('notes'),
  createdBy: text('created_by').notNull(),
  ...syncColumns,
  ...timestamps,
});

export const grnLines = pgTable('grn_lines', {
  id: text('id').primaryKey(),
  grnId: text('grn_id').notNull(),
  productId: text('product_id').notNull(),
  qty: integer('qty').notNull(),
  unitCost: doublePrecision('unit_cost').notNull(),
  unitRetail: doublePrecision('unit_retail'),
  lineTotal: doublePrecision('line_total').notNull(),
  ...syncColumns,
  ...timestamps,
});

export const productCostHistory = pgTable('product_cost_history', {
  id: text('id').primaryKey(),
  productId: text('product_id').notNull(),
  vendorId: text('vendor_id'),
  costPrice: doublePrecision('cost_price').notNull(),
  qty: integer('qty').notNull().default(0),
  sourceType: text('source_type').notNull(),
  sourceId: text('source_id'),
  ...syncColumns,
  ...timestamps,
});

export const eodClosings = pgTable('eod_closings', {
  id: text('id').primaryKey(),
  closingDate: text('closing_date').notNull().unique(),
  totalSales: doublePrecision('total_sales').notNull().default(0),
  transactionCount: integer('transaction_count').notNull().default(0),
  returnsTotal: doublePrecision('returns_total').notNull().default(0),
  expensesTotal: doublePrecision('expenses_total').notNull().default(0),
  cashCollected: doublePrecision('cash_collected').notNull().default(0),
  openingFloat: doublePrecision('opening_float').notNull().default(0),
  closingFloat: doublePrecision('closing_float'),
  variance: doublePrecision('variance'),
  paymentBreakdownJson: text('payment_breakdown_json'),
  closedBy: text('closed_by').notNull(),
  closedAt: text('closed_at').notNull(),
  ...syncColumns,
  ...timestamps,
});
