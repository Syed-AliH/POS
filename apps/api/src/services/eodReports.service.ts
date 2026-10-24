import { and, desc, eq, gte, lte } from 'drizzle-orm';
import { eodReports } from '@mama-babi/db-pg';
import type { PostgresClient } from '@mama-babi/db-pg';
import { v4 as uuid } from 'uuid';

export interface CreateEodReportInput {
  reportDate: string;
  storeName?: string;
  cashierName?: string;
  openingCash: number;
  cardPayments: number;
  onlinePayments: number;
  totalCashCount: number;
  totalExpenses: number;
  dailySales: number;
  pdfBase64: string;
  /**
   * The day's expenses as they stood at EOD — a snapshot for the report. The rows
   * themselves are entered on the Expenses tab and already live in `expenses`, so
   * nothing is recorded from here (doing so would count every expense twice).
   */
  expenseLines?: Array<{ amount: number; description?: string }>;
  /** Cash handed to the owner at close. A cash movement — not an expense, not a sale. */
  cashToOwner?: number;
}

export async function createEodReport(
  db: PostgresClient,
  user: { id: string; name: string; role: string },
  input: CreateEodReportInput,
) {
  const now = new Date().toISOString();
  const id = uuid();
  const cashToOwner = Math.max(0, input.cashToOwner ?? 0);
  // One live report per day: submitting again (a correction, or a double click)
  // replaces the earlier one instead of listing the day twice on the portal. The old
  // row is kept, soft-deleted, so nothing is lost.
  await db.transaction(async (tx) => {
    const superseded = await tx
      .update(eodReports)
      .set({ isDeleted: true, updatedAt: now })
      .where(and(eq(eodReports.reportDate, input.reportDate), eq(eodReports.isDeleted, false)))
      .returning({ id: eodReports.id });
    if (superseded.length) {
      console.log('[eod] replaced earlier report(s) for', input.reportDate, superseded.map((r) => r.id));
    }
    await tx.insert(eodReports).values({
      id,
      reportDate: input.reportDate,
      storeName: input.storeName ?? null,
      cashierId: user.id,
      cashierName: input.cashierName ?? user.name,
      openingCash: input.openingCash,
      cardPayments: input.cardPayments,
      onlinePayments: input.onlinePayments,
      totalCashCount: input.totalCashCount,
      totalExpenses: input.totalExpenses,
      dailySales: input.dailySales,
      pdfBase64: input.pdfBase64,
      expenseLinesJson: input.expenseLines?.length ? JSON.stringify(input.expenseLines) : null,
      cashToOwner,
      createdAt: now,
      updatedAt: now,
    });
  });

  return { success: true as const, data: { id } };
}

interface EodExpenseLine {
  amount: number;
  description?: string;
}

function parseExpenseLines(json: string | null): EodExpenseLine[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function listEodReports(
  db: PostgresClient,
  params?: { startDate?: string; endDate?: string; limit?: number },
) {
  const conditions = [eq(eodReports.isDeleted, false)];
  if (params?.startDate) conditions.push(gte(eodReports.reportDate, params.startDate));
  if (params?.endDate) conditions.push(lte(eodReports.reportDate, params.endDate));

  const rows = await db
    .select({
      id: eodReports.id,
      reportDate: eodReports.reportDate,
      storeName: eodReports.storeName,
      cashierName: eodReports.cashierName,
      openingCash: eodReports.openingCash,
      cardPayments: eodReports.cardPayments,
      onlinePayments: eodReports.onlinePayments,
      totalCashCount: eodReports.totalCashCount,
      totalExpenses: eodReports.totalExpenses,
      dailySales: eodReports.dailySales,
      cashToOwner: eodReports.cashToOwner,
      expenseLinesJson: eodReports.expenseLinesJson,
      createdAt: eodReports.createdAt,
    })
    .from(eodReports)
    .where(and(...conditions))
    .orderBy(desc(eodReports.createdAt))
    .limit(Math.min(params?.limit ?? 100, 500));

  return {
    success: true as const,
    data: rows.map(({ expenseLinesJson, ...rest }) => ({
      ...rest,
      expenseLines: parseExpenseLines(expenseLinesJson),
    })),
  };
}

export async function getEodReport(db: PostgresClient, id: string) {
  const [row] = await db.select().from(eodReports).where(eq(eodReports.id, id)).limit(1);
  if (!row || row.isDeleted) return { success: false as const, error: 'Report not found' };
  const { expenseLinesJson, ...rest } = row;
  return { success: true as const, data: { ...rest, expenseLines: parseExpenseLines(expenseLinesJson) } };
}
