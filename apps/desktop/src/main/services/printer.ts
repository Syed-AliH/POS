import {
  resolveReceiptSampleSale,
  type ReceiptSale,
  type ReceiptTemplateConfig,
} from '@mama-babi/printer';
import { getAllSettings } from './settings';
import { isLikelyLabelPrinterName } from './printerDevices';
import { printReceiptWysiwyg } from './receiptPrintWysiwyg';
import { getPrintContext, invalidatePrintContext } from '../print/printContext';

export async function printReceiptToDevice(
  sale: ReceiptSale,
  templateOverride?: ReceiptTemplateConfig,
): Promise<{ printed: boolean; fallback?: string }> {
  // Settings, default template and printer name are cached across receipts.
  const ctx = await getPrintContext();
  const settings = ctx.settings;
  const template = templateOverride ?? ctx.template;

  try {
    const printerName = ctx.printerName;

    if (printerName && isLikelyLabelPrinterName(printerName)) {
      throw new Error(
        `"${printerName}" is a label printer (TSPL). Choose a thermal receipt printer in Settings → Printers.`,
      );
    }

    const result = await printReceiptWysiwyg(sale, settings, template, printerName);
    return { printed: result.printed };
  } catch (err) {
    console.warn('[print:receipt:error]', err);
    // The cached printer may have been unplugged or renamed — re-resolve next time.
    invalidatePrintContext();
    return {
      printed: false,
      fallback: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function printTestReceipt(template?: ReceiptTemplateConfig): Promise<{ printed: boolean }> {
  const sale = resolveReceiptSampleSale(template);
  const result = await printReceiptToDevice(sale, template);
  if (result.fallback && !result.printed) {
    throw new Error(result.fallback);
  }
  return { printed: result.printed };
}

export function formatZReport(report: {
  date: string;
  totalSales: number;
  transactionCount: number;
  cashSales: number;
  cardSales: number;
  walletSales?: number;
  returnsTotal: number;
  expensesTotal?: number;
  netClosing?: number;
}): string {
  const settings = getAllSettings();
  const store = settings.store_name ?? 'Mama Babi';
  const currency = settings.currency ?? 'PKR';
  return [
    '========== Z-REPORT ==========',
    store,
    `Date: ${report.date}`,
    '------------------------------',
    `Transactions: ${report.transactionCount}`,
    `Total Sales: ${currency} ${report.totalSales.toFixed(2)}`,
    `Cash Sales: ${currency} ${report.cashSales.toFixed(2)}`,
    `Card Sales: ${currency} ${report.cardSales.toFixed(2)}`,
    report.walletSales != null ? `Wallet Sales: ${currency} ${report.walletSales.toFixed(2)}` : null,
    `Returns: ${currency} ${report.returnsTotal.toFixed(2)}`,
    report.expensesTotal != null ? `Expenses: ${currency} ${report.expensesTotal.toFixed(2)}` : null,
    report.netClosing != null ? `Net Closing: ${currency} ${report.netClosing.toFixed(2)}` : null,
    '==============================',
  ].filter(Boolean).join('\n');
}
