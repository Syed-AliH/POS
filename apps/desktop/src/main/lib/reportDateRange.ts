import { sql, type SQL } from 'drizzle-orm';
import { localCalendarDate } from '@shared/datetime';
import type { ReportDateRange } from '@shared/types';

export { localCalendarDate };

export function coerceReportDateRange(params?: ReportDateRange | string): { startDate: string; endDate: string } {
  const today = localCalendarDate();
  if (typeof params === 'string') {
    return { startDate: params, endDate: params };
  }
  const startDate = params?.startDate ?? today;
  const endDate = params?.endDate ?? startDate;
  if (startDate <= endDate) return { startDate, endDate };
  return { startDate: endDate, endDate: startDate };
}

export function formatReportPeriod(range: { startDate: string; endDate: string }): string {
  return range.startDate === range.endDate ? range.startDate : `${range.startDate} → ${range.endDate}`;
}

/** Filter ISO timestamps to full local calendar days within [startDate, endDate] inclusive. */
export function createdAtInLocalRange(
  createdAtColumn: unknown,
  params?: ReportDateRange | string,
): SQL {
  const { startDate, endDate } = coerceReportDateRange(params);
  return sql`datetime(${createdAtColumn}, 'localtime') >= datetime(${startDate} || ' 00:00:00')
    AND datetime(${createdAtColumn}, 'localtime') < datetime(${endDate} || ' 00:00:00', '+1 day')`;
}
