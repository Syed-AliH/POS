import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@mama-babi/ui';
import { getApi } from '@renderer/lib/api';
import { Modal } from '@renderer/components/Modal';
import { WorkflowStepper } from '@renderer/components/WorkflowStepper';
import { toast } from '@renderer/stores/toastStore';
import { newProductFormDefaults, useProductDefaultsStore } from '@renderer/stores/productDefaultsStore';
import {
  downloadExcelTemplate,
  downloadProductsCsv,
  downloadProductsExcel,
  mapProductImportRows,
  mapProductsToExportRows,
  parseExcelFile,
  PRODUCT_IMPORT_HEADERS,
} from '@renderer/lib/excelImport';
import { importProductsViaApi } from '@renderer/lib/productImport';
import { SortableTh } from '@renderer/components/SortableTh';
import { sortByKey, useTableSort } from '@renderer/lib/useTableSort';
import { formatDateTime, parseTimestamp } from '@shared/datetime';
import type { Category, Product, ProductHistory, ProductInput } from '@shared/types';

const api = getApi();

type SortKey = 'name' | 'sku' | 'category' | 'price' | 'stock' | 'status' | 'createdAt';
type AddedDateFilter = 'all' | 'today' | '7d' | '30d';
type HistoryTab = 'purchases' | 'sales' | 'returns';
type ProductHistSortKey = 'date' | 'reference' | 'qty' | 'total';

const WORKFLOW_STEPS = [
  { id: 'add', label: 'Add product', hint: 'Cost + markup pricing' },
  { id: 'stock', label: 'Set stock', hint: 'Auto SKU & barcode' },
  { id: 'sell', label: 'Sell at checkout', hint: 'F1 search or scan' },
  { id: 'return', label: 'Returns', hint: 'Use sale # from receipt' },
];

const STOCK_ADJUST_REASONS = [
  { value: 'correction', label: 'Correction' },
  { value: 'count', label: 'Physical count' },
  { value: 'damage', label: 'Damage / write-off' },
  { value: 'other', label: 'Other' },
];

function emptyForm(): ProductInput & { retailMarkup?: string; saleMarkup?: string } {
  return { name: '', costPrice: undefined, retailMarkup: '', saleMarkup: '', stockQty: 0, taxRate: 0, reorderLevel: 10 };
}

/** % suffix → cost + that % of cost; plain number → fixed retail/sale price */
function parseMarkupInput(value: string, cost: number): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.includes('%')) {
    const pct = parseFloat(trimmed.replace(/%/g, '').trim());
    if (isNaN(pct) || cost <= 0) return undefined;
    return cost + cost * (pct / 100);
  }
  const amount = parseFloat(trimmed);
  if (isNaN(amount)) return undefined;
  return amount;
}

function formatPriceValue(price: number): string {
  return Number.isInteger(price) ? String(price) : price.toFixed(2);
}

/** If value contains %, replace with the computed PKR price */
function resolveMarkupToPrice(value: string, cost: number): string {
  const trimmed = value.trim();
  if (!trimmed || !trimmed.includes('%')) return trimmed;
  const price = parseMarkupInput(trimmed, cost);
  if (price == null) return trimmed;
  return formatPriceValue(price);
}

function productCreatedTime(p: Product): number {
  if (!p.createdAt) return 0;
  const t = parseTimestamp(p.createdAt).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function matchesAddedDateFilter(p: Product, filter: AddedDateFilter): boolean {
  if (filter === 'all') return true;
  const ms = productCreatedTime(p);
  if (!ms) return false;
  const start = new Date();
  if (filter === 'today') {
    start.setHours(0, 0, 0, 0);
  } else if (filter === '7d') {
    start.setDate(start.getDate() - 7);
    start.setHours(0, 0, 0, 0);
  } else if (filter === '30d') {
    start.setDate(start.getDate() - 30);
    start.setHours(0, 0, 0, 0);
  }
  return ms >= start.getTime();
}

export function ProductsPage() {
  const navigate = useNavigate();
  const [products, setProducts] = useState<Product[]>([]);
  const [savedProduct, setSavedProduct] = useState<Product | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [addedDateFilter, setAddedDateFilter] = useState<AddedDateFilter>('all');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm());
  const [newCategory, setNewCategory] = useState('');
  const [newCategoryPrefix, setNewCategoryPrefix] = useState('');
  const [csvText, setCsvText] = useState('');
  const [message, setMessage] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ imported: number; errors: string[] } | null>(null);
  const importFileRef = useRef<HTMLInputElement>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [detailProduct, setDetailProduct] = useState<Product | null>(null);
  const [bulkPriceOpen, setBulkPriceOpen] = useState(false);
  const [bulkMode, setBulkMode] = useState<'increase' | 'original' | 'last'>('increase');
  const [bulkPercent, setBulkPercent] = useState('');
  const [bulkScope, setBulkScope] = useState<'selected' | 'category' | 'all'>('selected');
  const [bulkCategoryId, setBulkCategoryId] = useState('');
  const [bulkApplying, setBulkApplying] = useState(false);
  const [stockAdjustQty, setStockAdjustQty] = useState('');
  const [stockAdjustReason, setStockAdjustReason] = useState('correction');
  const [stockAdjustNotes, setStockAdjustNotes] = useState('');
  const [stockAdjusting, setStockAdjusting] = useState(false);
  const [history, setHistory] = useState<ProductHistory | null>(null);
  const [historyTab, setHistoryTab] = useState<HistoryTab>('purchases');
  const { onSort: onHistSort, icon: histIcon, sortKey: histSortKey, sortDir: histSortDir } = useTableSort<ProductHistSortKey>('date', 'desc');
  const defaultCategoryId = useProductDefaultsStore((s) => s.defaultCategoryId);
  const setDefaultCategoryId = useProductDefaultsStore((s) => s.setDefaultCategoryId);

  const load = async () => {
    const [p, c] = await Promise.all([api.products.list(), api.categories.list()]);
    const rows = p.success ? (p.data ?? []) : [];
    if (p.success) setProducts(rows);
    else toast.error(p.error ?? 'Failed to load products');
    if (c.success) setCategories(c.data ?? []);
    else toast.error(c.error ?? 'Failed to load categories');
    return rows;
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    const costPrice = form.costPrice ?? 0;
    if (costPrice <= 0) return;
    const retailHasPct = form.retailMarkup?.includes('%');
    const saleHasPct = form.saleMarkup?.includes('%');
    if (!retailHasPct && !saleHasPct) return;
    setForm((f) => ({
      ...f,
      retailMarkup: retailHasPct ? resolveMarkupToPrice(f.retailMarkup ?? '', costPrice) : f.retailMarkup,
      saleMarkup: saleHasPct ? resolveMarkupToPrice(f.saleMarkup ?? '', costPrice) : f.saleMarkup,
    }));
  }, [form.costPrice]);

  const categoryName = (id: string | null | undefined) =>
    categories.find((c) => c.id === id)?.name ?? '—';

  const filtered = useMemo(() => {
    let rows = products.filter((p) => {
      const matchesSearch = !search ||
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        p.sku.toLowerCase().includes(search.toLowerCase()) ||
        p.barcode.includes(search);
      const matchesStatus = statusFilter === 'all' || p.status === statusFilter;
      const matchesCategory = !categoryFilter || p.categoryId === categoryFilter;
      const matchesAdded = matchesAddedDateFilter(p, addedDateFilter);
      return matchesSearch && matchesStatus && matchesCategory && matchesAdded;
    });

    rows.sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'name') cmp = a.name.localeCompare(b.name);
      else if (sortKey === 'sku') cmp = a.sku.localeCompare(b.sku);
      else if (sortKey === 'category') cmp = categoryName(a.categoryId).localeCompare(categoryName(b.categoryId));
      else if (sortKey === 'price') cmp = (a.salePrice ?? a.retailPrice) - (b.salePrice ?? b.retailPrice);
      else if (sortKey === 'stock') cmp = a.stockQty - b.stockQty;
      else if (sortKey === 'status') cmp = a.status.localeCompare(b.status);
      else if (sortKey === 'createdAt') cmp = productCreatedTime(a) - productCreatedTime(b);
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return rows;
  }, [products, search, statusFilter, categoryFilter, addedDateFilter, sortKey, sortDir, categories]);

  const selectedProducts = useMemo(
    () => filtered.filter((p) => selectedIds.has(p.id)),
    [filtered, selectedIds],
  );

  const allFilteredSelected = filtered.length > 0 && filtered.every((p) => selectedIds.has(p.id));
  const someFilteredSelected = filtered.some((p) => selectedIds.has(p.id));

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAllFiltered = () => {
    if (allFilteredSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const p of filtered) next.delete(p.id);
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const p of filtered) next.add(p.id);
        return next;
      });
    }
  };

  const exportSelected = (format: 'excel' | 'csv') => {
    if (!selectedProducts.length) {
      toast.error('Select one or more products to export');
      return;
    }
    const rows = mapProductsToExportRows(selectedProducts);
    const stamp = new Date().toISOString().slice(0, 10);
    if (format === 'excel') {
      downloadProductsExcel(`products-export-${stamp}.xlsx`, rows);
    } else {
      downloadProductsCsv(`products-export-${stamp}.csv`, rows);
    }
    toast.success(`Exported ${rows.length} product(s)`);
  };

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  };

  const sortedHistoryRows = useMemo(() => {
    const rows = history?.[historyTab] ?? [];
    return sortByKey(rows, histSortKey, histSortDir, {
      date: (e) => e.date,
      reference: (e) => e.reference,
      qty: (e) => e.qty,
      total: (e) => e.total,
    });
  }, [history, historyTab, histSortKey, histSortDir]);

  const cost = form.costPrice ?? 0;
  const computedRetail = parseMarkupInput(form.retailMarkup ?? '', cost) ?? form.retailPrice ?? 0;
  const computedSale = parseMarkupInput(form.saleMarkup ?? '', cost);
  const marginPct = computedRetail > 0 && cost > 0 ? ((computedRetail - cost) / computedRetail) * 100 : 0;

  const startEdit = (p: Product) => {
    setEditingId(p.id);
    setStockAdjustQty(String(p.stockQty));
    setStockAdjustReason('correction');
    setStockAdjustNotes('');
    setForm({
      name: p.name,
      sku: p.sku,
      barcode: p.barcode,
      categoryId: p.categoryId ?? undefined,
      costPrice: p.costPrice,
      retailPrice: p.retailPrice,
      retailMarkup: formatPriceValue(p.retailPrice),
      salePrice: p.salePrice ?? undefined,
      saleMarkup: p.salePrice ? formatPriceValue(p.salePrice) : '',
      taxRate: p.taxRate,
      stockQty: p.stockQty,
      reorderLevel: p.reorderLevel,
      description: p.description ?? undefined,
      status: p.status,
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setForm(emptyForm());
    setStockAdjustQty('');
    setStockAdjustReason('correction');
    setStockAdjustNotes('');
  };

  const resetStockAdjustFields = (product: Product) => {
    setStockAdjustQty(String(product.stockQty));
    setStockAdjustReason('correction');
    setStockAdjustNotes('');
  };

  const applyStockAdjustment = async (product: Product) => {
    const qtyAfter = parseInt(stockAdjustQty, 10);
    if (Number.isNaN(qtyAfter)) {
      toast.error('Enter a valid stock quantity');
      return;
    }
    if (qtyAfter === product.stockQty) {
      toast.warning('Stock is already at that quantity');
      return;
    }
    setStockAdjusting(true);
    try {
      const result = await api.inventory.adjust({
        productId: product.id,
        qtyAfter,
        reason: stockAdjustReason,
        notes: stockAdjustNotes.trim() || undefined,
      });
      if (!result.success) {
        toast.error(result.error ?? 'Failed to update stock');
        return;
      }
      toast.success(`Stock updated: ${result.data?.qtyBefore ?? product.stockQty} → ${result.data?.qtyAfter ?? qtyAfter}`);
      const rows = await load();
      const refreshed = rows.find((p) => p.id === product.id);
      if (refreshed) {
        if (detailProduct?.id === product.id) {
          setDetailProduct(refreshed);
          resetStockAdjustFields(refreshed);
        }
        if (editingId === product.id) {
          setForm((prev) => ({ ...prev, stockQty: refreshed.stockQty }));
          resetStockAdjustFields(refreshed);
        }
      }
    } finally {
      setStockAdjusting(false);
    }
  };

  const handleSave = async () => {
    if (!form.name.trim()) { setMessage('Enter a product name'); return; }
    if (!form.categoryId && editingId === 'new') { setMessage('Select a category'); return; }
    const payload: ProductInput = {
      ...form,
      costPrice: cost,
      retailPrice: computedRetail,
      salePrice: computedSale,
    };
    if (editingId && editingId !== 'new') {
      delete payload.stockQty;
    }
    if (!payload.retailPrice || payload.retailPrice <= 0) {
      setMessage('Enter cost and retail price (e.g. 40% or 1000)');
      return;
    }
    const result = editingId && editingId !== 'new'
      ? await api.products.update(editingId, payload)
      : await api.products.create(payload);
    if (result.success && result.data) {
      toast.success(editingId && editingId !== 'new' ? 'Product updated' : `Created: ${result.data.name}`);
      if (!editingId || editingId === 'new') setSavedProduct(result.data);
      cancelEdit();
      load();
    } else {
      toast.error(result.error ?? 'Save failed');
      setMessage(result.error ?? 'Save failed');
    }
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setImportResult(null);
    try {
      const rawRows = await parseExcelFile(file);
      const rows = mapProductImportRows(rawRows);
      if (!rows.length) { toast.error('No valid rows found in the file'); setImporting(false); return; }
      const result = await importProductsViaApi(api, rows);
      setImportResult(result);
      if (result.imported > 0) {
        toast.success(`Imported ${result.imported} product(s)`);
        await load();
      } else if (result.errors.length) {
        toast.error(result.errors[0] ?? 'No products were imported');
      } else {
        toast.error('No products were imported');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to read file');
    } finally {
      setImporting(false);
      if (importFileRef.current) importFileRef.current.value = '';
    }
  };

  const handleArchive = async (id: string, name: string) => {
    if (!confirm(`Archive "${name}"?`)) return;
    const result = await api.products.archive(id);
    if (result.success) { if (editingId === id) cancelEdit(); load(); }
    else setMessage(result.error ?? 'Archive failed');
  };

  const handleAddCategory = async () => {
    if (!newCategory.trim()) {
      toast.error('Enter a category name');
      return;
    }
    const result = await api.categories.create(
      newCategory.trim(),
      undefined,
      newCategoryPrefix.trim() || undefined,
    );
    if (result.success) {
      toast.success(`Category "${newCategory.trim()}" added`);
      setNewCategory('');
      setNewCategoryPrefix('');
      load();
    } else {
      toast.error(result.error ?? 'Failed to add category');
    }
  };

  const openDetail = async (p: Product) => {
    setDetailProduct(p);
    resetStockAdjustFields(p);
    setHistoryTab('purchases');
    const result = await api.products.history(p.id);
    if (result.success) setHistory(result.data ?? null);
  };

  const sortIcon = (key: SortKey) => sortKey === key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '';

  const handleRetailMarkupBlur = () => {
    if (!form.retailMarkup?.includes('%')) return;
    const resolved = resolveMarkupToPrice(form.retailMarkup, cost);
    if (resolved !== form.retailMarkup) setForm({ ...form, retailMarkup: resolved });
  };

  const handleSaleMarkupBlur = () => {
    if (!form.saleMarkup?.includes('%')) return;
    const resolved = resolveMarkupToPrice(form.saleMarkup, cost);
    if (resolved !== form.saleMarkup) setForm({ ...form, saleMarkup: resolved });
  };

  const startNewProduct = () => {
    cancelEdit();
    setEditingId('new');
    setForm({ ...emptyForm(), ...newProductFormDefaults() });
  };

  const openBulkPrice = () => {
    setBulkMode('increase');
    setBulkPercent('');
    setBulkScope(selectedIds.size > 0 ? 'selected' : 'all');
    setBulkCategoryId(categoryFilter || categories[0]?.id || '');
    setBulkPriceOpen(true);
  };

  /** Resolve the shared scope selector into the productIds/categoryIds/applyToAll payload. */
  const resolveBulkScope = (): { productIds?: string[]; categoryIds?: string[]; applyToAll?: boolean } | null => {
    if (bulkScope === 'selected') {
      if (selectedIds.size === 0) { toast.error('Select one or more products first'); return null; }
      return { productIds: [...selectedIds] };
    }
    if (bulkScope === 'category') {
      if (!bulkCategoryId) { toast.error('Choose a category'); return null; }
      return { categoryIds: [bulkCategoryId] };
    }
    return { applyToAll: true };
  };

  const applyBulkPrice = async () => {
    const scope = resolveBulkScope();
    if (!scope) return;

    setBulkApplying(true);
    try {
      let result;
      if (bulkMode === 'increase') {
        const percent = parseFloat(bulkPercent);
        if (!Number.isFinite(percent) || percent === 0) {
          toast.error('Enter a non-zero percentage');
          return;
        }
        result = await api.products.bulkPriceIncrease({ percent, ...scope });
      } else {
        result = await api.products.bulkPriceRevert({ mode: bulkMode, ...scope });
      }
      if (result.success) {
        toast.success(`Updated ${result.data?.updated ?? 0} product price(s)`);
        setBulkPriceOpen(false);
        await load();
      } else {
        toast.error(result.error ?? 'Bulk price update failed');
      }
    } finally {
      setBulkApplying(false);
    }
  };

  const handleSetDefaultCategory = () => {
    if (!form.categoryId) {
      toast.error('Select a category first');
      return;
    }
    setDefaultCategoryId(form.categoryId);
    toast.success(`Default category set to ${categoryName(form.categoryId)}`);
  };

  return (
    <div className="h-full flex flex-col">
      <WorkflowStepper steps={WORKFLOW_STEPS} currentStep={editingId ? 0 : products.length > 0 ? 2 : 0} />
      <div className="flex-1 overflow-y-auto p-6">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h2 className="text-2xl font-bold">Products</h2>
            <p className="text-sm text-slate-500">{products.length} items</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button
              variant="ghost"
              onClick={() =>
                downloadExcelTemplate('products-template.xlsx', PRODUCT_IMPORT_HEADERS, [
                  { 'Product Name': 'Basmati Rice 1kg', Category: 'Groceries', 'Cost Price': 120, 'Retail Price': 150, 'Sale Price': '' },
                  { 'Product Name': 'Cooking Oil 1L', Category: 'Groceries', 'Cost Price': 280, 'Retail Price': 320, 'Sale Price': '' },
                ])
              }
            >
              ⬇ Template
            </Button>
            <Button variant="ghost" onClick={() => { setImportOpen(true); setImportResult(null); }}>⬆ Import Excel</Button>
            <Button
              variant="ghost"
              disabled={!selectedProducts.length}
              onClick={() => exportSelected('excel')}
            >
              ⬇ Export Excel{selectedProducts.length ? ` (${selectedProducts.length})` : ''}
            </Button>
            <Button
              variant="ghost"
              disabled={!selectedProducts.length}
              onClick={() => exportSelected('csv')}
            >
              ⬇ Export CSV{selectedProducts.length ? ` (${selectedProducts.length})` : ''}
            </Button>
            <Button variant="ghost" onClick={openBulkPrice}>% Increase Price</Button>
            <Button variant="secondary" onClick={startNewProduct}>+ Add Product</Button>
          </div>
        </div>
        {message && <div className="mb-4 p-3 bg-blue-50 rounded-lg text-sm">{message}</div>}

        {editingId !== null && (
          <div className="mb-6 grid grid-cols-3 gap-3 rounded-xl border border-primary-200 bg-white p-4 dark:border-primary-900 dark:bg-slate-900">
            <h3 className="col-span-3 font-semibold">{editingId === 'new' ? 'New Product' : 'Edit Product'}</h3>
            <input placeholder="Product name *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="col-span-3 px-3 py-2 border rounded-lg" />
            <div className="col-span-3 flex flex-wrap items-center gap-2">
              <select value={form.categoryId ?? ''} onChange={(e) => setForm({ ...form, categoryId: e.target.value || undefined })} className="min-w-[180px] flex-1 px-3 py-2 border rounded-lg">
                <option value="">Category *</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.skuPrefix ?? '—'})</option>)}
              </select>
              <Button variant="ghost" size="sm" onClick={handleSetDefaultCategory} disabled={!form.categoryId}>
                Set default
              </Button>
              {defaultCategoryId && (
                <span className="text-xs text-slate-500">
                  Saved default: {categoryName(defaultCategoryId)}
                  {form.categoryId === defaultCategoryId && ' ✓'}
                </span>
              )}
            </div>
            {editingId !== 'new' && (
              <>
                <input readOnly value={form.sku ?? ''} className="px-3 py-2 border rounded-lg bg-slate-50 text-slate-500 dark:bg-slate-800 dark:text-slate-400" title="SKU (auto-generated)" />
                <input readOnly value={form.barcode ?? ''} className="px-3 py-2 border rounded-lg bg-slate-50 text-slate-500 dark:bg-slate-800 dark:text-slate-400" title="Barcode (auto-generated)" />
              </>
            )}
            {editingId === 'new' && <p className="col-span-3 text-xs text-slate-400">SKU & barcode auto-generated on save</p>}
            <div>
              <label className="text-xs text-slate-500">Cost Price (PKR)</label>
              <input type="number" value={form.costPrice ?? ''} onChange={(e) => setForm({ ...form, costPrice: e.target.value ? parseFloat(e.target.value) : undefined })} className="w-full px-3 py-2 border rounded-lg" placeholder="0.00" />
            </div>
            <div>
              <label className="text-xs text-slate-500">Retail price (PKR)</label>
              <input
                type="text"
                value={form.retailMarkup ?? ''}
                onChange={(e) => setForm({ ...form, retailMarkup: e.target.value })}
                onBlur={handleRetailMarkupBlur}
                className="w-full px-3 py-2 border rounded-lg"
                placeholder="e.g. 1000 or 10%"
              />
              <p className="text-xs text-slate-400 mt-0.5">Type 10% to add markup on cost — converts to PKR price</p>
            </div>
            <div>
              <label className="text-xs text-slate-500">Sale price (PKR, optional)</label>
              <input
                type="text"
                value={form.saleMarkup ?? ''}
                onChange={(e) => setForm({ ...form, saleMarkup: e.target.value })}
                onBlur={handleSaleMarkupBlur}
                className="w-full px-3 py-2 border rounded-lg"
                placeholder="e.g. 900 or 15%"
              />
            </div>
            <div className="col-span-3 p-3 bg-slate-50 rounded-lg text-sm">
              <span className="font-medium">Preview:</span> Retail PKR {computedRetail.toFixed(2)}
              {computedSale != null && <span> · Sale PKR {computedSale.toFixed(2)}</span>}
              {marginPct > 0 && <span className="text-slate-500"> · Margin {marginPct.toFixed(1)}%</span>}
            </div>
            {editingId === 'new' ? (
              <div>
                <label className="text-xs text-slate-500">Opening stock</label>
                <input
                  type="number"
                  min={0}
                  value={form.stockQty ?? 0}
                  onChange={(e) => setForm({ ...form, stockQty: parseInt(e.target.value, 10) || 0 })}
                  className="w-full px-3 py-2 border rounded-lg"
                />
              </div>
            ) : (
              <div className="col-span-3 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/50" id="product-stock-adjust">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium">Stock on hand</p>
                    <p className={`text-lg font-semibold ${(form.stockQty ?? 0) < 0 ? 'text-red-600' : (form.stockQty ?? 0) === 0 ? 'text-amber-600' : ''}`}>
                      {form.stockQty ?? 0}
                      {(form.stockQty ?? 0) < 0 && <span className="ml-2 text-xs font-normal text-red-500">Negative — set correct count below</span>}
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="text-xs text-slate-500">Set stock to</label>
                    <input
                      type="number"
                      value={stockAdjustQty}
                      onChange={(e) => setStockAdjustQty(e.target.value)}
                      className="w-full px-3 py-2 border rounded-lg dark:border-slate-700 dark:bg-slate-900"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500">Reason</label>
                    <select
                      value={stockAdjustReason}
                      onChange={(e) => setStockAdjustReason(e.target.value)}
                      className="w-full px-3 py-2 border rounded-lg dark:border-slate-700 dark:bg-slate-900"
                    >
                      {STOCK_ADJUST_REASONS.map((r) => (
                        <option key={r.value} value={r.value}>{r.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-slate-500">Notes (optional)</label>
                    <input
                      value={stockAdjustNotes}
                      onChange={(e) => setStockAdjustNotes(e.target.value)}
                      placeholder="e.g. GRN void correction"
                      className="w-full px-3 py-2 border rounded-lg dark:border-slate-700 dark:bg-slate-900"
                    />
                  </div>
                </div>
                <div className="mt-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={stockAdjusting || !products.find((p) => p.id === editingId)}
                    onClick={() => {
                      const current = products.find((p) => p.id === editingId);
                      if (current) void applyStockAdjustment(current);
                    }}
                  >
                    {stockAdjusting ? 'Updating stock…' : 'Update stock'}
                  </Button>
                </div>
              </div>
            )}
            {editingId !== 'new' && (
              <select value={form.status ?? 'active'} onChange={(e) => setForm({ ...form, status: e.target.value as Product['status'] })} className="px-3 py-2 border rounded-lg">
                <option value="active">Active</option>
                <option value="archived">Archived</option>
                <option value="discontinued">Discontinued</option>
              </select>
            )}
            <div className="col-span-3 flex gap-2">
              <Button onClick={handleSave}>Save</Button>
              <Button variant="ghost" onClick={cancelEdit}>Cancel</Button>
              {editingId !== 'new' && <Button variant="danger" onClick={() => handleArchive(editingId, form.name)}>Archive</Button>}
            </div>
          </div>
        )}

        <div className="mb-4 flex gap-2 items-center flex-wrap">
          <input placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} className="flex-1 min-w-[200px] px-3 py-2 border rounded-lg" />
          <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="px-3 py-2 border rounded-lg text-sm">
            <option value="">All categories</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="px-3 py-2 border rounded-lg text-sm">
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="archived">Archived</option>
          </select>
          <select
            value={addedDateFilter}
            onChange={(e) => setAddedDateFilter(e.target.value as AddedDateFilter)}
            className="px-3 py-2 border rounded-lg text-sm"
            title="Filter by date added"
          >
            <option value="all">Added: any time</option>
            <option value="today">Added: today</option>
            <option value="7d">Added: last 7 days</option>
            <option value="30d">Added: last 30 days</option>
          </select>
          <select
            value={sortKey === 'createdAt' ? `createdAt-${sortDir}` : ''}
            onChange={(e) => {
              const v = e.target.value;
              if (!v) {
                setSortKey('name');
                setSortDir('asc');
                return;
              }
              const [key, dir] = v.split('-') as [SortKey, 'asc' | 'desc'];
              setSortKey(key);
              setSortDir(dir);
            }}
            className="px-3 py-2 border rounded-lg text-sm"
            title="Sort by date added"
          >
            <option value="">Sort: default</option>
            <option value="createdAt-desc">Added: newest first</option>
            <option value="createdAt-asc">Added: oldest first</option>
          </select>
          <input placeholder="Category name" value={newCategory} onChange={(e) => setNewCategory(e.target.value)} className="w-32 px-3 py-2 border rounded-lg text-sm" />
          <input placeholder="Prefix" value={newCategoryPrefix} onChange={(e) => setNewCategoryPrefix(e.target.value.toUpperCase())} className="w-16 px-2 py-2 border rounded-lg text-sm" maxLength={4} />
          <Button size="sm" variant="ghost" onClick={handleAddCategory}>+ Cat</Button>
        </div>

        <div className="panel overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr className="text-left text-slate-500">
                <th className="w-10 p-3">
                  <input
                    type="checkbox"
                    checked={allFilteredSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = someFilteredSelected && !allFilteredSelected;
                    }}
                    onChange={toggleSelectAllFiltered}
                    aria-label="Select all visible products"
                    className="h-4 w-4 rounded border-slate-300"
                  />
                </th>
                <th className="p-3 cursor-pointer" onClick={() => toggleSort('name')}>Name{sortIcon('name')}</th>
                <th className="p-3 cursor-pointer" onClick={() => toggleSort('sku')}>SKU{sortIcon('sku')}</th>
                <th className="p-3 cursor-pointer" onClick={() => toggleSort('category')}>Category{sortIcon('category')}</th>
                <th className="p-3 text-right cursor-pointer" onClick={() => toggleSort('price')}>Price{sortIcon('price')}</th>
                <th className="p-3 text-right cursor-pointer" onClick={() => toggleSort('stock')}>Stock{sortIcon('stock')}</th>
                <th className="p-3 cursor-pointer whitespace-nowrap" onClick={() => toggleSort('createdAt')}>Added{sortIcon('createdAt')}</th>
                <th className="p-3 cursor-pointer" onClick={() => toggleSort('status')}>Status{sortIcon('status')}</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr
                  key={p.id}
                  className={`border-t hover:bg-slate-50 cursor-pointer ${selectedIds.has(p.id) ? 'bg-primary-50/50 dark:bg-primary-950/20' : ''}`}
                  onClick={() => openDetail(p)}
                >
                  <td className="p-3" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(p.id)}
                      onChange={() => toggleSelect(p.id)}
                      aria-label={`Select ${p.name}`}
                      className="h-4 w-4 rounded border-slate-300"
                    />
                  </td>
                  <td className="p-3 font-medium">{p.name}</td>
                  <td className="p-3 text-slate-500">{p.sku}</td>
                  <td className="p-3">{categoryName(p.categoryId)}</td>
                  <td className="p-3 text-right">{(p.salePrice ?? p.retailPrice).toFixed(0)}</td>
                  <td className={`p-3 text-right ${p.stockQty < 0 ? 'text-red-600 font-semibold' : p.stockQty === 0 ? 'text-amber-600' : ''}`}>
                    {p.stockQty}
                  </td>
                  <td className="p-3 whitespace-nowrap text-xs text-slate-500">{formatDateTime(p.createdAt)}</td>
                  <td className="p-3"><span className="text-xs px-2 py-0.5 rounded bg-slate-100">{p.status}</span></td>
                  <td className="p-3" onClick={(e) => e.stopPropagation()}>
                    <button className="text-primary-600 text-sm mr-3" onClick={() => startEdit(p)}>Edit</button>
                    <button
                      className="text-slate-600 text-sm hover:text-primary-600"
                      onClick={() => {
                        startEdit(p);
                        setTimeout(() => {
                          document.getElementById('product-stock-adjust')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                        }, 50);
                      }}
                    >
                      Stock
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <Modal open={!!savedProduct} title="Product ready" onClose={() => setSavedProduct(null)}
          footer={<><Button variant="ghost" onClick={() => setSavedProduct(null)}>Add another</Button><Button onClick={() => { setSavedProduct(null); navigate('/checkout'); }}>Test in Checkout</Button></>}
        >
          {savedProduct && (
            <div className="space-y-2 text-center">
              <p className="font-semibold">{savedProduct.name}</p>
              <p className="font-mono text-sm bg-slate-100 px-3 py-2 rounded">{savedProduct.barcode}</p>
              <p className="text-sm text-slate-500">SKU: {savedProduct.sku}</p>
            </div>
          )}
        </Modal>

        <Modal open={!!detailProduct} title={detailProduct?.name ?? 'Product'} onClose={() => { setDetailProduct(null); setHistory(null); }} size="lg"
          footer={<Button variant="ghost" onClick={() => { setDetailProduct(null); setHistory(null); }}>Close</Button>}
        >
          {detailProduct && (
            <div>
              <div className="grid grid-cols-3 gap-2 text-sm mb-4">
                <div><span className="text-slate-500">SKU</span><div className="font-mono">{detailProduct.sku}</div></div>
                <div><span className="text-slate-500">Cost</span><div>PKR {detailProduct.costPrice.toFixed(2)}</div></div>
                <div>
                  <span className="text-slate-500">Stock</span>
                  <div className={detailProduct.stockQty < 0 ? 'text-red-600 font-semibold' : detailProduct.stockQty === 0 ? 'text-amber-600' : ''}>
                    {detailProduct.stockQty}
                    {detailProduct.stockQty < 0 && <span className="block text-xs font-normal text-red-500">Negative inventory</span>}
                  </div>
                </div>
                {detailProduct.createdAt && (
                  <div><span className="text-slate-500">Created</span><div className="text-xs">{formatDateTime(detailProduct.createdAt)}</div></div>
                )}
                {detailProduct.updatedAt && (
                  <div><span className="text-slate-500">Updated</span><div className="text-xs">{formatDateTime(detailProduct.updatedAt)}</div></div>
                )}
              </div>
              <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/50">
                <p className="text-sm font-medium mb-2">Set stock</p>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="text-xs text-slate-500">Set stock to</label>
                    <input
                      type="number"
                      value={stockAdjustQty}
                      onChange={(e) => setStockAdjustQty(e.target.value)}
                      className="w-full px-3 py-2 border rounded-lg text-sm dark:border-slate-700 dark:bg-slate-900"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500">Reason</label>
                    <select
                      value={stockAdjustReason}
                      onChange={(e) => setStockAdjustReason(e.target.value)}
                      className="w-full px-3 py-2 border rounded-lg text-sm dark:border-slate-700 dark:bg-slate-900"
                    >
                      {STOCK_ADJUST_REASONS.map((r) => (
                        <option key={r.value} value={r.value}>{r.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-slate-500">Notes (optional)</label>
                    <input
                      value={stockAdjustNotes}
                      onChange={(e) => setStockAdjustNotes(e.target.value)}
                      placeholder="e.g. after voided GRN"
                      className="w-full px-3 py-2 border rounded-lg text-sm dark:border-slate-700 dark:bg-slate-900"
                    />
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  className="mt-2"
                  disabled={stockAdjusting}
                  onClick={() => applyStockAdjustment(detailProduct)}
                >
                  {stockAdjusting ? 'Updating stock…' : 'Update stock'}
                </Button>
              </div>
              <div className="flex gap-2 mb-3">
                {(['purchases', 'sales', 'returns'] as HistoryTab[]).map((t) => (
                  <button key={t} type="button" onClick={() => setHistoryTab(t)} className={`px-3 py-1 rounded text-sm capitalize ${historyTab === t ? 'bg-primary-100 text-primary-800' : 'bg-slate-100'}`}>{t}</button>
                ))}
              </div>
              <div className="max-h-48 overflow-y-auto border rounded-lg text-sm">
                {sortedHistoryRows.length === 0 && <p className="p-4 text-slate-400 text-center">No {historyTab} history</p>}
                <table className="w-full">
                  {sortedHistoryRows.length > 0 && (
                    <thead className="bg-slate-50 sticky top-0">
                      <tr>
                        <SortableTh label="Date" columnKey="date" onSort={onHistSort} icon={histIcon} className="p-2" />
                        <SortableTh label="Reference" columnKey="reference" onSort={onHistSort} icon={histIcon} className="p-2" />
                        <SortableTh label="Qty" columnKey="qty" onSort={onHistSort} icon={histIcon} className="p-2" align="right" />
                        <SortableTh label="Total" columnKey="total" onSort={onHistSort} icon={histIcon} className="p-2" align="right" />
                      </tr>
                    </thead>
                  )}
                  <tbody>
                    {sortedHistoryRows.map((e, i) => (
                      <tr key={i} className="border-b">
                        <td className="p-2 whitespace-nowrap text-xs">{formatDateTime(e.date)}</td>
                        <td className="p-2">{e.reference}</td>
                        <td className="p-2 text-right">{e.qty}</td>
                        <td className="p-2 text-right">{e.total.toFixed(0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </Modal>

        <Modal open={bulkPriceOpen} onClose={() => setBulkPriceOpen(false)} title="Bulk price update">
          <div className="space-y-4 w-full max-w-md">
            <div>
              <label className="block text-sm font-medium mb-1">Action</label>
              <select
                value={bulkMode}
                onChange={(e) => setBulkMode(e.target.value as 'increase' | 'original' | 'last')}
                className="w-full px-3 py-2 border rounded-lg"
              >
                <option value="increase">Increase price by %</option>
                <option value="last">Undo last increase (revert to previous price)</option>
                <option value="original">Reset to original price (at creation)</option>
              </select>
            </div>

            {bulkMode === 'increase' ? (
              <>
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  Raises retail (and sale) prices by the percentage, then rounds each to the nearest clean value (nearest 10).
                </p>
                <div>
                  <label className="block text-sm font-medium mb-1">Increase by (%)</label>
                  <input
                    type="number"
                    value={bulkPercent}
                    onChange={(e) => setBulkPercent(e.target.value)}
                    placeholder="e.g. 5"
                    className="w-full px-3 py-2 border rounded-lg"
                  />
                </div>
              </>
            ) : (
              <p className="text-sm text-slate-600 dark:text-slate-400">
                {bulkMode === 'last'
                  ? 'Restores each product to the price it had just before the most recent increase.'
                  : 'Restores each product to its original price recorded when it was created.'}
              </p>
            )}

            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="bulkScope" checked={bulkScope === 'selected'} onChange={() => setBulkScope('selected')} />
                Selected products ({selectedIds.size})
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="bulkScope" checked={bulkScope === 'category'} onChange={() => setBulkScope('category')} />
                Category:
                <select
                  value={bulkCategoryId}
                  onChange={(e) => { setBulkCategoryId(e.target.value); setBulkScope('category'); }}
                  className="px-2 py-1 border rounded-lg text-sm"
                >
                  <option value="">Choose…</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="bulkScope" checked={bulkScope === 'all'} onChange={() => setBulkScope('all')} />
                All active products
              </label>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={() => setBulkPriceOpen(false)}>Cancel</Button>
              <Button onClick={applyBulkPrice} disabled={bulkApplying}>
                {bulkApplying ? 'Applying…' : bulkMode === 'increase' ? 'Apply increase' : 'Apply revert'}
              </Button>
            </div>
          </div>
        </Modal>

        {/* Excel Import Modal */}
        <Modal open={importOpen} onClose={() => setImportOpen(false)} title="Import Products from Excel">
          <div className="space-y-4 w-full max-w-lg">
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Fill in the template (⬇ Template button on the Products page) then upload below.
              SKU and barcode are auto-generated as <strong>SKU-[Category]-[Number]</strong>.
              Categories are matched by name — new ones are created automatically.
            </p>

            <div>
              <label className="block text-sm font-medium mb-1">Upload filled Excel file (.xlsx)</label>
              <input
                ref={importFileRef}
                type="file"
                accept=".xlsx,.xls"
                onChange={handleImportFile}
                disabled={importing}
                className="block w-full text-sm text-slate-700 file:mr-3 file:rounded-lg file:border-0 file:bg-primary-50 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary-700 hover:file:bg-primary-100 dark:text-slate-300"
              />
              {importing && <p className="mt-2 text-sm text-slate-500">Importing…</p>}
            </div>

            {importResult && (
              <div className={`rounded-lg p-3 text-sm ${importResult.imported > 0 ? 'bg-green-50 dark:bg-green-950' : 'bg-amber-50 dark:bg-amber-950'}`}>
                <p className="font-semibold mb-1">
                  {importResult.imported > 0 ? `✓ ${importResult.imported} product(s) imported` : 'No products imported'}
                </p>
                {importResult.errors.length > 0 && (
                  <div className="mt-2 max-h-40 overflow-y-auto space-y-0.5">
                    {importResult.errors.map((e, i) => (
                      <p key={i} className="text-red-600 dark:text-red-400 text-xs">{e}</p>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-end pt-2">
              <Button variant="ghost" onClick={() => setImportOpen(false)}>Close</Button>
            </div>
          </div>
        </Modal>
      </div>
    </div>
  );
}
