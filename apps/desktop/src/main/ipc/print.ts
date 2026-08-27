import type { ApiResult, LabelTemplateSummary, SaleSummary } from '@shared/types';
import type { ReceiptSale, ReceiptTemplateConfig } from '@mama-babi/printer';
import { requireSession, requireRole } from '../session';
import { isCloudMode } from '../cloud/config';
import { fetchCloudSale } from '../cloud/client';
import { printTestReceipt, formatZReport } from '../services/printer';
import { enqueueReceipt } from '../print/receiptQueue';
import { printTestLabelFromTemplate } from '../services/labelPrintTemplate';
import { sendLabelPrinterCommand } from '../services/labelPrinterCommands';
import { buildSaleSummary } from './sales';
import { handleEodReport } from './cash';
import { eq } from 'drizzle-orm';
import { sales } from '@mama-babi/db-schema';
import { getDb } from '../db';

function toReceiptSale(summary: SaleSummary): ReceiptSale {
  return {
    saleNumber: summary.saleNumber,
    createdAt: summary.createdAt,
    cashierName: summary.cashierName,
    items: summary.items.map((i) => ({
      productName: i.productName,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      lineTotal: i.lineTotal,
      discountPercent: i.discountPercent,
      originalPrice: i.originalPrice,
    })),
    subtotal: summary.subtotal,
    discountAmount: summary.discountAmount,
    taxAmount: summary.taxAmount,
    totalAmount: summary.totalAmount,
    paymentMethod: summary.paymentMethod,
    amountTendered: summary.amountTendered,
    changeGiven: summary.changeGiven,
  };
}

/**
 * Queues a receipt and returns as soon as it is accepted. Rendering a receipt costs
 * hundreds of milliseconds (hidden window + rasterise), which used to be awaited by
 * the checkout screen before it could clear the cart. Outcome arrives on PRINT_STATUS.
 *
 * Pass `sale` when the caller already has the summary (the checkout screen does) to
 * skip re-reading it from the server.
 */
export async function handlePrintReceipt(
  saleId: string,
  sale?: SaleSummary,
): Promise<ApiResult<{ printed: boolean; queued: boolean; jobId?: string }>> {
  try {
    requireSession();
    let summary: SaleSummary | null = sale ?? null;

    if (!summary) {
      if (isCloudMode()) {
        const result = await fetchCloudSale(saleId);
        if (!result.success || !result.data) {
          return { success: false, error: result.error ?? 'Sale not found' };
        }
        summary = result.data;
      } else {
        summary = buildSaleSummary(saleId);
        if (!summary) return { success: false, error: 'Sale not found' };
      }
    }

    if (!isCloudMode()) {
      const db = getDb();
      db.update(sales).set({ receiptPrinted: true, updatedAt: new Date().toISOString() }).where(eq(sales.id, saleId)).run();
    }

    const { jobId, queued, error } = enqueueReceipt(toReceiptSale(summary));
    if (!queued) return { success: false, error };
    return { success: true, data: { printed: false, queued: true, jobId } };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Print failed' };
  }
}

export async function handlePrintTestReceipt(
  template: ReceiptTemplateConfig,
): Promise<ApiResult<{ printed: boolean }>> {
  try {
    requireRole('super_admin', 'manager');
    const result = await printTestReceipt(template);
    return { success: true, data: result };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Test print failed' };
  }
}

export async function handlePrintTestLabel(input: {
  templateId: string;
}): Promise<ApiResult<{ printed: boolean; templateName?: string }>> {
  try {
    requireRole('super_admin', 'manager');
    if (!input.templateId) return { success: false, error: 'Template ID required' };
    const result = await printTestLabelFromTemplate(input.templateId);
    return { success: true, data: result };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Test print failed' };
  }
}

export async function handleLabelFeed(input?: {
  rollConfig?: Partial<LabelTemplateSummary['rollConfig']>;
  widthMm?: number;
  heightMm?: number;
}): Promise<ApiResult<{ ok: boolean }>> {
  try {
    requireRole('super_admin', 'manager');
    await sendLabelPrinterCommand(
      'FORMFEED',
      input?.rollConfig,
      input?.widthMm,
      input?.heightMm,
    );
    return { success: true, data: { ok: true } };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Feed failed' };
  }
}

export async function handleLabelCalibrate(input?: {
  rollConfig?: Partial<LabelTemplateSummary['rollConfig']>;
  widthMm?: number;
  heightMm?: number;
}): Promise<ApiResult<{ ok: boolean }>> {
  try {
    requireRole('super_admin', 'manager');
    await sendLabelPrinterCommand(
      'GAPDETECT',
      input?.rollConfig,
      input?.widthMm,
      input?.heightMm,
    );
    return { success: true, data: { ok: true } };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Calibration failed' };
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
