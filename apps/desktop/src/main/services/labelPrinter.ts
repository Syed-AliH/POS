import { BrowserWindow } from 'electron';
// @ts-expect-error no types published
import PosPrinterPkg from 'electron-pos-printer';
import { buildLabelPrintData, SAMPLE_LABEL_PRODUCT, type LabelLayout, type LabelProduct } from '@mama-babi/printer';
import { getAllSettings } from './settings';

const { PosPrinter } = PosPrinterPkg as { PosPrinter: { print: (data: unknown[], options: unknown) => Promise<void> } };

export async function printTestLabel(
  layout: LabelLayout,
  widthMm: number,
  heightMm: number,
): Promise<{ printed: boolean }> {
  const result = await printLabelsBatch([SAMPLE_LABEL_PRODUCT], layout, widthMm, heightMm);
  return { printed: result.printed };
}

export async function printLabelsBatch(
  products: LabelProduct[],
  layout: LabelLayout,
  widthMm: number,
  heightMm = 30,
): Promise<{ printed: boolean; labelCount: number }> {
  const settings = getAllSettings();
  const printerName = settings.label_printer || settings.receipt_printer;
  const currency = settings.currency ?? 'PKR';

  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  if (!win) throw new Error('No window available for printing');

  const printOptions = {
    preview: !printerName,
    width: `${widthMm}mm`,
    margin: '0 0 0 0',
    copies: 1,
    printerName: printerName || undefined,
    timeOutPerLine: 400,
    silent: !!printerName,
    pageSize: { width: widthMm * 1000, height: heightMm * 1000 },
  };

  let printed = false;
  try {
    for (const product of products) {
      const data = buildLabelPrintData(product, layout, currency);
      await PosPrinter.print(data, printOptions);
      printed = true;
    }
    return { printed, labelCount: products.length };
  } catch (err) {
    console.warn('[print:labels:error]', err);
    for (const product of products) {
      const preview = buildLabelPrintData(product, layout, currency)
        .map((l) => (l.type === 'barCode' ? `[BARCODE ${l.value}]` : l.value))
        .join(' | ');
      console.log(`[print:label:fallback] ${preview}`);
    }
    return { printed: false, labelCount: products.length };
  }
}
