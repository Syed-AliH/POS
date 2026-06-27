import { useEffect, useState } from 'react';
import { Button } from '@mama-babi/ui';
import { getApi } from '@renderer/lib/api';
import type { Customer, CustomerInput, LoyaltyRule, LoyaltyRuleInput } from '@shared/types';

const api = getApi();

const emptyForm = (): CustomerInput => ({
  name: '',
  phone: '',
  email: '',
  address: '',
  notes: '',
});

const defaultRuleForm = (): LoyaltyRuleInput => ({
  spendThreshold: 1000,
  pointsAwarded: 10,
  redemptionRate: 1,
});

export function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [activeRule, setActiveRule] = useState<LoyaltyRule | null>(null);
  const [ruleForm, setRuleForm] = useState<LoyaltyRuleInput>(defaultRuleForm);
  const [form, setForm] = useState<CustomerInput>(emptyForm());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [message, setMessage] = useState('');
  const [savingRule, setSavingRule] = useState(false);

  const load = async () => {
    const [c, r] = await Promise.all([api.customers.list(), api.customers.loyaltyRules()]);
    if (c.success) setCustomers(c.data ?? []);
    if (r.success) {
      const rule = r.data?.[0] ?? null;
      setActiveRule(rule);
      if (rule) {
        setRuleForm({
          spendThreshold: rule.spendThreshold,
          pointsAwarded: rule.pointsAwarded,
          redemptionRate: rule.redemptionRate,
        });
      }
    }
  };

  useEffect(() => { load(); }, []);

  const resetForm = () => {
    setEditingId(null);
    setForm(emptyForm());
  };

  const startEdit = (c: Customer) => {
    setEditingId(c.id);
    setForm({
      name: c.name,
      phone: c.phone ?? '',
      email: c.email ?? '',
      address: c.address ?? '',
      notes: c.notes ?? '',
    });
  };

  const handleSaveCustomer = async () => {
    if (!form.name.trim()) return;
    const result = editingId
      ? await api.customers.update(editingId, form)
      : await api.customers.create(form);
    if (result.success) {
      setMessage(editingId ? 'Customer updated' : `Created: ${result.data?.name}`);
      resetForm();
      load();
    } else setMessage(result.error ?? 'Failed');
  };

  const handleSaveRule = async () => {
    if (ruleForm.spendThreshold <= 0) {
      setMessage('Sale amount must be greater than zero');
      return;
    }
    if (ruleForm.pointsAwarded < 0) {
      setMessage('Points must be zero or greater');
      return;
    }
    setSavingRule(true);
    const result = await api.customers.saveLoyaltyRule(ruleForm);
    setSavingRule(false);
    if (result.success) {
      setMessage('Loyalty program updated');
      load();
    } else setMessage(result.error ?? 'Failed to save loyalty program');
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

      <div className="panel p-4 mb-6 space-y-4">
        <div>
          <h3 className="font-semibold">Loyalty program</h3>
          <p className="text-sm text-slate-500 mt-1">
            Set how many points customers earn per sale amount. Points are added automatically at checkout.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="text-sm font-medium text-slate-600">Sale amount (PKR)</label>
            <input
              type="number"
              min={1}
              step={1}
              value={ruleForm.spendThreshold}
              onChange={(e) => setRuleForm({ ...ruleForm, spendThreshold: parseFloat(e.target.value) || 0 })}
              className="w-full mt-1 px-3 py-2 border rounded-lg"
            />
            <p className="text-xs text-slate-400 mt-1">Per this much spent on a sale</p>
          </div>
          <div>
            <label className="text-sm font-medium text-slate-600">Points earned</label>
            <input
              type="number"
              min={0}
              step={1}
              value={ruleForm.pointsAwarded}
              onChange={(e) => setRuleForm({ ...ruleForm, pointsAwarded: parseInt(e.target.value, 10) || 0 })}
              className="w-full mt-1 px-3 py-2 border rounded-lg"
            />
            <p className="text-xs text-slate-400 mt-1">Awarded for each threshold reached</p>
          </div>
          <div>
            <label className="text-sm font-medium text-slate-600">Redemption (PKR / point)</label>
            <input
              type="number"
              min={0.01}
              step={0.01}
              value={ruleForm.redemptionRate ?? 1}
              onChange={(e) => setRuleForm({ ...ruleForm, redemptionRate: parseFloat(e.target.value) || 1 })}
              className="w-full mt-1 px-3 py-2 border rounded-lg"
            />
            <p className="text-xs text-slate-400 mt-1">Discount value when redeeming at checkout</p>
          </div>
        </div>
        {activeRule && (
          <p className="text-sm text-primary-700">
            Current: <strong>{ruleForm.pointsAwarded} pts</strong> per PKR <strong>{ruleForm.spendThreshold}</strong>
            {' · '}Redeem PKR <strong>{ruleForm.redemptionRate ?? 1}</strong>/pt
          </p>
        )}
        <Button onClick={handleSaveRule} disabled={savingRule}>
          {savingRule ? 'Saving…' : 'Save loyalty program'}
        </Button>
      </div>

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
            <Button onClick={handleSaveCustomer}>{editingId ? 'Update' : 'Create'}</Button>
            {editingId && <Button variant="ghost" onClick={resetForm}>Cancel</Button>}
          </div>
        </div>

        <div className="panel p-4">
          <input placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} className="w-full px-3 py-2 border rounded-lg mb-3" />
          <div className="space-y-2 max-h-[28rem] overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-8">No customers yet — create one using the form</p>
            ) : filtered.map((c) => (
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
