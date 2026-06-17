import type { LabelElement, LabelLayout, LabelProduct } from '@mama-babi/printer';
import {
  calcLabelSlotPosition,
  estimateBarcodeWidthPx,
  labelBarcodeHeightPx,
  labelElementLeftEdgeMm,
  labelTsplFontKey,
  labelTsplXMul,
  resolveBarcodeBarWidth,
  resolveLabelFieldText,
  truncateLabelElementText,
} from '@mama-babi/printer';
import { sendRawToWindowsPrinter } from './labelRawWindows';
import type { LabelRollLayout } from './labelRollLayout';

/** Bump when print math changes — verify in terminal after restart. */
export const LABEL_PRINT_ENGINE_VERSION = '2026-06-12-tspl-native-v3';

const DOTS_PER_MM = 8;
const TSPL_EOL = '\r\n';

/** Approximate char width in dots at xMul=1 for TSC/Gainscha built-in fonts. */
const TSPL_CHAR_WIDTH: Record<string, number> = {
  '1': 6,
  '2': 8,
  '3': 10,
  '4': 14,
};

function mmToDots(mm: number): number {
  return Math.round(mm * DOTS_PER_MM);
}

function escapeTspl(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function tsplFont(el: LabelElement): { font: string; xMul: number; yMul: number } {
  const font = labelTsplFontKey(el.fontSize);
  return { font, xMul: 1, yMul: 1 };
}

function tsplXMul(el: LabelElement, base: { xMul: number; yMul: number }): number {
  return labelTsplXMul(el.fontSize, el.fontWeight === 'bold');
}

function estimateTextWidthDots(text: string, font: string, xMul: number): number {
  const charW = TSPL_CHAR_WIDTH[font] ?? 6;
  return Math.max(8, Math.round(text.length * charW * xMul));
}

function estimateBarcodeWidthDots(value: string, barWidth: number): number {
  return estimateBarcodeWidthPx(value, barWidth);
}

function tsplXFromAnchor(
  anchorDots: number,
  widthDots: number,
  align: LabelElement['align'],
): number {
  if (align === 'center') return anchorDots - Math.round(widthDots / 2);
  if (align === 'right') return anchorDots - widthDots;
  return anchorDots;
}

function truncateToFitDots(
  text: string,
  el: LabelElement,
  labelWidthMm: number,
): string {
  return truncateLabelElementText(text, el, labelWidthMm);
}

function fitTextInSlot(
  text: string,
  el: LabelElement,
  labelWidthMm: number,
  baseFont: { font: string; xMul: number; yMul: number },
  xMul: number,
  align: LabelElement['align'],
  anchorX: number,
  minX: number,
  maxX: number,
): { text: string; baseX: number } {
  let fitted = truncateToFitDots(text, el, labelWidthMm);
  let textWidth = estimateTextWidthDots(fitted, baseFont.font, xMul);
  let baseX = tsplXFromAnchor(anchorX, textWidth, align);
  baseX = Math.min(Math.max(baseX, minX), Math.max(minX, maxX - textWidth));

  while (fitted.length > 1 && baseX + textWidth > maxX) {
    fitted = fitted.slice(0, -1);
    textWidth = estimateTextWidthDots(fitted, baseFont.font, xMul);
    baseX = tsplXFromAnchor(anchorX, textWidth, align);
    baseX = Math.min(Math.max(baseX, minX), Math.max(minX, maxX - textWidth));
  }

  return { text: fitted, baseX };
}

function detectBarcodeFormat(value: string): { format: string; value: string } {
  const digits = value.replace(/\D/g, '');
  if (digits.length === 13) return { format: 'EAN13', value: digits };
  if (digits.length === 12) return { format: 'EAN13', value: `0${digits}` };
  if (digits.length === 8) return { format: 'EAN8', value: digits };
  if (digits.length === 11) return { format: 'UPCA', value: digits };
  return { format: '128', value: value.trim() };
}

function appendLabelElements(
  lines: string[],
  product: LabelProduct,
  layout: LabelLayout,
  currency: string,
  slotXMm: number,
  slotYMm: number,
  labelWidthMm: number,
  labelHeightMm: number,
): void {
  const showGraphic = layout.showBarcodeGraphic ?? layout.showBarcode ?? false;
  const elements = layout.elements?.filter((e) => e.visible) ?? [];
  const labelWidthDots = mmToDots(labelWidthMm);
  const labelHeightDots = mmToDots(labelHeightMm);
  const originXDots = mmToDots(slotXMm);
  const originYDots = mmToDots(slotYMm);
  const minX = originXDots + 2;
  const maxX = originXDots + labelWidthDots - 2;

  for (const el of elements) {
    const align = el.align ?? 'left';
    const anchorX = originXDots + Math.round((el.x / 100) * labelWidthDots);
    const baseY = Math.min(
      originYDots + labelHeightDots - 4,
      originYDots + Math.round((el.y / 100) * labelHeightDots),
    );

    if (el.type === 'barcode' && showGraphic && product.barcode) {
      const barHeight = Math.min(
        mmToDots(12),
        Math.max(mmToDots(4), Math.round(labelBarcodeHeightPx(el.fontSize) / 2)),
      );
      const barNarrow = Math.max(1, Math.min(2, Math.round(resolveBarcodeBarWidth(el, labelWidthMm))));
      const { format, value: barValue } = detectBarcodeFormat(product.barcode);
      const barWidthDots = estimateBarcodeWidthDots(barValue, resolveBarcodeBarWidth(el, labelWidthMm));
      const leftEdgeMm = labelElementLeftEdgeMm(el, labelWidthMm, barValue);
      let baseX = originXDots + mmToDots(leftEdgeMm);
      const rightLimit = maxX - barWidthDots;
      if (rightLimit >= minX && baseX > rightLimit) baseX = rightLimit;
      baseX = Math.max(minX, baseX);
      lines.push(
        `BARCODE ${baseX},${baseY},"${format}",${barHeight},0,0,${barNarrow},2,"${escapeTspl(barValue)}"`,
      );
      continue;
    }

    const textRaw = resolveLabelFieldText(el.type, product, layout, currency, el);
    if (!textRaw) continue;

    const baseFont = tsplFont(el);
    const xMul = tsplXMul(el, baseFont);
    const yMul = baseFont.yMul;
    const { text, baseX } = fitTextInSlot(
      textRaw,
      el,
      labelWidthMm,
      baseFont,
      xMul,
      align,
      anchorX,
      minX,
      maxX,
    );

    lines.push(
      `TEXT ${baseX},${baseY},"${baseFont.font}",0,${xMul},${yMul},"${escapeTspl(text)}"`,
    );
  }
}

export function buildLabelTsplRow(
  products: LabelProduct[],
  layout: LabelLayout,
  currency: string,
  roll: LabelRollLayout,
  startSlotIndex: number,
): string {
  const { labelWidthMm, labelHeightMm, printableWidthMm, rollConfig } = roll;
  const lines: string[] = [];

  lines.push(`SIZE ${printableWidthMm} mm, ${labelHeightMm} mm`);
  lines.push(`GAP ${rollConfig.verticalGapMm} mm, 0 mm`);
  lines.push('DIRECTION 1');
  lines.push('REFERENCE 0,0');
  lines.push('CLS');

  products.forEach((product, idx) => {
    const slot = calcLabelSlotPosition(
      rollConfig,
      labelWidthMm,
      labelHeightMm,
      startSlotIndex + idx,
    );
    appendLabelElements(
      lines,
      product,
      layout,
      currency,
      slot.xMm,
      slot.yMm,
      labelWidthMm,
      labelHeightMm,
    );
  });

  lines.push('PRINT 1,1');
  return lines.join(TSPL_EOL) + TSPL_EOL;
}

export async function printLabelTsplRow(
  printerName: string,
  products: LabelProduct[],
  layout: LabelLayout,
  currency: string,
  roll: LabelRollLayout,
  startSlotIndex: number,
): Promise<void> {
  const tspl = buildLabelTsplRow(products, layout, currency, roll, startSlotIndex);
  const slots = products.map((_, idx) =>
    calcLabelSlotPosition(
      roll.rollConfig,
      roll.labelWidthMm,
      roll.labelHeightMm,
      startSlotIndex + idx,
    ),
  );

  console.log('[print:label:tspl]', {
    engine: LABEL_PRINT_ENGINE_VERSION,
    printerName,
    rollWidthMm: roll.printableWidthMm,
    labelWidthMm: roll.labelWidthMm,
    labelHeightMm: roll.labelHeightMm,
    marginLeftMm: roll.rollConfig.marginLeftMm,
    horizontalGapMm: roll.rollConfig.horizontalGapMm,
    columns: roll.rollConfig.columns,
    slotPositions: slots.map((s) => ({ slot: s.index, xMm: s.xMm, yMm: s.yMm })),
    bytes: tspl.length,
    preview: tspl.replace(/\r\n/g, ' | ').slice(0, 400),
  });
  await sendRawToWindowsPrinter(printerName, tspl);
  console.log('[print:label:tspl] success');
}

export function buildTsplUtilityCommand(
  command: 'FORMFEED' | 'GAPDETECT',
  roll: LabelRollLayout,
): string {
  const lines = [
    `SIZE ${roll.printableWidthMm} mm, ${roll.labelHeightMm} mm`,
    `GAP ${roll.rollConfig.verticalGapMm} mm, 0 mm`,
    'DIRECTION 1',
    'REFERENCE 0,0',
    'CLS',
    command,
  ];
  return lines.join(TSPL_EOL) + TSPL_EOL;
}
