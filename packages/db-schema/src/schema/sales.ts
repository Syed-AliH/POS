import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { syncColumns, timestamps } from './base';

export const sales = sqliteTable('sales', {
  id: text('id').primaryKey(),
  saleNumber: text('sale_number').notNull().unique(),
  cashierId: text('cashier_id').notNull(),
  customerId: text('customer_id'),
  subtotal: real('subtotal').notNull().default(0),
  discountAmount: real('discount_amount').notNull().default(0),
  discountReason: text('discount_reason'),
  taxAmount: real('tax_amount').notNull().default(0),
  totalAmount: real('total_amount').notNull().default(0),
  paymentMethod: text('payment_method', {
    enum: ['cash', 'card', 'bank_transfer', 'wallet'],
  }).notNull(),
  amountTendered: real('amount_tendered'),
  changeGiven: real('change_given'),
  status: text('status', { enum: ['completed', 'held', 'voided', 'returned'] })
    .notNull()
    .default('completed'),
  heldKey: text('held_key'),
  notes: text('notes'),
  receiptPrinted: integer('receipt_printed', { mode: 'boolean' }).notNull().default(false),
  syncedAt: text('synced_at'),
  ...syncColumns,
  ...timestamps,
});

export const saleItems = sqliteTable('sale_items', {
  id: text('id').primaryKey(),
  saleId: text('sale_id').notNull(),
  productId: text('product_id').notNull(),
  productName: text('product_name').notNull(),
  productSku: text('product_sku').notNull(),
  quantity: integer('quantity').notNull(),
  unitPrice: real('unit_price').notNull(),
  discountPercent: real('discount_percent').notNull().default(0),
  taxRate: real('tax_rate').notNull().default(0),
  lineTotal: real('line_total').notNull(),
  ...syncColumns,
  ...timestamps,
});
