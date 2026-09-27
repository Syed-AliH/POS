function formatReceiptDateTime(iso: string): string {
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const pad = (n: number) => String(n).padStart(2, '0');
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  let hours = d.getHours();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  return `${pad(d.getDate())}-${MONTHS[d.getMonth()]}-${d.getFullYear()} ${pad(hours)}:${pad(d.getMinutes())} ${ampm}`;
}

export interface ReceiptTemplateSections {
  showLogo: boolean;
  showStoreName: boolean;
  showAddress: boolean;
  showPhone: boolean;
  showEmail: boolean;
  showHeaderText: boolean;
  showSaleNumber: boolean;
  showDate: boolean;
  showCashier: boolean;
  showItems: boolean;
  showSubtotal: boolean;
  showDiscount: boolean;
  showTax: boolean;
  showTotal: boolean;
  showPayment: boolean;
  showThankYou: boolean;
  showReturnPolicy: boolean;
  showTaxInfo: boolean;
  showQrCode: boolean;
}

export interface ReceiptTemplateHeader {
  storeName?: string;
  storeNameFontSize?: number;
  storeNameFontFamily?: 'sans' | 'serif' | 'mono' | 'display' | 'custom';
  storeNameFontWeight?: 'normal' | 'bold';
  storeNameUppercase?: boolean;
  storeNameCustomFontName?: string;
  storeNameCustomFontDataUrl?: string;
  storeNameCustomFontFormat?: 'truetype' | 'opentype' | 'woff' | 'woff2';
  logoDataUrl?: string;
  address?: string;
  phone?: string;
  email?: string;
  headerText?: string;
  customLine?: string;
  showLogo?: boolean;
  showAddress?: boolean;
  /** Custom labels for receipt rows (e.g. change "Receipt:" to "Invoice #"). */
  labels?: ReceiptTemplateLabels;
  /** Body / totals font sizes in preview pixels. */
  style?: ReceiptTemplateStyle;
  /** Sample sale text for designer preview and test print (real sales use checkout data). */
  sampleSale?: Partial<ReceiptSale>;
}

/** User-editable row labels on printed receipts. */
export interface ReceiptTemplateLabels {
  receiptNumber?: string;
  date?: string;
  cashier?: string;
  subtotal?: string;
  discount?: string;
  tax?: string;
  total?: string;
  payment?: string;
  tendered?: string;
  change?: string;
  /** Prefix for the pre-markdown price on a discounted line. */
  was?: string;
  /** Suffix after the discount percentage, e.g. "35% off". */
  off?: string;
}

export const DEFAULT_RECEIPT_LABELS: Required<ReceiptTemplateLabels> = {
  receiptNumber: 'Receipt:',
  date: 'Date:',
  cashier: 'Cashier:',
  subtotal: 'Subtotal:',
  discount: 'Discount:',
  tax: 'Tax:',
  total: 'TOTAL:',
  payment: 'Payment:',
  tendered: 'Tendered:',
  change: 'Change:',
  was: 'Was',
  off: 'off',
};

export interface ReceiptTemplateStyle {
  bodyFontSize?: number;
  smallFontSize?: number;
  totalFontSize?: number;
  footerFontSize?: number;
  bodyFontFamily?: ReceiptStoreFontKey;
  itemFontFamily?: ReceiptStoreFontKey;
  metaFontFamily?: ReceiptStoreFontKey;
  footerFontFamily?: ReceiptStoreFontKey;
  customFontName?: string;
  customFontDataUrl?: string;
  customFontFormat?: 'truetype' | 'opentype' | 'woff' | 'woff2';
  showHeaderDivider?: boolean;
  showMetaDivider?: boolean;
  showBeforeTotalsDivider?: boolean;
  showBeforePaymentDivider?: boolean;
  showFooterDivider?: boolean;
  dividerChar?: string;
  dashChar?: string;
}

export const DEFAULT_RECEIPT_STYLE: Required<
  Omit<ReceiptTemplateStyle, 'customFontName' | 'customFontDataUrl' | 'customFontFormat'>
> & Pick<ReceiptTemplateStyle, 'customFontName' | 'customFontDataUrl' | 'customFontFormat'> = {
  bodyFontSize: 11,
  smallFontSize: 10,
  totalFontSize: 12,
  footerFontSize: 9,
  bodyFontFamily: 'mono',
  itemFontFamily: 'sans',
  metaFontFamily: 'mono',
  footerFontFamily: 'mono',
  showHeaderDivider: true,
  showMetaDivider: true,
  showBeforeTotalsDivider: true,
  showBeforePaymentDivider: true,
  showFooterDivider: true,
  dividerChar: '═',
  dashChar: '─',
};

export function resolveReceiptLabels(header?: ReceiptTemplateHeader): Required<ReceiptTemplateLabels> {
  return { ...DEFAULT_RECEIPT_LABELS, ...header?.labels };
}

export function resolveReceiptStyle(header?: ReceiptTemplateHeader): Required<
  Omit<ReceiptTemplateStyle, 'customFontName' | 'customFontDataUrl' | 'customFontFormat'>
> & Pick<ReceiptTemplateStyle, 'customFontName' | 'customFontDataUrl' | 'customFontFormat'> {
  return { ...DEFAULT_RECEIPT_STYLE, ...header?.style };
}

export type ReceiptFontZone = 'body' | 'item' | 'meta' | 'footer';

export function resolveReceiptZoneFontFamily(
  style: ReturnType<typeof resolveReceiptStyle>,
  zone: ReceiptFontZone,
): string {
  const key =
    zone === 'body' ? style.bodyFontFamily
    : zone === 'item' ? style.itemFontFamily
    : zone === 'meta' ? style.metaFontFamily
    : style.footerFontFamily;
  if (key === 'custom' && style.customFontName) {
    const safe = style.customFontName.replace(/'/g, '');
    return `'${safe}', ui-monospace, monospace`;
  }
  if (key === 'custom') return RECEIPT_STORE_FONTS.mono.family;
  return RECEIPT_STORE_FONTS[key ?? 'mono'].family;
}

/** Merge template sample sale with defaults — for preview and test print only. */
export function resolveReceiptSampleSale(
  template?: ReceiptTemplateConfig,
  base: ReceiptSale = SAMPLE_RECEIPT_SALE,
): ReceiptSale {
  const sample = template?.header?.sampleSale;
  if (!sample) return { ...base };
  return {
    ...base,
    ...sample,
    items: sample.items ?? base.items,
  };
}

export const RECEIPT_STORE_FONTS = {
  sans: { label: 'Modern Sans', family: "'Poppins', system-ui, sans-serif" },
  serif: { label: 'Classic Serif', family: "Georgia, 'Times New Roman', serif" },
  mono: { label: 'Receipt Mono', family: "ui-monospace, 'Courier New', monospace" },
  display: { label: 'Bold Display', family: "'Poppins', system-ui, sans-serif" },
  custom: { label: 'Custom Font', family: 'inherit' },
} as const;

export type ReceiptStoreFontKey = keyof typeof RECEIPT_STORE_FONTS;

export function fontFormatFromFilename(filename: string): ReceiptTemplateHeader['storeNameCustomFontFormat'] {
  const ext = filename.split('.').pop()?.toLowerCase();
  if (ext === 'woff2') return 'woff2';
  if (ext === 'woff') return 'woff';
  if (ext === 'otf') return 'opentype';
  return 'truetype';
}

export function fontNameFromFilename(filename: string): string {
  const base = filename.replace(/\.[^.]+$/, '').trim();
  return base.replace(/[-_]+/g, ' ') || 'Custom Font';
}

export function resolveStoreNameFontFamily(header: ReceiptTemplateHeader): string {
  if (header.storeNameFontFamily === 'custom' && header.storeNameCustomFontName) {
    const safe = header.storeNameCustomFontName.replace(/'/g, '');
    return `'${safe}', 'Poppins', sans-serif`;
  }
  const key = header.storeNameFontFamily ?? 'sans';
  if (key === 'custom') return RECEIPT_STORE_FONTS.sans.family;
  return RECEIPT_STORE_FONTS[key].family;
}

export interface ReceiptTemplateFooter {
  message?: string;
  thankYouMessage?: string;
  returnPolicy?: string;
  taxInfo?: string;
  qrCodeContent?: string;
  customLine?: string;
}

export interface ReceiptTemplateConfig {
  widthMm?: 58 | 80;
  sections?: Partial<ReceiptTemplateSections>;
  header?: ReceiptTemplateHeader;
  footer?: ReceiptTemplateFooter;
}

export interface ReceiptSale {
  saleNumber: string;
  createdAt: string;
  cashierName: string;
  items: Array<{
    productName: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
    /** Per-line discount percentage applied to this item (0 when none). */
    discountPercent?: number;
    /** Retail price when the item was on sale — prints the customer's saving. */
    originalPrice?: number;
  }>;
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  totalAmount: number;
  paymentMethod: string;
  amountTendered: number | null;
  changeGiven: number | null;
}

export const SAMPLE_RECEIPT_SALE: ReceiptSale = {
  saleNumber: 'MB-2026-000042',
  createdAt: new Date().toISOString(),
  cashierName: 'Demo Cashier',
  items: [
    { productName: 'Organic Baby Formula 400g', quantity: 2, unitPrice: 1250, lineTotal: 2500, discountPercent: 0 },
    { productName: 'Cotton Onesie Set', quantity: 1, unitPrice: 890, lineTotal: 890, discountPercent: 10 },
  ],
  subtotal: 3390,
  discountAmount: 100,
  taxAmount: 0,
  totalAmount: 3290,
  paymentMethod: 'cash',
  amountTendered: 3500,
  changeGiven: 210,
};

export const DEFAULT_RECEIPT_SECTIONS: ReceiptTemplateSections = {
  showLogo: true,
  showStoreName: true,
  showAddress: true,
  showPhone: true,
  showEmail: false,
  showHeaderText: true,
  showSaleNumber: true,
  showDate: true,
  showCashier: true,
  showItems: true,
  showSubtotal: true,
  showDiscount: true,
  showTax: true,
  showTotal: true,
  showPayment: true,
  showThankYou: true,
  showReturnPolicy: true,
  showTaxInfo: false,
  showQrCode: false,
};

function charsForWidth(widthMm: 58 | 80): number {
  return widthMm === 58 ? 32 : 42;
}

export function formatReceipt(
  sale: ReceiptSale,
  settings: Record<string, string>,
  template?: ReceiptTemplateConfig,
): string {
  const widthMm = template?.widthMm ?? 80;
  const width = charsForWidth(widthMm);
  const sections = { ...DEFAULT_RECEIPT_SECTIONS, ...template?.sections };
  const header = template?.header ?? {};
  const footer = template?.footer ?? {};

  const storeName = header.storeName || settings.store_name || 'Store';
  const address = header.address ?? settings.store_address ?? '';
  const phone = header.phone ?? settings.store_phone ?? '';
  const email = header.email ?? settings.store_email ?? '';
  const currency = settings.currency ?? 'PKR';
  const line = '='.repeat(width);
  const dash = '-'.repeat(width);

  const fmt = (n: number) => `${currency} ${n.toFixed(2)}`;
  const pad = (left: string, right: string) => {
    const space = width - left.length - right.length;
    return left + ' '.repeat(Math.max(1, space)) + right;
  };
  const center = (text: string) => {
    const trimmed = text.slice(0, width);
    return trimmed.padStart(Math.floor((width + trimmed.length) / 2)).slice(0, width);
  };
  // Splits on the user's own line breaks first, then word-wraps each one to the
  // printer width independently — a manual numbered list (1. ... / 2. ...) must
  // stay on separate lines rather than being run together into one paragraph.
  const wrap = (text: string) => {
    const rows: string[] = [];
    for (const paragraph of text.split('\n')) {
      if (!paragraph.trim()) {
        rows.push('');
        continue;
      }
      const words = paragraph.split(' ');
      let row = '';
      for (const word of words) {
        const next = row ? `${row} ${word}` : word;
        if (next.length > width) {
          if (row) rows.push(row);
          row = word.slice(0, width);
        } else row = next;
      }
      if (row) rows.push(row);
    }
    return rows;
  };

  const lines: string[] = [line];

  if (sections.showLogo && header.logoDataUrl) {
    lines.push(center('[ LOGO ]'));
  }
  if (sections.showStoreName && storeName) {
    lines.push(center(header.storeNameUppercase === false ? storeName : storeName.toUpperCase()));
  }
  if (sections.showAddress && address) wrap(address).forEach((r) => lines.push(center(r)));
  if (sections.showPhone && phone) lines.push(center(phone));
  if (sections.showEmail && email) lines.push(center(email));
  if (sections.showHeaderText && header.headerText) wrap(header.headerText).forEach((r) => lines.push(center(r)));
  if (header.customLine) wrap(header.customLine).forEach((r) => lines.push(center(r)));

  lines.push(line);
  if (sections.showSaleNumber) lines.push(`Receipt: ${sale.saleNumber}`);
  if (sections.showDate) lines.push(`Date: ${formatReceiptDateTime(sale.createdAt)}`);
  if (sections.showCashier) lines.push(`Cashier: ${sale.cashierName}`);
  lines.push(dash);

  if (sections.showItems) {
    for (const item of sale.items) {
      lines.push(item.productName.slice(0, width));
      lines.push(pad(`  ${item.quantity} x ${fmt(item.unitPrice)}`, fmt(item.lineTotal)));
      if (item.discountPercent && item.discountPercent > 0) {
        lines.push(`  Discount: ${item.discountPercent}%`);
      }
    }
    lines.push(dash);
  }

  const totalQuantity = sale.items.reduce((sum, i) => sum + i.quantity, 0);
  lines.push(pad('Total items:', String(totalQuantity)));
  if (sections.showSubtotal) lines.push(pad('Subtotal:', fmt(sale.subtotal)));
  if (sections.showDiscount && sale.discountAmount > 0) lines.push(pad('Discount:', `-${fmt(sale.discountAmount)}`));
  if (sections.showTax) lines.push(pad('Tax:', fmt(sale.taxAmount)));
  lines.push(pad('TOTAL:', fmt(sale.totalAmount)));
  lines.push(dash);

  if (sections.showPayment) {
    lines.push(`Payment: ${sale.paymentMethod.toUpperCase()}`);
    if (sale.amountTendered != null) {
      lines.push(pad('Tendered:', fmt(sale.amountTendered)));
      lines.push(pad('Change:', fmt(sale.changeGiven ?? 0)));
    }
  }

  if (sections.showTaxInfo && footer.taxInfo) {
    lines.push(dash);
    wrap(footer.taxInfo).forEach((r) => lines.push(r));
  }

  lines.push(line);

  // Left-aligned — a numbered list (1. ... 2. ...) reads naturally flush-left, not
  // centered line-by-line.
  if (sections.showReturnPolicy && footer.returnPolicy) {
    wrap(footer.returnPolicy).forEach((r) => lines.push(r));
  }

  if (footer.customLine) wrap(footer.customLine).forEach((r) => lines.push(center(r)));

  if (sections.showQrCode) {
    const qr = footer.qrCodeContent ?? sale.saleNumber;
    lines.push(center('[ QR CODE ]'));
    lines.push(center(qr.slice(0, width)));
  }

  // Thank-you sits last, right above the closing rule — the final thing a
  // customer reads.
  const thankYou = footer.thankYouMessage ?? footer.message ?? 'Thank you for your purchase!';
  if (sections.showThankYou) wrap(thankYou).forEach((r) => lines.push(center(r)));

  lines.push(line);
  return lines.join('\n');
}

export interface LabelProduct {
  name: string;
  sku: string;
  barcode: string;
  /** What the customer pays — the sale price when one is set. */
  price: number;
  /** Pre-discount price, for sale labels. Omitted when the product is not discounted. */
  originalPrice?: number;
}

export const SAMPLE_LABEL_PRODUCT: LabelProduct = {
  name: 'Wooden Puzzle 1902-9W',
  sku: 'SKU-TO-0001',
  barcode: '8901234567',  // 10 digits → CODE128, matches generated product barcodes
  price: 940,
  // Carries a markdown so the designer can see and place the struck was-price;
  // templates without that field ignore it.
  originalPrice: 1250,
};

/** Second slot for 2-up label designer / roll previews. */
export const SAMPLE_LABEL_PRODUCT_2: LabelProduct = {
  name: 'Wooden Numeric 1902-8W',
  sku: 'SKU-TO-0002',
  barcode: '6291108734',  // 10 digits → CODE128
  price: 940,
  originalPrice: 1100,
};

export type LabelFieldType =
  | 'name'
  | 'price'
  | 'originalPrice'
  | 'discountPercent'
  | 'sku'
  | 'barcode'
  | 'storeName'
  | 'customText';

import type { LabelFontId } from './labelFonts';

export interface LabelElement {
  id: string;
  type: LabelFieldType;
  visible: boolean;
  x: number;
  y: number;
  fontSize: number;
  fontWeight?: 'normal' | 'bold';
  align?: 'left' | 'center' | 'right';
  customText?: string;
  barcodeBarWidth?: number;
  /** Barcode height in mm; bar width scales automatically from height. */
  barcodeHeightMm?: number;
  fontFamily?: LabelFontId;
  /** Display name for uploaded custom font. */
  customFontFamily?: string;
  /** Base64 data URL of uploaded font file (.ttf, etc.). */
  customFontDataUrl?: string;
  customFontFormat?: 'truetype' | 'opentype' | 'woff' | 'woff2';
  /** Extra space between characters (designer units, same scale as fontSize). */
  letterSpacing?: number;
  /** Draws a line through the text — an alternative to a WAS/NOW label. */
  strikethrough?: boolean;
  /** Rendered before the field's value, e.g. "WAS ". Skipped when the value is empty. */
  prefix?: string;
}

export interface LabelLayout {
  fields?: Array<'name' | 'price' | 'sku' | 'barcode'>;
  showBarcode?: boolean;
  showBarcodeGraphic?: boolean;
  fontSize?: string;
  elements?: LabelElement[];
  storeName?: string;
}

export interface LabelPrintLine {
  type: 'text' | 'barCode';
  value: string;
  style?: Record<string, string>;
  height?: number;
  width?: number;
  displayValue?: boolean;
  position?: 'left' | 'center' | 'right';
}

/**
 * Sale label: a WAS price above a prominent NOW price, with the saving as a badge.
 *
 * Laid out for 38.1 x 25.4 mm stock. The two prices share a line — struck price small
 * on the left, sale price large on the right — so the barcode keeps the lower third
 * and stays scannable.
 */
export function saleLabelElements(): LabelElement[] {
  return [
    { id: 'store', type: 'storeName', visible: true, x: 50, y: 3, fontSize: 8, align: 'center', fontWeight: 'bold' },
    { id: 'name', type: 'name', visible: true, x: 5, y: 17, fontSize: 8, align: 'left' },
    { id: 'was', type: 'originalPrice', visible: true, x: 5, y: 33, fontSize: 8, align: 'left', prefix: 'WAS ' },
    { id: 'off', type: 'discountPercent', visible: true, x: 95, y: 32, fontSize: 9, align: 'right', fontWeight: 'bold' },
    { id: 'now', type: 'price', visible: true, x: 5, y: 45, fontSize: 12, align: 'left', fontWeight: 'bold', prefix: 'NOW ' },
    { id: 'barcode', type: 'barcode', visible: true, x: 5, y: 64, fontSize: 7, align: 'left', barcodeHeightMm: 5 },
    { id: 'sku', type: 'sku', visible: true, x: 5, y: 88, fontSize: 7, align: 'left' },
  ];
}

export function defaultLabelElements(): LabelElement[] {
  return [
    { id: 'store', type: 'storeName', visible: true, x: 50, y: 8, fontSize: 8, align: 'center', fontWeight: 'bold' },
    { id: 'name', type: 'name', visible: true, x: 5, y: 22, fontSize: 10, align: 'left', fontWeight: 'bold' },
    { id: 'price', type: 'price', visible: true, x: 5, y: 42, fontSize: 12, align: 'left', fontWeight: 'bold' },
    { id: 'sku', type: 'sku', visible: true, x: 5, y: 58, fontSize: 8, align: 'left' },
    { id: 'barcode', type: 'barcode', visible: true, x: 5, y: 78, fontSize: 8, align: 'left' },
  ];
}

import {
  labelBarcodeBarWidth,
  labelBarcodeHeightPx,
  labelElementStyle,
  resolveLabelFieldText,
} from './labelRender';

export {
  LABEL_DESIGN_PX_PER_MM,
  LABEL_FONT_FAMILY,
  LABEL_MONO_FAMILY,
  LABEL_PRINT_PX_PER_MM,
  LABEL_CANVAS_PREVIEW_SCALE,
  buildLabelSlotInnerHtml,
  labelBarcodeBarWidth,
  labelBarcodeHeightPx,
  labelBarcodePrintHeightPx,
  labelCanvasSizePx,
  labelElementAlignTransform,
  labelElementStyle,
  labelFontSizePx,
  labelLetterSpacingPx,
  labelElementPrintStyle,
  labelTextPreviewStyle,
  scaleLabelStyleToPreview,
  labelPreviewBarcodeHeightPx,
  labelPreviewFontSizePx,
  labelPreviewLetterSpacingPx,
  labelStyleToCss,
  labelTsplFontHeightDots,
  labelTsplFontKey,
  labelTsplPreviewFontSizePx,
  clampLabelPositionPercent,
  labelMmToPercent,
  labelPercentToMm,
  labelElementLeftEdgeMm,
  labelElementMaxWidthPx,
  labelLeftEdgeMmToAnchorPercent,
  labelPreviewMaxWidthPx,
  resolveBarcodeBarWidth,
  labelTsplXMul,
  resolveLabelFieldText,
  truncateLabelElementText,
  truncateTextForLabelWidth,
  truncateTextForTsplSlot,
  estimateTsplTextWidthDots,
  labelBarcodeLayoutStyle,
  labelTextPrintStyle,
  calcBarcodeSlotPositionPx,
  resolveBarcodePrintMetrics,
  resolveBarcodeHeightPx,
  LABEL_DESIGNER_REFERENCE_BARCODE,
} from './labelRender';

export {
  LABEL_FONT_OPTIONS,
  buildLabelPrintFontFaceCss,
  collectCustomLabelFonts,
  collectCustomLabelFontNames,
  barcodeModuleCountForFormat,
  code128ModuleCount,
  detectBarcodeFormat,
  ean13CheckDigit,
  estimateBarcodeModuleCount,
  estimateBarcodeWidthPx,
  fitBarcodeBarWidth,
  normalizeBarcodeForPrint,
  resolveBarcodePrintFormat,
  isValidEan13CheckDigit,
  resolveLabelFontFamily,
  resolveUniformBarcodeBarWidth,
  resolveBarcodeBarWidthFromHeight,
  BARCODE_HEIGHT_TO_MODULE_RATIO,
  BARCODE_QUIET_ZONE_MODULES,
  BARCODE_BAR_WIDTH_AUTO_SENTINEL,
  barcodeQuietZonePx,
  barcodeModuleMinWidth,
  barcodeDesignerMinBarWidth,
  BARCODE_DESIGNER_MIN_BAR_WIDTH,
  isBarcodeBarWidthAuto,
  type LabelFontId,
  type LabelCustomFont,
  type LabelCustomFontFormat,
} from './labelFonts';

function buildPositionedLabelPrintData(
  product: LabelProduct,
  layout: LabelLayout,
  currency: string,
  widthMm: number,
): LabelPrintLine[] {
  const lines: LabelPrintLine[] = [];
  const showGraphic = layout.showBarcodeGraphic ?? layout.showBarcode ?? false;
  const elements = layout.elements?.filter((e) => e.visible) ?? [];

  for (const el of elements) {
    const baseStyle = Object.fromEntries(
      Object.entries(labelElementStyle(el, 'print')).map(([k, v]) => [k, String(v)]),
    );

    if (el.type === 'barcode' && showGraphic && product.barcode) {
      lines.push({
        type: 'barCode',
        value: product.barcode,
        height: labelBarcodeHeightPx(el.fontSize),
        width: labelBarcodeBarWidth(widthMm),
        displayValue: false,
        position: el.align ?? 'left',
        style: {
          ...baseStyle,
          display: 'flex',
          justifyContent: el.align === 'center' ? 'center' : el.align === 'right' ? 'flex-end' : 'flex-start',
        },
      });
      continue;
    }

    const value = resolveLabelFieldText(el.type, product, layout, currency, el);
    if (!value) continue;

    lines.push({
      type: 'text',
      value,
      style: baseStyle,
    });
  }

  return lines;
}

export function buildLabelPrintData(
  product: LabelProduct,
  layout: LabelLayout,
  currency = 'PKR',
  widthMm = 50,
  _heightMm = 30,
): LabelPrintLine[] {
  if (layout.elements?.length) {
    return buildPositionedLabelPrintData(product, layout, currency, widthMm);
  }

  const lines: LabelPrintLine[] = [];
  const showGraphic = layout.showBarcodeGraphic ?? layout.showBarcode ?? false;
  const fontSize = layout.fontSize ?? '12px';
  const fields = layout.fields ?? ['name', 'price', 'sku'];
  for (const field of fields) {
    if (field === 'name') {
      lines.push({ type: 'text', value: product.name.slice(0, 32), style: { fontSize, fontWeight: '600' } });
    } else if (field === 'price') {
      lines.push({ type: 'text', value: `${currency} ${product.price.toFixed(2)}`, style: { fontSize: '14px', fontWeight: '700' } });
    } else if (field === 'sku') {
      lines.push({ type: 'text', value: product.sku, style: { fontSize: '10px' } });
    } else if (field === 'barcode' && !showGraphic) {
      lines.push({ type: 'text', value: product.barcode, style: { fontSize: '10px' } });
    }
  }

  if (showGraphic && product.barcode) {
    lines.push({ type: 'barCode', value: product.barcode, height: 40, width: 2, displayValue: false });
  }

  return lines;
}

export function formatLabelPreview(product: LabelProduct, layout: LabelLayout, currency = 'PKR'): string {
  return buildLabelPrintData(product, layout, currency)
    .map((l) => (l.type === 'barCode' ? `[BARCODE: ${l.value}]` : l.value))
    .join('\n');
}

export function mmToPx(mm: number, scale = 3.5): number {
  return Math.round(mm * scale);
}

export function normalizeLabelLayout(raw: LabelLayout, storeName?: string): LabelLayout {
  if (raw.elements?.length) {
    return {
      ...raw,
      showBarcodeGraphic: raw.showBarcodeGraphic ?? raw.showBarcode ?? true,
      storeName: raw.storeName ?? storeName,
    };
  }
  return {
    ...raw,
    elements: defaultLabelElements(),
    showBarcodeGraphic: raw.showBarcode ?? true,
    storeName: raw.storeName ?? storeName,
    fields: raw.fields ?? ['name', 'price', 'sku'],
  };
}

/** Single source of truth for preview + batch print layout resolution. */
export function resolveLabelLayoutForPrint(
  raw: LabelLayout,
  storeNameFromSettings?: string,
): LabelLayout {
  return normalizeLabelLayout(raw, raw.storeName ?? storeNameFromSettings ?? 'Store');
}

export function parseReceiptTemplateConfig(
  headerJson: ReceiptTemplateHeader & { widthMm?: 58 | 80; sections?: Partial<ReceiptTemplateSections> },
  footerJson: ReceiptTemplateFooter,
): ReceiptTemplateConfig {
  const { widthMm, sections, ...header } = headerJson;
  return { widthMm: widthMm ?? 80, sections, header, footer: footerJson };
}

export const RECEIPT_SECTION_LABELS: Record<keyof ReceiptTemplateSections, string> = {
  showLogo: 'Logo',
  showStoreName: 'Store Name',
  showAddress: 'Address',
  showPhone: 'Phone',
  showEmail: 'Email',
  showHeaderText: 'Header Text',
  showSaleNumber: 'Receipt Number',
  showDate: 'Date & Time',
  showCashier: 'Cashier',
  showItems: 'Line Items',
  showSubtotal: 'Subtotal',
  showDiscount: 'Discount',
  showTax: 'Tax',
  showTotal: 'Total',
  showPayment: 'Payment Details',
  showThankYou: 'Thank You Message',
  showReturnPolicy: 'Return Policy',
  showTaxInfo: 'Tax Information',
  showQrCode: 'QR Code',
};

export const LABEL_SIZE_PRESETS = [
  { label: '38.1 × 25.4 mm (MamaBabi)', widthMm: 38.1, heightMm: 25.4 },
  { label: '38 × 28 mm', widthMm: 38, heightMm: 28 },
  { label: '40 × 30 mm', widthMm: 40, heightMm: 30 },
  { label: '50 × 25 mm', widthMm: 50, heightMm: 25 },
  { label: '50 × 30 mm', widthMm: 50, heightMm: 30 },
  { label: '60 × 40 mm', widthMm: 60, heightMm: 40 },
] as const;

export const LABEL_FIELD_META: Record<LabelFieldType, { label: string; icon: string }> = {
  storeName: { label: 'Store Name', icon: 'store' },
  name: { label: 'Product Name', icon: 'tag' },
  price: { label: 'Price', icon: 'dollar' },
  originalPrice: { label: 'Was Price (struck)', icon: 'dollar' },
  discountPercent: { label: 'Discount % Off', icon: 'tag' },
  sku: { label: 'SKU', icon: 'hash' },
  barcode: { label: 'Barcode', icon: 'barcode' },
  customText: { label: 'Custom Text', icon: 'text' },
};

export {
  DEFAULT_LABEL_ROLL_CONFIG,
  MAMABABI_38_1x25_4_2UP_ROLL,
  buildPreviewSlots,
  calcLabelSlotPosition,
  calcLabelSlotPositionPx,
  calcPrintableHeight,
  calcPrintablePageSizePx,
  calcPrintableWidth,
  calcRollWidthMm,
  normalizeLabelRollConfig,
  labelDpiScale,
  resolveLabelDimensions,
  resolvePrintScalePercent,
  type LabelOrientation,
  type LabelSlotPositionPx,
  type LabelPaperType,
  type LabelRollConfig,
  type LabelScaleMode,
  type LabelSlotPosition,
} from './labelRollConfig';

export {
  buildReceiptPrintHtml,
  buildReceiptPrintFontFaceCss,
  receiptPreviewWidthPx,
  receiptPrintWidthPx,
  receiptScaledDotsSize,
  resolveReceiptPaperWidthMm,
  RECEIPT_PRINT_PX_PER_MM,
  RECEIPT_PRINT_MARGIN_MM,
  RECEIPT_PRINTABLE_MM,
} from './receiptRender';
