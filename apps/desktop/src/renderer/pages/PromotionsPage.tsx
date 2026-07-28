import { useEffect, useState } from 'react';
import { Button } from '@mama-babi/ui';
import { getApi } from '@renderer/lib/api';
import type { Category, Promotion, PromotionInput } from '@shared/types';

const api = getApi();
const emptyForm: PromotionInput = {
  name: '', type: 'percent', value: 10, isActive: true, isStackable: false, categoryIds: [], productIds: [],
};

/** datetime-local inputs need "YYYY-MM-DDTHH:mm"; older promos may be stored as date-only. */
function toDatetimeLocal(value?: string | null): string {
  if (!value) return '';
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00` : value;
}

export function PromotionsPage() {
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [form, setForm] = useState<PromotionInput>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  const load = async () => {
    const [p, c] = await Promise.all([api.promotions.list(), api.categories.list()]);
    if (p.success) setPromotions(p.data ?? []);
    if (c.success) setCategories(c.data ?? []);
  };

  useEffect(() => { load(); }, []);

  const categoryName = (id: string) => categories.find((c) => c.id === id)?.name ?? id;

  const startEdit = (p: Promotion) => {
    setEditingId(p.id);
    setForm({
      name: p.name,
      type: p.type,
      value: p.value,
      startDate: toDatetimeLocal(p.startDate) || undefined,
      endDate: toDatetimeLocal(p.endDate) || undefined,
      minPurchase: p.minPurchase ?? undefined,
      categoryIds: p.categoryIds ?? [],
      productIds: p.productIds ?? [],
      isStackable: p.isStackable,
      isActive: p.isActive,
    });
  };

  const toggleCategory = (id: string) => {
    setForm((f) => {
      const current = f.categoryIds ?? [];
      const next = current.includes(id) ? current.filter((c) => c !== id) : [...current, id];
      return { ...f, categoryIds: next };
    });
  };

  const resetForm = () => { setEditingId(null); setForm(emptyForm); };

  const handleSave = async () => {
    if (!form.name.trim()) { setMessage('Enter a promotion name'); return; }
    const result = editingId
      ? await api.promotions.update(editingId, form)
      : await api.promotions.create(form);
    if (result.success) {
      setMessage(editingId ? 'Promotion updated' : 'Promotion created');
      resetForm();
      load();
    } else setMessage(result.error ?? 'Failed');
  };

  const toggleActive = async (promo: Promotion) => {
    await api.promotions.update(promo.id, { isActive: !promo.isActive });
    load();
  };

  const selectedCategoryIds = form.categoryIds ?? [];

  return (
    <div className="page-shell">
      <h2 className="page-title mb-6">Promotions</h2>
      {message && <div className="mb-4 p-3 bg-blue-50 rounded-lg text-sm">{message}</div>}

      <div className="grid grid-cols-2 gap-6">
        <div className="panel p-4 space-y-3">
          <h3 className="font-semibold">{editingId ? 'Edit Promotion' : 'Create Promotion'}</h3>

          <input placeholder="Name *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full px-3 py-2 border rounded-lg" />

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
              <span className="text-xs text-slate-500">Starts</span>
              <input type="datetime-local" value={form.startDate ?? ''} onChange={(e) => setForm({ ...form, startDate: e.target.value || undefined })} className="w-full px-3 py-2 border rounded-lg" />
            </label>
            <label className="text-sm">
              <span className="text-xs text-slate-500">Ends</span>
              <input type="datetime-local" value={form.endDate ?? ''} onChange={(e) => setForm({ ...form, endDate: e.target.value || undefined })} className="w-full px-3 py-2 border rounded-lg" />
            </label>
          </div>

          <div>
            <p className="text-xs text-slate-500 mb-1">Categories (leave empty to apply to the whole cart)</p>
            <div className="max-h-40 overflow-y-auto rounded-lg border border-slate-200 p-2 dark:border-slate-700">
              {categories.length === 0 && <p className="text-xs text-slate-400 p-1">No categories yet</p>}
              {categories.map((c) => (
                <label key={c.id} className="flex items-center gap-2 px-1 py-1 text-sm">
                  <input type="checkbox" checked={selectedCategoryIds.includes(c.id)} onChange={() => toggleCategory(c.id)} />
                  {c.name}
                </label>
              ))}
            </div>
            {selectedCategoryIds.length > 0 && (
              <p className="mt-1 text-xs text-slate-500">
                Applies to: {selectedCategoryIds.map(categoryName).join(', ')}
              </p>
            )}
          </div>

          <input type="number" placeholder="Min purchase (optional)" value={form.minPurchase ?? ''} onChange={(e) => setForm({ ...form, minPurchase: parseFloat(e.target.value) || undefined })} className="w-full px-3 py-2 border rounded-lg" />

          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.isStackable} onChange={(e) => setForm({ ...form, isStackable: e.target.checked })} />Stackable</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.isActive ?? true} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />Enabled</label>
          </div>

          <div className="flex gap-2">
            <Button onClick={handleSave}>{editingId ? 'Update' : 'Create'}</Button>
            {editingId && <Button variant="ghost" onClick={resetForm}>Cancel</Button>}
          </div>
        </div>

        <div className="panel p-4 space-y-2">
          <h3 className="font-semibold mb-2">All Promotions</h3>
          {promotions.length === 0 && <p className="text-sm text-slate-400">No promotions yet</p>}
          {promotions.map((p) => (
            <div key={p.id} className="flex justify-between items-center p-3 border rounded-lg">
              <button className="text-left flex-1" onClick={() => startEdit(p)}>
                <div className="font-medium">{p.name}</div>
                <div className="text-sm text-slate-500">
                  {p.type === 'percent' ? `${p.value}% off` : `PKR ${p.value} off`}
                  {p.categoryIds.length > 0 && ` · ${p.categoryIds.map(categoryName).join(', ')}`}
                  {p.categoryIds.length === 0 && p.productIds.length === 0 && ' · whole cart'}
                </div>
                {(p.startDate || p.endDate) && (
                  <div className="text-xs text-slate-400">
                    {p.startDate ? toDatetimeLocal(p.startDate).replace('T', ' ') : '—'} → {p.endDate ? toDatetimeLocal(p.endDate).replace('T', ' ') : '—'}
                  </div>
                )}
              </button>
              <button onClick={() => toggleActive(p)} className={`text-xs px-2 py-1 rounded ml-2 ${p.isActive ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-500'}`}>
                {p.isActive ? 'On' : 'Off'}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
