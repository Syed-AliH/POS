import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { createDatabase, type DatabaseClient } from '@mama-babi/db-schema/client';
import { runMigrations } from './migrate';

let db: DatabaseClient | null = null;

export function getDbPath(): string {
  const userData = app.getPath('userData');
  return path.join(userData, 'mama-babi.db');
}

export function initDatabase(): DatabaseClient {
  if (db) return db;

  const dbPath = getDbPath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  runMigrations(dbPath);
  db = createDatabase(dbPath);
  return db;
}

export function getDb(): DatabaseClient {
  if (!db) throw new Error('Database not initialized');
  return db;
}
