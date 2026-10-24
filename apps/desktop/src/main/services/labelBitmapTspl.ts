import { sendRawToWindowsPrinter } from './labelRawWindows';
import {
  captureLabelBatchImage,
  LabelCaptureCache,
  nativeImageToTsplBitmap,
  prefetchLabelSlots,
} from './labelLabelCapture';
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
  cache?: LabelCaptureCache,
): Promise<Buffer> {
  assertSlotsArray(slots);
  const image = await captureLabelBatchImage(slots, roll, pageSizePx, cache);
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

/** Rows in the first spool job — small, so the printer starts almost immediately. */
const FIRST_JOB_ROWS = 2;
/** Rows per spool job after that. Each job costs a PowerShell launch, so not too small. */
const JOB_ROWS = 40;
/** How many rows ahead of the one being assembled to start rendering. */
const PREFETCH_ROWS = 24;

/**
 * Print die-cut rows as a short series of Windows RAW jobs. Each row is a
 * self-contained SIZE…PRINT block (one physical strip on 2-up rolls), so splitting
 * between rows is safe. Rows used to be collected into a single job, which meant
 * nothing printed until every label in the batch had been rendered; now the first
 * rows go out as soon as they are ready and later ones follow, in order, while
 * rendering continues.
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

  const cache = new LabelCaptureCache();
  let prefetchedUpTo = 0;
  const prefetchThrough = (rowIndex: number) => {
    const end = Math.min(rowBatches.length, rowIndex + 1);
    for (; prefetchedUpTo < end; prefetchedUpTo++) {
      const { slots, roll } = rowBatches[prefetchedUpTo]!;
      prefetchLabelSlots(slots, roll, cache);
    }
  };

  // Jobs are chained so Windows spools them in order; after a failure the rest are skipped.
  let sendChain: Promise<void> = Promise.resolve();
  let sendError: unknown = null;
  let jobCount = 0;
  let pending: Buffer[] = [];
  let totalLabels = 0;
  const flush = () => {
    if (!pending.length) return;
    const payload = Buffer.concat(pending);
    const jobIndex = jobCount++;
    const rows = pending.length;
    pending = [];
    sendChain = sendChain.then(async () => {
      if (sendError) return;
      try {
        await sendRawToWindowsPrinter(printerName, payload);
        console.log('[print:label:bitmap:job]', { engine: LABEL_BITMAP_ENGINE_VERSION, jobIndex, rows, bytes: payload.length });
      } catch (err) {
        sendError = err;
      }
    });
  };

  for (let i = 0; i < rowBatches.length; i++) {
    if (sendError) break;
    prefetchThrough(i + PREFETCH_ROWS);
    const { slots, roll, pageSizePx } = rowBatches[i]!;
    pending.push(await buildLabelBitmapTsplPayload(slots, roll, pageSizePx, cache));
    totalLabels += slots.length;
    if (pending.length >= (jobCount === 0 ? FIRST_JOB_ROWS : JOB_ROWS)) flush();
  }
  flush();
  await sendChain;
  if (sendError) throw sendError;

  console.log('[print:label:bitmap] success', {
    engine: LABEL_BITMAP_ENGINE_VERSION,
    printerName,
    rowCount: rowBatches.length,
    totalLabels,
    jobs: jobCount,
  });
}

/** @deprecated Use printLabelBitmapTsplBatch */
export const printLabelBitmapTsplRow = printLabelBitmapTsplBatch;
