import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@mama-babi/ui';
import { getApi } from '@renderer/lib/api';
import { Modal } from '@renderer/components/Modal';
import { WorkflowStepper } from '@renderer/components/WorkflowStepper';
import { toast } from '@renderer/stores/toastStore';
import { newProductFormDefaults, useProductDefaultsStore } from '@renderer/stores/productDefaultsStore';
import { formatDateTime } from '@shared/datetime';
import type { Category, Product, ProductHistory, ProductInput } from '@shared/types';

const api = getApi();

type SortKey = 'name' | 'sku' | 'category' | 'price' | 'stock' | 'status';
type HistoryTab = 'purchases' | 'sales' | 'returns';

const WORKFLOW_STEPS = [
  { id: 'add', label: 'Add product', hint: 'Cost + markup pricing' },
  { id: 'stock', label: 'Set stock', hint: 'Auto SKU & barcode' },
  { id: 'sell', label: 'Sell at checkout', hint: 'F1 search or scan' },
  { id: 'return', label: 'Returns', hint: 'Use sale # from receipt' },
];

function emptyForm(): ProductInput & { retailMarkup?: string; saleMarkup?: string } {
  return { name: '', costPrice: undefined, retailMarkup: '', saleMarkup: '', stockQty: 0, taxRate: 17, reorderLevel: 10 };
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

export function ProductsPage() {
  const navigate = useNavigate();
  const [products, setProducts] = useState<Product[]>([]);
  const [savedProduct, setSavedProduct] = useState<Product | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm());
  const [newCategory, setNewCategory] = useState('');
  const [newCategoryPrefix, setNewCategoryPrefix] = useState('');
  const [csvText, setCsvText] = useState('');
  const [message, setMessage] = useState('');
  const [detailProduct, setDetailProduct] = useState<Product | null>(null);
  const [history, setHistory] = useState<ProductHistory | null>(null);
  const [historyTab, setHistoryTab] = useState<HistoryTab>('purchases');
  const defaultCategoryId = useProductDefaultsStore((s) => s.defaultCategoryId);
  const setDefaultCategoryId = useProductDefaultsStore((s) => s.setDefaultCategoryId);

  const load = async () => {
    const [p, c] = await Promise.all([api.products.list(), api.categories.list()]);
    if (p.success) setProducts(p.data ?? []);
    if (c.success) setCategories(c.data ?? []);
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
      return matchesSearch && matchesStatus && matchesCategory;
    });

    rows.sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'name') cmp = a.name.localeCompare(b.name);
      else if (sortKey === 'sku') cmp = a.sku.localeCompare(b.sku);
      else if (sortKey === 'category') cmp = categoryName(a.categoryId).localeCompare(categoryName(b.categoryId));
      else if (sortKey === 'price') cmp = (a.salePrice ?? a.retailPrice) - (b.salePrice ?? b.retailPrice);
      else if (sortKey === 'stock') cmp = a.stockQty - b.stockQty;
      else if (sortKey === 'status') cmp = a.status.localeCompare(b.status);
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return rows;
  }, [products, search, statusFilter, categoryFilter, sortKey, sortDir, categories]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  };

  const cost = form.costPrice ?? 0;
  const computedRetail = parseMarkupInput(form.retailMarkup ?? '', cost) ?? form.retailPrice ?? 0;
  const computedSale = parseMarkupInput(form.saleMarkup ?? '', cost);
  const marginPct = computedRetail > 0 && cost > 0 ? ((computedRetail - cost) / computedRetail) * 100 : 0;

  const startEdit = (p: Product) => {
    setEditingId(p.id);
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

  const cancelEdit = () => { setEditingId(null); setForm(emptyForm()); };

  const handleSave = async () => {
    if (!form.name.trim()) { setMessage('Enter a product name'); return; }
    if (!form.categoryId && editingId === 'new') { setMessage('Select a category'); return; }
    const payload: ProductInput = {
      ...form,
      costPrice: cost,
      retailPrice: computedRetail,
      salePrice: computedSale,
    };
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

  const handleArchive = async (id: string, name: string) => {
    if (!confirm(`Archive "${name}"?`)) return;
    const result = await api.products.archive(id);
    if (result.success) { if (editingId === id) cancelEdit(); load(); }
    else setMessage(result.error ?? 'Archive failed');
  };

  const handleAddCategory = async () => {
    if (!newCategory.trim()) return;
    const result = await api.categories.create(newCategory.trim(), undefined, newCategoryPrefix || undefined);
    if (result.success) { setNewCategory(''); setNewCategoryPrefix(''); load(); }
  };

  const openDetail = async (p: Product) => {
    setDetailProduct(p);
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
          <div className="flex gap-2">
            <Button variant="ghost" onClick={async () => { const r = await api.products.seedDemo(); if (r.success) { toast.success(`Loaded ${r.data?.added} products`); load(); } }}>Load Demo</Button>
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
          <input placeholder="Category name" value={newCategory} onChange={(e) => setNewCategory(e.target.value)} className="w-32 px-3 py-2 border rounded-lg text-sm" />
          <input placeholder="Prefix" value={newCategoryPrefix} onChange={(e) => setNewCategoryPrefix(e.target.value.toUpperCase())} className="w-16 px-2 py-2 border rounded-lg text-sm" maxLength={4} />
          <Button size="sm" variant="ghost" onClick={handleAddCategory}>+ Cat</Button>
        </div>

        <div className="panel overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr className="text-left text-slate-500">
                <th className="p-3 cursor-pointer" onClick={() => toggleSort('name')}>Name{sortIcon('name')}</th>
                <th className="p-3 cursor-pointer" onClick={() => toggleSort('sku')}>SKU{sortIcon('sku')}</th>
                <th className="p-3 cursor-pointer" onClick={() => toggleSort('category')}>Category{sortIcon('category')}</th>
                <th className="p-3 text-right cursor-pointer" onClick={() => toggleSort('price')}>Price{sortIcon('price')}</th>
                <th className="p-3 text-right cursor-pointer" onClick={() => toggleSort('stock')}>Stock{sortIcon('stock')}</th>
                <th className="p-3 cursor-pointer" onClick={() => toggleSort('status')}>Status{sortIcon('status')}</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id} className="border-t hover:bg-slate-50 cursor-pointer" onClick={() => openDetail(p)}>
                  <td className="p-3 font-medium">{p.name}</td>
                  <td className="p-3 text-slate-500">{p.sku}</td>
                  <td className="p-3">{categoryName(p.categoryId)}</td>
                  <td className="p-3 text-right">{(p.salePrice ?? p.retailPrice).toFixed(0)}</td>
                  <td className={`p-3 text-right ${p.stockQty < 0 ? 'text-red-600 font-semibold' : p.stockQty === 0 ? 'text-amber-600' : ''}`}>
                    {p.stockQty}
                  </td>
                  <td className="p-3"><span className="text-xs px-2 py-0.5 rounded bg-slate-100">{p.status}</span></td>
                  <td className="p-3" onClick={(e) => e.stopPropagation()}>
                    <button className="text-primary-600 text-sm" onClick={() => startEdit(p)}>Edit</button>
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
              <div className="flex gap-2 mb-3">
                {(['purchases', 'sales', 'returns'] as HistoryTab[]).map((t) => (
                  <button key={t} type="button" onClick={() => setHistoryTab(t)} className={`px-3 py-1 rounded text-sm capitalize ${historyTab === t ? 'bg-primary-100 text-primary-800' : 'bg-slate-100'}`}>{t}</button>
                ))}
              </div>
              <div className="max-h-48 overflow-y-auto border rounded-lg text-sm">
                {(history?.[historyTab] ?? []).length === 0 && <p className="p-4 text-slate-400 text-center">No {historyTab} history</p>}
                <table className="w-full">
                  <tbody>
                    {(history?.[historyTab] ?? []).map((e, i) => (
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
      </div>
    </div>
  );
}
