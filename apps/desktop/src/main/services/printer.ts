import { BrowserWindow } from 'electron';
// @ts-expect-error no types published
import PosPrinterPkg from 'electron-pos-printer';

const { PosPrinter } = PosPrinterPkg as { PosPrinter: { print: (data: unknown[], options: unknown) => Promise<void> } };
import {
  formatReceipt,
  SAMPLE_RECEIPT_SALE,
  type ReceiptSale,
  type ReceiptTemplateConfig,
} from '@mama-babi/printer';
import { getAllSettings } from './settings';
import { getDefaultReceiptTemplate, receiptTemplateToConfig } from './receiptTemplates';

function receiptPrintData(text: string) {
  return text.split('\n').map((line) => ({
    type: 'text' as const,
    value: line,
    style: { fontSize: '12px', fontFamily: 'monospace' },
  }));
}

export async function printReceiptToDevice(
  sale: ReceiptSale,
  templateOverride?: ReceiptTemplateConfig,
): Promise<{ printed: boolean; fallback?: string }> {
  const settings = getAllSettings();
  const template = templateOverride ?? (() => {
    const tpl = getDefaultReceiptTemplate();
    return tpl ? receiptTemplateToConfig(tpl) : undefined;
  })();
  const widthMm = template?.widthMm ?? 80;
  const text = formatReceipt(sale, settings, template);
  const data = receiptPrintData(text);

  try {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    if (!win) throw new Error('No window available for printing');
    // Receipts always use print preview — never silent/hardware receipt printer.
    await PosPrinter.print(data, {
      preview: true,
      width: `${widthMm}mm`,
      margin: '0 0 0 0',
      copies: 1,
      timeOutPerLine: 400,
      silent: false,
      pageSize: `${widthMm}mm`,
    });
    return { printed: false };
  } catch (err) {
    console.log('[print:fallback]\n', text);
    console.warn('[print:error]', err);
    return { printed: false, fallback: text };
  }
}

export async function printTestReceipt(template?: ReceiptTemplateConfig): Promise<{ printed: boolean }> {
  const result = await printReceiptToDevice(SAMPLE_RECEIPT_SALE, template);
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
