import { real, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { syncColumns, timestamps } from './base';

export const supplierPayments = sqliteTable('supplier_payments', {
  id: text('id').primaryKey(),
  paymentNumber: text('payment_number').notNull().unique(),
  vendorId: text('vendor_id').notNull(),
  amount: real('amount').notNull(),
  paymentDate: text('payment_date').notNull(),
  notes: text('notes'),
  balanceAfter: real('balance_after').notNull().default(0),
  processedBy: text('processed_by').notNull(),
  ...syncColumns,
  ...timestamps,
});
