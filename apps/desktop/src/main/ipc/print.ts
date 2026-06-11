import { eq } from 'drizzle-orm';
import { sales } from '@mama-babi/db-schema';
import type { ApiResult } from '@shared/types';
import { getDb } from '../db';
import { requireSession } from '../session';
import { printReceiptToDevice, formatZReport } from '../services/printer';
import { buildSaleSummary } from './sales';
import { handleEodReport } from './cash';

export async function handlePrintReceipt(saleId: string): Promise<ApiResult<{ printed: boolean }>> {
  try {
    requireSession();
    const db = getDb();
    const summary = buildSaleSummary(saleId);
    if (!summary) return { success: false, error: 'Sale not found' };

    const result = await printReceiptToDevice(summary);
    db.update(sales).set({ receiptPrinted: true, updatedAt: new Date().toISOString() }).where(eq(sales.id, saleId)).run();
    return { success: true, data: { printed: result.printed } };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Print failed' };
  }
}

export async function handlePrintZReport(date?: string): Promise<ApiResult<{ printed: boolean }>> {
  try {
    requireSession();
    const report = handleEodReport(date);
    if (!report.success || !report.data) return { success: false, error: report.error ?? 'EOD failed' };

    const text = formatZReport(report.data);
    console.log('[print:z-report]\n', text);
    return { success: true, data: { printed: false } };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Z-report failed' };
  }
}
