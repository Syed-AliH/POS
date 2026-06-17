import {
  calcLabelSlotPositionPx,
  calcBarcodeSlotPositionPx,
  barcodeQuietZonePx,
  resolveBarcodePrintMetrics,
  resolveLabelFieldText,
} from '@mama-babi/printer';
import { renderBarcodeSvgMarkup } from './labelBarcodeSvg';
import { rasterizeBarcodeSvgMarkup } from './labelBarcodeRaster';
import { blitDarkRgba } from './labelRgba';
import type { LabelSlotContent } from './labelHtmlDocument';
import type { LabelRollLayout } from './labelRollLayout';

/** Draw pixel-perfect barcodes onto a captured label page (text-only bitmap). */
export function compositeBarcodesOnLabelPage(
  pageRgba: Buffer,
  pageW: number,
  pageH: number,
  slots: LabelSlotContent[],
  roll: LabelRollLayout,
): void {
  const { labelWidthMm, labelHeightMm, rollConfig } = roll;

  for (const slot of slots) {
    const showGraphic = slot.layout.showBarcodeGraphic ?? slot.layout.showBarcode ?? false;
    if (!showGraphic) continue;

    const slotPos = calcLabelSlotPositionPx(
      rollConfig,
      labelWidthMm,
      labelHeightMm,
      slot.slotIndex,
    );

    for (const el of slot.layout.elements ?? []) {
      if (el.type !== 'barcode' || !el.visible) continue;

      const value = resolveLabelFieldText(el.type, slot.product, slot.layout, slot.currency, el);
      if (!value.trim()) continue;

      const metrics = resolveBarcodePrintMetrics(el, slot.widthMm, slot.heightMm, value);
      const svg = renderBarcodeSvgMarkup(metrics.normalizedValue, metrics.height, metrics.barWidth);
      const raster = svg ? rasterizeBarcodeSvgMarkup(svg) : null;
      if (!raster) continue;

      const quietPx = barcodeQuietZonePx(metrics.barWidth);
      const barcodePos = calcBarcodeSlotPositionPx(
        el,
        slot.widthMm,
        slot.heightMm,
        raster.width,
        raster.height,
        quietPx,
      );

      blitDarkRgba(
        pageRgba,
        pageW,
        pageH,
        raster.rgba,
        raster.width,
        raster.height,
        slotPos.leftPx + barcodePos.leftPx,
        slotPos.topPx + barcodePos.topPx,
        {
          x: slotPos.leftPx,
          y: slotPos.topPx,
          w: slotPos.labelWidthPx,
          h: slotPos.labelHeightPx,
        },
      );
    }
  }
}
