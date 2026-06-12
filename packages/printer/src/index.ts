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
    { productName: 'Organic Baby Formula 400g', quantity: 2, unitPrice: 1250, lineTotal: 2500 },
    { productName: 'Cotton Onesie Set', quantity: 1, unitPrice: 890, lineTotal: 890 },
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
  const wrap = (text: string) => {
    const words = text.split(' ');
    const rows: string[] = [];
    let row = '';
    for (const word of words) {
      const next = row ? `${row} ${word}` : word;
      if (next.length > width) {
        if (row) rows.push(row);
        row = word.slice(0, width);
      } else row = next;
    }
    if (row) rows.push(row);
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
    }
    lines.push(dash);
  }

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

  const thankYou = footer.thankYouMessage ?? footer.message ?? 'Thank you for your purchase!';
  if (sections.showThankYou) wrap(thankYou).forEach((r) => lines.push(center(r)));

  if (sections.showReturnPolicy && footer.returnPolicy) {
    wrap(footer.returnPolicy).forEach((r) => lines.push(center(r)));
  }

  if (footer.customLine) wrap(footer.customLine).forEach((r) => lines.push(center(r)));

  if (sections.showQrCode) {
    const qr = footer.qrCodeContent ?? sale.saleNumber;
    lines.push(center('[ QR CODE ]'));
    lines.push(center(qr.slice(0, width)));
  }

  lines.push(line);
  return lines.join('\n');
}

export interface LabelProduct {
  name: string;
  sku: string;
  barcode: string;
  price: number;
}

export const SAMPLE_LABEL_PRODUCT: LabelProduct = {
  name: 'Organic Baby Formula 400g',
  sku: 'BB-FORM-400',
  barcode: '8901234567890',
  price: 1250,
};

export type LabelFieldType = 'name' | 'price' | 'sku' | 'barcode' | 'storeName' | 'customText';

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
  style?: { fontSize?: string; fontWeight?: string; textAlign?: string };
  height?: number;
  width?: number;
  displayValue?: boolean;
}

export function defaultLabelElements(): LabelElement[] {
  return [
    { id: 'store', type: 'storeName', visible: true, x: 50, y: 8, fontSize: 8, align: 'center', fontWeight: 'bold' },
    { id: 'name', type: 'name', visible: true, x: 5, y: 22, fontSize: 10, align: 'left', fontWeight: 'bold' },
    { id: 'price', type: 'price', visible: true, x: 5, y: 42, fontSize: 12, align: 'left', fontWeight: 'bold' },
    { id: 'sku', type: 'sku', visible: true, x: 5, y: 58, fontSize: 8, align: 'left' },
    { id: 'barcode', type: 'barcode', visible: true, x: 50, y: 78, fontSize: 8, align: 'center' },
  ];
}

function resolveLabelText(
  type: LabelFieldType,
  product: LabelProduct,
  layout: LabelLayout,
  currency: string,
  element?: LabelElement,
): string {
  switch (type) {
    case 'name': return product.name.slice(0, 32);
    case 'price': return `${currency} ${product.price.toFixed(2)}`;
    case 'sku': return product.sku;
    case 'barcode': return product.barcode;
    case 'storeName': return (layout.storeName ?? 'Store').slice(0, 24);
    case 'customText': return element?.customText ?? '';
    default: return '';
  }
}

export function buildLabelPrintData(
  product: LabelProduct,
  layout: LabelLayout,
  currency = 'PKR',
): LabelPrintLine[] {
  const lines: LabelPrintLine[] = [];
  const showGraphic = layout.showBarcodeGraphic ?? layout.showBarcode ?? false;

  if (layout.elements?.length) {
    const sorted = [...layout.elements].filter((e) => e.visible).sort((a, b) => a.y - b.y);
    for (const el of sorted) {
      if (el.type === 'barcode' && showGraphic && product.barcode) {
        lines.push({
          type: 'barCode',
          value: product.barcode,
          height: 36,
          width: 2,
          displayValue: false,
        });
        continue;
      }
      const value = resolveLabelText(el.type, product, layout, currency, el);
      if (!value) continue;
      lines.push({
        type: 'text',
        value,
        style: {
          fontSize: `${el.fontSize}px`,
          fontWeight: el.fontWeight === 'bold' ? '700' : '400',
          textAlign: el.align ?? 'left',
        },
      });
    }
    return lines;
  }

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
  showPayment: 'Payment Details',
  showThankYou: 'Thank You Message',
  showReturnPolicy: 'Return Policy',
  showTaxInfo: 'Tax Information',
  showQrCode: 'QR Code',
};

export const LABEL_SIZE_PRESETS = [
  { label: '40 × 30 mm', widthMm: 40, heightMm: 30 },
  { label: '50 × 25 mm', widthMm: 50, heightMm: 25 },
  { label: '60 × 40 mm', widthMm: 60, heightMm: 40 },
] as const;

export const LABEL_FIELD_META: Record<LabelFieldType, { label: string; icon: string }> = {
  storeName: { label: 'Store Name', icon: 'store' },
  name: { label: 'Product Name', icon: 'tag' },
  price: { label: 'Price', icon: 'dollar' },
  sku: { label: 'SKU', icon: 'hash' },
  barcode: { label: 'Barcode', icon: 'barcode' },
  customText: { label: 'Custom Text', icon: 'text' },
};
