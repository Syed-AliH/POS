/** Returns true when the value is an HTTP(S) API base URL (not a database connection string). */
export function isValidApiUrl(url: string | null | undefined): boolean {
  if (!url?.trim()) return false;
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function apiUrlValidationError(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return 'Server URL is required.';
  if (/^postgres(ql)?:\/\//i.test(trimmed)) {
    return 'This is a database address. Enter your POS API server URL (starts with http:// or https://), not the database link.';
  }
  if (!isValidApiUrl(trimmed)) {
    return 'URL must start with http:// or https:// (example: http://localhost:3001 or https://api.yourbusiness.com).';
  }
  return null;
}
