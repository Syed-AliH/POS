import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DATABASE_PATH ?? path.join(__dirname, '../../../data/mama-babi.db');
const migrationsDir = path.join(__dirname, '../drizzle');

fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS __drizzle_migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

const applied = new Set(
  db.prepare('SELECT hash FROM __drizzle_migrations').all().map((r) => (r as { hash: string }).hash),
);

if (!fs.existsSync(migrationsDir)) {
  console.log('No migrations folder yet. Run pnpm db:generate first.');
  db.close();
  process.exit(0);
}

const files = fs
  .readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort();

for (const file of files) {
  const hash = file.replace('.sql', '');
  if (applied.has(hash)) continue;

  const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
  const statements = sql
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter(Boolean);

  const migrate = db.transaction(() => {
    for (const statement of statements) {
      db.exec(statement);
    }
    db.prepare('INSERT INTO __drizzle_migrations (hash) VALUES (?)').run(hash);
  });

  migrate();
  console.log(`Applied migration: ${file}`);
}

db.close();
console.log('Migrations complete.');
