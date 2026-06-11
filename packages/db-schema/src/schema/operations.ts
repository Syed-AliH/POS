import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { syncColumns, timestamps } from './base';

export const purchaseOrders = sqliteTable('purchase_orders', {
  id: text('id').primaryKey(),
  poNumber: text('po_number').notNull().unique(),
  vendorId: text('vendor_id').notNull(),
  status: text('status', {
    enum: ['draft', 'sent', 'partially_received', 'received', 'cancelled'],
  })
    .notNull()
    .default('draft'),
  totalCost: real('total_cost').notNull().default(0),
  notes: text('notes'),
  receivedAt: text('received_at'),
  ...syncColumns,
  ...timestamps,
});

export const poItems = sqliteTable('po_items', {
  id: text('id').primaryKey(),
  poId: text('po_id').notNull(),
  productId: text('product_id').notNull(),
  qtyOrdered: integer('qty_ordered').notNull(),
  qtyReceived: integer('qty_received').notNull().default(0),
  unitCost: real('unit_cost').notNull(),
  ...syncColumns,
  ...timestamps,
});

export const returns = sqliteTable('returns', {
  id: text('id').primaryKey(),
  returnNumber: text('return_number').notNull().unique(),
  saleId: text('sale_id').notNull(),
  reason: text('reason').notNull(),
  refundMethod: text('refund_method').notNull(),
  status: text('status').notNull().default('completed'),
  totalRefund: real('total_refund').notNull().default(0),
  processedBy: text('processed_by').notNull(),
  ...syncColumns,
  ...timestamps,
});

export const returnItems = sqliteTable('return_items', {
  id: text('id').primaryKey(),
  returnId: text('return_id').notNull(),
  saleItemId: text('sale_item_id').notNull(),
  productId: text('product_id').notNull(),
  qtyReturned: integer('qty_returned').notNull(),
  restocked: integer('restocked', { mode: 'boolean' }).notNull().default(true),
  unitRefund: real('unit_refund').notNull(),
  ...syncColumns,
  ...timestamps,
});

export const cashSessions = sqliteTable('cash_sessions', {
  id: text('id').primaryKey(),
  cashierId: text('cashier_id').notNull(),
  shiftId: text('shift_id'),
  openingFloat: real('opening_float').notNull().default(0),
  closingFloat: real('closing_float'),
  expectedCash: real('expected_cash'),
  difference: real('difference'),
  status: text('status').notNull().default('open'),
  closedAt: text('closed_at'),
  ...syncColumns,
  ...timestamps,
});

export const shifts = sqliteTable('shifts', {
  id: text('id').primaryKey(),
  cashierId: text('cashier_id').notNull(),
  startTime: text('start_time').notNull(),
  endTime: text('end_time'),
  openingFloat: real('opening_float').notNull().default(0),
  closingFloat: real('closing_float'),
  status: text('status').notNull().default('open'),
  ...syncColumns,
  ...timestamps,
});

export const expenseCategories = sqliteTable('expense_categories', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  ...syncColumns,
  ...timestamps,
});

export const expenses = sqliteTable('expenses', {
  id: text('id').primaryKey(),
  categoryId: text('category_id').notNull(),
  amount: real('amount').notNull(),
  paidBy: text('paid_by').notNull(),
  notes: text('notes'),
  receiptPath: text('receipt_path'),
  shiftId: text('shift_id'),
  approvedBy: text('approved_by'),
  status: text('status').notNull().default('pending'),
  ...syncColumns,
  ...timestamps,
});

export const giftCards = sqliteTable('gift_cards', {
  id: text('id').primaryKey(),
  code: text('code').notNull().unique(),
  initialBalance: real('initial_balance').notNull(),
  currentBalance: real('current_balance').notNull(),
  issuedBy: text('issued_by'),
  customerId: text('customer_id'),
  status: text('status').notNull().default('active'),
  expiresAt: text('expires_at'),
  ...syncColumns,
  ...timestamps,
});
