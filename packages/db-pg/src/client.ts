import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema';

export type PostgresClient = ReturnType<typeof createPostgresDatabase>;

export function createPostgresDatabase(connectionString: string, poolOptions?: pg.PoolConfig) {
  const pool = new pg.Pool({
    connectionString,
    max: poolOptions?.max ?? 10,
    ...poolOptions,
  });
  return drizzle(pool, { schema });
}

export function createPostgresPool(connectionString: string, poolOptions?: pg.PoolConfig) {
  return new pg.Pool({
    connectionString,
    max: poolOptions?.max ?? 10,
    ...poolOptions,
  });
}
