export const LABEL_FONT_OPTIONS = [
  { id: 'segoe', label: 'Segoe UI', family: 'Segoe UI, Arial, sans-serif' },
  { id: 'arial', label: 'Arial', family: 'Arial, Helvetica, sans-serif' },
  { id: 'sans', label: 'System Sans', family: 'system-ui, -apple-system, sans-serif' },
  { id: 'serif', label: 'Serif', family: 'Georgia, Times New Roman, serif' },
  { id: 'mono', label: 'Monospace', family: 'Consolas, ui-monospace, monospace' },
  { id: 'narrow', label: 'Arial Narrow', family: 'Arial Narrow, Arial, sans-serif' },
  { id: 'impact', label: 'Impact', family: 'Impact, Haettenschweiler, sans-serif' },
  { id: 'custom', label: 'Upload font…', family: '' },
] as const;

export type LabelFontId = (typeof LABEL_FONT_OPTIONS)[number]['id'];

function cssSafeFontToken(name: string): string {
  return name.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'custom';
}

export type LabelCustomFontFormat = 'truetype' | 'opentype' | 'woff' | 'woff2';

export type LabelCustomFont = {
  name: string;
  dataUrl?: string;
  format?: LabelCustomFontFormat;
};

export function resolveLabelFontFamily(
  el: Pick<
    { fontFamily?: LabelFontId; customFontFamily?: string; customFontDataUrl?: string; type: string },
    'fontFamily' | 'customFontFamily' | 'customFontDataUrl' | 'type'
  >,
  mode: 'preview' | 'print' = 'preview',
): string {
  if (el.type === 'barcode') return 'ui-monospace, monospace';
  const id = el.fontFamily ?? 'segoe';
  if (id === 'custom' && el.customFontFamily?.trim()) {
    const name = el.customFontFamily.trim();
    const safe = cssSafeFontToken(name);
    const family = `'label-custom-${safe}'`;
    if (el.customFontDataUrl) {
      return `${family}, sans-serif`;
    }
    if (mode === 'print') {
      return `${family}, '${name.replace(/'/g, "\\'")}', sans-serif`;
    }
    return `'${name.replace(/'/g, "\\'")}', sans-serif`;
  }
  const match = LABEL_FONT_OPTIONS.find((f) => f.id === id);
  const stack = match?.family ?? 'Segoe UI, Arial, sans-serif';
  if (mode === 'print') {
    return `'label-${id}', ${quoteCssFontStack(stack)}`;
  }
  return stack;
}

/** Unique uploaded / custom fonts referenced by label elements. */
export function collectCustomLabelFonts(
  elements?: Array<{
    fontFamily?: LabelFontId;
    customFontFamily?: string;
    customFontDataUrl?: string;
    customFontFormat?: LabelCustomFontFormat;
  }>,
): LabelCustomFont[] {
  const byName = new Map<string, LabelCustomFont>();
  for (const el of elements ?? []) {
    if (el.fontFamily !== 'custom' || !el.customFontFamily?.trim()) continue;
    const name = el.customFontFamily.trim();
    const existing = byName.get(name);
    if (!existing) {
      byName.set(name, {
        name,
        dataUrl: el.customFontDataUrl,
        format: el.customFontFormat,
      });
    } else if (!existing.dataUrl && el.customFontDataUrl) {
      byName.set(name, {
        name,
        dataUrl: el.customFontDataUrl,
        format: el.customFontFormat,
      });
    }
  }
  return [...byName.values()];
}

/** @deprecated Use collectCustomLabelFonts */
export function collectCustomLabelFontNames(
  elements?: Array<{ fontFamily?: LabelFontId; customFontFamily?: string }>,
): string[] {
  return collectCustomLabelFonts(elements).map((f) => f.name);
}

/** @font-face rules so Chromium resolves designer font picks when rasterizing labels. */
export function buildLabelPrintFontFaceCss(customFonts?: LabelCustomFont[]): string {
  const base = LABEL_FONT_OPTIONS.filter((opt) => opt.id !== 'custom')
    .map((opt) => {
      const localNames = opt.family
        .split(',')
        .map((part) => part.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean);
      const src = localNames.map((name) => `local('${name.replace(/'/g, "\\'")}')`).join(', ');
      return `@font-face{font-family:'label-${opt.id}';font-style:normal;font-weight:normal;src:${src};}`;
    })
    .join('');

  const custom = (customFonts ?? [])
    .map((font) => {
      const safe = cssSafeFontToken(font.name);
      if (font.dataUrl) {
        const format = font.format ?? 'truetype';
        const escapedUrl = font.dataUrl.replace(/'/g, "\\'");
        return `@font-face{font-family:'label-custom-${safe}';font-style:normal;font-weight:normal;src:url('${escapedUrl}') format('${format}');}`;
      }
      const escaped = font.name.replace(/'/g, "\\'");
      return `@font-face{font-family:'label-custom-${safe}';font-style:normal;font-weight:normal;src:local('${escaped}');}`;
    })
    .join('');

  return base + custom;
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

/** Bar modules for common symbologies (203 DPI layout math). */
export function detectBarcodeFormat(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length === 13 || digits.length === 12) return 'EAN13';
  if (digits.length === 8) return 'EAN8';
  if (digits.length === 11) return 'UPC';
  return 'CODE128';
}

export function ean13CheckDigit(body12: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const n = Number.parseInt(body12[i] ?? '', 10);
    if (!Number.isFinite(n)) return 0;
    sum += n * (i % 2 === 0 ? 1 : 3);
  }
  return (10 - (sum % 10)) % 10;
}

export function isValidEan13CheckDigit(digits13: string): boolean {
  if (digits13.length !== 13) return false;
  return digits13[12] === String(ean13CheckDigit(digits13.slice(0, 12)));
}

export function isValidEan8CheckDigit(digits8: string): boolean {
  if (digits8.length !== 8) return false;
  const body = digits8.slice(0, 7);
  let sum = 0;
  for (let i = 0; i < 7; i++) {
    const n = Number.parseInt(body[i] ?? '', 10);
    if (!Number.isFinite(n)) return false;
    sum += n * (i % 2 === 0 ? 3 : 1);
  }
  const check = (10 - (sum % 10)) % 10;
  return digits8[7] === String(check);
}

/** Symbology for printing — invalid EAN check digits use CODE128 to preserve unique product codes. */
export function resolveBarcodePrintFormat(value: string): 'EAN13' | 'EAN8' | 'UPC' | 'CODE128' {
  const digits = value.replace(/\D/g, '');
  if (digits.length === 13 && isValidEan13CheckDigit(digits)) return 'EAN13';
  if (digits.length === 12) return 'EAN13';
  if (digits.length === 8 && isValidEan8CheckDigit(digits)) return 'EAN8';
  if (digits.length === 7) return 'EAN8';
  if (digits.length === 11) return 'UPC';
  return 'CODE128';
}

/**
 * Normalize a product barcode for label print.
 * Valid EAN/UPC: fix or keep check digit. Invalid EAN-13 (e.g. demo codes sharing the same
 * first 12 digits): keep full digits and print as CODE128 so each product stays unique.
 */
export function normalizeBarcodeForPrint(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  const digits = trimmed.replace(/\D/g, '');
  const format = resolveBarcodePrintFormat(trimmed);

  if (format === 'EAN13') {
    if (digits.length === 13) return digits;
    if (digits.length >= 12) {
      const body = digits.slice(0, 12);
      return body + String(ean13CheckDigit(body));
    }
  }

  if (format === 'EAN8') {
    if (digits.length === 8) return digits;
    if (digits.length >= 7) {
      const body = digits.slice(0, 7);
      let sum = 0;
      for (let i = 0; i < 7; i++) {
        const n = Number.parseInt(body[i] ?? '', 10);
        sum += n * (i % 2 === 0 ? 3 : 1);
      }
      const check = (10 - (sum % 10)) % 10;
      return body + String(check);
    }
  }

  if (format === 'UPC' && digits.length >= 11) {
    const body = digits.slice(0, 11);
    return body + String(ean13CheckDigit(body.padStart(12, '0').slice(1)));
  }

  // CODE128 — preserve full code (digits or alphanumeric) for unique internal barcodes
  return digits.length > 0 ? digits : trimmed;
}

/** JsBarcode CODE128 module estimate — numeric values use code set C (pairs of digits). */
export function code128ModuleCount(value: string): number {
  const trimmed = value.trim();
  if (!trimmed) return 95;
  if (/^\d+$/.test(trimmed)) {
    // Start C(11) + data ceil(n/2)*11 + checksum(11) + stop(13)
    return 35 + 11 * Math.ceil(trimmed.length / 2);
  }
  // Code set B: start(11) + n*11 + checksum(11) + stop(13)
  return 35 + 11 * trimmed.length;
}

export function barcodeModuleCountForFormat(format: string, value?: string): number {
  if (format === 'EAN13') return 95;
  if (format === 'EAN8') return 67;
  if (format === 'UPC') return 95;
  if (value?.trim()) {
    const trimmed = value.trim();
    if (format === 'CODE39') return trimmed.length * 13 + 13;
    if (format === 'CODE128') return code128ModuleCount(trimmed);
    return code128ModuleCount(trimmed);
  }
  return estimateBarcodeModuleCount(value ?? '');
}

export function estimateBarcodeModuleCount(value: string): number {
  const trimmed = value.trim();
  if (!trimmed) return 95;
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length === 13 || digits.length === 12) return 95;
  if (digits.length === 8) return 67;
  if (digits.length === 11) return 95;
  return code128ModuleCount(trimmed);
}

/** Approximate printed barcode width in print pixels (203 DPI). */
export function estimateBarcodeWidthPx(value: string, barWidth: number): number {
  return Math.ceil(estimateBarcodeModuleCount(value) * barWidth);
}

/**
 * Uniform module width for a symbology — fills the slot at 203 DPI.
 * CODE128/CODE39 allow barWidth=1 to fit wider codes. EAN/UPC minimum is 2 dots.
 * Result is always capped so modules × barWidth ≤ maxWidthPx (no slot overflow).
 * Legacy designer values below 1.75 (e.g. 1.1) are treated as auto-fill.
 */
export function resolveUniformBarcodeBarWidth(
  format: string,
  maxWidthPx: number,
  preferredBarWidth: number,
  value?: string,
): number {
  const modules = Math.max(1, barcodeModuleCountForFormat(format, value));
  // EAN/UPC need at least 2 dots per bar for scanner accuracy; CODE128 can use 1
  const minBarWidth = format === 'EAN13' || format === 'EAN8' || format === 'UPC' ? 2 : 1;
  const filled = maxWidthPx / modules;
  // Always scale to fill the slot; preferred width is a ceiling when manually set high
  const capped =
    preferredBarWidth >= 1.75 ? Math.min(preferredBarWidth, filled) : filled;
  const snapped = Math.min(filled, Math.round(Math.max(minBarWidth, capped) * 2) / 2);
  return Math.max(minBarWidth, snapped);
}

/**
 * Ideal height ÷ module width ratio for scannable thermal barcodes (203 DPI).
 */
export const BARCODE_HEIGHT_TO_MODULE_RATIO = 16;

export function resolveBarcodeBarWidthFromHeight(
  heightPx: number,
  maxWidthPx: number,
  format: string,
  value?: string,
): number {
  const modules = Math.max(1, barcodeModuleCountForFormat(format, value));
  const minBarWidth = format === 'EAN13' || format === 'EAN8' || format === 'UPC' ? 2 : 1;
  let barWidth = Math.max(minBarWidth, Math.round((heightPx / BARCODE_HEIGHT_TO_MODULE_RATIO) * 2) / 2);
  if (modules * barWidth > maxWidthPx) {
    barWidth = Math.max(minBarWidth, Math.floor((maxWidthPx / modules) * 2) / 2);
  }
  return barWidth;
}

/**
 * Pick JsBarcode module width so the graphic fits the slot without CSS scaling.
 * CSS downscaling blurs bars and makes them unscannable on thermal printers.
 */
export function fitBarcodeBarWidth(
  value: string,
  maxWidthPx: number,
  preferredBarWidth: number,
): number {
  const format = detectBarcodeFormat(value);
  return resolveUniformBarcodeBarWidth(format, maxWidthPx, preferredBarWidth, value);
}
