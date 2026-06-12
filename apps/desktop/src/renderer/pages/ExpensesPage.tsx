import { useEffect, useMemo, useState } from 'react';
import { Button } from '@mama-babi/ui';
import { getApi } from '@renderer/lib/api';
import { formatDateTime } from '@shared/datetime';
import type { ExpenseCategory, ExpenseSummary } from '@shared/types';

const api = getApi();

export function ExpensesPage() {
  const today = new Date().toISOString().slice(0, 10);
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [expenses, setExpenses] = useState<ExpenseSummary[]>([]);
  const [categoryId, setCategoryId] = useState('');
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [statusFilter, setStatusFilter] = useState('');
  const [message, setMessage] = useState('');

  const dailyTotal = useMemo(() =>
    expenses.filter((e) => e.status === 'approved').reduce((s, e) => s + e.amount, 0),
  [expenses]);

  const load = async () => {
    const [c, e] = await Promise.all([
      api.expenses.categories(),
      api.expenses.list({ startDate, endDate, status: statusFilter || undefined, limit: 100 }),
    ]);
    if (c.success) {
      setCategories(c.data ?? []);
      if (c.data?.[0] && !categoryId) setCategoryId(c.data[0].id);
    }
    if (e.success) setExpenses(e.data ?? []);
  };

  useEffect(() => { load(); }, [startDate, endDate, statusFilter]);

  const handleCreate = async () => {
    if (!categoryId || !amount) return;
    const result = await api.expenses.create({ categoryId, amount: parseFloat(amount), notes: notes || undefined });
    if (result.success) {
      setMessage('Expense recorded');
      setAmount('');
      setNotes('');
      load();
    } else setMessage(result.error ?? 'Failed');
  };

  const handleApprove = async (id: string) => {
    const result = await api.expenses.approve(id);
    if (result.success) load();
    else setMessage(result.error ?? 'Approve failed');
  };

  return (
    <div className="page-shell">
      <h2 className="text-2xl font-bold mb-2">Expenses</h2>
      <div className="mb-4 p-3 bg-primary-50 rounded-lg inline-block">
        <span className="text-sm text-slate-600">Period total (approved): </span>
        <span className="font-bold text-primary-800">PKR {dailyTotal.toFixed(2)}</span>
      </div>
      {message && <div className="mb-4 p-3 bg-blue-50 rounded-lg text-sm">{message}</div>}

      <div className="flex gap-2 mb-4">
        <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="px-3 py-2 border rounded-lg text-sm" />
        <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="px-3 py-2 border rounded-lg text-sm" />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="px-3 py-2 border rounded-lg text-sm">
          <option value="">All statuses</option>
          <option value="approved">Approved</option>
          <option value="pending">Pending</option>
        </select>
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div className="panel p-4 space-y-3">
          <h3 className="font-semibold">Record Expense</h3>
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="w-full px-3 py-2 border rounded-lg">
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <input type="number" placeholder="Amount (PKR)" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-full px-3 py-2 border rounded-lg" />
          <input placeholder="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full px-3 py-2 border rounded-lg" />
          <Button onClick={handleCreate}>Submit</Button>
        </div>

        <div className="panel p-4">
          <h3 className="font-semibold mb-3">Recent Expenses</h3>
          {expenses.map((e) => (
            <div key={e.id} className="flex justify-between items-center py-2 border-b text-sm">
              <div>
                <span className="font-medium">{e.categoryName}</span>
                <span className="text-slate-400 ml-2">{formatDateTime(e.createdAt)}</span>
                {e.status === 'pending' && <span className="ml-2 text-xs text-amber-600">pending</span>}
              </div>
              <div className="flex items-center gap-2">
                <span className="font-semibold">PKR {e.amount.toFixed(0)}</span>
                {e.status === 'pending' && <Button size="sm" variant="ghost" onClick={() => handleApprove(e.id)}>Approve</Button>}
              </div>
            </div>
          ))}
          {expenses.length === 0 && <p className="text-slate-400 text-sm">No expenses in selected period</p>}
        </div>
      </div>
    </div>
  );
}
