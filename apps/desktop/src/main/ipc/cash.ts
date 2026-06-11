import { and, desc, eq, gte, lte } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import { eodClosings, expenses, returns, sales, shifts, users } from '@mama-babi/db-schema';
import type { ApiResult, EodClosingRecord, EodReport, ReportDateRange, ShiftSummary } from '@shared/types';
import { getDb } from '../db';
import { coerceReportDateRange, createdAtInLocalRange, formatReportPeriod } from '../lib/reportDateRange';
import { requireRole, requireSession } from '../session';
import { logAudit } from '../services/audit';
import { getSetting } from '../services/settings';

function mapShift(row: typeof shifts.$inferSelect): ShiftSummary {
  const db = getDb();
  const cashier = db.select().from(users).where(eq(users.id, row.cashierId)).get();
  return {
    id: row.id,
    cashierId: row.cashierId,
    cashierName: cashier?.name ?? 'Unknown',
    startTime: row.startTime,
    endTime: row.endTime,
    openingFloat: row.openingFloat,
    closingFloat: row.closingFloat,
    status: row.status,
  };
}

export function handleShiftStart(openingFloat: number): ApiResult<ShiftSummary> {
  try {
    const session = requireSession();
    const db = getDb();
    const now = new Date().toISOString();
    const deviceId = getSetting('device_id') ?? 'local-device';
    const branchId = getSetting('branch_id') ?? 'main';

    const existing = db
      .select()
      .from(shifts)
      .where(and(eq(shifts.cashierId, session.id), eq(shifts.status, 'open')))
      .get();
    if (existing) return { success: false, error: 'Shift already open' };

    const id = uuid();
    db.insert(shifts).values({
      id,
      cashierId: session.id,
      startTime: now,
      openingFloat,
      status: 'open',
      deviceId,
      branchId,
      createdAt: now,
      updatedAt: now,
    }).run();

    logAudit('shifts', 'start', id, undefined, { openingFloat });
    return { success: true, data: mapShift(db.select().from(shifts).where(eq(shifts.id, id)).get()!) };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Shift start failed' };
  }
}

export function handleShiftEnd(closingFloat: number): ApiResult<ShiftSummary> {
  try {
    const session = requireSession();
    const db = getDb();
    const now = new Date().toISOString();

    const shift = db
      .select()
      .from(shifts)
      .where(and(eq(shifts.cashierId, session.id), eq(shifts.status, 'open')))
      .get();
    if (!shift) return { success: false, error: 'No open shift' };

    const start = shift.startTime;
    const end = now;
    const cashSales = db
      .select()
      .from(sales)
      .where(
        and(
          eq(sales.cashierId, session.id),
          eq(sales.status, 'completed'),
          eq(sales.paymentMethod, 'cash'),
          gte(sales.createdAt, start),
          lte(sales.createdAt, end),
        ),
      )
      .all()
      .reduce((sum, s) => sum + s.totalAmount, 0);

    const expectedCash = shift.openingFloat + cashSales;
    const difference = closingFloat - expectedCash;

    db.update(shifts)
      .set({ endTime: now, closingFloat, status: 'closed', updatedAt: now })
      .where(eq(shifts.id, shift.id))
      .run();

    const updated = { ...mapShift(shift), closingFloat, endTime: now, status: 'closed', expectedCash, difference };
    logAudit('shifts', 'end', shift.id, undefined, { closingFloat, expectedCash, difference });
    return { success: true, data: updated };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Shift end failed' };
  }
}

export function handleShiftCurrent(): ApiResult<ShiftSummary | null> {
  try {
    const session = requireSession();
    const db = getDb();
    const shift = db
      .select()
      .from(shifts)
      .where(and(eq(shifts.cashierId, session.id), eq(shifts.status, 'open')))
      .get();
    return { success: true, data: shift ? mapShift(shift) : null };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Get shift failed' };
  }
}

export function handleShiftList(limit = 50): ApiResult<ShiftSummary[]> {
  try {
    requireRole('super_admin', 'manager');
    const db = getDb();
    const rows = db.select().from(shifts).orderBy(desc(shifts.startTime)).limit(limit).all();
    return { success: true, data: rows.map(mapShift) };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'List failed' };
  }
}

export function handleEodReport(params?: ReportDateRange | string): ApiResult<EodReport> {
  try {
    requireRole('super_admin', 'manager');
    const db = getDb();
    const range = coerceReportDateRange(params);
    const periodLabel = formatReportPeriod(range);

    const daySales = db
      .select()
      .from(sales)
      .where(and(eq(sales.status, 'completed'), createdAtInLocalRange(sales.createdAt, range)))
      .all();

    const dayReturns = db
      .select()
      .from(returns)
      .where(createdAtInLocalRange(returns.createdAt, range))
      .all();

    const dayExpenses = db
      .select()
      .from(expenses)
      .where(and(eq(expenses.status, 'approved'), createdAtInLocalRange(expenses.createdAt, range)))
      .all();

    const cashSales = daySales.filter((s) => s.paymentMethod === 'cash').reduce((sum, s) => sum + s.totalAmount, 0);
    const cardSales = daySales.filter((s) => s.paymentMethod === 'card').reduce((sum, s) => sum + s.totalAmount, 0);
    const walletSales = daySales.filter((s) => s.paymentMethod === 'wallet').reduce((sum, s) => sum + s.totalAmount, 0);
    const returnsTotal = dayReturns.reduce((sum, r) => sum + r.totalRefund, 0);
    const expensesTotal = dayExpenses.reduce((sum, e) => sum + e.amount, 0);

    const openShifts = db.select().from(shifts).where(eq(shifts.status, 'open')).all();
    const openingFloat = openShifts.reduce((sum, s) => sum + s.openingFloat, 0);
    const expectedCash = openingFloat + cashSales - returnsTotal;

    return {
      success: true,
      data: {
        date: periodLabel,
        totalSales: daySales.reduce((sum, s) => sum + s.totalAmount, 0),
        transactionCount: daySales.length,
        cashSales,
        cardSales,
        walletSales,
        returnsTotal,
        expensesTotal,
        openingFloat,
        expectedCash,
        netClosing: expectedCash - expensesTotal,
      },
    };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'EOD failed' };
  }
}

function mapEodClosing(row: typeof eodClosings.$inferSelect): EodClosingRecord {
  let paymentBreakdown: Record<string, number> = {};
  try {
    paymentBreakdown = row.paymentBreakdownJson ? JSON.parse(row.paymentBreakdownJson) : {};
  } catch {
    paymentBreakdown = {};
  }
  return {
    id: row.id,
    closingDate: row.closingDate,
    totalSales: row.totalSales,
    transactionCount: row.transactionCount,
    returnsTotal: row.returnsTotal,
    expensesTotal: row.expensesTotal,
    cashCollected: row.cashCollected,
    openingFloat: row.openingFloat,
    closingFloat: row.closingFloat,
    variance: row.variance,
    paymentBreakdown,
    closedBy: row.closedBy,
    closedAt: row.closedAt,
  };
}

export function handleEodCloseDay(date?: string, closingFloat?: number): ApiResult<EodClosingRecord> {
  try {
    const session = requireRole('super_admin', 'manager');
    const report = handleEodReport(date);
    if (!report.success || !report.data) return { success: false, error: report.error ?? 'EOD compute failed' };

    const db = getDb();
    const targetDate = report.data.date;
    const existing = db.select().from(eodClosings).where(eq(eodClosings.closingDate, targetDate)).get();
    if (existing) return { success: false, error: 'Day already closed' };

    const daySales = db
      .select()
      .from(sales)
      .where(and(eq(sales.status, 'completed'), createdAtInLocalRange(sales.createdAt, date)))
      .all();

    const paymentBreakdown: Record<string, number> = {};
    for (const sale of daySales) {
      paymentBreakdown[sale.paymentMethod] = (paymentBreakdown[sale.paymentMethod] ?? 0) + sale.totalAmount;
    }

    const now = new Date().toISOString();
    const deviceId = getSetting('device_id') ?? 'local-device';
    const branchId = getSetting('branch_id') ?? 'main';
    const id = uuid();
    const variance = closingFloat != null ? closingFloat - report.data.expectedCash : null;

    db.insert(eodClosings).values({
      id,
      closingDate: targetDate,
      totalSales: report.data.totalSales,
      transactionCount: report.data.transactionCount,
      returnsTotal: report.data.returnsTotal,
      expensesTotal: report.data.expensesTotal,
      cashCollected: report.data.cashSales,
      openingFloat: report.data.openingFloat,
      closingFloat: closingFloat ?? null,
      variance,
      paymentBreakdownJson: JSON.stringify(paymentBreakdown),
      closedBy: session.id,
      closedAt: now,
      deviceId,
      branchId,
      createdAt: now,
      updatedAt: now,
    }).run();

    logAudit('eod', 'close_day', id, undefined, { closingDate: targetDate });
    const row = db.select().from(eodClosings).where(eq(eodClosings.id, id)).get()!;
    return { success: true, data: mapEodClosing(row) };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Close day failed' };
  }
}

export function handleEodClosingsList(params?: { startDate?: string; endDate?: string; limit?: number }): ApiResult<EodClosingRecord[]> {
  try {
    requireRole('super_admin', 'manager');
    const db = getDb();
    const limit = params?.limit ?? 50;
    let rows = db.select().from(eodClosings).orderBy(desc(eodClosings.closingDate)).limit(limit * 3).all();

    if (params?.startDate) rows = rows.filter((r) => r.closingDate >= params.startDate!);
    if (params?.endDate) rows = rows.filter((r) => r.closingDate <= params.endDate!);

    return { success: true, data: rows.slice(0, limit).map(mapEodClosing) };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'List failed' };
  }
}

export function handleEodClosingGet(id: string): ApiResult<EodClosingRecord> {
  try {
    requireRole('super_admin', 'manager');
    const db = getDb();
    const row = db.select().from(eodClosings).where(eq(eodClosings.id, id)).get();
    if (!row) return { success: false, error: 'Closing record not found' };
    return { success: true, data: mapEodClosing(row) };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Get failed' };
  }
}
