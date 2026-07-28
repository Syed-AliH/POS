import { boolean, doublePrecision, index, integer, pgTable, text } from 'drizzle-orm/pg-core';
import { syncColumns, timestamps } from './base';

export const sales = pgTable('sales', {
  id: text('id').primaryKey(),
  saleNumber: text('sale_number').notNull().unique(),
  cashierId: text('cashier_id').notNull(),
  customerId: text('customer_id'),
  subtotal: doublePrecision('subtotal').notNull().default(0),
  discountAmount: doublePrecision('discount_amount').notNull().default(0),
  discountReason: text('discount_reason'),
  taxAmount: doublePrecision('tax_amount').notNull().default(0),
  totalAmount: doublePrecision('total_amount').notNull().default(0),
  paymentMethod: text('payment_method', {
    enum: ['cash', 'card', 'bank_transfer', 'wallet', 'online'],
  }).notNull(),
  amountTendered: doublePrecision('amount_tendered'),
  changeGiven: doublePrecision('change_given'),
  status: text('status', { enum: ['completed', 'held', 'voided', 'returned'] })
    .notNull()
    .default('completed'),
  heldKey: text('held_key'),
  notes: text('notes'),
  receiptPrinted: boolean('receipt_printed').notNull().default(false),
  syncedAt: text('synced_at'),
  ...syncColumns,
  ...timestamps,
}, (t) => ({
  // Sales history and every report filter on status and order by created_at.
  statusCreatedIdx: index('idx_sales_status_created').on(t.status, t.createdAt),
  createdIdx: index('idx_sales_created').on(t.createdAt),
  heldKeyIdx: index('idx_sales_held_key').on(t.heldKey),
  customerIdx: index('idx_sales_customer').on(t.customerId),
  cashierIdx: index('idx_sales_cashier').on(t.cashierId),
}));

export const saleItems = pgTable('sale_items', {
  id: text('id').primaryKey(),
  saleId: text('sale_id').notNull(),
  productId: text('product_id').notNull(),
  productName: text('product_name').notNull(),
  productSku: text('product_sku').notNull(),
  quantity: integer('quantity').notNull(),
  unitPrice: doublePrecision('unit_price').notNull(),
  discountPercent: doublePrecision('discount_percent').notNull().default(0),
  taxRate: doublePrecision('tax_rate').notNull().default(0),
  lineTotal: doublePrecision('line_total').notNull(),
  ...syncColumns,
  ...timestamps,
}, (t) => ({
  saleIdx: index('idx_sale_items_sale').on(t.saleId),
  productIdx: index('idx_sale_items_product').on(t.productId),
}));
