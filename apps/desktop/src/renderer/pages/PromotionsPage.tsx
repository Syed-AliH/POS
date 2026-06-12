import { useEffect, useState } from 'react';
import { Button } from '@mama-babi/ui';
import { getApi } from '@renderer/lib/api';
import type { Promotion, PromotionInput } from '@shared/types';

const api = getApi();
const emptyForm: PromotionInput = { name: '', type: 'percent', value: 10, isActive: true, isStackable: false };

export function PromotionsPage() {
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [form, setForm] = useState<PromotionInput>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  const load = async () => {
    const result = await api.promotions.list();
    if (result.success) setPromotions(result.data ?? []);
  };

  useEffect(() => { load(); }, []);

  const startEdit = (p: Promotion) => {
    setEditingId(p.id);
    setForm({
      name: p.name,
      type: p.type,
      value: p.value,
      startDate: p.startDate ?? undefined,
      endDate: p.endDate ?? undefined,
      minPurchase: p.minPurchase ?? undefined,
      isStackable: p.isStackable,
      isActive: p.isActive,
    });
  };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    const result = editingId
      ? await api.promotions.update(editingId, form)
      : await api.promotions.create(form);
    if (result.success) {
      setMessage(editingId ? 'Promotion updated' : 'Promotion created');
      setEditingId(null);
      setForm(emptyForm);
      load();
    } else setMessage(result.error ?? 'Failed');
  };

  const toggleActive = async (promo: Promotion) => {
    await api.promotions.update(promo.id, { isActive: !promo.isActive });
    load();
  };

  return (
    <div className="page-shell">
      <h2 className="page-title mb-6">Promotions</h2>
      {message && <div className="mb-4 p-3 bg-blue-50 rounded-lg text-sm">{message}</div>}

      <div className="grid grid-cols-2 gap-6">
        <div className="panel p-4 space-y-3">
          <h3 className="font-semibold">{editingId ? 'Edit Promotion' : 'Create Promotion'}</h3>
          <input placeholder="Name *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full px-3 py-2 border rounded-lg" />
          <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as 'percent' | 'fixed' })} className="w-full px-3 py-2 border rounded-lg">
            <option value="percent">% off</option>
            <option value="fixed">Fixed PKR off</option>
          </select>
          <input type="number" value={form.value} onChange={(e) => setForm({ ...form, value: parseFloat(e.target.value) || 0 })} className="w-full px-3 py-2 border rounded-lg" />
          <input type="date" value={form.startDate ?? ''} onChange={(e) => setForm({ ...form, startDate: e.target.value || undefined })} className="w-full px-3 py-2 border rounded-lg" />
          <input type="date" value={form.endDate ?? ''} onChange={(e) => setForm({ ...form, endDate: e.target.value || undefined })} className="w-full px-3 py-2 border rounded-lg" />
          <input type="number" placeholder="Min purchase" value={form.minPurchase ?? ''} onChange={(e) => setForm({ ...form, minPurchase: parseFloat(e.target.value) || undefined })} className="w-full px-3 py-2 border rounded-lg" />
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.isStackable} onChange={(e) => setForm({ ...form, isStackable: e.target.checked })} />Stackable</label>
          <div className="flex gap-2">
            <Button onClick={handleSave}>{editingId ? 'Update' : 'Create'}</Button>
            {editingId && <Button variant="ghost" onClick={() => { setEditingId(null); setForm(emptyForm); }}>Cancel</Button>}
          </div>
        </div>

        <div className="panel p-4 space-y-2">
          <h3 className="font-semibold mb-2">All Promotions</h3>
          {promotions.map((p) => (
            <div key={p.id} className="flex justify-between items-center p-3 border rounded-lg">
              <button className="text-left flex-1" onClick={() => startEdit(p)}>
                <div className="font-medium">{p.name}</div>
                <div className="text-sm text-slate-500">{p.type === 'percent' ? `${p.value}%` : `PKR ${p.value}`}</div>
              </button>
              <button onClick={() => toggleActive(p)} className={`text-xs px-2 py-1 rounded ml-2 ${p.isActive ? 'bg-green-100' : 'bg-slate-100'}`}>
                {p.isActive ? 'On' : 'Off'}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
