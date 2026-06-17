import { BrowserWindow, nativeImage, screen, type NativeImage } from 'electron';
import { calcLabelSlotPositionPx } from '@mama-babi/printer';
import {
  buildBarcodeInjectScript,
  buildLabelHtmlDocument,
  buildSingleLabelHtmlDocument,
  type LabelSlotContent,
} from './labelHtmlDocument';
import type { LabelRollLayout } from './labelRollLayout';

/** Nearest-neighbor downsample — preserves crisp 1-bit barcodes (no anti-aliasing). */
export function nearestDownsampleRgba(
  src: Buffer,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): Buffer {
  const dst = Buffer.alloc(dstW * dstH * 4, 255);
  for (let dy = 0; dy < dstH; dy++) {
    const sy = Math.min(srcH - 1, Math.floor(((dy + 0.5) * srcH) / dstH));
    for (let dx = 0; dx < dstW; dx++) {
      const sx = Math.min(srcW - 1, Math.floor(((dx + 0.5) * srcW) / dstW));
      const si = (sy * srcW + sx) * 4;
      const di = (dy * dstW + dx) * 4;
      dst[di] = src[si] ?? 255;
      dst[di + 1] = src[si + 1] ?? 255;
      dst[di + 2] = src[si + 2] ?? 255;
      dst[di + 3] = src[si + 3] ?? 255;
    }
  }
  return dst;
}

export function blitRgba(
  dest: Buffer,
  destW: number,
  destH: number,
  src: Buffer,
  srcW: number,
  srcH: number,
  atX: number,
  atY: number,
): void {
  for (let y = 0; y < srcH; y++) {
    const dy = atY + y;
    if (dy < 0 || dy >= destH) continue;
    for (let x = 0; x < srcW; x++) {
      const dx = atX + x;
      if (dx < 0 || dx >= destW) continue;
      const si = (y * srcW + x) * 4;
      const di = (dy * destW + dx) * 4;
      dest[di] = src[si] ?? 255;
      dest[di + 1] = src[si + 1] ?? 255;
      dest[di + 2] = src[si + 2] ?? 255;
      dest[di + 3] = src[si + 3] ?? 255;
    }
  }
}

function captureScaleFactor(win: BrowserWindow): number {
  const display = screen.getDisplayMatching(win.getBounds());
  return display.scaleFactor > 0 ? display.scaleFactor : 1;
}

function rgbaFromNativeImage(
  image: NativeImage,
  expectedW: number,
  expectedH: number,
): Buffer {
  const captured = image.getSize();
  let rgba = image.getBitmap();
  if (captured.width !== expectedW || captured.height !== expectedH) {
    rgba = nearestDownsampleRgba(rgba, captured.width, captured.height, expectedW, expectedH);
  }
  return rgba;
}

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

async function captureLabelHtmlToRgba(
  layoutHtml: string,
  widthPx: number,
  heightPx: number,
): Promise<Buffer> {
  const win = new BrowserWindow({
    width: widthPx,
    height: heightPx,
    show: false,
    useContentSize: true,
    backgroundColor: '#ffffff',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      zoomFactor: 1,
    },
  });

  try {
    win.setContentSize(widthPx, heightPx);
    win.webContents.setZoomFactor(1);
    win.webContents.setVisualZoomLevelLimits(1, 1);

    await withTimeout(
      win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(layoutHtml)}`),
      8000,
      'HTML load',
    );

    if (layoutHtml.includes('data-barcode-value')) {
      await withTimeout(
        win.webContents.executeJavaScript(buildBarcodeInjectScript(), true),
        8000,
        'Barcode render',
      );
      await new Promise((r) => setTimeout(r, 150));

      const barcodeAudit = await win.webContents.executeJavaScript(
        `[...document.querySelectorAll('[data-barcode-value]')].map(function(w) {
          return {
            sku: w.getAttribute('data-product-sku') || '',
            value: w.getAttribute('data-barcode-value') || '',
            format: w.getAttribute('data-barcode-format') || '',
            rendered: w.getAttribute('data-barcode-rendered') || '',
          };
        })`,
        true,
      );
      console.log('[print:label:capture] barcodes in page', barcodeAudit);
    }

    await withTimeout(
      win.webContents.executeJavaScript(
        `document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()`,
        true,
      ),
      5000,
      'Font load',
    );

    await new Promise((r) => setTimeout(r, 200));

    // capturePage rect is in DIP (logical) units — use CSS pixel dimensions directly so
    // the full HTML page is captured regardless of the display's device-pixel-ratio.
    // At scale > 1, this returns a larger physical image; rgbaFromNativeImage downsamples it.
    const image = await win.webContents.capturePage({
      x: 0,
      y: 0,
      width: widthPx,
      height: heightPx,
    });

    const captured = image.getSize();
    const scale = captureScaleFactor(win);
    console.log('[print:label:capture] page captured', {
      expected: { width: widthPx, height: heightPx },
      captured,
      displayScale: scale,
    });
    if (captured.width < widthPx || captured.height < heightPx) {
      console.warn('[print:label:capture] captured smaller than expected — content may be clipped');
    }

    return rgbaFromNativeImage(image, widthPx, heightPx);
  } finally {
    if (!win.isDestroyed()) win.close();
  }
}

/**
 * Capture an entire label batch in one browser page — one HTML doc, one inject, one bitmap.
 */
export async function captureLabelBatchImage(
  slots: LabelSlotContent[],
  roll: LabelRollLayout,
  pageSizePx: { width: number; height: number },
): Promise<NativeImage> {
  if (slots.length === 0) {
    throw new Error('captureLabelBatchImage: no label slots to render.');
  }

  const html = buildLabelHtmlDocument(slots, roll);
  const rgba = await captureLabelHtmlToRgba(html, pageSizePx.width, pageSizePx.height);

  console.log('[print:label:capture] batch composite', {
    pageWidthPx: pageSizePx.width,
    pageHeightPx: pageSizePx.height,
    rowCount: roll.rowCount,
    slots: slots.map((s) => ({
      slotIndex: s.slotIndex,
      sku: s.product.sku,
      barcode: s.product.barcode,
    })),
  });

  return nativeImage.createFromBuffer(rgba, {
    width: pageSizePx.width,
    height: pageSizePx.height,
    scaleFactor: 1,
  });
}

/**
 * @deprecated Use captureLabelBatchImage — kept for single-row experiments.
 */
export async function captureLabelRowImage(
  slots: LabelSlotContent[] | LabelSlotContent,
  roll: LabelRollLayout,
  pageSizePx: { width: number; height: number },
): Promise<NativeImage> {
  const slotList = Array.isArray(slots) ? slots : [slots];
  if (slotList.length === 0) {
    throw new Error('captureLabelRowImage: no label slots to render.');
  }

  const { labelWidthMm, labelHeightMm, rollConfig } = roll;
  const composite = Buffer.alloc(pageSizePx.width * pageSizePx.height * 4, 255);
  const rotate180 = rollConfig.rotate180 ?? false;

  for (const slot of slotList) {
    const pos = calcLabelSlotPositionPx(rollConfig, labelWidthMm, labelHeightMm, slot.slotIndex);
    const html = buildSingleLabelHtmlDocument(slot, rotate180);
    const slotRgba = await captureLabelHtmlToRgba(html, pos.labelWidthPx, pos.labelHeightPx);
    blitRgba(composite, pageSizePx.width, pageSizePx.height, slotRgba, pos.labelWidthPx, pos.labelHeightPx, pos.leftPx, pos.topPx);
  }

  console.log('[print:label:capture] per-slot composite', {
    pageWidthPx: pageSizePx.width,
    pageHeightPx: pageSizePx.height,
    slots: slotList.map((s) => ({
      sku: s.product.sku,
      barcode: s.product.barcode,
      globalSlotIndex: s.slotIndex,
      columnSlotIndex: s.slotIndex % Math.max(1, rollConfig.columns),
    })),
  });

  return nativeImage.createFromBuffer(composite, {
    width: pageSizePx.width,
    height: pageSizePx.height,
    scaleFactor: 1,
  });
}

export function rgbaToTsplBitmap(
  rgba: Buffer,
  width: number,
  height: number,
): {
  widthPx: number;
  heightPx: number;
  widthBytes: number;
  data: Buffer;
} {
  const widthBytes = Math.ceil(width / 8);
  const data = Buffer.alloc(widthBytes * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = rgba[i] ?? 255;
      const g = rgba[i + 1] ?? 255;
      const b = rgba[i + 2] ?? 255;
      const a = rgba[i + 3] ?? 255;
      const lum = a < 128 ? 255 : 0.299 * r + 0.587 * g + 0.114 * b;
      if (lum < 128) {
        const byteIdx = y * widthBytes + (x >> 3);
        data[byteIdx] |= 0x80 >> (x & 7);
      }
    }
  }

  for (let i = 0; i < data.length; i++) {
    data[i] ^= 0xff;
  }

  return { widthPx: width, heightPx: height, widthBytes, data };
}

/**
 * Convert captured page to TSPL 1-bit bitmap (MSB = leftmost pixel).
 * TSC/Gainscha TSPL uses bit 0 = print (dark), bit 1 = no print — opposite of our raster.
 */
export function nativeImageToTsplBitmap(
  image: NativeImage,
  expected?: { width: number; height: number },
): {
  widthPx: number;
  heightPx: number;
  widthBytes: number;
  data: Buffer;
} {
  const expectedW = expected?.width ?? image.getSize().width;
  const expectedH = expected?.height ?? image.getSize().height;
  const rgba = rgbaFromNativeImage(image, expectedW, expectedH);
  return rgbaToTsplBitmap(rgba, expectedW, expectedH);
}
