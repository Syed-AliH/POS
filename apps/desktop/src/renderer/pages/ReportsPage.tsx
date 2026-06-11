import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@mama-babi/ui';
import { getApi } from '@renderer/lib/api';
import { localCalendarDate } from '@shared/datetime';
import type {
  EodReport,
  InventoryValuation,
  PaymentBreakdownRow,
  ProfitReport,
  SalesByCategoryRow,
  TopProductRow,
} from '@shared/types';

const api = getApi();

export function ReportsPage() {
  const today = useMemo(() => localCalendarDate(), []);
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [summary, setSummary] = useState({ totalSales: 0, transactionCount: 0 });
  const [eod, setEod] = useState<EodReport | null>(null);
  const [byCategory, setByCategory] = useState<SalesByCategoryRow[]>([]);
  const [topProducts, setTopProducts] = useState<TopProductRow[]>([]);
  const [payments, setPayments] = useState<PaymentBreakdownRow[]>([]);
  const [valuation, setValuation] = useState<InventoryValuation | null>(null);
  const [profit, setProfit] = useState<ProfitReport | null>(null);
  const [loading, setLoading] = useState(false);

  const range = { startDate, endDate };
  const periodLabel = startDate === endDate ? startDate : `${startDate} → ${endDate}`;

  const load = async () => {
    setLoading(true);
    const [summaryRes, eodRes, categoryRes, topRes, paymentRes, valuationRes, profitRes] = await Promise.all([
      api.reports.dailySales(range),
      api.reports.eod(range),
      api.reports.salesByCategory(range),
      api.reports.topProducts({ ...range, limit: 10 }),
      api.reports.paymentBreakdown(range),
      api.reports.inventoryValuation(),
      api.reports.profit(range),
    ]);
    setLoading(false);
    if (summaryRes.success && summaryRes.data) setSummary(summaryRes.data);
    if (eodRes.success) setEod(eodRes.data ?? null);
    if (categoryRes.success) setByCategory(categoryRes.data ?? []);
    if (topRes.success) setTopProducts(topRes.data ?? []);
    if (paymentRes.success) setPayments(paymentRes.data ?? []);
    if (valuationRes.success) setValuation(valuationRes.data ?? null);
    if (profitRes.success) setProfit(profitRes.data ?? null);
  };

  useEffect(() => { load(); }, [startDate, endDate]);

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-2xl font-bold">Reports</h2>
          <p className="text-sm text-slate-500 mt-1">All figures below use the selected date range ({periodLabel})</p>
        </div>
        <div className="flex gap-2 items-center">
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="px-3 py-2 border rounded-lg text-sm" />
          <span className="text-slate-400">to</span>
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="px-3 py-2 border rounded-lg text-sm" />
          <Button variant="secondary" size="sm" onClick={load} disabled={loading}>
            {loading ? 'Loading…' : 'Refresh'}
          </Button>
          <Link to="/inventory-report" className="text-sm text-pink-700 hover:underline px-2 py-2">Inventory Report →</Link>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
        <div className="bg-white rounded-xl border p-4">
          <p className="text-sm text-slate-500">Sales</p>
          <p className="text-2xl font-bold text-pink-700">PKR {(profit?.revenue ?? summary.totalSales).toFixed(0)}</p>
          <p className="text-xs text-slate-400">{profit?.transactionCount ?? summary.transactionCount} transactions</p>
        </div>
        {profit && (
          <>
            <div className="bg-white rounded-xl border p-4">
              <p className="text-sm text-slate-500">Est. Cost</p>
              <p className="text-2xl font-bold">PKR {profit.estimatedCost.toFixed(0)}</p>
            </div>
            <div className="bg-white rounded-xl border p-4">
              <p className="text-sm text-slate-500">Gross Profit</p>
              <p className="text-2xl font-bold">PKR {profit.grossProfit.toFixed(0)}</p>
              <p className="text-xs text-slate-400">{profit.marginPercent.toFixed(1)}% margin</p>
            </div>
            <div className="bg-white rounded-xl border p-4">
              <p className="text-sm text-slate-500">Returns</p>
              <p className="text-2xl font-bold">PKR {profit.returnsTotal.toFixed(0)}</p>
            </div>
          </>
        )}
        {eod && (
          <div className="bg-white rounded-xl border p-4">
            <p className="text-sm text-slate-500">Expenses</p>
            <p className="text-2xl font-bold">PKR {eod.expensesTotal.toFixed(0)}</p>
          </div>
        )}
      </div>

      {valuation && (
        <div className="bg-white rounded-xl border p-4 mb-6 space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
            <div><span className="text-slate-500">Stock units:</span> <strong className={valuation.totalUnits < 0 ? 'text-red-600' : ''}>{valuation.totalUnits}</strong></div>
            <div><span className="text-slate-500">Cost value:</span> <strong>PKR {valuation.totalCostValue.toFixed(0)}</strong></div>
            <div><span className="text-slate-500">Retail value:</span> <strong>PKR {valuation.totalRetailValue.toFixed(0)}</strong></div>
            <div><span className="text-slate-500">Active SKUs:</span> <strong>{valuation.productCount}</strong></div>
          </div>
          {valuation.negativeStockCount > 0 && (
            <div>
              <p className="text-sm font-medium text-red-700 mb-2">
                Negative inventory: {valuation.negativeStockCount} product{valuation.negativeStockCount === 1 ? '' : 's'}
              </p>
              <div className="max-h-36 overflow-y-auto border rounded-lg text-sm">
                <table className="w-full">
                  <tbody>
                    {valuation.negativeStockItems.map((p) => (
                      <tr key={p.id} className="border-b border-slate-100 last:border-0">
                        <td className="p-2">{p.name}</td>
                        <td className="p-2 font-mono text-xs text-slate-500">{p.sku}</td>
                        <td className="p-2 text-right text-red-600 font-semibold">{p.stockQty}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border p-4">
          <h3 className="font-semibold mb-3">Sales by Category</h3>
          {byCategory.map((r) => (
            <div key={r.categoryName} className="flex justify-between text-sm py-1 border-b border-slate-50">
              <span>{r.categoryName}</span>
              <span className="font-medium">PKR {r.totalSales.toFixed(0)} ({r.itemCount} items)</span>
            </div>
          ))}
          {!byCategory.length && <p className="text-slate-400 text-sm">No data for this period</p>}
        </div>

        <div className="bg-white rounded-xl border p-4">
          <h3 className="font-semibold mb-3">Top Products</h3>
          {topProducts.map((r, i) => (
            <div key={r.productId} className="flex justify-between text-sm py-1 border-b border-slate-50">
              <span>{i + 1}. {r.productName}</span>
              <span className="font-medium">PKR {r.revenue.toFixed(0)} ×{r.quantitySold}</span>
            </div>
          ))}
          {!topProducts.length && <p className="text-slate-400 text-sm">No data for this period</p>}
        </div>

        <div className="bg-white rounded-xl border p-4">
          <h3 className="font-semibold mb-3">Payment Breakdown</h3>
          {payments.map((r) => (
            <div key={r.paymentMethod} className="flex justify-between text-sm py-1 border-b border-slate-50 capitalize">
              <span>{r.paymentMethod.replace('_', ' ')}</span>
              <span className="font-medium">PKR {r.total.toFixed(0)} ({r.count})</span>
            </div>
          ))}
          {!payments.length && <p className="text-slate-400 text-sm">No data for this period</p>}
        </div>

        {eod && (
          <div className="bg-white rounded-xl border p-4">
            <h3 className="font-semibold mb-3">Period Summary ({eod.date})</h3>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between"><span>Total sales</span><span>PKR {eod.totalSales.toFixed(0)}</span></div>
              <div className="flex justify-between"><span>Cash sales</span><span>PKR {eod.cashSales.toFixed(0)}</span></div>
              <div className="flex justify-between"><span>Card sales</span><span>PKR {eod.cardSales.toFixed(0)}</span></div>
              <div className="flex justify-between"><span>Returns</span><span>PKR {eod.returnsTotal.toFixed(0)}</span></div>
              <div className="flex justify-between"><span>Expenses</span><span>PKR {eod.expensesTotal.toFixed(0)}</span></div>
              <div className="flex justify-between font-semibold pt-2 border-t"><span>Net (sales − returns − expenses)</span><span>PKR {(eod.totalSales - eod.returnsTotal - eod.expensesTotal).toFixed(0)}</span></div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
