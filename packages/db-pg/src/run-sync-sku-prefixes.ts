import './load-env';
import { createPostgresDatabase } from './client';
import { syncSkuPrefixes } from './sync-sku-prefixes';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const db = createPostgresDatabase(connectionString);

syncSkuPrefixes(db)
  .then((result) => {
    console.log(
      `SKU prefix sync complete — categories updated: ${result.categoriesUpdated}, products updated: ${result.productsUpdated}`,
    );
    return db.$client.end();
  })
  .catch((err) => {
    console.error('SKU prefix sync failed:', err);
    process.exit(1);
  });
