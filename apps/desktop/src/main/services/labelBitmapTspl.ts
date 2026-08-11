import { sendRawToWindowsPrinter } from './labelRawWindows';
import { captureLabelBatchImage, nativeImageToTsplBitmap } from './labelLabelCapture';
import type { LabelSlotContent } from './labelHtmlDocument';
import type { LabelRollLayout } from './labelRollLayout';

export const LABEL_BITMAP_ENGINE_VERSION = '2026-08-11-per-slot-capture-v33-dpi';

function assertSlotsArray(slots: unknown): asserts slots is LabelSlotContent[] {
  if (!Array.isArray(slots)) {
    throw new TypeError(
      `Label bitmap print expected a slots array but received ${typeof slots}. ` +
        `Restart the desktop app (stop and run pnpm dev again) so the main process loads engine ${LABEL_BITMAP_ENGINE_VERSION}.`,
    );
  }
  if (slots.length === 0) {
    throw new Error('Label bitmap print received an empty slots array.');
  }
}

const TSPL_EOL = '\r\n';

function buildBitmapTsplPayload(
  roll: LabelRollLayout,
  widthBytes: number,
  heightPx: number,
  bitmap: Buffer,
): Buffer {
  const { printableWidthMm, printableHeightMm, rollConfig } = roll;
  const header = [
    `SIZE ${printableWidthMm} mm, ${printableHeightMm} mm`,
    `GAP ${rollConfig.verticalGapMm} mm, 0 mm`,
    // Without these the printer keeps whatever was last stored in its memory, which is
    // why output could be brown and soft with no obvious cause in the app.
    `DENSITY ${rollConfig.density}`,
    `SPEED ${rollConfig.speedIps}`,
    'DIRECTION 1',
    'REFERENCE 0,0',
    'CLS',
    `BITMAP 0,0,${widthBytes},${heightPx},0`,
  ].join(TSPL_EOL);

  return Buffer.concat([
    Buffer.from(`${header}${TSPL_EOL}`, 'ascii'),
    bitmap,
    Buffer.from(`${TSPL_EOL}PRINT 1,1${TSPL_EOL}`, 'ascii'),
  ]);
}

/** Build TSPL bytes for one row (does not send to printer). */
export async function buildLabelBitmapTsplPayload(
  slots: LabelSlotContent[],
  roll: LabelRollLayout,
  pageSizePx: { width: number; height: number },
): Promise<Buffer> {
  assertSlotsArray(slots);
  const image = await captureLabelBatchImage(slots, roll, pageSizePx);
  const { widthBytes, heightPx, data } = nativeImageToTsplBitmap(image);
  return buildBitmapTsplPayload(roll, widthBytes, heightPx, data);
}

/** One TSPL row — single BITMAP + single PRINT. */
export async function printLabelBitmapTsplBatch(
  printerName: string,
  slots: LabelSlotContent[],
  roll: LabelRollLayout,
  pageSizePx: { width: number; height: number },
): Promise<void> {
  assertSlotsArray(slots);

  const image = await captureLabelBatchImage(slots, roll, pageSizePx);
  const { widthBytes, heightPx, data, widthPx } = nativeImageToTsplBitmap(image);
  const payload = buildBitmapTsplPayload(roll, widthBytes, heightPx, data);

  console.log('[print:label:bitmap]', {
    engine: LABEL_BITMAP_ENGINE_VERSION,
    printerName,
    rollWidthMm: roll.printableWidthMm,
    rollHeightMm: roll.printableHeightMm,
    rowCount: roll.rowCount,
    labelWidthMm: roll.labelWidthMm,
    labelHeightMm: roll.labelHeightMm,
    pageWidthPx: widthPx,
    pageHeightPx: heightPx,
    widthBytes,
    bitmapBytes: data.length,
    labelCount: slots.length,
    slots: slots.map((s) => ({
      slotIndex: s.slotIndex,
      sku: s.product.sku,
      barcode: s.product.barcode,
    })),
  });

  await sendRawToWindowsPrinter(printerName, payload);
  console.log('[print:label:bitmap] success — single TSPL row');
}

/**
 * Multiple die-cut rows in one Windows RAW job (one spool submission).
 * Each row = one physical strip on 2-up rolls (SIZE height = one row).
 */
export async function printLabelBitmapTsplCombined(
  printerName: string,
  rowBatches: Array<{
    slots: LabelSlotContent[];
    roll: LabelRollLayout;
    pageSizePx: { width: number; height: number };
  }>,
): Promise<void> {
  if (!rowBatches.length) {
    throw new Error('printLabelBitmapTsplCombined: no rows to print.');
  }

  const payloads: Buffer[] = [];
  let totalLabels = 0;

  for (let i = 0; i < rowBatches.length; i++) {
    const { slots, roll, pageSizePx } = rowBatches[i]!;
    const payload = await buildLabelBitmapTsplPayload(slots, roll, pageSizePx);
    payloads.push(payload);
    totalLabels += slots.length;

    console.log('[print:label:bitmap:row]', {
      engine: LABEL_BITMAP_ENGINE_VERSION,
      rowIndex: i,
      rowCount: rowBatches.length,
      labelCount: slots.length,
      rollHeightMm: roll.printableHeightMm,
      dpi: roll.rollConfig.dpi,
      layoutPx: pageSizePx,
      payloadBytes: payload.length,
      slots: slots.map((s) => ({ slotIndex: s.slotIndex, sku: s.product.sku })),
    });
  }

  const combined = Buffer.concat(payloads);
  console.log('[print:label:bitmap:combined]', {
    engine: LABEL_BITMAP_ENGINE_VERSION,
    printerName,
    rowCount: rowBatches.length,
    totalLabels,
    combinedBytes: combined.length,
  });

  await sendRawToWindowsPrinter(printerName, combined);
  console.log('[print:label:bitmap] success — combined TSPL job');
}

/** @deprecated Use printLabelBitmapTsplBatch */
export const printLabelBitmapTsplRow = printLabelBitmapTsplBatch;
