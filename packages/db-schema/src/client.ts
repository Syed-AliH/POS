import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';

export type DatabaseClient = ReturnType<typeof createDatabase>;

export function createDatabase(dbPath: string) {
  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  // NORMAL is the usual POS trade-off with WAL: no fsync per commit (the dominant
  // cost when a sale writes several statements), and only the last transaction can
  // be lost on a power cut — the database itself cannot corrupt.
  sqlite.pragma('synchronous = NORMAL');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('cache_size = -64000'); // 64 MB page cache
  sqlite.pragma('mmap_size = 268435456'); // 256 MB memory-mapped reads
  sqlite.pragma('temp_store = MEMORY');
  return drizzle(sqlite, { schema });
}

export function runMigrations(dbPath: string, sql: string) {
  const sqlite = new Database(dbPath);
  sqlite.exec(sql);
  sqlite.close();
}
