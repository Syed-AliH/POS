import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@mama-babi/ui';
import { getApi } from '@renderer/lib/api';
import { Modal } from '@renderer/components/Modal';
import { ReceiptPreview } from '@renderer/components/ReceiptPreview';
import { toast } from '@renderer/stores/toastStore';
import { formatDateTime, localCalendarDate } from '@shared/datetime';
import type {
  ProfitReport,
  ReceiptPreview as ReceiptPreviewData,
  SaleSummary,
} from '@shared/types';

const api = getApi();

export function DashboardPage() {
  const navigate = useNavigate();
  const [startDate, setStartDate] = useState(() => localCalendarDate());
  const [endDate, setEndDate] = useState(() => localCalendarDate());
  const [profit, setProfit] = useState<ProfitReport | null>(null);
  const [sales, setSales] = useState<SaleSummary[]>([]);
  const [heldCount, setHeldCount] = useState(0);
  const [storeName, setStoreName] = useState('Mama Babi');
  const [loading, setLoading] = useState(false);
  const [selectedSale, setSelectedSale] = useState<SaleSummary | null>(null);
  const [receiptPreview, setReceiptPreview] = useState<ReceiptPreviewData | null>(null);
  const [receiptOpen, setReceiptOpen] = useState(false);

  const range = { startDate, endDate };
  const rangeLabel = startDate === endDate ? startDate : `${startDate} → ${endDate}`;

  const load = async () => {
    setLoading(true);
    const [profitRes, salesRes, heldRes, settingsRes] = await Promise.all([
      api.reports.profit(range),
      api.sales.list({ limit: 100, status: 'completed', startDate, endDate }),
      api.sales.list({ limit: 100, status: 'held' }),
      api.settings.get('store_name'),
    ]);
    setLoading(false);
    if (profitRes.success) setProfit(profitRes.data ?? null);
    if (salesRes.success) setSales(salesRes.data ?? []);
    if (heldRes.success) setHeldCount(heldRes.data?.length ?? 0);
    if (settingsRes.success && settingsRes.data) setStoreName(settingsRes.data);
  };

  useEffect(() => { load(); }, [startDate, endDate]);

  const openBill = async (sale: SaleSummary) => {
    const [saleRes, previewRes] = await Promise.all([
      api.sales.get(sale.id),
      api.sales.receiptPreview(sale.id),
    ]);
    if (saleRes.success && saleRes.data) setSelectedSale(saleRes.data);
    if (previewRes.success && previewRes.data) {
      setReceiptPreview(previewRes.data);
      setReceiptOpen(true);
    } else {
      toast.error(previewRes.error ?? 'Could not load receipt');
    }
  };

  const handleReprint = async () => {
    if (!selectedSale) return;
    const result = await api.print.receipt(selectedSale.id);
    if (result.success) toast.success('Receipt sent to printer');
    else toast.error(result.error ?? 'Print failed');
  };

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="flex flex-wrap justify-between items-start gap-4 mb-6">
        <div>
          <h2 className="text-2xl font-bold">{storeName} Dashboard</h2>
          <p className="text-sm text-slate-500 mt-1">Analytics and bills for the selected period</p>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="px-3 py-2 border rounded-lg text-sm"
          />
          <span className="text-slate-400">to</span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="px-3 py-2 border rounded-lg text-sm"
          />
          <Button variant="secondary" size="sm" onClick={load} disabled={loading}>
            {loading ? 'Loading…' : 'Refresh'}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <p className="text-sm text-slate-500">Total Sales</p>
          <p className="text-3xl font-bold text-pink-700 mt-1">PKR {(profit?.revenue ?? 0).toFixed(2)}</p>
          <p className="text-xs text-slate-400 mt-1">{rangeLabel}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <p className="text-sm text-slate-500">Transactions</p>
          <p className="text-3xl font-bold mt-1">{profit?.transactionCount ?? 0}</p>
          <p className="text-xs text-slate-400 mt-1">completed bills</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <p className="text-sm text-slate-500">Gross Profit</p>
          <p className="text-3xl font-bold mt-1">PKR {(profit?.grossProfit ?? 0).toFixed(2)}</p>
          <p className="text-xs text-slate-400 mt-1">{(profit?.marginPercent ?? 0).toFixed(1)}% margin</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <p className="text-sm text-slate-500">Held Sales</p>
          <p className="text-3xl font-bold mt-1">{heldCount}</p>
          {heldCount > 0 && <Link to="/sales" className="text-sm text-pink-600 mt-1 inline-block">View in Sales →</Link>}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200">
        <div className="p-4 border-b border-slate-100 flex justify-between items-center">
          <h3 className="font-semibold">Bills ({rangeLabel})</h3>
          <p className="text-xs text-slate-500">Click a row to view receipt</p>
        </div>
        <table className="w-full">
          <thead className="bg-slate-50">
            <tr className="text-left text-sm text-slate-500">
              <th className="p-3">Sale #</th>
              <th className="p-3">Cashier</th>
              <th className="p-3">Customer</th>
              <th className="p-3">Payment</th>
              <th className="p-3 text-right">Total</th>
              <th className="p-3">Date / Time</th>
            </tr>
          </thead>
          <tbody>
            {sales.map((s) => (
              <tr
                key={s.id}
                className="border-t border-slate-100 cursor-pointer hover:bg-pink-50"
                onClick={() => openBill(s)}
              >
                <td className="p-3 font-mono text-sm text-pink-700">{s.saleNumber}</td>
                <td className="p-3">{s.cashierName}</td>
                <td className="p-3 text-slate-600">{s.customerName ?? '—'}</td>
                <td className="p-3 capitalize">{s.paymentMethod.replace('_', ' ')}</td>
                <td className="p-3 text-right font-semibold">PKR {s.totalAmount.toFixed(2)}</td>
                <td className="p-3 text-sm text-slate-500 whitespace-nowrap">{formatDateTime(s.createdAt)}</td>
              </tr>
            ))}
            {sales.length === 0 && !loading && (
              <tr>
                <td colSpan={6} className="p-8 text-center text-slate-400">
                  No completed bills in this period
                </td>
              </tr>
            )}
            {loading && sales.length === 0 && (
              <tr>
                <td colSpan={6} className="p-8 text-center text-slate-400">Loading…</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal
        open={receiptOpen}
        title={selectedSale ? `Bill ${selectedSale.saleNumber}` : 'Receipt'}
        onClose={() => { setReceiptOpen(false); setReceiptPreview(null); setSelectedSale(null); }}
        size="md"
        footer={(
          <>
            <Button variant="ghost" onClick={() => { setReceiptOpen(false); setReceiptPreview(null); setSelectedSale(null); }}>
              Close
            </Button>
            <Button variant="secondary" onClick={handleReprint}>Print receipt</Button>
            {selectedSale && (
              <Button
                variant="secondary"
                onClick={() => {
                  setReceiptOpen(false);
                  navigate(`/returns?sale=${encodeURIComponent(selectedSale.saleNumber)}`);
                }}
              >
                Process return
              </Button>
            )}
          </>
        )}
      >
        {receiptPreview ? (
          <ReceiptPreview data={receiptPreview} />
        ) : (
          <p className="text-slate-500 text-sm">Loading receipt…</p>
        )}
      </Modal>
    </div>
  );
}
