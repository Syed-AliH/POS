import { BrowserWindow, nativeImage, screen, type NativeImage } from 'electron';
import { calcLabelSlotPositionPx, labelDpiScale } from '@mama-babi/printer';
import {
  buildBarcodeInjectScript,
  buildSingleLabelHtmlDocument,
  type LabelSlotContent,
} from './labelHtmlDocument';
import type { LabelRollLayout } from './labelRollLayout';
import { blitRgba, downsampleRgbaToPrintSize } from './labelRgba';

export { nearestDownsampleRgba, boxDownsampleRgba, downsampleRgbaToPrintSize, blitRgba, blitDarkRgba } from './labelRgba';

function rgbaFromNativeImage(
  image: NativeImage,
  expectedW: number,
  expectedH: number,
): Buffer {
  const captured = image.getSize();
  let rgba = image.getBitmap();
  if (captured.width !== expectedW || captured.height !== expectedH) {
    rgba = downsampleRgbaToPrintSize(rgba, captured.width, captured.height, expectedW, expectedH);
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
  /** Layout px → head dots. 1 for a 203 DPI head, 1.478 for 300 DPI. */
  dpiScale = 1,
): Promise<Buffer> {
  const displayScale = screen.getPrimaryDisplay().scaleFactor || 1;
  // Compensate Windows/macOS display scaling: shrink the window in DIP and zoom
  // content back up so capturePage returns exact print pixels (624×203 at 203 DPI).
  // The HTML is authored at 203 DPI, so a denser head also zooms by dpiScale — the
  // text re-renders at the higher density instead of being blown up afterwards.
  const totalZoom = displayScale * dpiScale;
  const winWidth = Math.max(1, Math.round(widthPx / displayScale));
  const winHeight = Math.max(1, Math.round(heightPx / displayScale));
  const zoomFactor = totalZoom;

  const win = new BrowserWindow({
    width: winWidth,
    height: winHeight,
    show: false,
    useContentSize: true,
    backgroundColor: '#ffffff',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      zoomFactor,
    },
  });

  try {
    win.setContentSize(winWidth, winHeight);
    win.webContents.setZoomFactor(zoomFactor);
    win.webContents.setVisualZoomLevelLimits(1, 1);

    await withTimeout(
      win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(layoutHtml)}`),
      8000,
      'HTML load',
    );

    if (layoutHtml.includes('data-barcode-pending')) {
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
            pending: w.hasAttribute('data-barcode-pending'),
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

    const image = await win.webContents.capturePage(
      { x: 0, y: 0, width: winWidth, height: winHeight },
      { scaleFactor: 1 },
    );

    const captured = image.getSize();
    console.log('[print:label:capture] page captured', {
      expected: { width: widthPx, height: heightPx },
      captured,
      displayScale,
      zoomFactor,
      winSize: { width: winWidth, height: winHeight },
    });
    if (captured.width !== widthPx || captured.height !== heightPx) {
      console.warn(
        '[print:label:capture] size mismatch — output will be resampled to print dimensions.',
      );
    }

    return rgbaFromNativeImage(image, widthPx, heightPx);
  } finally {
    if (!win.isDestroyed()) win.close();
  }
}

/**
 * Capture a label row — one browser page per die-cut label, composited at exact slot X/Y.
 * Avoids 2-up full-page capture misaligning the second column on HiDPI Windows.
 */
export async function captureLabelBatchImage(
  slots: LabelSlotContent[],
  roll: LabelRollLayout,
  pageSizePx: { width: number; height: number },
): Promise<NativeImage> {
  return captureLabelRowImage(slots, roll, pageSizePx);
}

/** Capture each slot separately and composite onto the row bitmap. */
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
  const dpiScale = labelDpiScale(rollConfig);
  const dotW = Math.max(1, Math.round(pageSizePx.width * dpiScale));
  const dotH = Math.max(1, Math.round(pageSizePx.height * dpiScale));
  const composite = Buffer.alloc(dotW * dotH * 4, 255);
  const rotate180 = rollConfig.rotate180 ?? false;

  for (const slot of slotList) {
    const pos = calcLabelSlotPositionPx(rollConfig, labelWidthMm, labelHeightMm, slot.slotIndex);
    const slotW = Math.max(1, Math.round(pos.labelWidthPx * dpiScale));
    const slotH = Math.max(1, Math.round(pos.labelHeightPx * dpiScale));
    const html = buildSingleLabelHtmlDocument(slot, rotate180);
    const slotRgba = await captureLabelHtmlToRgba(html, slotW, slotH, dpiScale);
    blitRgba(
      composite, dotW, dotH, slotRgba, slotW, slotH,
      Math.round(pos.leftPx * dpiScale), Math.round(pos.topPx * dpiScale),
    );
  }

  console.log('[print:label:capture] per-slot composite', {
    dpi: rollConfig.dpi,
    dpiScale,
    layoutPx: `${pageSizePx.width}x${pageSizePx.height}`,
    headDots: `${dotW}x${dotH}`,
    slots: slotList.map((s) => ({
      sku: s.product.sku,
      barcode: s.product.barcode,
      globalSlotIndex: s.slotIndex,
      columnSlotIndex: s.slotIndex % Math.max(1, rollConfig.columns),
    })),
  });

  return nativeImage.createFromBuffer(composite, {
    width: dotW,
    height: dotH,
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
      const b = rgba[i] ?? 255;
      const g = rgba[i + 1] ?? 255;
      const r = rgba[i + 2] ?? 255;
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
