import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@mama-babi/ui';
import { getApi } from '@renderer/lib/api';
import { SortableTh } from '@renderer/components/SortableTh';
import { sortByKey, useTableSort } from '@renderer/lib/useTableSort';
import { formatDateOnly, formatDateTime } from '@shared/datetime';
import type { Category, InventoryReportRow, InventoryReportSummary, InventoryStockFilter } from '@shared/types';

type InvSortKey = 'product' | 'barcode' | 'category' | 'stock' | 'cost' | 'retail' | 'value' | 'grn' | 'updated';

const api = getApi();

const STOCK_FILTERS: { id: InventoryStockFilter; label: string }[] = [
  { id: 'all', label: 'All stock' },
  { id: 'negative', label: 'Negative' },
  { id: 'zero', label: 'Zero' },
  { id: 'low', label: 'Low stock' },
];

function downloadCsv(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function InventoryReportPage() {
  const [report, setReport] = useState<InventoryReportSummary | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [stockFilter, setStockFilter] = useState<InventoryStockFilter>('all');
  const [loading, setLoading] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);
  const { onSort, icon, sortKey, sortDir } = useTableSort<InvSortKey>('product');

  const load = async () => {
    setLoading(true);
    const result = await api.reports.inventory({
      search: search || undefined,
      categoryId: categoryId || undefined,
      stockFilter,
    });
    setLoading(false);
    if (result.success) setReport(result.data ?? null);
  };

  useEffect(() => {
    api.categories.list().then((r) => {
      if (r.success) setCategories(r.data ?? []);
    });
  }, []);

  useEffect(() => { load(); }, [categoryId, stockFilter]);

  const rows = useMemo(() => {
    const raw = report?.rows ?? [];
    return sortByKey(raw, sortKey, sortDir, {
      product: (r) => r.productName,
      barcode: (r) => r.barcode,
      category: (r) => r.categoryName,
      stock: (r) => r.stockQty,
      cost: (r) => r.costPrice,
      retail: (r) => r.retailPrice,
      value: (r) => r.inventoryValue,
      grn: (r) => r.lastGrnDate ?? '',
      updated: (r) => r.updatedAt,
    });
  }, [report?.rows, sortKey, sortDir]);

  const exportCsv = () => {
    const header = [
      'Product Name',
      'Barcode',
      'SKU',
      'Category',
      'Stock Qty',
      'Cost Price',
      'Retail Price',
      'Inventory Value',
      'Last GRN Date',
      'Last Updated',
    ].join(',');
    const body = rows.map((r) => [
      `"${r.productName.replace(/"/g, '""')}"`,
      r.barcode,
      r.sku,
      `"${r.categoryName.replace(/"/g, '""')}"`,
      r.stockQty,
      r.costPrice.toFixed(2),
      r.retailPrice.toFixed(2),
      r.inventoryValue.toFixed(2),
      r.lastGrnDate ?? '',
      formatDateTime(r.updatedAt),
    ].join(','));
    downloadCsv(`inventory-report-${new Date().toISOString().slice(0, 10)}.csv`, [header, ...body].join('\n'));
  };

  const handlePrint = () => {
    const content = printRef.current;
    if (!content) return;
    const win = window.open('', '_blank', 'width=1100,height=800');
    if (!win) return;
    win.document.write(`
      <html><head><title>Inventory Report</title>
      <style>
        body { font-family: Arial, sans-serif; font-size: 12px; padding: 16px; }
        h1 { font-size: 18px; margin-bottom: 8px; }
        table { width: 100%; border-collapse: collapse; }
        th, td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; }
        th { background: #f8fafc; }
        .summary { margin-bottom: 12px; }
      </style></head><body>
      <h1>Inventory Report</h1>
      <div class="summary">
        Products: ${report?.totalProducts ?? 0} |
        Units: ${report?.totalUnits ?? 0} |
        Value: PKR ${(report?.totalInventoryValue ?? 0).toFixed(2)}
      </div>
      ${content.innerHTML}
      </body></html>
    `);
    win.document.close();
    win.focus();
    win.print();
  };

  const stockClass = (qty: number, reorder: number) => {
    if (qty < 0) return 'text-red-600 font-semibold';
    if (qty === 0) return 'text-amber-600';
    if (qty <= reorder) return 'text-orange-600';
    return '';
  };

  const summary = useMemo(() => report, [report]);

  return (
    <div className="page-shell">
      <div className="flex justify-between items-start gap-4 mb-6 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold">Inventory Report</h2>
          <p className="text-sm text-slate-500 mt-1">Complete stock visibility with cost value and GRN history</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="secondary" size="sm" onClick={exportCsv} disabled={!rows.length}>Export CSV</Button>
          <Button variant="secondary" size="sm" onClick={handlePrint} disabled={!rows.length}>Print</Button>
          <Button size="sm" onClick={load} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</Button>
        </div>
      </div>

      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
          <div className="panel p-4">
            <p className="text-xs text-slate-500">Products shown</p>
            <p className="text-2xl font-bold">{summary.totalProducts}</p>
          </div>
          <div className="panel p-4">
            <p className="text-xs text-slate-500">Total units</p>
            <p className="text-2xl font-bold">{summary.totalUnits}</p>
          </div>
          <div className="panel p-4">
            <p className="text-xs text-slate-500">Inventory value</p>
            <p className="text-2xl font-bold text-primary-700">PKR {summary.totalInventoryValue.toFixed(0)}</p>
          </div>
          <div className="panel p-4">
            <p className="text-xs text-slate-500">Negative / Zero / Low</p>
            <p className="text-lg font-bold">
              <span className="text-red-600">{summary.negativeCount}</span>
              {' / '}
              <span className="text-amber-600">{summary.zeroCount}</span>
              {' / '}
              <span className="text-orange-600">{summary.lowCount}</span>
            </p>
          </div>
        </div>
      )}

      <div className="flex gap-2 mb-4 flex-wrap">
        <input
          placeholder="Search name, barcode, SKU…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && load()}
          className="px-3 py-2 border rounded-lg text-sm flex-1 min-w-[200px]"
        />
        <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="px-3 py-2 border rounded-lg text-sm">
          <option value="">All categories</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={stockFilter} onChange={(e) => setStockFilter(e.target.value as InventoryStockFilter)} className="px-3 py-2 border rounded-lg text-sm">
          {STOCK_FILTERS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
        </select>
        <Button size="sm" onClick={load}>Search</Button>
      </div>

      <div className="panel overflow-hidden">
        <div ref={printRef} className="overflow-x-auto">
          <table className="w-full text-sm min-w-[1100px]">
            <thead className="bg-slate-50">
              <tr className="text-left text-slate-500">
                <SortableTh label="Product" columnKey="product" onSort={onSort} icon={icon} className="p-3" />
                <SortableTh label="Barcode" columnKey="barcode" onSort={onSort} icon={icon} className="p-3" />
                <SortableTh label="Category" columnKey="category" onSort={onSort} icon={icon} className="p-3" />
                <SortableTh label="Stock" columnKey="stock" onSort={onSort} icon={icon} className="p-3" align="right" />
                <SortableTh label="Cost" columnKey="cost" onSort={onSort} icon={icon} className="p-3" align="right" />
                <SortableTh label="Retail" columnKey="retail" onSort={onSort} icon={icon} className="p-3" align="right" />
                <SortableTh label="Inv. Value" columnKey="value" onSort={onSort} icon={icon} className="p-3" align="right" />
                <SortableTh label="Last GRN" columnKey="grn" onSort={onSort} icon={icon} className="p-3" />
                <SortableTh label="Updated" columnKey="updated" onSort={onSort} icon={icon} className="p-3" />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={9} className="p-10 text-center text-slate-400">{loading ? 'Loading…' : 'No products match filters'}</td></tr>
              ) : rows.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="p-3">
                    <div className="font-medium">{r.productName}</div>
                    <div className="text-xs text-slate-400">{r.sku}</div>
                  </td>
                  <td className="p-3 font-mono text-xs">{r.barcode}</td>
                  <td className="p-3">{r.categoryName}</td>
                  <td className={`p-3 text-right ${stockClass(r.stockQty, r.reorderLevel)}`}>{r.stockQty}</td>
                  <td className="p-3 text-right">PKR {r.costPrice.toFixed(2)}</td>
                  <td className="p-3 text-right">PKR {r.retailPrice.toFixed(2)}</td>
                  <td className="p-3 text-right font-semibold">PKR {r.inventoryValue.toFixed(2)}</td>
                  <td className="p-3 whitespace-nowrap text-xs">{r.lastGrnDate ? formatDateOnly(r.lastGrnDate) : '—'}</td>
                  <td className="p-3 whitespace-nowrap text-xs text-slate-500">{formatDateTime(r.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
