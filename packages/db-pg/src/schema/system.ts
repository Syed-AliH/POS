import { index, pgTable, text } from 'drizzle-orm/pg-core';
import { syncColumns, timestamps } from './base';

export const auditLogs = pgTable('audit_logs', {
  id: text('id').primaryKey(),
  userId: text('user_id'),
  module: text('module').notNull(),
  action: text('action').notNull(),
  recordId: text('record_id'),
  oldValue: text('old_value'),
  newValue: text('new_value'),
  ip: text('ip'),
  ...syncColumns,
  createdAt: text('created_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
}, (t) => ({
  createdIdx: index('idx_audit_logs_created').on(t.createdAt),
  moduleCreatedIdx: index('idx_audit_logs_module_created').on(t.module, t.createdAt),
}));

export const syncQueue = pgTable('sync_queue', {
  id: text('id').primaryKey(),
  tableName: text('table_name').notNull(),
  recordId: text('record_id').notNull(),
  operation: text('operation', { enum: ['INSERT', 'UPDATE', 'DELETE'] }).notNull(),
  payload: text('payload').notNull(),
  status: text('status').notNull().default('pending'),
  ...syncColumns,
  ...timestamps,
});
