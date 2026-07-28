import { useEffect, useMemo, useState } from 'react';
import { Button } from '@mama-babi/ui';
import { getApi } from '@renderer/lib/api';
import type { Category, Product, PromoCode, PromoCodeInput } from '@shared/types';

const api = getApi();
const emptyForm: PromoCodeInput = {
  code: '', description: '', type: 'percent', value: 10, isActive: true, categoryIds: [], productIds: [],
};

/** datetime-local inputs need "YYYY-MM-DDTHH:mm"; older records may be stored as date-only. */
function toDatetimeLocal(value?: string | null): string {
  if (!value) return '';
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00` : value;
}

export function PromoCodesPage() {
  const [promoCodes, setPromoCodes] = useState<PromoCode[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [productSearch, setProductSearch] = useState('');
  const [form, setForm] = useState<PromoCodeInput>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  const load = async () => {
    const [pc, c, p] = await Promise.all([
      api.promoCodes.list(),
      api.categories.list(),
      api.products.list(),
    ]);
    if (pc.success) setPromoCodes(pc.data ?? []);
    if (c.success) setCategories(c.data ?? []);
    if (p.success) setProducts(p.data ?? []);
  };

  useEffect(() => { load(); }, []);

  const categoryName = (id: string) => categories.find((c) => c.id === id)?.name ?? id;
  const productName = (id: string) => products.find((p) => p.id === id)?.name ?? id;

  const selectedCategoryIds = form.categoryIds ?? [];
  const selectedProductIds = form.productIds ?? [];

  const filteredProducts = useMemo(() => {
    const q = productSearch.trim().toLowerCase();
    if (!q) return [];
    return products.filter((p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q)).slice(0, 20);
  }, [productSearch, products]);

  const startEdit = (pc: PromoCode) => {
    setEditingId(pc.id);
    setForm({
      code: pc.code,
      description: pc.description ?? '',
      type: pc.type,
      value: pc.value,
      startDate: toDatetimeLocal(pc.startDate) || undefined,
      endDate: toDatetimeLocal(pc.endDate) || undefined,
      minPurchase: pc.minPurchase ?? undefined,
      usageLimit: pc.usageLimit ?? undefined,
      categoryIds: pc.categoryIds ?? [],
      productIds: pc.productIds ?? [],
      isActive: pc.isActive,
    });
  };

  const toggleCategory = (id: string) => {
    setForm((f) => {
      const current = f.categoryIds ?? [];
      const next = current.includes(id) ? current.filter((c) => c !== id) : [...current, id];
      return { ...f, categoryIds: next };
    });
  };

  const toggleProduct = (id: string) => {
    setForm((f) => {
      const current = f.productIds ?? [];
      const next = current.includes(id) ? current.filter((p) => p !== id) : [...current, id];
      return { ...f, productIds: next };
    });
  };

  const resetForm = () => { setEditingId(null); setForm(emptyForm); setProductSearch(''); };

  const handleSave = async () => {
    if (!form.code.trim()) { setMessage('Enter a promo code'); return; }
    if (!form.value || form.value <= 0) { setMessage('Enter a discount value greater than 0'); return; }
    const payload: PromoCodeInput = { ...form, code: form.code.trim().toUpperCase() };
    const result = editingId
      ? await api.promoCodes.update(editingId, payload)
      : await api.promoCodes.create(payload);
    if (result.success) {
      setMessage(editingId ? 'Promo code updated' : 'Promo code created');
      resetForm();
      load();
    } else setMessage(result.error ?? 'Failed');
  };

  const toggleActive = async (pc: PromoCode) => {
    await api.promoCodes.update(pc.id, { isActive: !pc.isActive });
    load();
  };

  const handleDelete = async (pc: PromoCode) => {
    if (!confirm(`Delete promo code "${pc.code}"?`)) return;
    const result = await api.promoCodes.delete(pc.id);
    if (result.success) { setMessage('Promo code deleted'); if (editingId === pc.id) resetForm(); load(); }
    else setMessage(result.error ?? 'Delete failed');
  };

  return (
    <div className="page-shell">
      <h2 className="page-title mb-6">Promo Codes</h2>
      {message && <div className="mb-4 p-3 bg-blue-50 rounded-lg text-sm">{message}</div>}

      <div className="grid grid-cols-2 gap-6">
        <div className="panel p-4 space-y-3">
          <h3 className="font-semibold">{editingId ? 'Edit Promo Code' : 'Create Promo Code'}</h3>

          <input
            placeholder="Code * (e.g. SAVE10)"
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
            className="w-full px-3 py-2 border rounded-lg font-mono uppercase"
          />
          <input
            placeholder="Description (optional)"
            value={form.description ?? ''}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="w-full px-3 py-2 border rounded-lg"
          />

          <div className="grid grid-cols-2 gap-2">
            <label className="text-sm">
              <span className="text-xs text-slate-500">Discount type</span>
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as 'percent' | 'fixed' })} className="w-full px-3 py-2 border rounded-lg">
                <option value="percent">% off</option>
                <option value="fixed">Fixed PKR off</option>
              </select>
            </label>
            <label className="text-sm">
              <span className="text-xs text-slate-500">{form.type === 'percent' ? 'Percentage (%)' : 'Amount (PKR)'}</span>
              <input type="number" value={form.value} onChange={(e) => setForm({ ...form, value: parseFloat(e.target.value) || 0 })} className="w-full px-3 py-2 border rounded-lg" />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className="text-sm">
              <span className="text-xs text-slate-500">Starts (optional)</span>
              <input type="datetime-local" value={form.startDate ?? ''} onChange={(e) => setForm({ ...form, startDate: e.target.value || undefined })} className="w-full px-3 py-2 border rounded-lg" />
            </label>
            <label className="text-sm">
              <span className="text-xs text-slate-500">Ends (optional)</span>
              <input type="datetime-local" value={form.endDate ?? ''} onChange={(e) => setForm({ ...form, endDate: e.target.value || undefined })} className="w-full px-3 py-2 border rounded-lg" />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className="text-sm">
              <span className="text-xs text-slate-500">Min purchase (optional)</span>
              <input type="number" value={form.minPurchase ?? ''} onChange={(e) => setForm({ ...form, minPurchase: parseFloat(e.target.value) || undefined })} className="w-full px-3 py-2 border rounded-lg" />
            </label>
            <label className="text-sm">
              <span className="text-xs text-slate-500">Usage limit (optional)</span>
              <input type="number" value={form.usageLimit ?? ''} onChange={(e) => setForm({ ...form, usageLimit: parseInt(e.target.value, 10) || undefined })} className="w-full px-3 py-2 border rounded-lg" />
            </label>
          </div>

          <div>
            <p className="text-xs text-slate-500 mb-1">Categories (leave categories & products empty to apply to the whole cart)</p>
            <div className="max-h-32 overflow-y-auto rounded-lg border border-slate-200 p-2 dark:border-slate-700">
              {categories.length === 0 && <p className="text-xs text-slate-400 p-1">No categories yet</p>}
              {categories.map((c) => (
                <label key={c.id} className="flex items-center gap-2 px-1 py-1 text-sm">
                  <input type="checkbox" checked={selectedCategoryIds.includes(c.id)} onChange={() => toggleCategory(c.id)} />
                  {c.name}
                </label>
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs text-slate-500 mb-1">Products (search to add)</p>
            <input
              placeholder="Search products by name or SKU…"
              value={productSearch}
              onChange={(e) => setProductSearch(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg text-sm"
            />
            {filteredProducts.length > 0 && (
              <div className="mt-1 max-h-32 overflow-y-auto rounded-lg border border-slate-200 p-2 dark:border-slate-700">
                {filteredProducts.map((p) => (
                  <label key={p.id} className="flex items-center gap-2 px-1 py-1 text-sm">
                    <input type="checkbox" checked={selectedProductIds.includes(p.id)} onChange={() => toggleProduct(p.id)} />
                    {p.name} <span className="text-xs text-slate-400">{p.sku}</span>
                  </label>
                ))}
              </div>
            )}
            {selectedProductIds.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {selectedProductIds.map((id) => (
                  <button key={id} type="button" onClick={() => toggleProduct(id)} className="text-xs bg-slate-100 dark:bg-slate-800 rounded px-2 py-0.5">
                    {productName(id)} ×
                  </button>
                ))}
              </div>
            )}
          </div>

          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.isActive ?? true} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />Enabled</label>

          <div className="flex gap-2">
            <Button onClick={handleSave}>{editingId ? 'Update' : 'Create'}</Button>
            {editingId && <Button variant="ghost" onClick={resetForm}>Cancel</Button>}
          </div>
        </div>

        <div className="panel p-4 space-y-2">
          <h3 className="font-semibold mb-2">All Promo Codes</h3>
          {promoCodes.length === 0 && <p className="text-sm text-slate-400">No promo codes yet</p>}
          {promoCodes.map((pc) => (
            <div key={pc.id} className="flex justify-between items-center p-3 border rounded-lg">
              <button className="text-left flex-1" onClick={() => startEdit(pc)}>
                <div className="font-medium font-mono">{pc.code}</div>
                <div className="text-sm text-slate-500">
                  {pc.type === 'percent' ? `${pc.value}% off` : `PKR ${pc.value} off`}
                  {pc.categoryIds.length > 0 && ` · ${pc.categoryIds.map(categoryName).join(', ')}`}
                  {pc.productIds.length > 0 && ` · ${pc.productIds.length} product${pc.productIds.length === 1 ? '' : 's'}`}
                  {pc.categoryIds.length === 0 && pc.productIds.length === 0 && ' · whole cart'}
                </div>
                <div className="text-xs text-slate-400">
                  Used {pc.usageCount}{pc.usageLimit != null ? ` / ${pc.usageLimit}` : ''}
                  {(pc.startDate || pc.endDate) && ` · ${pc.startDate ? toDatetimeLocal(pc.startDate).replace('T', ' ') : '—'} → ${pc.endDate ? toDatetimeLocal(pc.endDate).replace('T', ' ') : '—'}`}
                </div>
              </button>
              <div className="flex flex-col gap-1 ml-2">
                <button onClick={() => toggleActive(pc)} className={`text-xs px-2 py-1 rounded ${pc.isActive ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-500'}`}>
                  {pc.isActive ? 'On' : 'Off'}
                </button>
                <button onClick={() => handleDelete(pc)} className="text-xs px-2 py-1 rounded bg-red-50 text-red-600">Delete</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
