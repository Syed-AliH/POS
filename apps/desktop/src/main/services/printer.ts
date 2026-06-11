import { BrowserWindow } from 'electron';
// @ts-expect-error no types published
import PosPrinterPkg from 'electron-pos-printer';

const { PosPrinter } = PosPrinterPkg as { PosPrinter: { print: (data: unknown[], options: unknown) => Promise<void> } };
import { formatReceipt, type ReceiptSale } from '@mama-babi/printer';
import { getAllSettings } from './settings';

export async function printReceiptToDevice(sale: ReceiptSale): Promise<{ printed: boolean; fallback?: string }> {
  const settings = getAllSettings();
  const printerName = settings.receipt_printer;

  const data = formatReceipt(sale, settings).split('\n').map((line) => ({
    type: 'text' as const,
    value: line,
    style: { fontSize: '12px' },
  }));

  try {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    if (!win) throw new Error('No window available for printing');
    await PosPrinter.print(data, {
      preview: !printerName,
      width: '80mm',
      margin: '0 0 0 0',
      copies: 1,
      printerName: printerName || undefined,
      timeOutPerLine: 400,
      silent: !!printerName,
      pageSize: '80mm',
    });
    return { printed: true };
  } catch (err) {
    const fallback = formatReceipt(sale, settings);
    console.log('[print:fallback]\n', fallback);
    console.warn('[print:error]', err);
    return { printed: false, fallback };
  }
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
