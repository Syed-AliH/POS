/** Consistent app-wide datetime formatting (local timezone). */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Parse ISO timestamps and calendar dates (YYYY-MM-DD). */
export function parseTimestamp(value: string | Date): Date {
  if (value instanceof Date) return value;
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const [y, m, d] = trimmed.split('-').map(Number);
    return new Date(y, m - 1, d, 0, 0, 0, 0);
  }
  return new Date(trimmed);
}

export function localCalendarDate(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = pad2(d.getMonth() + 1);
  const day = pad2(d.getDate());
  return `${y}-${m}-${day}`;
}

/** e.g. 11-Jun-2026 03:45 PM */
export function formatDateTime(value: string | Date | null | undefined, fallback = '—'): string {
  if (value == null || value === '') return fallback;
  const d = parseTimestamp(value);
  if (Number.isNaN(d.getTime())) return String(value);

  const day = pad2(d.getDate());
  const month = MONTHS[d.getMonth()];
  const year = d.getFullYear();
  let hours = d.getHours();
  const minutes = pad2(d.getMinutes());
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;

  return `${day}-${month}-${year} ${pad2(hours)}:${minutes} ${ampm}`;
}

/** Date portion only: 11-Jun-2026 */
export function formatDateOnly(value: string | Date | null | undefined, fallback = '—'): string {
  if (value == null || value === '') return fallback;
  const d = parseTimestamp(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return `${pad2(d.getDate())}-${MONTHS[d.getMonth()]}-${d.getFullYear()}`;
}

/** Time portion only: 03:45 PM */
export function formatTimeOnly(value: string | Date | null | undefined, fallback = '—'): string {
  if (value == null || value === '') return fallback;
  const d = parseTimestamp(value);
  if (Number.isNaN(d.getTime())) return fallback;
  let hours = d.getHours();
  const minutes = pad2(d.getMinutes());
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  return `${pad2(hours)}:${minutes} ${ampm}`;
}
