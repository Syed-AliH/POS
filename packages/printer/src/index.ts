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

export function formatReceipt(sale: ReceiptSale, settings: Record<string, string>): string {
  const storeName = settings.store_name ?? 'Mama Babi';
  const address = settings.store_address ?? '';
  const phone = settings.store_phone ?? '';
  const currency = settings.currency ?? 'PKR';
  const width = 40;
  const line = '='.repeat(width);
  const dash = '-'.repeat(width);

  const fmt = (n: number) => `${currency} ${n.toFixed(2)}`;
  const pad = (left: string, right: string) => {
    const space = width - left.length - right.length;
    return left + ' '.repeat(Math.max(1, space)) + right;
  };

  const lines: string[] = [
    line,
    storeName.toUpperCase().padStart((width + storeName.length) / 2).slice(0, width),
    address,
    phone,
    line,
    `Receipt: ${sale.saleNumber}`,
    `Date: ${formatReceiptDateTime(sale.createdAt)}`,
    `Cashier: ${sale.cashierName}`,
    dash,
  ];

  for (const item of sale.items) {
    lines.push(item.productName.slice(0, width));
    lines.push(pad(`  ${item.quantity} x ${fmt(item.unitPrice)}`, fmt(item.lineTotal)));
  }

  lines.push(
    dash,
    pad('Subtotal:', fmt(sale.subtotal)),
    ...(sale.discountAmount > 0 ? [pad('Discount:', `-${fmt(sale.discountAmount)}`)] : []),
    pad('Tax:', fmt(sale.taxAmount)),
    pad('TOTAL:', fmt(sale.totalAmount)),
    dash,
    `Payment: ${sale.paymentMethod.toUpperCase()}`,
  );

  if (sale.amountTendered != null) {
    lines.push(pad('Tendered:', fmt(sale.amountTendered)));
    lines.push(pad('Change:', fmt(sale.changeGiven ?? 0)));
  }

  lines.push(line, 'Thank you for shopping with Mama Babi!', line);
  return lines.join('\n');
}

export interface LabelProduct {
  name: string;
  sku: string;
  barcode: string;
  price: number;
}

export interface LabelLayout {
  fields: Array<'name' | 'price' | 'sku' | 'barcode'>;
  showBarcode: boolean;
  fontSize?: string;
}

export interface LabelPrintLine {
  type: 'text' | 'barCode';
  value: string;
  style?: { fontSize?: string; fontWeight?: string; textAlign?: string };
  height?: number;
  width?: number;
  displayValue?: boolean;
}

export function buildLabelPrintData(
  product: LabelProduct,
  layout: LabelLayout,
  currency = 'PKR',
): LabelPrintLine[] {
  const lines: LabelPrintLine[] = [];
  const fontSize = layout.fontSize ?? '12px';

  for (const field of layout.fields) {
    if (field === 'name') {
      lines.push({ type: 'text', value: product.name.slice(0, 32), style: { fontSize, fontWeight: '600' } });
    } else if (field === 'price') {
      lines.push({ type: 'text', value: `${currency} ${product.price.toFixed(2)}`, style: { fontSize: '14px', fontWeight: '700' } });
    } else if (field === 'sku') {
      lines.push({ type: 'text', value: product.sku, style: { fontSize: '10px' } });
    } else if (field === 'barcode' && !layout.showBarcode) {
      lines.push({ type: 'text', value: product.barcode, style: { fontSize: '10px' } });
    }
  }

  if (layout.showBarcode && product.barcode) {
    lines.push({
      type: 'barCode',
      value: product.barcode,
      height: 40,
      width: 2,
      displayValue: true,
    });
  }

  return lines;
}

export function formatLabelPreview(product: LabelProduct, layout: LabelLayout, currency = 'PKR'): string {
  return buildLabelPrintData(product, layout, currency)
    .filter((l) => l.type === 'text')
    .map((l) => l.value)
    .concat(layout.showBarcode ? [`[BARCODE: ${product.barcode}]`] : [])
    .join('\n');
}
