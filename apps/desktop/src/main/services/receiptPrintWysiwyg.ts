import { BrowserWindow, nativeImage, screen, type NativeImage, type WebContents } from 'electron';
import {
  buildReceiptPrintHtml,
  receiptPrintWidthPx,
  resolveReceiptPaperWidthMm,
} from '@mama-babi/printer';
import type { ReceiptSale, ReceiptTemplateConfig } from '@mama-babi/printer';
import { buildRasterPrintHtml } from './labelHtmlDocument';
import { downsampleRgbaToPrintSize } from './labelRgba';
import { nativeImageToEscPosReceipt, rgbaToThermalMonochrome, RECEIPT_THERMAL_THRESHOLD } from './receiptEscPosRaster';
import { sendRawToWindowsPrinter } from './labelRawWindows';

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
    const timer = setTimeout(() => reject(new Error(`Print timed out after ${timeoutMs}ms`)), timeoutMs);
    webContents.print(options, (success, failureReason) => {
      clearTimeout(timer);
      if (success) resolve();
      else reject(new Error(failureReason || 'Print failed'));
    });
  });
}

function rgbaFromNativeImage(image: NativeImage, expectedW: number, expectedH: number): Buffer {
  const captured = image.getSize();
  let rgba = image.getBitmap();
  if (captured.width !== expectedW || captured.height !== expectedH) {
    rgba = downsampleRgbaToPrintSize(rgba, captured.width, captured.height, expectedW, expectedH);
  }
  return rgba;
}

function normalizeReceiptBitmap(rgba: Buffer, width: number, height: number): NativeImage {
  const mono = rgbaToThermalMonochrome(rgba, width, height, RECEIPT_THERMAL_THRESHOLD);
  return nativeImage.createFromBitmap(mono, { width, height });
}

/** Render at 2× then downsample for sharper thermal output. */
const RECEIPT_CAPTURE_SUPERSAMPLE = 2;

/**
 * One hidden renderer is reused across receipts instead of creating (and tearing down)
 * a BrowserWindow per print. Prints are serialised by the receipt queue, so a single
 * window is enough; it is destroyed and recreated if a render ever fails.
 */
let renderWindow: BrowserWindow | null = null;
let renderWindowBusy = false;

function acquireRenderWindow(widthPx: number): BrowserWindow {
  if (renderWindowBusy) {
    // Defensive: the queue serialises prints, so this should not happen. Use a
    // throwaway window rather than corrupting the shared one.
    return createRenderWindow(widthPx);
  }
  if (!renderWindow || renderWindow.isDestroyed()) {
    renderWindow = createRenderWindow(widthPx);
  }
  renderWindowBusy = true;
  return renderWindow;
}

function releaseRenderWindow(): void {
  renderWindowBusy = false;
}

function destroyRenderWindow(): void {
  if (renderWindow && !renderWindow.isDestroyed()) renderWindow.destroy();
  renderWindow = null;
  renderWindowBusy = false;
}

function createRenderWindow(widthPx: number): BrowserWindow {
  return new BrowserWindow({
    width: widthPx,
    height: 400,
    show: false,
    useContentSize: true,
    backgroundColor: '#ffffff',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      zoomFactor: 1,
    },
  });
}

/** Waits for the compositor to present a frame, instead of guessing with a sleep. */
async function nextPaint(win: BrowserWindow, settleMs: number): Promise<void> {
  try {
    await withTimeout(
      win.webContents.executeJavaScript(
        `new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(1))))`,
        true,
      ),
      2000,
      'Receipt paint',
    );
  } catch {
    // Fall through to the timed settle below.
  }
  if (settleMs > 0) await new Promise((r) => setTimeout(r, settleMs));
}

async function captureReceiptPng(
  sale: ReceiptSale,
  settings: Record<string, string>,
  template: ReceiptTemplateConfig | undefined,
): Promise<{ png: NativeImage; widthPx: number; heightPx: number; widthMm: 58 | 80; designMm: 58 | 80 }> {
  const designMm = template?.widthMm ?? 80;
  const paperWidthMm = resolveReceiptPaperWidthMm(settings, template);
  const outputWidthPx = receiptPrintWidthPx(paperWidthMm);
  const renderWidthPx = outputWidthPx * RECEIPT_CAPTURE_SUPERSAMPLE;

  const { html } = buildReceiptPrintHtml(sale, settings, template, {
    forPrint: true,
    targetWidthPx: renderWidthPx,
  });

  // Window must be full layout width at zoom 1. Shrinking the window + zooming up only
  // shows (winWidth / zoom) CSS pixels — e.g. 455 DIP @ 125% zoom clips a 569 px receipt.
  const displayScale = screen.getPrimaryDisplay().scaleFactor || 1;

  const renderWin = acquireRenderWindow(renderWidthPx);

  try {
    renderWin.setContentSize(renderWidthPx, 400);
    renderWin.webContents.setZoomFactor(1);
    renderWin.webContents.setVisualZoomLevelLimits(1, 1);

    await withTimeout(
      renderWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`),
      12000,
      'Receipt HTML load',
    );

    await withTimeout(
      renderWin.webContents.executeJavaScript(
        `document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()`,
        true,
      ),
      5000,
      'Receipt font load',
    );

    // Was a flat 350ms guess; wait for an actual painted frame plus a small margin.
    await nextPaint(renderWin, 60);

    const receiptHeightPx = await renderWin.webContents.executeJavaScript(
      `(function() {
        var el = document.getElementById('receipt');
        document.documentElement.style.overflow = 'hidden';
        document.body.style.overflow = 'hidden';
        document.documentElement.style.width = '${renderWidthPx}px';
        document.body.style.width = '${renderWidthPx}px';
        var h = Math.ceil(el.getBoundingClientRect().height);
        document.documentElement.style.height = h + 'px';
        document.body.style.height = h + 'px';
        return h;
      })()`,
      true,
    );

    const captureHeight = Math.max(80, Math.ceil(receiptHeightPx));
    const winHeight = captureHeight + 2;
    renderWin.setContentSize(renderWidthPx, winHeight);

    // The window was just resized — let the resize present before capturing.
    await nextPaint(renderWin, 40);

    const image = await renderWin.webContents.capturePage(
      { x: 0, y: 0, width: renderWidthPx, height: winHeight },
      { scaleFactor: displayScale },
    );

    const captured = image.getSize();
    const outputHeight = Math.max(80, Math.round(captureHeight / RECEIPT_CAPTURE_SUPERSAMPLE));
    let contentHeight = outputHeight;
    if (captured.height < captureHeight - 2) {
      contentHeight = Math.min(
        outputHeight,
        Math.round(outputHeight * (captured.height / Math.max(1, captureHeight))),
      );
    }

    console.log('[print:receipt:capture]', {
      designMm,
      paperWidthMm,
      supersample: RECEIPT_CAPTURE_SUPERSAMPLE,
      expected: { width: outputWidthPx, height: contentHeight },
      render: { width: renderWidthPx, height: captureHeight },
      captured,
      displayScale,
      winSize: { width: renderWidthPx, height: winHeight },
    });
    if (captured.width !== renderWidthPx || captured.height !== captureHeight) {
      console.warn('[print:receipt:capture] size mismatch — resampling to print dimensions.');
    }

    const renderRgba = rgbaFromNativeImage(image, renderWidthPx, captureHeight);
    const rgba =
      renderWidthPx === outputWidthPx && captureHeight === contentHeight
        ? renderRgba
        : downsampleRgbaToPrintSize(renderRgba, renderWidthPx, captureHeight, outputWidthPx, contentHeight);
    const png = normalizeReceiptBitmap(rgba, outputWidthPx, contentHeight);

    return {
      png,
      widthPx: outputWidthPx,
      heightPx: contentHeight,
      widthMm: paperWidthMm,
      designMm,
    };
  } catch (err) {
    // A wedged renderer must not poison every later receipt.
    destroyRenderWindow();
    throw err;
  } finally {
    releaseRenderWindow();
  }
}

/** WYSIWYG receipt print — captures Receipt Designer layout, ESC/POS raster for hardware. */
export async function printReceiptWysiwyg(
  sale: ReceiptSale,
  settings: Record<string, string>,
  template: ReceiptTemplateConfig | undefined,
  printerName?: string,
): Promise<{ printed: boolean }> {
  const usePreview = !printerName?.trim();
  const { png, widthPx, heightPx, widthMm, designMm } = await captureReceiptPng(sale, settings, template);

  console.log('[print:receipt:wysiwyg]', {
    printerName: printerName ?? '(preview)',
    paperWidthMm: widthMm,
    designWidthMm: designMm,
    outputWidthPx: widthPx,
    outputHeightPx: heightPx,
    preview: usePreview,
  });

  if (!usePreview && printerName) {
    const escPos = nativeImageToEscPosReceipt(png, { feedLines: 4, cut: true });
    await sendRawToWindowsPrinter(printerName, escPos);
    return { printed: true };
  }

  const heightMm = (heightPx / widthPx) * widthMm;
  const pngBase64 = png.toPNG().toString('base64');
  const rasterHtml = buildRasterPrintHtml(pngBase64, widthPx, heightPx, widthMm, heightMm);

  const printWin = new BrowserWindow({
    width: widthPx,
    height: heightPx,
    show: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  try {
    await withTimeout(
      printWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(rasterHtml)}`),
      8000,
      'Receipt raster load',
    );

    await new Promise((r) => setTimeout(r, 100));

    const pageWidthMicrons = Math.round(widthMm * 1000);
    const pageHeightMicrons = Math.round(heightMm * 1000);

    await printWebContents(
      printWin.webContents,
      {
        silent: false,
        preview: true,
        printBackground: true,
        deviceName: '',
        copies: 1,
        margins: { marginType: 'none' },
        pageSize: { width: pageWidthMicrons, height: pageHeightMicrons },
        scaleFactor: 100,
      },
      20000,
    );

    return { printed: false };
  } finally {
    if (!printWin.isDestroyed()) printWin.close();
  }
}
