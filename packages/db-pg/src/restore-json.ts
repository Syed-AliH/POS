/**
 * Restore a `.json.gz` backup produced by the desktop app on a machine without
 * pg_dump installed.
 *
 * Usage:  DATABASE_URL=... pnpm --filter @mama-babi/db-pg restore-json <file.json.gz>
 *
 * A JSON backup holds data only, not the schema — run `pnpm --filter
 * @mama-babi/db-pg migrate` against the target database first. This replaces
 * table contents inside a single transaction: if anything fails, nothing
 * changes.
 */
import { createReadStream } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';
import pg from 'pg';

interface BackupFile {
  format: string;
  version: number;
  createdAt: string;
  tables: Record<string, Record<string, unknown>[]>;
}

/** Rows per INSERT — keeps well under Postgres' 65535 bound-parameter limit. */
const BATCH_ROWS = 500;

async function readBackup(path: string): Promise<BackupFile> {
  const chunks: Buffer[] = [];
  for await (const chunk of createReadStream(path).pipe(createGunzip())) {
    chunks.push(chunk as Buffer);
  }
  const parsed = JSON.parse(Buffer.concat(chunks).toString('utf-8')) as BackupFile;
  if (parsed.format !== 'mama-babi-json-backup') {
    throw new Error('Not a Mama Babi JSON backup file.');
  }
  return parsed;
}

async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await new Promise<string>((resolve) => rl.question(question, resolve));
    return answer.trim().toUpperCase() === 'REPLACE';
  } finally {
    rl.close();
  }
}

const quote = (ident: string) => `"${ident.replace(/"/g, '""')}"`;

async function insertRows(
  client: pg.Client,
  table: string,
  rows: Record<string, unknown>[],
): Promise<void> {
  // `select *` gives every row the same key set, so the first row defines the columns.
  const columns = Object.keys(rows[0]);
  const columnList = columns.map(quote).join(', ');

  for (let start = 0; start < rows.length; start += BATCH_ROWS) {
    const batch = rows.slice(start, start + BATCH_ROWS);
    const values: unknown[] = [];
    const tuples = batch.map((row) => {
      const placeholders = columns.map((col) => {
        values.push(row[col] ?? null);
        return `$${values.length}`;
      });
      return `(${placeholders.join(', ')})`;
    });

    await client.query(
      `insert into ${quote(table)} (${columnList}) values ${tuples.join(', ')}`,
      values,
    );
  }
}

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: pnpm --filter @mama-babi/db-pg restore-json <file.json.gz>');
    process.exit(1);
  }

  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    console.error('DATABASE_URL is not set.');
    process.exit(1);
  }

  const backup = await readBackup(file);
  const tables = Object.keys(backup.tables);
  const totalRows = tables.reduce((sum, t) => sum + backup.tables[t].length, 0);
  const target = new URL(url);

  console.log(`Backup taken : ${backup.createdAt}`);
  console.log(`Contents     : ${tables.length} tables, ${totalRows} rows`);
  console.log(`Target       : ${target.hostname}${target.pathname}`);
  console.log('\nThis DELETES all existing rows in those tables and replaces them.');

  if (!(await confirm('Type REPLACE to continue: '))) {
    console.log('Aborted.');
    process.exit(1);
  }

  const client = new pg.Client({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 20000,
  });
  await client.connect();

  try {
    await client.query('begin');

    // The schema declares no foreign keys or triggers, so plain deletes in any
    // order are safe. Verify that still holds rather than assuming it.
    const { rows: fks } = await client.query<{ n: string }>(
      "select count(*) as n from pg_constraint where contype = 'f' and connamespace = 'public'::regnamespace",
    );
    if (Number(fks[0].n) > 0) {
      throw new Error(
        `The target database has ${fks[0].n} foreign key constraint(s). This script assumes none — ` +
          'restore with pg_restore instead, or drop and recreate the schema first.',
      );
    }

    for (const table of tables) {
      await client.query(`delete from ${quote(table)}`);
    }

    for (const table of tables) {
      const rows = backup.tables[table];
      if (!rows.length) continue;
      await insertRows(client, table, rows);
      console.log(`  ${String(rows.length).padStart(6)} rows -> ${table}`);
    }

    await client.query('commit');
    console.log('\nRestore complete.');
  } catch (err) {
    await client.query('rollback').catch(() => {});
    throw err;
  } finally {
    await client.end().catch(() => {});
  }
}

main().catch((err) => {
  console.error('\nRestore failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
