import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { syncColumns, timestamps } from './base';

export const settings = sqliteTable('settings', {
  id: text('id').primaryKey(),
  key: text('key').notNull().unique(),
  value: text('value').notNull(),
  scope: text('scope').notNull().default('global'),
  ...syncColumns,
  ...timestamps,
});
