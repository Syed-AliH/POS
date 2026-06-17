import { BrowserWindow, type WebContents } from 'electron';
import { LABEL_PRINT_PX_PER_MM, resolvePrintScalePercent } from '@mama-babi/printer';
import {
  buildBarcodeInjectScript,
  buildLabelHtmlDocument,
  buildRasterPrintHtml,
  type LabelSlotContent,
} from './labelHtmlDocument';
import type { LabelRollLayout } from './labelRollLayout';

type LabelPrintNativeOptions = {
  printerName: string;
  roll: LabelRollLayout;
  pageSizePx: { width: number; height: number };
};

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

function printWebContents(
  webContents: WebContents,
  options: Electron.WebContentsPrintOptions,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Print timed out after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);

    webContents.print(options, (success, failureReason) => {
      clearTimeout(timer);
      if (success) resolve();
      else reject(new Error(failureReason || 'Print failed'));
    });
  });
}

/**
 * WYSIWYG label print: render HTML in a hidden window, inject barcodes, rasterize to PNG,
 * then print the bitmap at exact mm dimensions so thermal drivers cannot bleed text across slots.
 */
export async function printLabelNative(
  slots: LabelSlotContent[],
  options: LabelPrintNativeOptions,
): Promise<void> {
  const { printerName, roll, pageSizePx } = options;
  const { printableWidthMm, printableHeightMm, rollConfig } = roll;
  const timeoutMs = Math.max(15000, 1000 * slots.length + 5000);
  const layoutHtml = buildLabelHtmlDocument(slots, roll);

  const renderWin = new BrowserWindow({
    width: pageSizePx.width,
    height: pageSizePx.height,
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  let printWin: BrowserWindow | null = null;

  try {
    console.log('[print:label:raster] rendering layout…');
    renderWin.setContentSize(pageSizePx.width, pageSizePx.height);
    renderWin.webContents.setZoomFactor(1);

    await withTimeout(
      renderWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(layoutHtml)}`),
      8000,
      'HTML load',
    );

    const hasBarcodes = layoutHtml.includes('data-barcode-value');
    if (hasBarcodes) {
      console.log('[print:label:raster] injecting barcodes…');
      await withTimeout(
        renderWin.webContents.executeJavaScript(buildBarcodeInjectScript(), true),
        5000,
        'Barcode render',
      );
    }

    await new Promise((r) => setTimeout(r, 250));

    const image = await renderWin.webContents.capturePage({
      x: 0,
      y: 0,
      width: pageSizePx.width,
      height: pageSizePx.height,
    });
    const pngBase64 = image.toPNG().toString('base64');

    const rasterHtml = buildRasterPrintHtml(
      pngBase64,
      pageSizePx.width,
      pageSizePx.height,
      printableWidthMm,
      printableHeightMm,
    );

    printWin = new BrowserWindow({
      width: pageSizePx.width,
      height: pageSizePx.height,
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    await withTimeout(
      printWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(rasterHtml)}`),
      8000,
      'Raster HTML load',
    );

    await new Promise((r) => setTimeout(r, 100));

    const pageWidthMicrons = Math.round(printableWidthMm * 1000);
    const pageHeightMicrons = Math.round(printableHeightMm * 1000);
    const scaleFactor = resolvePrintScalePercent(rollConfig);

    console.log('[print:label:raster]', {
      printerName,
      pageWidthMm: printableWidthMm,
      pageHeightMm: printableHeightMm,
      pageWidthPx: pageSizePx.width,
      pageHeightPx: pageSizePx.height,
      pxPerMm: LABEL_PRINT_PX_PER_MM,
      scaleFactor,
      slots: slots.length,
      barcodes: hasBarcodes,
    });

    await printWebContents(
      printWin.webContents,
      {
        silent: true,
        printBackground: true,
        deviceName: printerName,
        copies: 1,
        margins: { marginType: 'none' },
        pageSize: { width: pageWidthMicrons, height: pageHeightMicrons },
        scaleFactor,
      },
      timeoutMs,
    );
    console.log('[print:label:raster] success');
  } finally {
    if (!renderWin.isDestroyed()) renderWin.close();
    if (printWin && !printWin.isDestroyed()) printWin.close();
  }
}
