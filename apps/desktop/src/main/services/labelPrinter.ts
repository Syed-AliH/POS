import {
  calcPrintablePageSizePx,
  normalizeBarcodeForPrint,
  normalizeLabelRollConfig,
  resolveBarcodePrintFormat,
  resolveBarcodePrintMetrics,
  SAMPLE_LABEL_PRODUCT,
  type LabelLayout,
  type LabelProduct,
  type LabelRollConfig,
} from '@mama-babi/printer';
import type { LabelSlotContent } from './labelHtmlDocument';
import { printLabelBitmapTsplCombined, LABEL_BITMAP_ENGINE_VERSION } from './labelBitmapTspl';
import { resolveLabelRollLayout, slotForIndex } from './labelRollLayout';
import { resolveLabelPrinterNameOrThrow } from './printerDevices';
import { getAllSettings } from './settings';

console.log('[print:label:engine]', LABEL_BITMAP_ENGINE_VERSION);

function buildSlotContent(
  product: LabelProduct,
  layout: LabelLayout,
  currency: string,
  widthMm: number,
  heightMm: number,
  slotIndex: number,
  roll: ReturnType<typeof resolveLabelRollLayout>,
): LabelSlotContent {
  const pos = slotForIndex(roll, slotIndex);
  return {
    product: { ...product },
    layout,
    currency,
    widthMm,
    heightMm,
    xMm: pos.xMm,
    yMm: pos.yMm,
    slotIndex,
  };
}

export async function printTestLabel(
  layout: LabelLayout,
  widthMm: number,
  heightMm: number,
  rollConfig?: Partial<LabelRollConfig>,
): Promise<{ printed: boolean }> {
  const result = await printLabelsBatch(
    [SAMPLE_LABEL_PRODUCT],
    layout,
    widthMm,
    heightMm,
    rollConfig,
  );
  return { printed: result.printed };
}

export async function printLabelsBatch(
  products: LabelProduct[],
  layout: LabelLayout,
  widthMm: number,
  heightMm = 30,
  rollConfig?: Partial<LabelRollConfig> | null,
): Promise<{ printed: boolean; labelCount: number }> {
  const settings = getAllSettings();
  const printerName = await resolveLabelPrinterNameOrThrow(settings.label_printer);
  const currency = settings.currency ?? 'PKR';
  const config = normalizeLabelRollConfig(rollConfig);
  const columns = Math.max(1, config.columns);

  const barcodeAudit = products.map((p) => {
    const normalized = normalizeBarcodeForPrint(p.barcode);
    const format = resolveBarcodePrintFormat(p.barcode);
    const barcodeEl = layout.elements?.find((e) => e.type === 'barcode' && e.visible);
    const metrics = barcodeEl
      ? resolveBarcodePrintMetrics(barcodeEl, widthMm, heightMm, p.barcode)
      : null;
    return {
      sku: p.sku,
      raw: p.barcode,
      normalized,
      format,
      barWidth: metrics?.barWidth,
      svgWidthPx: metrics?.svgWidthPx,
      maxWidthPx: metrics?.maxWidthPx,
    };
  });
  const normalizedSet = new Set<string>();
  for (const entry of barcodeAudit) {
    if (entry.normalized && normalizedSet.has(entry.normalized)) {
      console.warn('[print:label] duplicate normalized barcode — scanner will treat these as one product:', entry);
    }
    if (entry.normalized) normalizedSet.add(entry.normalized);
  }

  console.log('[print:label]', {
    engine: LABEL_BITMAP_ENGINE_VERSION,
    printerName,
    labelWidthMm: widthMm,
    labelHeightMm: heightMm,
    columns: config.columns,
    labelCount: products.length,
    rowCount: Math.ceil(products.length / columns),
    barcodes: barcodeAudit,
  });

  // Die-cut 2-up rolls: one physical strip per row (columns labels). Multi-row SIZE in a
  // single PRINT only outputs the first strip — chunk rows, then send one combined RAW job.
  const rowBatches: Array<{
    slots: LabelSlotContent[];
    roll: ReturnType<typeof resolveLabelRollLayout>;
    pageSizePx: ReturnType<typeof calcPrintablePageSizePx>;
  }> = [];

  for (let offset = 0; offset < products.length; offset += columns) {
    const batch = products.slice(offset, offset + columns);
    const roll = resolveLabelRollLayout(widthMm, heightMm, config, 1);
    const pageSizePx = calcPrintablePageSizePx(config, widthMm, heightMm, 1);
    const slots: LabelSlotContent[] = batch.map((product, idx) =>
      buildSlotContent(product, layout, currency, widthMm, heightMm, idx, roll),
    );
    rowBatches.push({ slots, roll, pageSizePx });
  }

  await printLabelBitmapTsplCombined(printerName, rowBatches);

  return { printed: true, labelCount: products.length };
}
