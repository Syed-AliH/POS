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

  if (!rows.length) {
    console.log('No tables found.');
    process.exit(0);
  }

  let enabled = 0;
  for (const { tablename } of rows) {
    await client.query(`ALTER TABLE public."${tablename}" ENABLE ROW LEVEL SECURITY`);
    enabled++;
  }

  console.log(`\nRLS enabled on ${enabled} tables.`);
  console.log('\nIMPORTANT: The postgres/service-role user bypasses RLS.');
  console.log('Your API uses that role so all queries still work.');
  console.log('The Supabase anon/public REST API is now blocked for all tables.');
  console.log('\nYou do NOT need policies for the current POS setup.');
  console.log('Add policies only if you later use Supabase Auth or direct client access.');
} finally {
  client.release();
  await pool.end();
}
