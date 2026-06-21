import { boolean, text } from 'drizzle-orm/pg-core';

/** Shared sync metadata — mirrors SQLite desktop schema for future cloud sync. */
export const syncColumns = {
  deviceId: text('device_id').notNull().default('local'),
  branchId: text('branch_id').notNull().default('main'),
  isDeleted: boolean('is_deleted').notNull().default(false),
};

export const timestamps = {
  createdAt: text('created_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
};
