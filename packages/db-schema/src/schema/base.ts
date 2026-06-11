import { integer, text } from 'drizzle-orm/sqlite-core';

export const syncColumns = {
  deviceId: text('device_id').notNull().default('local'),
  branchId: text('branch_id').notNull().default('main'),
  isDeleted: integer('is_deleted', { mode: 'boolean' }).notNull().default(false),
};

export const timestamps = {
  createdAt: text('created_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
};
