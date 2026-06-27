import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ShoppingCart, Receipt, Wallet, Package } from 'lucide-react';
import { Button, KpiCard, PageHeader } from '@mama-babi/ui';
import { getApi } from '@renderer/lib/api';
import { SortableTh } from '@renderer/components/SortableTh';
import { Modal } from '@renderer/components/Modal';
import { ReceiptPreview } from '@renderer/components/ReceiptPreview';
import { toast } from '@renderer/stores/toastStore';
import { sortByKey, useTableSort } from '@renderer/lib/useTableSort';
import { formatDateTime, localCalendarDate } from '@shared/datetime';
import type {
  ProfitReport,
  ReceiptPreview as ReceiptPreviewData,
  SaleSummary,
} from '@shared/types';

const api = getApi();

type SaleSortKey = 'saleNumber' | 'cashier' | 'customer' | 'payment' | 'total' | 'date';

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
  const { onSort, icon, sortKey, sortDir } = useTableSort<SaleSortKey>('date', 'desc');

  const sortedSales = useMemo(
    () => sortByKey(sales, sortKey, sortDir, {
      saleNumber: (s) => s.saleNumber,
      cashier: (s) => s.cashierName,
      customer: (s) => s.customerName ?? '',
      payment: (s) => s.paymentMethod,
      total: (s) => s.totalAmount,
      date: (s) => s.createdAt,
    }),
    [sales, sortKey, sortDir],
  );

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
    <div className="page-shell">
      <PageHeader
        title={`${storeName} Dashboard`}
        description="Analytics and bills for the selected period"
        actions={(
          <>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="form-input w-auto" />
            <span className="text-slate-400">to</span>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="form-input w-auto" />
            <Button variant="secondary" size="sm" onClick={load} disabled={loading} loading={loading}>
              Refresh
            </Button>
          </>
        )}
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Total Sales" value={`PKR ${(profit?.revenue ?? 0).toFixed(2)}`} hint={rangeLabel} icon={<ShoppingCart className="h-5 w-5" />} />
        <KpiCard label="Transactions" value={profit?.transactionCount ?? 0} hint="completed bills" icon={<Receipt className="h-5 w-5" />} />
        <KpiCard label="Gross Profit" value={`PKR ${(profit?.grossProfit ?? 0).toFixed(2)}`} hint={`${(profit?.marginPercent ?? 0).toFixed(1)}% margin`} icon={<Wallet className="h-5 w-5" />} />
        <KpiCard label="Held Sales" value={heldCount} hint={heldCount > 0 ? 'View in Sales' : undefined} icon={<Package className="h-5 w-5" />} />
      </div>

      <div className="data-table-wrap">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-800">
          <h3 className="font-semibold text-slate-900 dark:text-slate-50">Bills ({rangeLabel})</h3>
          <p className="text-xs text-slate-500">Click a row to view receipt</p>
        </div>
        <table className="data-table">
          <thead className="bg-slate-50">
            <tr className="text-left text-sm text-slate-500">
              <SortableTh label="Sale #" columnKey="saleNumber" onSort={onSort} icon={icon} className="p-3" />
              <SortableTh label="Cashier" columnKey="cashier" onSort={onSort} icon={icon} className="p-3" />
              <SortableTh label="Customer" columnKey="customer" onSort={onSort} icon={icon} className="p-3" />
              <SortableTh label="Payment" columnKey="payment" onSort={onSort} icon={icon} className="p-3" />
              <SortableTh label="Total" columnKey="total" onSort={onSort} icon={icon} className="p-3" align="right" />
              <SortableTh label="Date / Time" columnKey="date" onSort={onSort} icon={icon} className="p-3" />
            </tr>
          </thead>
          <tbody>
            {sortedSales.map((s) => (
              <tr
                key={s.id}
                className="border-t border-slate-100 cursor-pointer hover:bg-primary-50"
                onClick={() => openBill(s)}
              >
                <td className="p-3 font-mono text-sm text-primary-700">{s.saleNumber}</td>
                <td className="p-3">{s.cashierName}</td>
                <td className="p-3 text-slate-600">{s.customerName ?? '—'}</td>
                <td className="p-3 capitalize">{s.paymentMethod.replace('_', ' ')}</td>
                <td className="p-3 text-right font-semibold">PKR {s.totalAmount.toFixed(2)}</td>
                <td className="p-3 text-sm text-slate-500 whitespace-nowrap">{formatDateTime(s.createdAt)}</td>
              </tr>
            ))}
            {sortedSales.length === 0 && !loading && (
              <tr>
                <td colSpan={6} className="p-8 text-center text-slate-400">
                  No completed bills in this period
                </td>
              </tr>
            )}
            {loading && sortedSales.length === 0 && (
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
