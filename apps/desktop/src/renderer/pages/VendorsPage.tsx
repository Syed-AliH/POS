import { useEffect, useState } from 'react';
import { Button } from '@mama-babi/ui';
import { getApi } from '@renderer/lib/api';
import type { Vendor, VendorInput } from '@shared/types';

const api = getApi();

const emptyForm: VendorInput = { name: '', contact: '', email: '', address: '', paymentTerms: '' };

export function VendorsPage() {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [form, setForm] = useState<VendorInput>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  const load = async () => {
    const result = await api.vendors.list();
    if (result.success) setVendors(result.data ?? []);
  };

  useEffect(() => { load(); }, []);

  const handleSave = async () => {
    if (!form.name.trim()) return;
    const result = editingId
      ? await api.vendors.update(editingId, form)
      : await api.vendors.create(form);
    if (result.success) {
      setMessage(editingId ? 'Vendor updated' : 'Vendor created');
      setForm(emptyForm);
      setEditingId(null);
      load();
    } else {
      setMessage(result.error ?? 'Save failed');
    }
  };

  const startEdit = (vendor: Vendor) => {
    setEditingId(vendor.id);
    setForm({
      name: vendor.name,
      contact: vendor.contact ?? '',
      email: vendor.email ?? '',
      address: vendor.address ?? '',
      paymentTerms: vendor.paymentTerms ?? '',
    });
  };

  return (
    <div className="page-shell">
      <h2 className="page-title mb-6">Vendors</h2>
      {message && <div className="mb-4 p-3 bg-blue-50 rounded-lg text-sm">{message}</div>}

      <div className="grid grid-cols-2 gap-6">
        <div className="panel p-4 space-y-3">
          <h3 className="font-semibold">{editingId ? 'Edit Vendor' : 'Add Vendor'}</h3>
          <input placeholder="Name *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full px-3 py-2 border rounded-lg" />
          <input placeholder="Contact" value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} className="w-full px-3 py-2 border rounded-lg" />
          <input placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full px-3 py-2 border rounded-lg" />
          <input placeholder="Address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="w-full px-3 py-2 border rounded-lg" />
          <input placeholder="Payment terms" value={form.paymentTerms} onChange={(e) => setForm({ ...form, paymentTerms: e.target.value })} className="w-full px-3 py-2 border rounded-lg" />
          <div className="flex gap-2">
            <Button onClick={handleSave}>{editingId ? 'Update' : 'Create'}</Button>
            {editingId && (
              <Button variant="ghost" onClick={() => { setEditingId(null); setForm(emptyForm); }}>Cancel</Button>
            )}
          </div>
        </div>

        <div className="panel p-4">
          <h3 className="font-semibold mb-3">All Vendors ({vendors.length})</h3>
          <div className="space-y-2 max-h-[28rem] overflow-y-auto">
            {vendors.map((v) => (
              <button
                key={v.id}
                onClick={() => startEdit(v)}
                className="w-full text-left p-3 border rounded-lg hover:bg-primary-50"
              >
                <div className="font-medium">{v.name}</div>
                <div className="text-sm text-slate-500">
                  {v.contact ?? '—'} · {v.paymentTerms ?? '—'}
                  {v.outstandingBalance > 0 && <span className="text-primary-700"> · PKR {v.outstandingBalance.toFixed(0)} due</span>}
                  {v.preferredPaymentType && <span> · Prefers {v.preferredPaymentType}</span>}
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
