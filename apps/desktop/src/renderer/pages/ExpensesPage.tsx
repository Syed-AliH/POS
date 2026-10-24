import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Pencil, Trash2, Wallet } from 'lucide-react';
import { Button, KpiCard, PageHeader } from '@mama-babi/ui';
import { getApi } from '@renderer/lib/api';
import { useToday } from '@renderer/hooks/useToday';
import { useAuthStore } from '@renderer/stores/authStore';
import { toast } from '@renderer/stores/toastStore';
import { formatDateOnly, formatTimeOnly, localCalendarDate } from '@shared/datetime';
import type { ExpenseCategory, ExpenseSummary } from '@shared/types';

const api = getApi();

function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + days);
  return localCalendarDate(d);
}

type Draft = { categoryId: string; amount: string; notes: string };

/**
 * Day-by-day expense book. Expenses are entered here as they happen; Day Close reads
 * the day's total back instead of having it typed in again. One date at a time —
 * today by default, and when the clock passes midnight the page moves to the new
 * day by itself. Earlier days stay a click away and are never overwritten.
 */
export function ExpensesPage() {
  const session = useAuthStore((s) => s.session);
  const isManager = session?.role === 'manager' || session?.role === 'super_admin';
  const today = useToday();
  const [date, setDate] = useState(today);
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [expenses, setExpenses] = useState<ExpenseSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<Draft>({ categoryId: '', amount: '', notes: '' });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Draft>({ categoryId: '', amount: '', notes: '' });
  const amountRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef(0);

  // Following "today": if the page was showing the old today when the date changed,
  // it moves to the new one. A past day the user chose stays put.
  const lastToday = useRef(today);
  useEffect(() => {
    if (lastToday.current !== today) {
      setDate((current) => (current === lastToday.current ? today : current));
      lastToday.current = today;
    }
  }, [today]);

  const isToday = date === today;

  const load = async () => {
    const requestId = ++requestRef.current;
    setLoading(true);
    const [c, e] = await Promise.all([
      api.expenses.categories(),
      api.expenses.list({ startDate: date, endDate: date, limit: 500 }),
    ]);
    if (requestId !== requestRef.current) return;
    setLoading(false);
    if (c.success) {
      const list = c.data ?? [];
      setCategories(list);
      setDraft((d) => (d.categoryId || !list[0] ? d : { ...d, categoryId: list[0].id }));
    }
    if (e.success) setExpenses(e.data ?? []);
    else toast.error(e.error ?? 'Could not load expenses');
  };

  useEffect(() => { void load(); }, [date]);

  // Counted the same way as Day Close and the owner portal: anything not rejected.
  const counted = useMemo(() => expenses.filter((e) => e.status !== 'rejected'), [expenses]);
  const dayTotal = useMemo(() => counted.reduce((sum, e) => sum + e.amount, 0), [counted]);
  const pendingCount = counted.filter((e) => e.status === 'pending').length;

  const canChange = (e: ExpenseSummary) =>
    isManager || (e.paidBy === session?.id && localCalendarDate(new Date(e.createdAt)) === today);

  const parseAmount = (value: string) => {
    const n = parseFloat(value);
    return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
  };

  const handleAdd = async () => {
    const amount = parseAmount(draft.amount);
    if (!draft.categoryId) { toast.error('Choose a category'); return; }
    if (amount == null) { toast.error('Enter an amount above 0'); amountRef.current?.focus(); return; }
    setSaving(true);
    const result = await api.expenses.create({ categoryId: draft.categoryId, amount, notes: draft.notes.trim() || undefined });
    setSaving(false);
    if (result.success && result.data) {
      toast.success(`Expense of PKR ${amount.toFixed(0)} saved`);
      setExpenses((prev) => [result.data!, ...prev]);
      setDraft((d) => ({ ...d, amount: '', notes: '' }));
      amountRef.current?.focus();
    } else {
      toast.error(result.error ?? 'Could not save the expense');
    }
  };

  const startEdit = (e: ExpenseSummary) => {
    setEditingId(e.id);
    setEditDraft({ categoryId: e.categoryId, amount: String(e.amount), notes: e.notes ?? '' });
  };

  const handleSaveEdit = async () => {
    if (!editingId) return;
    const amount = parseAmount(editDraft.amount);
    if (amount == null) { toast.error('Enter an amount above 0'); return; }
    setSaving(true);
    const result = await api.expenses.update(editingId, {
      categoryId: editDraft.categoryId,
      amount,
      notes: editDraft.notes.trim() || null,
    });
    setSaving(false);
    if (result.success && result.data) {
      setExpenses((prev) => prev.map((e) => (e.id === editingId ? result.data! : e)));
      setEditingId(null);
      toast.success('Expense updated');
    } else {
      toast.error(result.error ?? 'Could not update the expense');
    }
  };

  const handleDelete = async (e: ExpenseSummary) => {
    if (!confirm(`Delete the PKR ${e.amount.toFixed(0)} ${e.categoryName} expense? It will no longer count in Day Close or reports.`)) return;
    const result = await api.expenses.remove(e.id);
    if (result.success) {
      setExpenses((prev) => prev.filter((x) => x.id !== e.id));
      toast.success('Expense deleted');
    } else {
      toast.error(result.error ?? 'Could not delete the expense');
    }
  };

  const handleApprove = async (e: ExpenseSummary) => {
    const result = await api.expenses.approve(e.id);
    if (result.success && result.data) setExpenses((prev) => prev.map((x) => (x.id === e.id ? result.data! : x)));
    else toast.error(result.error ?? 'Approve failed');
  };

  const onEnter = (action: () => void) => (ev: React.KeyboardEvent) => {
    if (ev.key === 'Enter') { ev.preventDefault(); action(); }
  };

  return (
    <div className="page-shell">
      <PageHeader
        title="Expenses"
        description="Cash paid out of the shop, day by day. Day Close picks up each day's total automatically."
        actions={(
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => setDate((d) => shiftDate(d, -1))} aria-label="Previous day">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <input
              type="date"
              value={date}
              max={today}
              onChange={(e) => e.target.value && setDate(e.target.value)}
              className="form-input w-auto"
              aria-label="Expense date"
            />
            <Button variant="ghost" size="sm" onClick={() => setDate((d) => shiftDate(d, 1))} disabled={isToday} aria-label="Next day">
              <ChevronRight className="h-4 w-4" />
            </Button>
            {!isToday && <Button variant="secondary" size="sm" onClick={() => setDate(today)}>Today</Button>}
          </div>
        )}
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <KpiCard
          label={isToday ? "Today's expenses" : `Expenses on ${formatDateOnly(`${date}T12:00:00`)}`}
          value={`PKR ${dayTotal.toFixed(2)}`}
          hint={`${counted.length} expense${counted.length === 1 ? '' : 's'}${pendingCount ? ` · ${pendingCount} awaiting approval` : ''}`}
          icon={<Wallet className="h-5 w-5" />}
        />
      </div>

      {isToday ? (
        <div className="panel mb-6 p-4">
          <h3 className="mb-3 font-semibold">Add an expense</h3>
          <div className="grid gap-3 md:grid-cols-[200px_160px_1fr_auto]">
            <select
              value={draft.categoryId}
              onChange={(e) => setDraft((d) => ({ ...d, categoryId: e.target.value }))}
              className="form-select h-10"
              aria-label="Category"
            >
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <input
              ref={amountRef}
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              placeholder="Amount (PKR)"
              value={draft.amount}
              onChange={(e) => setDraft((d) => ({ ...d, amount: e.target.value }))}
              onKeyDown={onEnter(() => void handleAdd())}
              className="form-input h-10"
              aria-label="Amount"
            />
            <input
              placeholder="What was it for? (e.g. tea, delivery, electricity)"
              value={draft.notes}
              onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
              onKeyDown={onEnter(() => void handleAdd())}
              className="form-input h-10"
              aria-label="Description"
            />
            <Button onClick={() => void handleAdd()} disabled={saving} loading={saving}>Add expense</Button>
          </div>
          <p className="mt-2 text-xs text-slate-400">
            Cash given to the owner is not an expense — enter it on Day Close.
          </p>
        </div>
      ) : (
        <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
          Viewing {formatDateOnly(`${date}T12:00:00`)}. New expenses are added to today —{' '}
          <button type="button" className="font-semibold underline" onClick={() => setDate(today)}>go to today</button>.
        </div>
      )}

      <div className="data-table-wrap">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-500 dark:bg-slate-900">
            <tr>
              <th className="p-3">Time</th>
              <th className="p-3">Category</th>
              <th className="p-3">Description</th>
              <th className="p-3 text-right">Amount</th>
              <th className="p-3">Entered by</th>
              <th className="p-3" />
            </tr>
          </thead>
          <tbody>
            {expenses.map((e) => editingId === e.id ? (
              <tr key={e.id} className="border-t bg-primary-50/50 dark:bg-slate-900">
                <td className="p-3 text-xs text-slate-500">{formatTimeOnly(e.createdAt)}</td>
                <td className="p-2">
                  <select
                    value={editDraft.categoryId}
                    onChange={(ev) => setEditDraft((d) => ({ ...d, categoryId: ev.target.value }))}
                    className="form-select h-9"
                  >
                    {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </td>
                <td className="p-2">
                  <input
                    value={editDraft.notes}
                    onChange={(ev) => setEditDraft((d) => ({ ...d, notes: ev.target.value }))}
                    onKeyDown={onEnter(() => void handleSaveEdit())}
                    className="form-input h-9 w-full"
                  />
                </td>
                <td className="p-2">
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={editDraft.amount}
                    onChange={(ev) => setEditDraft((d) => ({ ...d, amount: ev.target.value }))}
                    onKeyDown={onEnter(() => void handleSaveEdit())}
                    className="form-input h-9 w-28 text-right"
                    autoFocus
                  />
                </td>
                <td className="p-3 text-xs text-slate-500">{e.paidByName}</td>
                <td className="p-2">
                  <div className="flex justify-end gap-2">
                    <Button size="sm" onClick={() => void handleSaveEdit()} disabled={saving}>Save</Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>Cancel</Button>
                  </div>
                </td>
              </tr>
            ) : (
              <tr key={e.id} className="border-t">
                <td className="p-3 text-xs text-slate-500">{formatTimeOnly(e.createdAt)}</td>
                <td className="p-3 font-medium">{e.categoryName}</td>
                <td className="p-3 text-slate-600 dark:text-slate-300">{e.notes || '—'}</td>
                <td className="p-3 text-right font-semibold tabular-nums">PKR {e.amount.toFixed(2)}</td>
                <td className="p-3 text-xs text-slate-500">
                  {e.paidByName}
                  {e.status === 'pending' && (
                    <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                      awaiting approval
                    </span>
                  )}
                </td>
                <td className="p-3">
                  <div className="flex justify-end gap-1">
                    {isManager && e.status === 'pending' && (
                      <Button size="sm" variant="ghost" onClick={() => void handleApprove(e)}>Approve</Button>
                    )}
                    {canChange(e) && (
                      <>
                        <Button size="sm" variant="ghost" onClick={() => startEdit(e)} aria-label="Edit expense">
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => void handleDelete(e)} aria-label="Delete expense">
                          <Trash2 className="h-4 w-4 text-danger-600" />
                        </Button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {!expenses.length && (
              <tr>
                <td colSpan={6} className="p-8 text-center text-sm text-slate-400">
                  {loading ? 'Loading…' : isToday ? 'No expenses yet today.' : 'No expenses on this day.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
