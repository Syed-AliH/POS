import { app } from 'electron';
import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import postgres from 'postgres';
import { redactSecrets } from '@shared/databaseUrl';
import { resolveDatabaseUrl } from './dbCredentials';
import { getBaseDatabaseUrl } from '../localApi/server';

export interface PgBackupInfo {
  filename: string;
  path: string;
  size: number;
  createdAt: string;
  /** 'pg_dump' restores with pg_restore; 'json' restores with the bundled script. */
  method: 'pg_dump' | 'json';
}

/** Keep a week of 6-hourly backups. */
const RETENTION_COUNT = 28;

export function getBackupDir(): string {
  const dir = join(app.getPath('userData'), 'backups');
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Locate pg_dump. Present on developer machines, usually absent on shop
 * terminals — hence the JSON fallback below.
 */
function findPgDump(): string | null {
  const candidates: string[] = [];
  const programFiles = [process.env['ProgramFiles'], process.env['ProgramW6432']].filter(Boolean) as string[];

  for (const base of programFiles) {
    const pgRoot = join(base, 'PostgreSQL');
    if (!existsSync(pgRoot)) continue;
    // Prefer the highest installed major version.
    const versions = readdirSync(pgRoot)
      .filter((v) => /^\d+$/.test(v))
      .sort((a, b) => Number(b) - Number(a));
    for (const v of versions) candidates.push(join(pgRoot, v, 'bin', 'pg_dump.exe'));
  }

  return candidates.find((p) => existsSync(p)) ?? null;
}

function timestampSlug(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').replace(/Z$/, '');
}

function connectionUrl(): string {
  return resolveDatabaseUrl(getBaseDatabaseUrl());
}

async function runPgDump(exe: string, url: string, target: string): Promise<void> {
  const u = new URL(url);
  const args = [
    '-h', u.hostname,
    '-p', u.port || '5432',
    '-U', decodeURIComponent(u.username),
    '-d', u.pathname.replace(/^\//, '') || 'postgres',
    '--schema=public',
    // The restore target will have a different role, so skip ownership/ACLs.
    '--no-owner',
    '--no-privileges',
    '-Fc',
    '-f', target,
  ];

  await new Promise<void>((resolve, reject) => {
    const child = spawn(exe, args, {
      env: {
        ...process.env,
        // Passed via env, never on the command line where it would show up in
        // the process list.
        PGPASSWORD: decodeURIComponent(u.password),
        PGSSLMODE: 'require',
      },
      windowsHide: true,
    });

    let stderr = '';
    child.stderr.on('data', (c: Buffer) => {
      stderr += c.toString();
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) return resolve();
      reject(new Error(redactSecrets(stderr.trim() || `pg_dump exited with code ${code}`, decodeURIComponent(u.password))));
    });
  });
}

/**
 * Dependency-free fallback. Every column in this schema is text, double
 * precision, boolean or integer, so JSON round-trips without loss.
 */
async function runJsonDump(url: string, target: string): Promise<void> {
  const sql = postgres(url, {
    ssl: { rejectUnauthorized: false },
    max: 1,
    connect_timeout: 20,
    prepare: false,
    onnotice: () => {},
  });

  try {
    const tables = await sql<{ table_name: string }[]>`
      select table_name from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'
      order by table_name
    `;

    // Stream table-by-table so a large table never has to sit in memory twice.
    async function* chunks() {
      yield `{"format":"mama-babi-json-backup","version":1,"createdAt":${JSON.stringify(new Date().toISOString())},"tables":{`;
      let first = true;
      for (const { table_name: name } of tables) {
        const rows = await sql.unsafe(`select * from "${name}"`);
        yield `${first ? '' : ','}${JSON.stringify(name)}:${JSON.stringify(rows)}`;
        first = false;
      }
      yield '}}';
    }

    await pipeline(Readable.from(chunks()), createGzip(), createWriteStream(target));
  } finally {
    await sql.end({ timeout: 5 }).catch(() => {});
  }
}

export async function createBackup(): Promise<PgBackupInfo> {
  const url = connectionUrl();
  const dir = getBackupDir();
  const exe = findPgDump();
  const method: PgBackupInfo['method'] = exe ? 'pg_dump' : 'json';
  const filename = `mama-babi-${timestampSlug()}.${method === 'pg_dump' ? 'dump' : 'json.gz'}`;
  const target = join(dir, filename);

  try {
    if (exe) await runPgDump(exe, url, target);
    else await runJsonDump(url, target);
  } catch (err) {
    // Never leave a half-written file that looks like a valid backup.
    if (existsSync(target)) {
      try {
        unlinkSync(target);
      } catch {
        /* best effort */
      }
    }
    throw err;
  }

  const stat = statSync(target);
  if (stat.size === 0) {
    unlinkSync(target);
    throw new Error('Backup produced an empty file.');
  }

  pruneBackups();

  return {
    filename,
    path: target,
    size: stat.size,
    createdAt: new Date().toISOString(),
    method,
  };
}

export function listBackups(): PgBackupInfo[] {
  const dir = getBackupDir();
  return readdirSync(dir)
    .filter((f) => f.endsWith('.dump') || f.endsWith('.json.gz'))
    .map((filename) => {
      const path = join(dir, filename);
      const stat = statSync(path);
      return {
        filename,
        path,
        size: stat.size,
        createdAt: stat.mtime.toISOString(),
        method: filename.endsWith('.dump') ? ('pg_dump' as const) : ('json' as const),
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function pruneBackups(): void {
  const extra = listBackups().slice(RETENTION_COUNT);
  for (const b of extra) {
    try {
      unlinkSync(b.path);
    } catch {
      /* a locked file will be pruned on the next run */
    }
  }
}
