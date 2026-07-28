import { useEffect, useMemo, useState } from 'react';
import { Button } from '@mama-babi/ui';
import { getApi } from '@renderer/lib/api';
import { toast } from '@renderer/stores/toastStore';

const api = getApi();

const DENOMINATIONS = [5000, 1000, 500, 100, 50, 20, 10];

interface ExpenseRow {
  amount: string;
  description: string;
}

function money(n: number): string {
  return `PKR ${n.toFixed(2)}`;
}

export function EodReportForm() {
  const [openingCash, setOpeningCash] = useState('');
  const [cardPayments, setCardPayments] = useState('');
  const [onlinePayments, setOnlinePayments] = useState('');
  const [counts, setCounts] = useState<Record<number, string>>({});
  const [expenses, setExpenses] = useState<ExpenseRow[]>([{ amount: '', description: '' }]);
  const [storeName, setStoreName] = useState('Store');

  useEffect(() => {
    api.settings.getAll().then((r) => {
      if (r.success && r.data) {
        setStoreName(r.data.store_name || 'Store');
      }
    });
  }, []);

  const num = (v: string) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  };

  const denomTotals = useMemo(
    () => DENOMINATIONS.map((d) => ({ denom: d, qty: parseInt(counts[d] ?? '', 10) || 0, total: d * (parseInt(counts[d] ?? '', 10) || 0) })),
    [counts],
  );
  const totalCashCount = denomTotals.reduce((sum, r) => sum + r.total, 0);
  const totalExpenses = expenses.reduce((sum, e) => sum + num(e.amount), 0);
  const opening = num(openingCash);
  const card = num(cardPayments);
  const online = num(onlinePayments);

  // Daily Sales = (Total Cash Count + Card + Online + Total Expenses) − Opening Cash
  const dailySales = totalCashCount + card + online + totalExpenses - opening;

  const updateCount = (denom: number, value: string) => {
    setCounts((prev) => ({ ...prev, [denom]: value.replace(/[^0-9]/g, '') }));
  };

  const updateExpense = (index: number, field: keyof ExpenseRow, value: string) => {
    setExpenses((prev) => prev.map((e, i) => (i === index ? { ...e, [field]: value } : e)));
  };

  const addExpense = () => setExpenses((prev) => [...prev, { amount: '', description: '' }]);
  const removeExpense = (index: number) => setExpenses((prev) => prev.filter((_, i) => i !== index));

  const [submitting, setSubmitting] = useState(false);

  const escapeHtml = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const buildReportHtml = (): string => {
    const now = new Date();
    const realExpenses = expenses.filter((e) => num(e.amount) > 0 || e.description.trim());
    const denomRows = denomTotals
      .map(
        (r) => `<tr><td>${r.denom}</td><td class="num">${r.qty}</td><td class="num">${money(r.total)}</td></tr>`,
      )
      .join('');
    const expenseRows = realExpenses.length
      ? realExpenses
          .map((e) => `<tr><td class="num">${money(num(e.amount))}</td><td>${escapeHtml(e.description.trim() || '—')}</td></tr>`)
          .join('')
      : `<tr><td colspan="2" class="muted">No expenses recorded</td></tr>`;

    return `<!doctype html><html><head><meta charset="utf-8"><style>
      * { box-sizing: border-box; }
      body { font-family: 'Segoe UI', Arial, sans-serif; color: #0f172a; margin: 0; padding: 32px; font-size: 13px; }
      .head { text-align: center; border-bottom: 3px solid #0d9488; padding-bottom: 16px; margin-bottom: 24px; }
      .head h1 { margin: 0; font-size: 20px; letter-spacing: 0.5px; }
      .head .store { font-size: 16px; font-weight: 600; color: #0d9488; margin-top: 4px; }
      .head .meta { font-size: 11px; color: #64748b; margin-top: 4px; }
      h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.6px; color: #0d9488; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; margin: 24px 0 10px; }
      .cards { display: flex; gap: 12px; }
      .card { flex: 1; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; }
      .card .label { font-size: 11px; color: #64748b; }
      .card .value { font-size: 16px; font-weight: 700; margin-top: 2px; }
      table { width: 100%; border-collapse: collapse; }
      th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #eef2f6; }
      th { font-size: 11px; text-transform: uppercase; color: #64748b; }
      td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
      tr.total td { font-weight: 700; border-top: 2px solid #cbd5e1; border-bottom: none; }
      .muted { color: #94a3b8; }
      .calc { background: #f0fdfa; border: 1px solid #99f6e4; border-radius: 8px; padding: 16px; margin-top: 8px; }
      .calc .row { display: flex; justify-content: space-between; padding: 3px 0; }
      .calc .formula { font-size: 11px; color: #64748b; margin-bottom: 8px; }
      .calc .grand { display: flex; justify-content: space-between; border-top: 2px solid #0d9488; margin-top: 8px; padding-top: 10px; font-size: 18px; font-weight: 800; color: #0f766e; }
      .foot { margin-top: 28px; text-align: center; font-size: 10px; color: #94a3b8; }
    </style></head><body>
      <div class="head">
        <h1>End of Day (EOD) Sales Report</h1>
        <div class="store">${escapeHtml(storeName)}</div>
        <div class="meta">Generated ${escapeHtml(now.toLocaleString())}</div>
      </div>

      <div class="cards">
        <div class="card"><div class="label">Opening Cash</div><div class="value">${money(opening)}</div></div>
        <div class="card"><div class="label">Card (Credit/Debit)</div><div class="value">${money(card)}</div></div>
        <div class="card"><div class="label">Online Payments</div><div class="value">${money(online)}</div></div>
      </div>

      <h2>Cash Count</h2>
      <table>
        <thead><tr><th>Denomination</th><th class="num">Quantity</th><th class="num">Total</th></tr></thead>
        <tbody>
          ${denomRows}
          <tr class="total"><td colspan="2">Total Cash Count</td><td class="num">${money(totalCashCount)}</td></tr>
        </tbody>
      </table>

      <h2>Day Expenses</h2>
      <table>
        <thead><tr><th class="num">Amount</th><th>Description</th></tr></thead>
        <tbody>
          ${expenseRows}
          <tr class="total"><td class="num">${money(totalExpenses)}</td><td>Total Expenses</td></tr>
        </tbody>
      </table>

      <h2>Daily Sales Calculation</h2>
      <div class="calc">
        <div class="formula">(Total Cash Count + Card + Online + Total Expenses) − Opening Cash</div>
        <div class="row"><span>Total Cash Count</span><span>${money(totalCashCount)}</span></div>
        <div class="row"><span>+ Card (Credit/Debit)</span><span>${money(card)}</span></div>
        <div class="row"><span>+ Online Payments</span><span>${money(online)}</span></div>
        <div class="row"><span>+ Total Expenses</span><span>${money(totalExpenses)}</span></div>
        <div class="row"><span>− Opening Cash</span><span>− ${money(opening)}</span></div>
        <div class="grand"><span>Daily Sales</span><span>${money(dailySales)}</span></div>
      </div>

      <div class="foot">Generated by the POS system and submitted to the Mamababi portal for admin review.</div>
    </body></html>`;
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    const dateStr = new Date().toISOString().slice(0, 10);
    const result = await api.eod.submitReport({
      html: buildReportHtml(),
      fileName: `EOD-Report-${dateStr}.pdf`,
      reportDate: dateStr,
      storeName,
      openingCash: opening,
      cardPayments: card,
      onlinePayments: online,
      totalCashCount,
      totalExpenses,
      dailySales,
    });
    setSubmitting(false);

    if (!result.success || !result.data) {
      toast.error(result.error ?? 'Could not submit report');
      return;
    }
    toast.success('EOD report submitted. An admin can now view it on the Mamababi portal.');
  };

  return (
    <div className="panel p-4 space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">End of Day (EOD) Sales Report</h3>
        <span className="text-xs text-slate-400">Submitted to the Mamababi portal for admin review</span>
      </div>

      {/* Top payment inputs */}
      <div className="grid grid-cols-3 gap-3">
        <label className="text-sm">
          <span className="text-xs text-slate-500">Opening Cash</span>
          <input type="number" value={openingCash} onChange={(e) => setOpeningCash(e.target.value)} placeholder="0" className="w-full mt-1 px-3 py-2 border rounded-lg" />
        </label>
        <label className="text-sm">
          <span className="text-xs text-slate-500">Card (Credit/Debit) — POS Machine</span>
          <input type="number" value={cardPayments} onChange={(e) => setCardPayments(e.target.value)} placeholder="0" className="w-full mt-1 px-3 py-2 border rounded-lg" />
        </label>
        <label className="text-sm">
          <span className="text-xs text-slate-500">Online (QR / bank transfer)</span>
          <input type="number" value={onlinePayments} onChange={(e) => setOnlinePayments(e.target.value)} placeholder="0" className="w-full mt-1 px-3 py-2 border rounded-lg" />
        </label>
      </div>

      {/* Cash count */}
      <div>
        <h4 className="font-medium text-sm mb-2">Cash Count</h4>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500">
              <th className="py-1 pr-2">Denomination</th>
              <th className="py-1 px-2 w-28">Quantity</th>
              <th className="py-1 pl-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {denomTotals.map((r) => (
              <tr key={r.denom} className="border-t border-slate-100 dark:border-slate-800">
                <td className="py-1 pr-2 font-medium">{r.denom}</td>
                <td className="py-1 px-2">
                  <input
                    type="number"
                    min={0}
                    value={counts[r.denom] ?? ''}
                    onChange={(e) => updateCount(r.denom, e.target.value)}
                    placeholder="0"
                    className="w-24 px-2 py-1 border rounded text-right"
                  />
                </td>
                <td className="py-1 pl-2 text-right tabular-nums">{money(r.total)}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-slate-200 dark:border-slate-700 font-semibold">
              <td className="py-2 pr-2" colSpan={2}>Total Cash Count</td>
              <td className="py-2 pl-2 text-right tabular-nums">{money(totalCashCount)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Day expenses */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h4 className="font-medium text-sm">Day Expenses</h4>
          <Button size="sm" variant="secondary" onClick={addExpense}>+ Add expense</Button>
        </div>
        <div className="space-y-2">
          {expenses.map((e, i) => (
            <div key={i} className="flex gap-2 items-center">
              <input
                type="number"
                value={e.amount}
                onChange={(ev) => updateExpense(i, 'amount', ev.target.value)}
                placeholder="Amount"
                className="w-32 px-3 py-2 border rounded-lg text-sm"
              />
              <input
                type="text"
                value={e.description}
                onChange={(ev) => updateExpense(i, 'description', ev.target.value)}
                placeholder="Description / details"
                className="flex-1 px-3 py-2 border rounded-lg text-sm"
              />
              <button type="button" className="text-red-500 px-2" onClick={() => removeExpense(i)} disabled={expenses.length === 1}>×</button>
            </div>
          ))}
        </div>
        <div className="flex justify-between text-sm font-semibold mt-2 pt-2 border-t border-slate-200 dark:border-slate-700">
          <span>Total Expenses</span>
          <span className="tabular-nums">{money(totalExpenses)}</span>
        </div>
      </div>

      {/* Daily sales calculation */}
      <div className="rounded-lg bg-slate-50 dark:bg-slate-800/60 p-4 space-y-1 text-sm">
        <h4 className="font-medium mb-2">Daily Sales Calculation</h4>
        <div className="flex justify-between"><span>Total Cash Count</span><span className="tabular-nums">{money(totalCashCount)}</span></div>
        <div className="flex justify-between"><span>+ Card (Credit/Debit)</span><span className="tabular-nums">{money(card)}</span></div>
        <div className="flex justify-between"><span>+ Online Payments</span><span className="tabular-nums">{money(online)}</span></div>
        <div className="flex justify-between"><span>+ Total Expenses</span><span className="tabular-nums">{money(totalExpenses)}</span></div>
        <div className="flex justify-between"><span>− Opening Cash</span><span className="tabular-nums">− {money(opening)}</span></div>
        <div className="flex justify-between border-t border-slate-300 dark:border-slate-600 pt-2 mt-1 text-lg font-bold text-primary-700 dark:text-primary-400">
          <span>Daily Sales</span><span className="tabular-nums">{money(dailySales)}</span>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-400">
          A PDF is generated and uploaded — visible to admins on the Mamababi portal.
        </p>
        <Button onClick={handleSubmit} disabled={submitting}>
          {submitting ? 'Submitting…' : 'Submit EOD Report'}
        </Button>
      </div>
    </div>
  );
}
