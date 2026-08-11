import type { LabelElement, LabelFieldType, LabelLayout, LabelProduct } from './index';
import {
  estimateBarcodeWidthPx,
  normalizeBarcodeForPrint,
  resolveBarcodePrintFormat,
  resolveLabelFontFamily,
  resolveUniformBarcodeBarWidth,
  barcodeModuleCountForFormat,
  barcodeModuleMinWidth,
  barcodeDesignerMinBarWidth,
  isBarcodeBarWidthAuto,
} from './labelFonts';

/** 203 DPI thermal print density — matches Gainscha dot pitch. */
export const LABEL_PRINT_PX_PER_MM = 8;

/** Designer fontSize units are defined at this px/mm baseline (preview canvas). */
export const LABEL_DESIGN_PX_PER_MM = 3.5;

/**
 * Canonical on-screen label preview scale (8 px/mm).
 * At this scale, LabelCanvasPreview previewScale = 1 and matches printed output.
 */
export const LABEL_CANVAS_PREVIEW_SCALE = LABEL_PRINT_PX_PER_MM;

export const LABEL_FONT_FAMILY = 'Segoe UI, Arial, sans-serif';
export const LABEL_MONO_FAMILY = 'ui-monospace, monospace';

export function labelFontSizePx(fontSize: number): number {
  return (fontSize * LABEL_PRINT_PX_PER_MM) / LABEL_DESIGN_PX_PER_MM;
}

export function labelLetterSpacingPx(letterSpacing: number | undefined): number | undefined {
  if (letterSpacing == null || letterSpacing <= 0) return undefined;
  return (letterSpacing * LABEL_PRINT_PX_PER_MM) / LABEL_DESIGN_PX_PER_MM;
}

export function labelPreviewLetterSpacingPx(
  letterSpacing: number | undefined,
  previewScale: number,
): number | undefined {
  const px = labelLetterSpacingPx(letterSpacing);
  if (px == null) return undefined;
  return px * (previewScale / LABEL_PRINT_PX_PER_MM);
}

export function labelCanvasSizePx(widthMm: number, heightMm: number): { width: number; height: number } {
  return {
    width: Math.round(widthMm * LABEL_PRINT_PX_PER_MM),
    height: Math.round(heightMm * LABEL_PRINT_PX_PER_MM),
  };
}

export function labelPreviewFontSizePx(fontSize: number, previewScale: number): number {
  return labelFontSizePx(fontSize) * (previewScale / LABEL_PRINT_PX_PER_MM);
}

export function labelElementAlignTransform(align?: LabelElement['align']): string | undefined {
  if (align === 'center') return 'translateX(-50%)';
  if (align === 'right') return 'translateX(-100%)';
  return undefined;
}

export function labelBarcodeHeightPx(fontSize: number): number {
  return Math.max(24, Math.round(labelFontSizePx(fontSize) * 3.2));
}

/** Barcode height that fits within the label slot below the element's Y position. */
export function labelBarcodePrintHeightPx(
  el: Pick<LabelElement, 'fontSize' | 'y'>,
  labelHeightMm: number,
): number {
  const labelHeightPx = Math.round(labelHeightMm * LABEL_PRINT_PX_PER_MM);
  const topPx = Math.round((el.y / 100) * labelHeightPx);
  const pad = 2;
  const maxH = Math.max(12, labelHeightPx - topPx - pad);
  return Math.min(labelBarcodeHeightPx(el.fontSize), maxH);
}

/** Barcode height in print pixels — prefers explicit mm when set in the designer. */
export function resolveBarcodeHeightPx(
  el: Pick<LabelElement, 'fontSize' | 'y' | 'barcodeHeightMm'>,
  labelHeightMm: number,
): number {
  if (el.barcodeHeightMm != null && el.barcodeHeightMm > 0) {
    const fromMm = Math.round(el.barcodeHeightMm * LABEL_PRINT_PX_PER_MM);
    const labelHeightPx = Math.round(labelHeightMm * LABEL_PRINT_PX_PER_MM);
    const topPx = Math.round((el.y / 100) * labelHeightPx);
    const pad = 2;
    const maxH = Math.max(12, labelHeightPx - topPx - pad);
    return Math.min(fromMm, maxH);
  }
  return labelBarcodePrintHeightPx(el, labelHeightMm);
}

export function labelBarcodeBarWidth(widthMm: number): number {
  // Auto-fill hint when element has no custom width — actual print uses slot fill math.
  return widthMm <= 40 ? 2.75 : 3;
}

export function resolveBarcodeBarWidth(
  el: Pick<LabelElement, 'barcodeBarWidth'>,
  labelWidthMm: number,
): number {
  return el.barcodeBarWidth ?? labelBarcodeBarWidth(labelWidthMm);
}

/** Max text width in print pixels (203 DPI) for an element within the label slot. */
export function labelElementMaxWidthPx(
  el: Pick<LabelElement, 'type' | 'x' | 'align'>,
  labelWidthMm: number,
): number {
  const labelWidthPx = Math.round(labelWidthMm * LABEL_PRINT_PX_PER_MM);
  const factor =
    el.type === 'name' || el.type === 'storeName' ? 0.85 : 0.92;
  const cap = Math.round(labelWidthPx * factor);
  const anchorPx = (el.x / 100) * labelWidthPx;
  const align = el.align ?? 'left';
  const pad = 4;
  if (align === 'center') return cap;
  if (align === 'right') return Math.max(8, Math.min(cap, anchorPx - pad));
  return Math.max(8, Math.min(cap, labelWidthPx - anchorPx - pad));
}

export function labelPreviewMaxWidthPx(
  el: Pick<LabelElement, 'type' | 'x' | 'align'>,
  labelWidthMm: number,
  previewScale: number,
): number {
  const printPx = labelElementMaxWidthPx(el, labelWidthMm);
  return Math.round((printPx / LABEL_PRINT_PX_PER_MM) * previewScale);
}

/** Element box width in mm — barcodes use estimated graphic width, not full max box. */
export function labelElementWidthMm(
  el: Pick<
    LabelElement,
    'type' | 'x' | 'align' | 'fontSize' | 'barcodeBarWidth' | 'barcodeHeightMm' | 'y'
  >,
  labelWidthMm: number,
  barcodeValue?: string,
  labelHeightMm?: number,
): number {
  if (el.type === 'barcode' && barcodeValue && labelHeightMm != null) {
    const metrics = resolveBarcodePrintMetrics(
      el as LabelElement,
      labelWidthMm,
      labelHeightMm,
      barcodeValue,
    );
    return metrics.svgWidthPx / LABEL_PRINT_PX_PER_MM;
  }
  if (el.type === 'barcode' && barcodeValue) {
    const barWidth = resolveBarcodeBarWidth(el, labelWidthMm);
    return estimateBarcodeWidthPx(barcodeValue, barWidth) / LABEL_PRINT_PX_PER_MM;
  }
  return labelElementMaxWidthPx(el, labelWidthMm) / LABEL_PRINT_PX_PER_MM;
}

/**
 * Visual left edge in mm — what users expect when aligning elements.
 * Internal `x` is an anchor: left edge (left align), center (center), right edge (right).
 */
export function labelElementLeftEdgeMm(
  el: Pick<
    LabelElement,
    'type' | 'x' | 'align' | 'fontSize' | 'barcodeBarWidth' | 'barcodeHeightMm' | 'y'
  >,
  labelWidthMm: number,
  barcodeValue?: string,
  labelHeightMm?: number,
): number {
  const anchorMm = labelPercentToMm(el.x, labelWidthMm);
  const widthMm = labelElementWidthMm(el, labelWidthMm, barcodeValue, labelHeightMm);
  const align = el.align ?? 'left';
  if (align === 'center') return Math.max(0, Math.round((anchorMm - widthMm / 2) * 10) / 10);
  if (align === 'right') return Math.max(0, Math.round((anchorMm - widthMm) * 10) / 10);
  return anchorMm;
}

/** Convert desired left edge (mm) to internal anchor percent for the element's alignment. */
export function labelLeftEdgeMmToAnchorPercent(
  leftEdgeMm: number,
  el: Pick<
    LabelElement,
    'type' | 'x' | 'align' | 'fontSize' | 'barcodeBarWidth' | 'barcodeHeightMm' | 'y'
  >,
  labelWidthMm: number,
  barcodeValue?: string,
  labelHeightMm?: number,
): number {
  const widthMm = labelElementWidthMm(el, labelWidthMm, barcodeValue, labelHeightMm);
  const align = el.align ?? 'left';
  const clampedLeft = Math.max(0, leftEdgeMm);
  let anchorMm = clampedLeft;
  if (align === 'center') anchorMm = clampedLeft + widthMm / 2;
  else if (align === 'right') anchorMm = clampedLeft + widthMm;
  return labelMmToPercent(anchorMm, labelWidthMm);
}

/** TSC/Gainscha built-in font heights in dots (yMul=1). */
const TSPL_FONT_HEIGHT_DOTS: Record<string, number> = {
  '1': 12,
  '2': 20,
  '3': 24,
  '4': 32,
};

const TSPL_CHAR_WIDTH_DOTS: Record<string, number> = {
  '1': 6,
  '2': 8,
  '3': 10,
  '4': 14,
};

export function labelTsplFontKey(fontSize: number): string {
  if (fontSize >= 16) return '4';
  if (fontSize >= 13) return '3';
  if (fontSize >= 11) return '2';
  return '1';
}

export function labelTsplXMul(_fontSize: number, bold?: boolean): number {
  const base = 1;
  return bold ? Math.min(2, base + 1) : base;
}

export function labelTsplFontHeightDots(fontSize: number): number {
  return TSPL_FONT_HEIGHT_DOTS[labelTsplFontKey(fontSize)] ?? 12;
}

/** Preview font size matching TSPL built-in font height on the designer canvas. */
export function labelTsplPreviewFontSizePx(fontSize: number, previewScale: number): number {
  const dots = labelTsplFontHeightDots(fontSize);
  return (dots / LABEL_PRINT_PX_PER_MM) * previewScale;
}

export function estimateTsplTextWidthDots(text: string, fontSize: number, bold = false): number {
  const font = labelTsplFontKey(fontSize);
  const xMul = labelTsplXMul(fontSize, bold);
  const charW = TSPL_CHAR_WIDTH_DOTS[font] ?? 6;
  return Math.max(8, Math.round(text.length * charW * xMul));
}

function availableTsplTextWidthDots(
  align: 'left' | 'center' | 'right',
  xPercent: number,
  labelWidthDots: number,
  fieldType?: LabelFieldType,
): number {
  const minX = 2;
  const maxX = labelWidthDots - 2;
  const anchorX = Math.round((xPercent / 100) * labelWidthDots);
  const widthFactor =
    fieldType === 'name' || fieldType === 'storeName' ? 0.85 : 0.92;
  const cap = Math.round(labelWidthDots * widthFactor);
  if (align === 'center') return cap;
  if (align === 'right') return Math.max(8, Math.min(cap, anchorX - minX - 4));
  return Math.max(8, Math.min(cap, maxX - anchorX - 4));
}

export function clampLabelPositionPercent(value: number): number {
  return Math.round(Math.min(100, Math.max(0, value)) * 10) / 10;
}

export function labelPercentToMm(percent: number, sizeMm: number): number {
  return Math.round((percent / 100) * sizeMm * 10) / 10;
}

export function labelMmToPercent(mm: number, sizeMm: number): number {
  if (sizeMm <= 0) return 0;
  return clampLabelPositionPercent((mm / sizeMm) * 100);
}

export function truncateTextForTsplSlot(
  text: string,
  fontSize: number,
  bold: boolean,
  align: 'left' | 'center' | 'right',
  xPercent: number,
  labelWidthMm: number,
  fieldType?: LabelFieldType,
): string {
  const labelWidthDots = Math.round(labelWidthMm * LABEL_PRINT_PX_PER_MM);
  const maxDots = availableTsplTextWidthDots(align, xPercent, labelWidthDots, fieldType);
  const font = labelTsplFontKey(fontSize);
  const xMul = labelTsplXMul(fontSize, bold);
  const charW = TSPL_CHAR_WIDTH_DOTS[font] ?? 6;

  if (Math.round(text.length * charW * xMul) <= maxDots) return text;

  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const w = Math.round(mid * charW * xMul);
    if (w <= maxDots) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? text.slice(0, lo) : text.slice(0, 1);
}

export function truncateLabelElementText(
  text: string,
  el: Pick<LabelElement, 'type' | 'fontSize' | 'fontWeight' | 'align' | 'x'>,
  labelWidthMm: number,
): string {
  const maxWPx = labelElementMaxWidthPx(el, labelWidthMm);
  const fontSizePx = labelFontSizePx(el.fontSize);
  return truncateTextForLabelWidth(
    text,
    fontSizePx,
    maxWPx,
    el.fontWeight === 'bold',
  );
}

/** Preview max width in px using the same TSPL slot math as print. */
export function labelTsplPreviewMaxWidthPx(
  align: 'left' | 'center' | 'right',
  xPercent: number,
  labelWidthMm: number,
  previewScale: number,
  fieldType?: LabelFieldType,
): number {
  const labelWidthDots = Math.round(labelWidthMm * LABEL_PRINT_PX_PER_MM);
  const maxDots = availableTsplTextWidthDots(align, xPercent, labelWidthDots, fieldType);
  return Math.round((maxDots / LABEL_PRINT_PX_PER_MM) * previewScale);
}

/** Rough Segoe UI char width for truncation before print. */
export function estimateTextWidthPx(text: string, fontSizePx: number, bold = false): number {
  const factor = bold ? 0.62 : 0.55;
  return Math.ceil(text.length * fontSizePx * factor);
}

export function truncateTextForLabelWidth(
  text: string,
  fontSizePx: number,
  maxWidthPx: number,
  bold = false,
): string {
  if (estimateTextWidthPx(text, fontSizePx, bold) <= maxWidthPx) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const candidate = `${text.slice(0, mid)}…`;
    if (estimateTextWidthPx(candidate, fontSizePx, bold) <= maxWidthPx) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? `${text.slice(0, lo)}…` : text.slice(0, 1);
}

export function labelBarcodeLayoutStyle(
  el: LabelElement,
  labelWidthMm: number,
  barcodeValue?: string,
  barHeightPx?: number,
  barWidthPx?: number,
): Record<string, string | number> {
  const align = el.align ?? 'left';
  const maxWidthPx = labelElementMaxWidthPx(el, labelWidthMm);
  const alignTransform = labelElementAlignTransform(align);
  const style: Record<string, string | number> = {
    position: 'absolute',
    top: `${el.y}%`,
    left: `${el.x}%`,
    ...(alignTransform ? { transform: alignTransform } : {}),
    maxWidth: `${maxWidthPx}px`,
    overflow: 'hidden',
    lineHeight: 0,
    margin: '0',
    padding: '0',
    boxSizing: 'border-box',
  };

  if (barHeightPx != null) {
    style.height = `${barHeightPx}px`;
    style.maxHeight = `${barHeightPx}px`;
  }

  if (barcodeValue?.trim()) {
    const normalized = normalizeBarcodeForPrint(barcodeValue);
    const format = resolveBarcodePrintFormat(normalized);
    const barWidth =
      barWidthPx ??
      resolveUniformBarcodeBarWidth(
        format,
        maxWidthPx,
        resolveBarcodeBarWidth(el, labelWidthMm),
        normalized,
        isBarcodeBarWidthAuto(el.barcodeBarWidth),
      );
    const modules = barcodeModuleCountForFormat(format, normalized);
    style.width = `${Math.min(maxWidthPx, Math.ceil(modules * barWidth))}px`;
  } else {
    style.width = 'max-content';
  }

  return style;
}

/** Top-left position of a barcode SVG within a label slot (matches CSS anchor + align). */
export function calcBarcodeSlotPositionPx(
  el: Pick<LabelElement, 'x' | 'y' | 'align'>,
  labelWidthMm: number,
  labelHeightMm: number,
  svgWidthPx: number,
  _svgHeightPx: number,
): { leftPx: number; topPx: number } {
  const labelWidthPx = Math.round(labelWidthMm * LABEL_PRINT_PX_PER_MM);
  const labelHeightPx = Math.round(labelHeightMm * LABEL_PRINT_PX_PER_MM);
  const anchorX = (el.x / 100) * labelWidthPx;
  const anchorY = (el.y / 100) * labelHeightPx;
  const align = el.align ?? 'left';
  let leftPx = anchorX;
  if (align === 'center') leftPx = anchorX - svgWidthPx / 2;
  else if (align === 'right') leftPx = anchorX - svgWidthPx;
  return { leftPx: Math.round(leftPx), topPx: Math.round(anchorY) };
}

/** Barcode used in Label Designer test print — batch labels lock to this module width. */
export const LABEL_DESIGNER_REFERENCE_BARCODE = '8901234567'; // 10-digit CODE128, matches generated barcodes

/** Parse rendered JsBarcode SVG width attribute (print pixels). */
export function parseBarcodeSvgWidthMarkup(svg: string): number | null {
  const match = svg.match(/\bwidth="([0-9.]+)"/);
  return match ? Number.parseFloat(match[1]) : null;
}

/**
 * Scale CODE128 bar width down so every barcode prints at the same total width as the
 * designer reference (10-digit sample at the template bar width).
 * Without this, longer numeric codes (e.g. 13 digits) render wider and look stretched.
 */
function normalizeCode128BarWidthToReference(
  barWidth: number,
  modules: number,
  referenceBarWidth: number,
): number {
  const refNorm = normalizeBarcodeForPrint(LABEL_DESIGNER_REFERENCE_BARCODE);
  const refModules = barcodeModuleCountForFormat('CODE128', refNorm);
  const targetWidthPx = refModules * referenceBarWidth;
  const currentWidthPx = modules * barWidth;
  if (currentWidthPx <= targetWidthPx) return barWidth;
  const scanMin = barcodeModuleMinWidth('CODE128');
  const scaled = targetWidthPx / modules;
  return Math.max(scanMin, Math.min(barWidth, Math.round(scaled * 100) / 100));
}

function resolveAutoBarcodeBarWidth(
  _height: number,
  maxWidthPx: number,
  format: string,
  normalizedValue: string,
): number {
  const modules = barcodeModuleCountForFormat(format, normalizedValue);
  const scanMin = barcodeModuleMinWidth(format);
  // Default compact widths: EAN formats use 2.0 (reliable on thermal printers);
  // CODE128 uses 1.6 (thin, compact, consistent across all barcode lengths).
  const isEan = format === 'EAN13' || format === 'EAN8' || format === 'UPC';
  const defaultBarWidth = isEan ? 2.0 : 1.6;
  const maxBarWidth = Math.floor((maxWidthPx / modules) * 10) / 10;
  return Math.max(scanMin, Math.min(defaultBarWidth, maxBarWidth));
}

export function resolveBarcodePrintMetrics(
  el: LabelElement,
  labelWidthMm: number,
  labelHeightMm: number,
  barcodeValue: string,
): {
  height: number;
  barWidth: number;
  maxWidthPx: number;
  minBarWidth: number;
  maxBarWidth: number;
  svgWidthPx: number;
  normalizedValue: string;
  format: string;
} {
  const normalizedValue = normalizeBarcodeForPrint(barcodeValue);
  const format = resolveBarcodePrintFormat(normalizedValue);
  const maxWidthPx = labelElementMaxWidthPx(el, labelWidthMm);
  const height = resolveBarcodeHeightPx(el, labelHeightMm);
  const autoFill = isBarcodeBarWidthAuto(el.barcodeBarWidth);
  const preferred = resolveBarcodeBarWidth(el, labelWidthMm);
  let barWidth = autoFill
    ? resolveAutoBarcodeBarWidth(height, maxWidthPx, format, normalizedValue)
    : resolveUniformBarcodeBarWidth(format, maxWidthPx, preferred, normalizedValue, false);

  const modules = barcodeModuleCountForFormat(format, normalizedValue);
  if (format === 'CODE128') {
    const referenceBarWidth = autoFill
      ? resolveAutoBarcodeBarWidth(height, maxWidthPx, 'CODE128', LABEL_DESIGNER_REFERENCE_BARCODE)
      : preferred;
    barWidth = normalizeCode128BarWidthToReference(barWidth, modules, referenceBarWidth);
  }

  const maxBarWidth = maxWidthPx / modules;
  return {
    height,
    barWidth,
    maxWidthPx,
    minBarWidth: barcodeDesignerMinBarWidth(),
    maxBarWidth,
    svgWidthPx: Math.ceil(modules * barWidth),
    normalizedValue,
    format,
  };
}

export function labelTextPrintStyle(
  el: LabelElement,
  labelWidthMm: number,
): Record<string, string | number> {
  const maxWidthPx = labelElementMaxWidthPx(el, labelWidthMm);
  const fontSizePx = labelFontSizePx(el.fontSize);
  const align = el.align ?? 'left';

  const style: Record<string, string | number> = {
    position: 'absolute',
    top: `${el.y}%`,
    fontSize: `${fontSizePx}px`,
    fontWeight: el.fontWeight === 'bold' ? 700 : 400,
    textAlign: align,
    fontFamily: resolveLabelFontFamily(el, 'print'),
    maxWidth: `${maxWidthPx}px`,
    width: `${maxWidthPx}px`,
    overflow: 'hidden',
    textOverflow: 'clip',
    lineHeight: 1.15,
    color: '#000000',
    margin: '0',
    padding: '0',
    whiteSpace: 'nowrap',
    boxSizing: 'border-box',
  };

  const letterSpacingPx = labelLetterSpacingPx(el.letterSpacing);
  if (letterSpacingPx != null) {
    style.letterSpacing = `${letterSpacingPx}px`;
  }

  if (align === 'center') {
    style.left = `${el.x}%`;
    style.transform = 'translateX(-50%)';
  } else if (align === 'right') {
    style.left = `${el.x}%`;
    style.transform = 'translateX(-100%)';
  } else {
    style.left = `${el.x}%`;
  }

  return style;
}

/**
 * Re-expresses a print style at the designer canvas scale.
 *
 * Every px value is a print pixel (8 per mm). Scaling them uniformly keeps the box,
 * the truncation point and the line height identical to what the printer produces —
 * only the size on screen changes. At the default canvas scale the ratio is 1 and the
 * style is passed through untouched.
 */
export function scaleLabelStyleToPreview(
  style: Record<string, string | number>,
  previewScale: number,
): Record<string, string | number> {
  const ratio = previewScale / LABEL_PRINT_PX_PER_MM;
  if (ratio === 1) return { ...style };
  const scaled: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(style)) {
    if (typeof value === 'string' && value.endsWith('px')) {
      const px = parseFloat(value);
      if (!Number.isNaN(px)) {
        scaled[key] = `${px * ratio}px`;
        continue;
      }
    }
    scaled[key] = value;
  }
  return scaled;
}

/**
 * The designer's text style, derived from the print style rather than restated.
 *
 * The canvas is meant to be what comes out of the printer; keeping a second set of
 * rules is how the two drifted apart (line height, ellipsis vs clipping, font stack).
 */
export function labelTextPreviewStyle(
  el: LabelElement,
  labelWidthMm: number,
  previewScale: number,
): Record<string, string | number> {
  return scaleLabelStyleToPreview(labelTextPrintStyle(el, labelWidthMm), previewScale);
}

export function labelElementPrintStyle(el: LabelElement, labelWidthMm: number): Record<string, string | number> {
  return labelTextPrintStyle(el, labelWidthMm);
}

export function labelElementStyle(
  el: LabelElement,
  mode: 'print' | 'preview',
  previewScale = 4,
): Record<string, string | number> {
  const fontSizePx =
    mode === 'print'
      ? labelFontSizePx(el.fontSize)
      : labelPreviewFontSizePx(el.fontSize, previewScale);

  const alignTransform = labelElementAlignTransform(el.align);
  return {
    position: 'absolute',
    left: `${el.x}%`,
    top: `${el.y}%`,
    ...(alignTransform ? { transform: alignTransform } : {}),
    fontSize: `${fontSizePx}px`,
    fontWeight: el.fontWeight === 'bold' ? 700 : 400,
    textAlign: el.align ?? 'left',
    fontFamily: el.type === 'barcode' ? LABEL_MONO_FAMILY : LABEL_FONT_FAMILY,
    maxWidth: '92%',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    lineHeight: 1.15,
    color: '#000000',
    margin: '0',
    padding: '0',
    whiteSpace: 'nowrap',
  };
}

export function resolveLabelFieldText(
  type: LabelFieldType,
  product: LabelProduct,
  layout: LabelLayout,
  currency: string,
  element?: LabelElement,
): string {
  switch (type) {
    case 'name':
      return product.name;
    case 'price':
      return `${currency} ${product.price.toFixed(2)}`;
    case 'sku':
      return product.sku;
    case 'barcode':
      return product.barcode;
    case 'storeName':
      return layout.storeName ?? 'Store';
    case 'customText':
      return element?.customText ?? '';
    default:
      return '';
  }
}

export function labelPreviewBarcodeHeightPx(fontSize: number, previewScale: number): number {
  return labelBarcodeHeightPx(fontSize) * (previewScale / LABEL_PRINT_PX_PER_MM);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function labelStyleToCss(style: Record<string, string | number>): string {
  return Object.entries(style)
    .map(([key, value]) => {
      const prop = key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
      if (prop === 'font-family' && typeof value === 'string') {
        return `${prop}:${value.includes("'") || value.includes('"') ? value : quoteCssFontStack(value)}`;
      }
      return `${prop}:${value}`;
    })
    .join(';');
}

function quoteCssFontStack(stack: string): string {
  return stack
    .split(',')
    .map((part) => {
      const name = part.trim();
      if (!name) return '';
      if ((name.startsWith('"') && name.endsWith('"')) || (name.startsWith("'") && name.endsWith("'"))) {
        return name;
      }
      return `'${name.replace(/'/g, "\\'")}'`;
    })
    .filter(Boolean)
    .join(', ');
}

/** HTML for one label slot — same font math as designer preview at print density. */
export function buildLabelSlotInnerHtml(
  product: LabelProduct,
  layout: LabelLayout,
  currency: string,
  widthMm: number,
  heightMm: number,
  renderBarcodeSvg?: (value: string, height: number, barWidth: number, maxWidthPx?: number) => string,
  options?: { omitBarcodes?: boolean },
): string {
  const showGraphic = layout.showBarcodeGraphic ?? layout.showBarcode ?? false;
  const elements = layout.elements?.filter((e) => e.visible) ?? [];
  const parts: string[] = [];

  for (const el of elements) {
    if (el.type === 'barcode') {
      if (!showGraphic || options?.omitBarcodes) continue;
      const value = resolveLabelFieldText(el.type, product, layout, currency, el);
      if (!value.trim()) continue;
      const metrics = resolveBarcodePrintMetrics(el, widthMm, heightMm, value);
      const css = labelStyleToCss(
        labelBarcodeLayoutStyle(el, widthMm, metrics.normalizedValue, metrics.height, metrics.barWidth),
      );
      const svg =
        renderBarcodeSvg?.(
          metrics.normalizedValue,
          metrics.height,
          metrics.barWidth,
          metrics.maxWidthPx,
        ) ?? '';
      if (svg) {
        const svgWidthPx = parseBarcodeSvgWidthMarkup(svg) ?? metrics.svgWidthPx;
        parts.push(
          `<div class="label-barcode" style="${css};width:${svgWidthPx}px;max-width:${svgWidthPx}px;height:${metrics.height}px;max-height:${metrics.height}px" data-product-sku="${escapeHtml(product.sku)}" data-barcode-format="${escapeHtml(metrics.format)}" data-barcode-value="${escapeHtml(metrics.normalizedValue)}" data-barcode-rendered="${escapeHtml(metrics.normalizedValue)}">${svg}</div>`,
        );
      } else {
        parts.push(
          `<div class="label-barcode" style="${css}" data-barcode-pending="1" data-product-sku="${escapeHtml(product.sku)}" data-barcode-format="${escapeHtml(metrics.format)}" data-barcode-value="${escapeHtml(metrics.normalizedValue)}" data-barcode-height="${metrics.height}" data-barcode-width="${metrics.barWidth}" data-barcode-margin="0"><svg class="barcode-svg" width="${metrics.svgWidthPx}" height="${metrics.height}"></svg></div>`,
        );
      }
      continue;
    }

    const css = labelStyleToCss(labelTextPrintStyle(el, widthMm));

    const raw = resolveLabelFieldText(el.type, product, layout, currency, el);
    if (!raw) continue;
    const value = truncateLabelElementText(raw, el, widthMm);
    parts.push(`<div style="${css}">${escapeHtml(value)}</div>`);
  }

  return parts.join('');
}
