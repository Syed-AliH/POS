import { doublePrecision, pgTable, text } from 'drizzle-orm/pg-core';
import { syncColumns, timestamps } from './base';

export const supplierPayments = pgTable('supplier_payments', {
  id: text('id').primaryKey(),
  paymentNumber: text('payment_number').notNull().unique(),
  vendorId: text('vendor_id').notNull(),
  amount: doublePrecision('amount').notNull(),
  paymentDate: text('payment_date').notNull(),
  notes: text('notes'),
  balanceAfter: doublePrecision('balance_after').notNull().default(0),
  processedBy: text('processed_by').notNull(),
  ...syncColumns,
  ...timestamps,
});
