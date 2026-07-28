/**
 * Helpers for working with the Postgres connection URL without ever exposing the
 * password. Shared between the main process (which holds the real credentials)
 * and the renderer (which only ever sees the redacted summary type).
 */

export interface DatabaseConnectionInfo {
  /** Host name only — no credentials. */
  host: string;
  port: string;
  database: string;
  username: string;
  /** True when an admin-supplied password override is in effect. */
  hasStoredPassword: boolean;
  /** ISO timestamp of the last password change, if any. */
  passwordUpdatedAt: string | null;
}

/**
 * Parse a connection URL. Returns null rather than throwing, and never includes
 * the password in the result.
 */
/**
 * Percent-decode, tolerating malformed escapes. A password containing a literal
 * `%` produces an invalid escape sequence that would otherwise throw.
 */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function parseConnectionUrl(
  url: string,
): { host: string; port: string; database: string; username: string } | null {
  try {
    const parsed = new URL(url);
    if (!/^postgres(ql)?:$/.test(parsed.protocol)) return null;
    return {
      host: parsed.hostname,
      port: parsed.port || '5432',
      database: parsed.pathname.replace(/^\//, '') || 'postgres',
      username: safeDecode(parsed.username),
    };
  } catch {
    return null;
  }
}

/**
 * Return the URL with `password` substituted in.
 *
 * The password is percent-encoded explicitly rather than relying on the WHATWG
 * URL setter: that setter leaves `%` untouched, so a password like `50%off`
 * would come back out as an invalid escape (or, worse, decode to something
 * else). `encodeURIComponent` escapes `%` as `%25`, which the Postgres driver
 * then decodes back to the exact original string.
 */
export function withPassword(url: string, password: string): string {
  const parsed = new URL(url);
  parsed.password = encodeURIComponent(password);
  return parsed.toString();
}

/** The current password in a URL, decoded. Empty string when absent. */
export function passwordFromUrl(url: string): string {
  try {
    return safeDecode(new URL(url).password);
  } catch {
    return '';
  }
}

/**
 * Strip credentials out of arbitrary text before it reaches a log or the UI.
 * Driver errors and stack traces routinely embed the whole connection string,
 * so every message that leaves the credential layer goes through this.
 */
export function redactSecrets(text: string, ...secrets: string[]): string {
  let output = text;

  // Any userinfo in a URL: postgres://user:secret@host → postgres://user:***@host
  output = output.replace(/(\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)[^\s@]*@/gi, '$1***@');

  // Literal occurrences of known secrets, plus their percent-encoded forms.
  for (const secret of secrets) {
    if (!secret || secret.length < 3) continue;
    for (const variant of new Set([secret, encodeURIComponent(secret)])) {
      output = output.split(variant).join('***');
    }
  }

  return output;
}

export function validatePasswordInput(password: string): string | null {
  if (!password) return 'Enter the database password.';
  if (password.length > 512) return 'That password is too long to be valid.';
  if (/[\u0000-\u001f\u007f]/.test(password)) {
    return 'The password contains invalid control characters.';
  }
  return null;
}
