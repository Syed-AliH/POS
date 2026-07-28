import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { PostgresClient } from '@mama-babi/db-pg';
import { createPostgresDatabase, syncSkuPrefixes } from '@mama-babi/db-pg';
import type { AppConfig } from '../config';
import { getSetting, setSetting } from '../services/settings.service';

/** Idempotently add the baseline/previous price-tracking columns and backfill legacy rows. */
async function ensureProductPriceColumns(db: PostgresClient) {
  // Run one statement per execute — the driver's extended protocol rejects multi-command queries.
  const statements = [
    sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS base_retail_price double precision`,
    sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS base_sale_price double precision`,
    sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS prev_retail_price double precision`,
    sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS prev_sale_price double precision`,
    sql`UPDATE products SET base_retail_price = retail_price WHERE base_retail_price IS NULL`,
    sql`UPDATE products SET base_sale_price = sale_price WHERE base_sale_price IS NULL AND sale_price IS NOT NULL`,
  ];
  for (const statement of statements) {
    await db.execute(statement);
  }
}

/**
 * Indexes now live in the drizzle migrations (packages/db-pg/drizzle/0004_*).
 * These older duplicates covered the same columns and only added write cost on
 * every insert, so drop them once.
 */
async function dropSupersededIndexes(db: PostgresClient) {
  const statements = [
    sql`DROP INDEX IF EXISTS idx_products_category_id`,
    sql`DROP INDEX IF EXISTS idx_sale_items_sale_id`,
    sql`DROP INDEX IF EXISTS idx_sale_items_product_id`,
    sql`DROP INDEX IF EXISTS idx_sales_created_at`,
    sql`DROP INDEX IF EXISTS idx_inventory_movements_product_id`,
  ];
  for (const statement of statements) {
    await db.execute(statement);
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    db: PostgresClient;
  }
}

/** Bump when a new one-off schema step is added to runBootstrapOnce. */
const BOOTSTRAP_VERSION = '2';
const BOOTSTRAP_KEY = 'schema_bootstrap_version';
const SKU_SYNC_KEY = 'sku_prefix_sync_done';

/** One-off schema maintenance. Skipped entirely once recorded, so tills stop racing it. */
async function runBootstrapOnce(app: FastifyInstance, db: PostgresClient) {
  let done: string | null = null;
  try {
    done = await getSetting(db, BOOTSTRAP_KEY);
  } catch (err) {
    // A missing settings table means a brand-new database — fall through and bootstrap.
    app.log.warn({ err }, 'Could not read bootstrap version; running bootstrap');
  }
  if (done === BOOTSTRAP_VERSION) return;

  try {
    await ensureProductPriceColumns(db);
  } catch (err) {
    app.log.error({ err }, 'Ensuring product price columns failed');
  }

  try {
    await dropSupersededIndexes(db);
  } catch (err) {
    app.log.error({ err }, 'Dropping superseded indexes failed');
  }

  try {
    await setSetting(db, BOOTSTRAP_KEY, BOOTSTRAP_VERSION);
    app.log.info({ version: BOOTSTRAP_VERSION }, 'Schema bootstrap complete');
  } catch (err) {
    // Not fatal, but it means the next launch repeats the work.
    app.log.error({ err }, 'Recording bootstrap version failed');
  }
}

/**
 * Data repair, not schema: keep retrying until it succeeds once, but never block
 * startup on it — it rewrites SKUs across the whole catalogue over the network.
 */
function scheduleSkuPrefixSync(app: FastifyInstance, db: PostgresClient) {
  setTimeout(() => {
    void (async () => {
      try {
        if ((await getSetting(db, SKU_SYNC_KEY)) === 'true') return;
        const result = await syncSkuPrefixes(db);
        await setSetting(db, SKU_SYNC_KEY, 'true');
        if (result.categoriesUpdated > 0 || result.productsUpdated > 0) {
          app.log.info({ ...result }, 'Synced category SKU prefixes and product SKUs');
        }
      } catch (err) {
        // Known failure mode: a SKU the sync wants to write already exists on another
        // product. It will retry next launch; the duplicate needs fixing in the catalogue.
        app.log.warn({ err }, 'SKU prefix sync failed — will retry on next launch');
      }
    })();
  }, 5_000).unref?.();
}

export async function registerDatabase(app: FastifyInstance, config: AppConfig) {
  const sslOptions = config.NODE_ENV === 'production' || config.DATABASE_URL.includes('supabase')
    ? { rejectUnauthorized: false }
    : undefined;

  const db = createPostgresDatabase(config.DATABASE_URL, {
    ssl: sslOptions,
    max: 10,
    // The database is remote (Supabase), so a dropped connection costs a full TLS
    // handshake on the next query. Keep sockets alive and idle connections warm —
    // a till is idle between customers and must not pay a reconnect per sale.
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
    idleTimeoutMillis: 300_000,
    connectionTimeoutMillis: 5000,
    // A wedged query must not hold a checkout hostage.
    statement_timeout: 15_000,
    query_timeout: 20_000,
    application_name: 'mama-babi-pos',
  });

  app.decorate('db', db);

  // Every till runs its own copy of this API against the shared database, so this
  // maintenance used to run ~12 remote statements (including two whole-table UPDATEs)
  // on every app launch, from every till, racing each other. Run it once per version.
  await runBootstrapOnce(app, db);
  scheduleSkuPrefixSync(app, db);

  app.addHook('onClose', async () => {
    await db.$client.end();
  });
}
