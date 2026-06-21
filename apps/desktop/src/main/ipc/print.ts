import type { ApiResult, LabelTemplateSummary, SaleSummary } from '@shared/types';
import type { ReceiptSale, ReceiptTemplateConfig } from '@mama-babi/printer';
import { requireSession, requireRole } from '../session';
import { isCloudMode } from '../cloud/config';
import { fetchCloudSale } from '../cloud/client';
import { printReceiptToDevice, printTestReceipt, formatZReport } from '../services/printer';
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

export async function handlePrintReceipt(saleId: string): Promise<ApiResult<{ printed: boolean }>> {
  try {
    requireSession();
    let summary: SaleSummary | null;

    if (isCloudMode()) {
      const result = await fetchCloudSale(saleId);
      if (!result.success || !result.data) {
        return { success: false, error: result.error ?? 'Sale not found' };
      }
      summary = result.data;
    } else {
      summary = buildSaleSummary(saleId);
      if (!summary) return { success: false, error: 'Sale not found' };
      const db = getDb();
      db.update(sales).set({ receiptPrinted: true, updatedAt: new Date().toISOString() }).where(eq(sales.id, saleId)).run();
    }

    const result = await printReceiptToDevice(toReceiptSale(summary));
    return { success: true, data: { printed: result.printed } };
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
