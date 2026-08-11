import { useEffect, useMemo, useState } from 'react';
import { getApi } from '@renderer/lib/api';
import { EodReportForm } from '@renderer/components/EodReportForm';
import { useAuthStore } from '@renderer/stores/authStore';
import { localCalendarDate } from '@shared/datetime';
import type { SaleSummary } from '@shared/types';

const api = getApi();

/**
 * Day close for a salesman.
 *
 * Deliberately narrower than the Shifts screen: it answers "what did I take today"
 * and lets the till be counted and submitted, without exposing shift administration
 * or the whole shop's figures.
 */
export function DayClosePage() {
  const session = useAuthStore((s) => s.session);
  const [sales, setSales] = useState<SaleSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const today = useMemo(() => localCalendarDate(), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void api.sales
      .list({ startDate: today, endDate: today, status: 'completed', limit: 500 })
      .then((result) => {
        if (cancelled) return;
        setSales(result.success && result.data ? result.data : []);
        if (!result.success) setError(result.error ?? 'Could not load today’s sales');
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Could not load today’s sales');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [today]);

  // A salesman closes his own drawer, so the figures are his own takings.
  const mine = useMemo(
    () => sales.filter((s) => !session || s.cashierId === session.id),
    [sales, session],
  );

  const totals = useMemo(() => {
    const byMethod = new Map<string, number>();
    let grand = 0;
    for (const sale of mine) {
      byMethod.set(sale.paymentMethod, (byMethod.get(sale.paymentMethod) ?? 0) + sale.totalAmount);
      grand += sale.totalAmount;
    }
    return { byMethod: [...byMethod.entries()], grand, count: mine.length };
  }, [mine]);

  return (
    <div className="page-shell">
      <div className="mb-4">
        <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Day Close</h2>
        <p className="text-sm text-slate-500">
          {session?.name} · {today} — count the drawer and submit the end-of-day report
        </p>
      </div>

      <div className="panel mb-6 p-4">
        <h3 className="mb-3 font-semibold text-slate-900 dark:text-slate-100">Your sales today</h3>
        {loading ? (
          <p className="text-sm text-slate-400">Loading…</p>
        ) : error ? (
          <p className="text-sm text-red-600 dark:text-red-400">
            {error} — count the drawer from your own records before submitting.
          </p>
        ) : totals.count === 0 ? (
          <p className="text-sm text-slate-400">No completed sales recorded for you today.</p>
        ) : (
          <div className="flex flex-wrap items-end gap-6">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Bills</p>
              <p className="text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-100">
                {totals.count}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Total taken</p>
              <p className="text-2xl font-bold tabular-nums text-primary-700 dark:text-primary-400">
                PKR {totals.grand.toFixed(2)}
              </p>
            </div>
            {totals.byMethod.map(([method, amount]) => (
              <div key={method}>
                <p className="text-xs uppercase tracking-wide text-slate-500 capitalize">{method}</p>
                <p className="text-lg font-semibold tabular-nums text-slate-700 dark:text-slate-300">
                  {amount.toFixed(2)}
                </p>
              </div>
            ))}
          </div>
        )}
        <p className="mt-3 text-xs text-slate-400">
          Cash counted below should match the cash figure above, less any float and expenses.
        </p>
      </div>

      <EodReportForm />
    </div>
  );
}
