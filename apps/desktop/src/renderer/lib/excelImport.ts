import * as XLSX from 'xlsx';

/** Parse any .xlsx or .xls file; returns rows as plain string-value objects. */
export function parseExcelFile(file: File): Promise<Record<string, string>[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        if (!data) {
          reject(new Error('Empty file'));
          return;
        }
        const wb = XLSX.read(data, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        if (!ws) {
          reject(new Error('No worksheet found'));
          return;
        }
        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
          defval: '',
          raw: false,
        });
        resolve(
          rows.map((r) =>
            Object.fromEntries(
              Object.entries(r).map(([k, v]) => [String(k).trim(), String(v ?? '').trim()]),
            ),
          ),
        );
      } catch (err) {
        reject(err instanceof Error ? err : new Error('Failed to parse file'));
      }
    };
    reader.onerror = () => reject(new Error('File read error'));
    reader.readAsArrayBuffer(file);
  });
}

type SheetHeader = { key: string; label: string; sample?: string | number };

/** Generate and immediately download an Excel template. */
export function downloadExcelTemplate(
  filename: string,
  headers: SheetHeader[],
  sampleRows: Record<string, string | number>[] = [],
): void {
  const data = sampleRows.length
    ? sampleRows
    : [Object.fromEntries(headers.map((h) => [h.label, h.sample ?? '']))];

  const ws = XLSX.utils.json_to_sheet(data, {
    header: headers.map((h) => h.label),
  });

  const colWidths = headers.map((h) => ({ wch: Math.max(h.label.length + 2, 14) }));
  ws['!cols'] = colWidths;

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Template');
  XLSX.writeFile(wb, filename);
}

/** Product import template definition */
export const PRODUCT_IMPORT_HEADERS: SheetHeader[] = [
  { key: 'name', label: 'Product Name', sample: 'Basmati Rice 1kg' },
  { key: 'category', label: 'Category', sample: 'Groceries' },
  { key: 'cost_price', label: 'Cost Price', sample: 120 },
  { key: 'retail_price', label: 'Retail Price', sample: 150 },
  { key: 'sale_price', label: 'Sale Price', sample: '' },
];

/** Product / GRN export column layout (SKU, Product Name, Qty, Cost Price, Retail Price). */
export const PRODUCT_EXPORT_HEADERS: SheetHeader[] = [
  { key: 'sku', label: 'SKU' },
  { key: 'product_name', label: 'Product Name' },
  { key: 'qty', label: 'Qty' },
  { key: 'cost_price', label: 'Cost Price' },
  { key: 'retail_price', label: 'Retail Price' },
];

export type ProductExportRow = {
  sku: string;
  product_name: string;
  qty: number;
  cost_price: number;
  retail_price: number;
};

export function mapProductsToExportRows(
  products: Array<{ sku: string; name: string; stockQty: number; costPrice: number; retailPrice: number }>,
): ProductExportRow[] {
  return products.map((p) => ({
    sku: p.sku,
    product_name: p.name,
    qty: p.stockQty,
    cost_price: p.costPrice,
    retail_price: p.retailPrice,
  }));
}

function exportRowsToSheetData(rows: ProductExportRow[]): Record<string, string | number>[] {
  return rows.map((r) => ({
    SKU: r.sku,
    'Product Name': r.product_name,
    Qty: r.qty,
    'Cost Price': r.cost_price,
    'Retail Price': r.retail_price,
  }));
}

/** Download selected products as Excel (.xlsx) with standard export columns. */
export function downloadProductsExcel(filename: string, rows: ProductExportRow[]): void {
  if (!rows.length) return;

  const ws = XLSX.utils.json_to_sheet(exportRowsToSheetData(rows), {
    header: PRODUCT_EXPORT_HEADERS.map((h) => h.label),
  });
  ws['!cols'] = PRODUCT_EXPORT_HEADERS.map((h) => ({ wch: Math.max(h.label.length + 2, 14) }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Products');
  XLSX.writeFile(wb, filename);
}

function escapeCsvCell(value: string | number): string {
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Download selected products as CSV with standard export columns. */
export function downloadProductsCsv(filename: string, rows: ProductExportRow[]): void {
  if (!rows.length) return;

  const header = PRODUCT_EXPORT_HEADERS.map((h) => h.label).join(',');
  const body = rows.map((r) =>
    [r.sku, r.product_name, r.qty, r.cost_price, r.retail_price].map(escapeCsvCell).join(','),
  );
  const content = [header, ...body].join('\n');
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/** GRN import template definition */
export const GRN_IMPORT_HEADERS: SheetHeader[] = [
  { key: 'sku', label: 'SKU', sample: 'SKU-GRO-0001' },
  { key: 'product_name', label: 'Product Name', sample: 'Basmati Rice 1kg' },
  { key: 'qty', label: 'Qty', sample: 10 },
  { key: 'cost_price', label: 'Cost Price', sample: 120 },
  { key: 'retail_price', label: 'Retail Price', sample: 150 },
];

function rowVal(row: Record<string, string>, ...keys: string[]): string {
  const normalized = Object.fromEntries(
    Object.entries(row).map(([k, v]) => [k.trim().toLowerCase(), v]),
  );
  for (const key of keys) {
    const v = normalized[key.trim().toLowerCase()];
    if (v !== undefined && v !== '') return v;
  }
  return '';
}

function parseNumber(value: string): number {
  const cleaned = value.replace(/,/g, '').trim();
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

/** Map Excel rows to product import shape using flexible header names. */
export function mapProductImportRows(
  rows: Record<string, string>[],
): Array<{ name: string; category: string; cost_price?: number; retail_price: number; sale_price?: number }> {
  return rows.map((r) => ({
    name: rowVal(r, 'Product Name', 'name', 'product_name', 'product'),
    category: rowVal(r, 'Category', 'category', 'cat'),
    cost_price: parseNumber(rowVal(r, 'Cost Price', 'cost_price', 'cost')),
    retail_price: parseNumber(rowVal(r, 'Retail Price', 'retail_price', 'retail')),
    sale_price: parseNumber(rowVal(r, 'Sale Price', 'sale_price', 'sale')) || undefined,
  })).filter((r) => r.name);
}
