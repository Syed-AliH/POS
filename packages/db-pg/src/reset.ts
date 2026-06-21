import './load-env';
import pg from 'pg';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString });
const client = await pool.connect();

try {
  const { rows } = await client.query<{ tablename: string }>(`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename NOT LIKE '__drizzle%'
    ORDER BY tablename
  `);

  if (rows.length === 0) {
    console.log('No application tables found — database is already empty.');
    process.exit(0);
  }

  const tableList = rows.map((r) => `"${r.tablename}"`).join(', ');
  await client.query(`TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE`);

  console.log(`Cleared ${rows.length} tables:`);
  for (const { tablename } of rows) {
    console.log(`  - ${tablename}`);
  }
  console.log('\nDatabase is empty. Run pnpm db:pg:seed only if you want default users and settings.');
} finally {
  client.release();
  await pool.end();
}
