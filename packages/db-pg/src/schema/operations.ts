import { boolean, doublePrecision, integer, pgTable, text } from 'drizzle-orm/pg-core';
import { syncColumns, timestamps } from './base';

export const purchaseOrders = pgTable('purchase_orders', {
  id: text('id').primaryKey(),
  poNumber: text('po_number').notNull().unique(),
  vendorId: text('vendor_id').notNull(),
  status: text('status', {
    enum: ['draft', 'sent', 'partially_received', 'received', 'cancelled'],
  })
    .notNull()
    .default('draft'),
  totalCost: doublePrecision('total_cost').notNull().default(0),
  notes: text('notes'),
  receivedAt: text('received_at'),
  ...syncColumns,
  ...timestamps,
});

export const poItems = pgTable('po_items', {
  id: text('id').primaryKey(),
  poId: text('po_id').notNull(),
  productId: text('product_id').notNull(),
  qtyOrdered: integer('qty_ordered').notNull(),
  qtyReceived: integer('qty_received').notNull().default(0),
  unitCost: doublePrecision('unit_cost').notNull(),
  ...syncColumns,
  ...timestamps,
});

export const returns = pgTable('returns', {
  id: text('id').primaryKey(),
  returnNumber: text('return_number').notNull().unique(),
  saleId: text('sale_id').notNull(),
  reason: text('reason').notNull(),
  refundMethod: text('refund_method').notNull(),
  status: text('status').notNull().default('completed'),
  totalRefund: doublePrecision('total_refund').notNull().default(0),
  processedBy: text('processed_by').notNull(),
  ...syncColumns,
  ...timestamps,
});

export const returnItems = pgTable('return_items', {
  id: text('id').primaryKey(),
  returnId: text('return_id').notNull(),
  saleItemId: text('sale_item_id').notNull(),
  productId: text('product_id').notNull(),
  qtyReturned: integer('qty_returned').notNull(),
  restocked: boolean('restocked').notNull().default(true),
  unitRefund: doublePrecision('unit_refund').notNull(),
  ...syncColumns,
  ...timestamps,
});

export const cashSessions = pgTable('cash_sessions', {
  id: text('id').primaryKey(),
  cashierId: text('cashier_id').notNull(),
  shiftId: text('shift_id'),
  openingFloat: doublePrecision('opening_float').notNull().default(0),
  closingFloat: doublePrecision('closing_float'),
  expectedCash: doublePrecision('expected_cash'),
  difference: doublePrecision('difference'),
  status: text('status').notNull().default('open'),
  closedAt: text('closed_at'),
  ...syncColumns,
  ...timestamps,
});

export const shifts = pgTable('shifts', {
  id: text('id').primaryKey(),
  cashierId: text('cashier_id').notNull(),
  startTime: text('start_time').notNull(),
  endTime: text('end_time'),
  openingFloat: doublePrecision('opening_float').notNull().default(0),
  closingFloat: doublePrecision('closing_float'),
  status: text('status').notNull().default('open'),
  ...syncColumns,
  ...timestamps,
});

export const expenseCategories = pgTable('expense_categories', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  ...syncColumns,
  ...timestamps,
});

export const expenses = pgTable('expenses', {
  id: text('id').primaryKey(),
  categoryId: text('category_id').notNull(),
  amount: doublePrecision('amount').notNull(),
  paidBy: text('paid_by').notNull(),
  notes: text('notes'),
  receiptPath: text('receipt_path'),
  shiftId: text('shift_id'),
  approvedBy: text('approved_by'),
  status: text('status').notNull().default('pending'),
  ...syncColumns,
  ...timestamps,
});

export const giftCards = pgTable('gift_cards', {
  id: text('id').primaryKey(),
  code: text('code').notNull().unique(),
  initialBalance: doublePrecision('initial_balance').notNull(),
  currentBalance: doublePrecision('current_balance').notNull(),
  issuedBy: text('issued_by'),
  customerId: text('customer_id'),
  status: text('status').notNull().default('active'),
  expiresAt: text('expires_at'),
  ...syncColumns,
  ...timestamps,
});
