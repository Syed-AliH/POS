import type { NativeImage } from 'electron';

/** 203 DPI — matches common 58/80 mm thermal printers (8 dots/mm). */
export const RECEIPT_PRINT_DPI = 203;

/**
 * Mid-grey cut for the 1-bit conversion.
 *
 * Text and rules are pure #000 on #fff in print mode, so every intermediate value
 * there is an artefact of the 2× supersampled capture being downsampled. 50% coverage
 * is the honest boundary: a higher cut (this was 236) promoted quarter-covered edge
 * pixels to solid black, fattening every glyph by up to a pixel a side — ink spread.
 *
 * Caveat: an uploaded store logo is a real image and may contain mid greys. Anything
 * lighter than this cut drops out of it. Raise the value if a pale logo disappears,
 * accepting slightly heavier text in exchange.
 */
export const RECEIPT_THERMAL_THRESHOLD = 128;

/**
 * Ink level 1-5 -> 1-bit threshold.
 *
 * Higher keeps more of the antialiased edge as ink, so strokes print heavier and read
 * darker on a head that under-burns; too high and the strokes bleed together. This is
 * image processing only — no printer command is sent, because an unrecognised control
 * code desynchronises the raster and prints the receipt as garbage characters.
 */
export function receiptThresholdForInkLevel(value: unknown): number {
  const n = Math.round(Number(value));
  const level = Number.isFinite(n) && n >= 1 && n <= 5 ? n : 3;
  return [0, 100, 115, 128, 165, 205][level] ?? RECEIPT_THERMAL_THRESHOLD;
}

/** Xprinter / ESC/POS clones often accept at most 128–255 raster rows per GS v 0 command. */
const MAX_STRIP_ROWS = 128;

/** Pack 1-bit row: MSB = leftmost dot, 1 = print (black). */
function packRowBits(rgba: Buffer, width: number, row: number, threshold: number): Buffer {
  const widthBytes = Math.ceil(width / 8);
  const rowBuf = Buffer.alloc(widthBytes, 0);
  const rowOffset = row * width * 4;
  for (let x = 0; x < width; x++) {
    const i = rowOffset + x * 4;
    const b = rgba[i] ?? 255;
    const g = rgba[i + 1] ?? 255;
    const r = rgba[i + 2] ?? 255;
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    if (lum < threshold) {
      const byteIndex = Math.floor(x / 8);
      const bit = 7 - (x % 8);
      rowBuf[byteIndex] |= 1 << bit;
    }
  }
  return rowBuf;
}

function appendGsV0Strip(
  chunks: Buffer[],
  rgba: Buffer,
  width: number,
  y0: number,
  stripHeight: number,
  threshold: number,
): void {
  const widthBytes = Math.ceil(width / 8);
  const header = Buffer.alloc(8);
  header[0] = 0x1d;
  header[1] = 0x76;
  header[2] = 0x30;
  header[3] = 0x00;
  header[4] = widthBytes & 0xff;
  header[5] = (widthBytes >> 8) & 0xff;
  header[6] = stripHeight & 0xff;
  header[7] = (stripHeight >> 8) & 0xff;
  chunks.push(header);
  for (let y = y0; y < y0 + stripHeight; y++) {
    chunks.push(packRowBits(rgba, width, y, threshold));
  }
}

/** Hard black/white threshold — no dithering (avoids background speckle on thermal). */
export function rgbaToThermalMonochrome(
  rgba: Buffer,
  width: number,
  height: number,
  threshold = RECEIPT_THERMAL_THRESHOLD,
): Buffer {
  const out = Buffer.alloc(rgba.length);
  for (let i = 0; i < rgba.length; i += 4) {
    const b = rgba[i] ?? 255;
    const g = rgba[i + 1] ?? 255;
    const r = rgba[i + 2] ?? 255;
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    const ink = lum < threshold ? 0 : 255;
    out[i] = ink;
    out[i + 1] = ink;
    out[i + 2] = ink;
    out[i + 3] = 255;
  }
  return out;
}

/**
 * ESC/POS raster print (GS v 0) in strips + feed + partial cut.
 * Striping avoids firmware limits that truncate tall receipts (black bar mid-print).
 */
export function buildEscPosRasterReceipt(
  rgba: Buffer,
  width: number,
  height: number,
  options?: { feedLines?: number; cut?: boolean; threshold?: number },
): Buffer {
  const threshold = options?.threshold ?? RECEIPT_THERMAL_THRESHOLD;
  const chunks: Buffer[] = [];

  chunks.push(Buffer.from([0x1b, 0x40]));
  chunks.push(Buffer.from([0x1b, 0x61, 0x00]));

  for (let y0 = 0; y0 < height; y0 += MAX_STRIP_ROWS) {
    const stripHeight = Math.min(MAX_STRIP_ROWS, height - y0);
    appendGsV0Strip(chunks, rgba, width, y0, stripHeight, threshold);
  }

  const feed = Math.min(255, Math.max(4, options?.feedLines ?? 8));
  chunks.push(Buffer.from([0x1b, 0x64, feed]));

  if (options?.cut !== false) {
    chunks.push(Buffer.from([0x1d, 0x56, 0x42, 0x00]));
  }

  return Buffer.concat(chunks);
}

export function nativeImageToEscPosReceipt(
  image: NativeImage,
  options?: { feedLines?: number; cut?: boolean; threshold?: number },
): Buffer {
  const { width, height } = image.getSize();
  const mono = rgbaToThermalMonochrome(
    image.getBitmap(),
    width,
    height,
    options?.threshold ?? RECEIPT_THERMAL_THRESHOLD,
  );
  return buildEscPosRasterReceipt(mono, width, height, options);
}
