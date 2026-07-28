import { safeStorage } from 'electron';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import postgres from 'postgres';
import {
  parseConnectionUrl,
  passwordFromUrl,
  redactSecrets,
  withPassword,
  type DatabaseConnectionInfo,
} from '@shared/databaseUrl';
import { ensureRuntimeDir, getDbCredentialsPath } from '../runtimePaths';

interface StoredCredentials {
  /** base64 of the safeStorage-encrypted password. Never plaintext. */
  passwordEnc: string;
  updatedAt: string;
}

/**
 * Cached decrypted password. Held in memory only — decrypting on every read
 * would be needless work, and the value never leaves this module unredacted.
 */
let cachedPassword: string | null | undefined;

function readStore(): StoredCredentials | null {
  const path = getDbCredentialsPath();
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Partial<StoredCredentials>;
    if (!parsed.passwordEnc) return null;
    return { passwordEnc: parsed.passwordEnc, updatedAt: parsed.updatedAt ?? '' };
  } catch {
    // A corrupt override must not brick startup — fall back to the bundled URL.
    console.warn('[dbCredentials] Stored credentials file is unreadable; ignoring it.');
    return null;
  }
}

/** The admin-set password, or null when none has been saved. */
export function getStoredPassword(): string | null {
  if (cachedPassword !== undefined) return cachedPassword;

  const store = readStore();
  if (!store) {
    cachedPassword = null;
    return null;
  }

  try {
    cachedPassword = safeStorage.decryptString(Buffer.from(store.passwordEnc, 'base64'));
  } catch {
    // Typically means the OS user or machine changed, so the ciphertext can no
    // longer be unsealed. Ignore it and let the bundled credentials apply.
    console.warn('[dbCredentials] Stored password could not be decrypted; ignoring it.');
    cachedPassword = null;
  }
  return cachedPassword;
}

export function getPasswordUpdatedAt(): string | null {
  const store = readStore();
  return store?.updatedAt || null;
}

/** The connection URL the app should actually use: base URL + password override. */
export function resolveDatabaseUrl(baseUrl: string): string {
  const override = getStoredPassword();
  if (!override) return baseUrl;
  try {
    return withPassword(baseUrl, override);
  } catch {
    return baseUrl;
  }
}

/** Redacted summary safe to send to the renderer. */
export function describeConnection(baseUrl: string): DatabaseConnectionInfo | null {
  const parsed = parseConnectionUrl(baseUrl);
  if (!parsed) return null;
  return {
    ...parsed,
    hasStoredPassword: getStoredPassword() !== null,
    passwordUpdatedAt: getPasswordUpdatedAt(),
  };
}

/** Every secret that must be scrubbed from a message before it leaves this module. */
function knownSecrets(baseUrl: string): string[] {
  return [passwordFromUrl(baseUrl), getStoredPassword() ?? ''].filter(Boolean);
}

function friendlyConnectionError(
  err: unknown,
  baseUrl: string,
  candidate: string,
  password: string,
): string {
  const code = (err as { code?: string })?.code;
  const raw = err instanceof Error ? err.message : String(err);

  switch (code) {
    case '28P01':
    case '28000': {
      // Passwords inside a connection URL are percent-encoded (`@` becomes
      // `%40`). Copying one straight out of .env is a very easy mistake, and
      // the raw rejection gives no clue that is what happened.
      if (/%[0-9A-Fa-f]{2}/.test(password)) {
        return (
          'The database rejected that password. It looks like it was copied from a connection ' +
          'string, where special characters are encoded — for example “%40” means “@”. Enter the ' +
          'actual password rather than the encoded form.'
        );
      }
      return 'The database rejected that password. Check it and try again.';
    }
    case '3D000':
      return 'Connected to the server, but that database does not exist.';
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return 'Cannot find the database server. Check your internet connection.';
    case 'ECONNREFUSED':
      return 'The database server refused the connection. It may be down or blocking this network.';
    case 'ENETUNREACH':
    case 'EHOSTUNREACH':
    case 'ETIMEDOUT':
    case 'CONNECT_TIMEOUT': {
      // Supabase direct-connection hosts are IPv6-only. On a network without
      // IPv6 the connection times out no matter what the password is, so say so
      // rather than sending the admin off to check their password again.
      const host = parseConnectionUrl(baseUrl)?.host ?? '';
      if (/^db\..*\.supabase\.co$/.test(host)) {
        return (
          'Could not reach the database server. This connection uses Supabase’s direct host ' +
          `(${host}), which requires IPv6 — most networks do not have it. Switch the app to the ` +
          'Supabase connection pooler host, which works over IPv4. This is not a password problem.'
        );
      }
      return 'Timed out reaching the database server. It may be offline, or a firewall may be blocking the connection.';
    }
    default:
      // Fall back to the driver text, scrubbed of anything credential-shaped.
      return `Could not connect: ${redactSecrets(raw, ...knownSecrets(baseUrl), passwordFromUrl(candidate))}`;
  }
}

/**
 * Open a throwaway connection with the candidate password and run a trivial
 * query. Nothing is persisted unless this succeeds.
 */
export async function testConnection(
  baseUrl: string,
  password: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  let candidate: string;
  try {
    candidate = withPassword(baseUrl, password);
  } catch {
    return { ok: false, error: 'The configured connection URL is malformed. Contact support.' };
  }

  const attempt = async (ssl: false | { rejectUnauthorized: boolean }) => {
    const sql = postgres(candidate, {
      ssl,
      max: 1,
      connect_timeout: 10,
      idle_timeout: 5,
      prepare: false,
      // The driver logs the connection string on notices otherwise.
      onnotice: () => {},
    });
    try {
      await sql`select 1 as ok`;
    } finally {
      await sql.end({ timeout: 5 }).catch(() => {});
    }
  };

  try {
    // Matches the bundled API, which runs with SSL enabled and lax cert checks.
    await attempt({ rejectUnauthorized: false });
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/does not support SSL|server does not support SSL/i.test(message)) {
      try {
        await attempt(false);
        return { ok: true };
      } catch (plainErr) {
        return { ok: false, error: friendlyConnectionError(plainErr, baseUrl, candidate, password) };
      }
    }
    return { ok: false, error: friendlyConnectionError(err, baseUrl, candidate, password) };
  }
}

/** Persist the password encrypted. Callers must have validated it first. */
export function savePassword(password: string): { ok: true } | { ok: false; error: string } {
  if (!safeStorage.isEncryptionAvailable()) {
    return {
      ok: false,
      error:
        'Secure storage is unavailable on this machine, so the password cannot be saved safely. ' +
        'Contact support rather than storing it unencrypted.',
    };
  }

  try {
    ensureRuntimeDir();
    const payload: StoredCredentials = {
      passwordEnc: safeStorage.encryptString(password).toString('base64'),
      updatedAt: new Date().toISOString(),
    };
    writeFileSync(getDbCredentialsPath(), JSON.stringify(payload, null, 2), {
      encoding: 'utf-8',
      mode: 0o600,
    });
    cachedPassword = password;
    return { ok: true };
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Could not save the password: ${redactSecrets(raw, password)}` };
  }
}

/** Drop the override and fall back to the bundled connection URL. */
export function clearStoredPassword(): void {
  const path = getDbCredentialsPath();
  if (existsSync(path)) unlinkSync(path);
  cachedPassword = null;
}
