export function localCalendarDate(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function coerceReportDateRange(params?: { startDate?: string; endDate?: string }) {
  const today = localCalendarDate();
  const startDate = params?.startDate?.trim() || today;
  const endDate = params?.endDate?.trim() || startDate;
  if (startDate <= endDate) return { startDate, endDate };
  return { startDate: endDate, endDate: startDate };
}

/** Inclusive local calendar-day range for ISO text timestamps. */
export function isoRangeBounds(range: { startDate: string; endDate: string }) {
  const end = new Date(`${range.endDate}T12:00:00`);
  end.setDate(end.getDate() + 1);
  const endExclusive = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}T00:00:00.000`;
  return {
    startInclusive: `${range.startDate}T00:00:00.000`,
    endExclusive,
  };
}
