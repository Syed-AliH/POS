import type { FastifyInstance } from 'fastify';
import type { PostgresClient } from '@mama-babi/db-pg';
import { createPostgresDatabase, syncSkuPrefixes } from '@mama-babi/db-pg';
import type { AppConfig } from '../config';

declare module 'fastify' {
  interface FastifyInstance {
    db: PostgresClient;
  }
}

export async function registerDatabase(app: FastifyInstance, config: AppConfig) {
  const sslOptions = config.NODE_ENV === 'production' || config.DATABASE_URL.includes('supabase')
    ? { rejectUnauthorized: false }
    : undefined;

  const db = createPostgresDatabase(config.DATABASE_URL, {
    ssl: sslOptions,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });

  app.decorate('db', db);

  try {
    const result = await syncSkuPrefixes(db);
    if (result.categoriesUpdated > 0 || result.productsUpdated > 0) {
      app.log.info(
        { ...result },
        'Synced category SKU prefixes and product SKUs',
      );
    }
  } catch (err) {
    app.log.error({ err }, 'SKU prefix sync failed');
  }

  app.addHook('onClose', async () => {
    await db.$client.end();
  });
}
