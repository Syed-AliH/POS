import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { syncColumns, timestamps } from './base';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  username: text('username').unique(),
  passwordHash: text('password_hash'),
  pinHash: text('pin_hash'),
  role: text('role', { enum: ['super_admin', 'manager', 'cashier'] }).notNull(),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  failedLoginAttempts: integer('failed_login_attempts').notNull().default(0),
  lockedUntil: text('locked_until'),
  ...syncColumns,
  ...timestamps,
});
