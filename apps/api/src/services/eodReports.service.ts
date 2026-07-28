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
}

export async function createEodReport(
  db: PostgresClient,
  user: { id: string; name: string },
  input: CreateEodReportInput,
) {
  const now = new Date().toISOString();
  const id = uuid();
  await db.insert(eodReports).values({
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
    createdAt: now,
    updatedAt: now,
  });
  return { success: true as const, data: { id } };
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
      createdAt: eodReports.createdAt,
    })
    .from(eodReports)
    .where(and(...conditions))
    .orderBy(desc(eodReports.createdAt))
    .limit(Math.min(params?.limit ?? 100, 500));

  return { success: true as const, data: rows };
}

export async function getEodReport(db: PostgresClient, id: string) {
  const [row] = await db.select().from(eodReports).where(eq(eodReports.id, id)).limit(1);
  if (!row || row.isDeleted) return { success: false as const, error: 'Report not found' };
  return { success: true as const, data: row };
}
