import './load-env';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.join(__dirname, '../drizzle');

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

async function run() {
  const pool = new pg.Pool({ connectionString });
  const db = drizzle(pool);

  await migrate(db, { migrationsFolder });
  await pool.end();
  console.log('PostgreSQL migrations complete.');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
