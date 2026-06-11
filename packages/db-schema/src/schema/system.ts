import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { syncColumns, timestamps } from './base';

export const auditLogs = sqliteTable('audit_logs', {
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
});

export const syncQueue = sqliteTable('sync_queue', {
  id: text('id').primaryKey(),
  tableName: text('table_name').notNull(),
  recordId: text('record_id').notNull(),
  operation: text('operation', { enum: ['INSERT', 'UPDATE', 'DELETE'] }).notNull(),
  payload: text('payload').notNull(),
  status: text('status').notNull().default('pending'),
  ...syncColumns,
  ...timestamps,
});
