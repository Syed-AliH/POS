import { pgTable, text } from 'drizzle-orm/pg-core';
import { syncColumns, timestamps } from './base';

export const settings = pgTable('settings', {
  id: text('id').primaryKey(),
  key: text('key').notNull().unique(),
  value: text('value').notNull(),
  scope: text('scope').notNull().default('global'),
  ...syncColumns,
  ...timestamps,
});
