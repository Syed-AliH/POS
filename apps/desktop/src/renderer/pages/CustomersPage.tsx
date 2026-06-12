import { useEffect, useState } from 'react';
import { Button } from '@mama-babi/ui';
import { getApi } from '@renderer/lib/api';
import type { Customer, CustomerInput, LoyaltyRule } from '@shared/types';

const api = getApi();
const emptyForm: CustomerInput = { name: '', phone: '', email: '', address: '', notes: '' };

export function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [rules, setRules] = useState<LoyaltyRule[]>([]);
  const [form, setForm] = useState<CustomerInput>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [message, setMessage] = useState('');

  const load = async () => {
    const [c, r] = await Promise.all([api.customers.list(), api.customers.loyaltyRules()]);
    if (c.success) setCustomers(c.data ?? []);
    if (r.success) setRules(r.data ?? []);
  };

  useEffect(() => { load(); }, []);

  const startEdit = (c: Customer) => {
    setEditingId(c.id);
    setForm({ name: c.name, phone: c.phone ?? '', email: c.email ?? '', address: c.address ?? '', notes: c.notes ?? '' });
  };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    const result = editingId
      ? await api.customers.update(editingId, form)
      : await api.customers.create(form);
    if (result.success) {
      setMessage(editingId ? 'Customer updated' : `Created: ${result.data?.name}`);
      setEditingId(null);
      setForm(emptyForm);
      load();
    } else setMessage(result.error ?? 'Failed');
  };

  const filtered = search
    ? customers.filter((c) =>
        c.name.toLowerCase().includes(search.toLowerCase()) ||
        (c.phone ?? '').includes(search))
    : customers;

  return (
    <div className="page-shell">
      <h2 className="page-title mb-6">Customers</h2>
      {message && <div className="mb-4 p-3 bg-blue-50 rounded-lg text-sm">{message}</div>}
      {rules[0] && (
        <div className="mb-4 p-3 bg-primary-50 rounded-lg text-sm">
          Loyalty: {rules[0].pointsAwarded} pts per PKR {rules[0].spendThreshold} · Redeem PKR {rules[0].redemptionRate}/pt
        </div>
      )}

      <div className="grid grid-cols-2 gap-6">
        <div className="panel p-4 space-y-3">
          <h3 className="font-semibold">{editingId ? 'Edit Customer' : 'Add Customer'}</h3>
          <div>
            <label className="text-sm font-medium text-slate-600">Name *</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full mt-1 px-3 py-2 border rounded-lg" />
          </div>
          <div>
            <label className="text-sm font-medium text-slate-600">Phone</label>
            <input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="03XX-XXXXXXX" className="w-full mt-1 px-3 py-2 border rounded-lg" />
          </div>
          <input placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full px-3 py-2 border rounded-lg" />
          <input placeholder="Address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="w-full px-3 py-2 border rounded-lg" />
          <textarea placeholder="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="w-full px-3 py-2 border rounded-lg" rows={2} />
          <div className="flex gap-2">
            <Button onClick={handleSave}>{editingId ? 'Update' : 'Create'}</Button>
            {editingId && <Button variant="ghost" onClick={() => { setEditingId(null); setForm(emptyForm); }}>Cancel</Button>}
          </div>
        </div>

        <div className="panel p-4">
          <input placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} className="w-full px-3 py-2 border rounded-lg mb-3" />
          <div className="space-y-2 max-h-[28rem] overflow-y-auto">
            {filtered.map((c) => (
              <button key={c.id} onClick={() => startEdit(c)} className="w-full text-left p-3 border rounded-lg hover:bg-primary-50">
                <div className="font-medium">{c.name}</div>
                <div className="text-sm text-slate-500">{c.phone ?? '—'}</div>
                <div className="text-sm text-primary-700 font-semibold">{c.loyaltyPoints} pts · PKR {c.totalSpent.toFixed(0)} spent</div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
