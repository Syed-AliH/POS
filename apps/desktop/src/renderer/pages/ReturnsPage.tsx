import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Search } from 'lucide-react';
import { Button } from '@mama-babi/ui';
import { getApi } from '@renderer/lib/api';
import { useAuthStore } from '@renderer/stores/authStore';
import { focusElement, registerPageShortcuts } from '@renderer/lib/shortcuts';
import { WorkflowStepper } from '@renderer/components/WorkflowStepper';
import { Modal } from '@renderer/components/Modal';
import { ReceiptSearchModal } from '@renderer/components/ReceiptSearchModal';
import { ReceiptPreview } from '@renderer/components/ReceiptPreview';
import { toast } from '@renderer/stores/toastStore';
import { formatDateOnly, formatDateTime, formatTimeOnly, localCalendarDate } from '@shared/datetime';
import type { ReceiptPreview as ReceiptPreviewData, ReturnSummary, SaleSummary } from '@shared/types';

const api = getApi();

type LookupMode = 'saleNumber' | 'customerName' | 'customerPhone';

function normalizePhone(phone: string): string {
  return phone.replace(/[\s\-()]/g, '');
}

const LOOKUP_MODES: { id: LookupMode; label: string; placeholder: string }[] = [
  {
    id: 'saleNumber',
    label: 'Sale #',
    placeholder: 'Filter by sale #…',
  },
  {
    id: 'customerName',
    label: 'Customer name',
    placeholder: 'Filter by customer name…',
  },
  {
    id: 'customerPhone',
    label: 'Phone number',
    placeholder: 'Filter by phone number…',
  },
];

const STEPS = [
  { id: 'lookup', label: 'Find sale', hint: 'Sale #, customer name, or phone' },
  { id: 'items', label: 'Select items', hint: 'Choose qty to return' },
  { id: 'refund', label: 'Process refund', hint: 'F4 to submit' },
];

export function ReturnsPage() {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { session } = useAuthStore();
  const isCashier = session?.role === 'cashier';

  const [lookupMode, setLookupMode] = useState<LookupMode>('saleNumber');
  const [searchQuery, setSearchQuery] = useState('');
  const [sale, setSale] = useState<SaleSummary | null>(null);
  const [allSales, setAllSales] = useState<SaleSummary[]>([]);
  const [searched, setSearched] = useState(false);
  const [receiptPreview, setReceiptPreview] = useState<ReceiptPreviewData | null>(null);
  const [reason, setReason] = useState('');
  const [refundMethod, setRefundMethod] = useState<'cash' | 'store_credit' | 'loyalty'>('cash');
  const [returnQtys, setReturnQtys] = useState<Record<string, number>>({});
  const [restockFlags, setRestockFlags] = useState<Record<string, boolean>>({});
  const [returns, setReturns] = useState<ReturnSummary[]>([]);
  const [returnPolicyDays, setReturnPolicyDays] = useState(7);
  const [successReturn, setSuccessReturn] = useState<ReturnSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [showReceiptSearch, setShowReceiptSearch] = useState(false);
  const [startDate, setStartDate] = useState(() => localCalendarDate());
  const [endDate, setEndDate] = useState(() => localCalendarDate());
  const searchRef = useRef<HTMLInputElement>(null);
  const submitRef = useRef<() => void>(() => undefined);

  const activeMode = LOOKUP_MODES.find((m) => m.id === lookupMode)!;

  const filteredSales = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return allSales;
    if (lookupMode === 'saleNumber') {
      return allSales.filter((s) => s.saleNumber.toLowerCase().includes(q));
    }
    if (lookupMode === 'customerName') {
      return allSales.filter((s) => s.customerName?.toLowerCase().includes(q));
    }
    const phoneQ = normalizePhone(searchQuery);
    return allSales.filter((s) => s.customerPhone && normalizePhone(s.customerPhone).includes(phoneQ));
  }, [allSales, searchQuery, lookupMode]);

  const refundPreview = useMemo(() => {
    if (!sale) return 0;
    return sale.items.reduce((sum, item) => {
      if (!item.saleItemId) return sum;
      const qty = returnQtys[item.saleItemId] ?? 0;
      const unit = item.lineTotal / item.quantity;
      return sum + unit * qty;
    }, 0);
  }, [sale, returnQtys]);

  const workflowStep = successReturn ? 2 : !sale ? 0 : refundPreview > 0 && reason.trim() ? 2 : 1;

  const loadReturns = async () => {
    const result = await api.returns.list({
      limit: 20,
      startDate,
      endDate,
    });
    if (result.success) setReturns(result.data ?? []);
  };

  const initReturnState = (found: SaleSummary) => {
    const qtys: Record<string, number> = {};
    const restock: Record<string, boolean> = {};
    found.items.forEach((i) => {
      if (i.saleItemId) {
        qtys[i.saleItemId] = 0;
        restock[i.saleItemId] = true;
      }
    });
    setReturnQtys(qtys);
    setRestockFlags(restock);
  };

  const loadAllSales = async () => {
    // Cashiers cannot browse all sales — they must look up a specific invoice
    if (isCashier) return;
    setLoading(true);
    const result = await api.sales.list({
      status: 'completed',
      limit: 200,
      startDate,
      endDate,
    });
    setLoading(false);
    if (result.success) setAllSales(result.data ?? []);
  };

  const selectSale = async (found: SaleSummary) => {
    setSale(found);
    setReceiptPreview(null);
    initReturnState(found);
    const previewResult = await api.sales.receiptPreview(found.id);
    if (previewResult.success) setReceiptPreview(previewResult.data ?? null);
    toast.success(`Selected sale ${found.saleNumber}`);
  };

  useEffect(() => {
    if (location.pathname !== '/returns') return;
    loadReturns();
    loadAllSales();
  }, [location.pathname, startDate, endDate]);

  useEffect(() => {
    api.settings.get('return_policy_days').then((r) => {
      if (r.success && r.data) setReturnPolicyDays(parseInt(r.data, 10) || 7);
    });
  }, []);

  useEffect(() => {
    return registerPageShortcuts(location.pathname, {
      F1: () => setShowReceiptSearch(true),
      F4: () => submitRef.current(),
    });
  }, [location.pathname]);

  const handleLookup = async (query?: string) => {
    const q = (query ?? searchQuery).trim();
    if (!q) {
      if (!isCashier) await loadAllSales();
      return;
    }

    if (lookupMode === 'saleNumber') {
      setLoading(true);
      const result = await api.sales.lookup(q);
      setLoading(false);
      if (result.success && result.data) {
        await selectSale(result.data);
        setSearched(true);
      } else {
        toast.error(result.error ?? 'Sale not found');
      }
      return;
    }

    // For cashier: search by name/phone hits the API with a text filter
    if (isCashier) {
      setLoading(true);
      const result = await api.sales.list({
        status: 'completed',
        limit: 50,
        search: q,
      });
      setLoading(false);
      setSearched(true);
      if (result.success) {
        const matches = result.data ?? [];
        setAllSales(matches);
        if (matches.length === 1) {
          await selectSale(matches[0]);
        } else if (!matches.length) {
          toast.error('No matching sales found');
        }
      }
      return;
    }

    if (filteredSales.length === 1) {
      await selectSale(filteredSales[0]);
    } else if (!filteredSales.length) {
      toast.error('No matching sales');
    } else {
      toast.info(`${filteredSales.length} sales match — click a row to select`);
    }
  };

  useEffect(() => {
    const fromUrl = searchParams.get('sale');
    if (!fromUrl) return;
    setLookupMode('saleNumber');
    setSearchQuery(fromUrl);
    (async () => {
      setLoading(true);
      const result = await api.sales.lookup(fromUrl);
      setLoading(false);
      if (result.success && result.data) {
        await selectSale(result.data);
      }
    })();
  }, [searchParams]);

  const handleSubmit = async () => {
    if (!sale) { toast.warning('Look up a sale first'); return; }
    if (!reason.trim()) { toast.warning('Enter a return reason'); return; }
    const items = Object.entries(returnQtys)
      .filter(([, qty]) => qty > 0)
      .map(([saleItemId, qtyReturned]) => ({
        saleItemId,
        qtyReturned,
        restocked: restockFlags[saleItemId] ?? true,
      }));
    if (!items.length) { toast.warning('Select at least one item to return'); return; }

    setLoading(true);
    const result = await api.returns.create({ saleNumber: sale.saleNumber, reason, refundMethod, items });
    setLoading(false);
    if (result.success && result.data) {
      setSuccessReturn(result.data);
      setSale(null);
      setSearchQuery('');
      setReceiptPreview(null);
      setReason('');
      setAllSales([]);
      setSearched(false);
      loadReturns();
      loadAllSales();
      toast.success(`Return ${result.data.returnNumber} — PKR ${result.data.totalRefund.toFixed(2)}`);
    } else toast.error(result.error ?? 'Return failed');
  };

  useEffect(() => { submitRef.current = handleSubmit; });

  const saleAgeDays = sale
    ? Math.floor((Date.now() - new Date(sale.createdAt).getTime()) / 86400000)
    : null;

  const handleModeChange = (mode: LookupMode) => {
    setLookupMode(mode);
    setSearchQuery('');
    setAllSales([]);
    setSearched(false);
    focusElement(searchRef, true);
  };

  return (
    <div className="h-full flex flex-col">
      <WorkflowStepper steps={STEPS} currentStep={workflowStep} />

      <div className="flex-1 overflow-y-auto p-6">
        <div className="flex justify-between items-center mb-6 flex-wrap gap-3">
          <div>
            <h2 className="text-2xl font-bold">Returns</h2>
            <p className="text-sm text-slate-500">Return policy: {returnPolicyDays} days from purchase</p>
          </div>
          {!isCashier && (
            <div className="flex gap-2 items-center flex-wrap">
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="px-3 py-2 border rounded-lg text-sm" />
              <span className="text-slate-400 text-sm">to</span>
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="px-3 py-2 border rounded-lg text-sm" />
              <Button variant="ghost" onClick={() => navigate('/sales')}>View Sales History</Button>
            </div>
          )}
        </div>

        <div className="panel p-4 mb-6">
          <label className="text-xs font-medium text-slate-500 uppercase">Step 1 — Find sale (F1)</label>
          <div className="flex gap-2 mt-2 mb-3">
            {LOOKUP_MODES.map((mode) => (
              <button
                key={mode.id}
                type="button"
                onClick={() => handleModeChange(mode.id)}
                className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                  lookupMode === mode.id
                    ? 'border-primary-300 bg-primary-50 font-medium text-primary-700 dark:border-primary-700 dark:bg-primary-950 dark:text-primary-300'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'
                }`}
              >
                {mode.label}
              </button>
            ))}
          </div>
          <div className="flex gap-2 mb-4">
            <input
              ref={searchRef}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={activeMode.placeholder}
              className="flex-1 px-3 py-2 border rounded-lg"
              onKeyDown={(e) => e.key === 'Enter' && handleLookup()}
            />
            <Button onClick={() => handleLookup()} disabled={loading}>{loading ? '…' : 'Lookup'}</Button>
          </div>

          <div className="border border-dashed rounded-lg min-h-[280px] flex flex-col">
            {receiptPreview && (
              <div className="p-4 border-b flex justify-center bg-slate-50/50">
                <ReceiptPreview data={receiptPreview} className="max-w-lg w-full shadow-sm" />
              </div>
            )}

            {/* Cashier mode: show prompt until a search is made */}
            {isCashier && !searched && !sale && (
              <div className="flex-1 flex flex-col items-center justify-center gap-3 py-10 text-slate-400">
                <Search className="h-10 w-10 opacity-40" />
                <p className="text-sm font-medium">Enter an invoice number or customer phone to look up a sale</p>
                <p className="text-xs">You cannot browse all sales — enter a specific invoice # or phone number</p>
              </div>
            )}

            {/* Full list (managers) or search results (cashiers after search) */}
            {(!isCashier || searched) && !sale && (
              <div className="flex-1 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="table-head">
                    <tr className="text-left border-b">
                      <th className="p-2 pl-3">Sale #</th>
                      <th className="p-2">Date</th>
                      <th className="p-2">Time</th>
                      <th className="p-2 text-right">Amount</th>
                      <th className="p-2">Customer</th>
                      <th className="p-2 pr-3">Phone</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredSales.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="p-8 text-center text-slate-400">
                          {loading
                            ? 'Looking up…'
                            : 'No sales found — try a different invoice # or phone number'}
                        </td>
                      </tr>
                    ) : filteredSales.map((row) => (
                      <tr
                        key={row.id}
                        onClick={() => selectSale(row)}
                        className={`border-t cursor-pointer row-hover ${
                          sale?.id === row.id ? 'row-active' : ''
                        }`}
                      >
                        <td className="p-2 pl-3 font-mono font-medium">{row.saleNumber}</td>
                        <td className="p-2 text-slate-500 whitespace-nowrap text-xs">{formatDateOnly(row.createdAt)}</td>
                        <td className="p-2 text-slate-500 whitespace-nowrap text-xs">{formatTimeOnly(row.createdAt)}</td>
                        <td className="p-2 text-right font-semibold">PKR {row.totalAmount.toFixed(2)}</td>
                        <td className="p-2">{row.customerName ?? '—'}</td>
                        <td className="p-2 pr-3 text-slate-600">{row.customerPhone ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {filteredSales.length > 0 && !isCashier && (
                  <p className="text-xs text-slate-400 px-3 py-2 border-t">
                    {filteredSales.length} sale{filteredSales.length !== 1 ? 's' : ''}
                    {searchQuery.trim() ? ' matching filter' : ` for ${startDate === endDate ? startDate : `${startDate} → ${endDate}`}`}
                    {' '}— click a row to view receipt
                  </p>
                )}
                {filteredSales.length > 1 && isCashier && (
                  <p className="text-xs text-slate-400 px-3 py-2 border-t">
                    {filteredSales.length} sales found — click a row to select
                  </p>
                )}
              </div>
            )}
          </div>

          {sale && (
            <div className="space-y-4 mt-4">
              <div className="flex justify-between items-start p-3 bg-slate-50 dark:bg-slate-800 rounded-lg">
                <div>
                  <p className="font-mono font-semibold">{sale.saleNumber}</p>
                  <p className="text-sm text-slate-500">{formatDateTime(sale.createdAt)} · {sale.cashierName}</p>
                </div>
                <div className="text-right">
                  <p className="font-bold">PKR {sale.totalAmount.toFixed(2)}</p>
                  {saleAgeDays != null && (
                    <p className={`text-xs ${saleAgeDays > returnPolicyDays ? 'text-red-600' : 'text-green-600'}`}>
                      {saleAgeDays} day(s) ago {saleAgeDays > returnPolicyDays ? '(outside policy)' : '(within policy)'}
                    </p>
                  )}
                </div>
              </div>

              <label className="text-xs font-medium text-slate-500 uppercase">Step 2 — Items to return</label>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-500 border-b">
                    <th className="p-2">Item</th>
                    <th className="p-2">Sold</th>
                    <th className="p-2">Return qty</th>
                    <th className="p-2">Restock</th>
                  </tr>
                </thead>
                <tbody>
                  {sale.items.map((item) => item.saleItemId && (
                    <tr key={item.saleItemId} className="border-t">
                      <td className="p-2">{item.productName}</td>
                      <td className="p-2">{item.quantity}</td>
                      <td className="p-2">
                        <div className="flex items-center gap-1">
                          <button type="button" className="w-8 h-8 rounded bg-slate-100" onClick={() => setReturnQtys({ ...returnQtys, [item.saleItemId!]: Math.max(0, (returnQtys[item.saleItemId!] ?? 0) - 1) })}>-</button>
                          <span className="w-6 text-center">{returnQtys[item.saleItemId] ?? 0}</span>
                          <button type="button" className="w-8 h-8 rounded bg-slate-100" onClick={() => setReturnQtys({ ...returnQtys, [item.saleItemId!]: Math.min(item.quantity, (returnQtys[item.saleItemId!] ?? 0) + 1) })}>+</button>
                        </div>
                      </td>
                      <td className="p-2">
                        <input type="checkbox" checked={restockFlags[item.saleItemId] ?? true}
                          onChange={(e) => setRestockFlags({ ...restockFlags, [item.saleItemId!]: e.target.checked })} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <label className="text-xs font-medium text-slate-500 uppercase">Step 3 — Reason & refund</label>
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for return *" className="w-full px-3 py-2 border rounded-lg" />
              <select value={refundMethod} onChange={(e) => setRefundMethod(e.target.value as typeof refundMethod)} className="w-full px-3 py-2 border rounded-lg">
                <option value="cash">Cash refund</option>
                <option value="store_credit">Store credit</option>
                <option value="loyalty">Loyalty points</option>
              </select>

              {refundPreview > 0 && (
                <div className="p-3 bg-green-50 border border-green-200 rounded-lg flex justify-between items-center">
                  <span className="font-medium text-green-800">Refund preview</span>
                  <span className="text-xl font-bold text-green-700">PKR {refundPreview.toFixed(2)}</span>
                </div>
              )}

              <Button onClick={handleSubmit} disabled={loading || refundPreview <= 0 || !reason.trim()}>
                {loading ? 'Processing…' : `Process Return — PKR ${refundPreview.toFixed(2)} (F4)`}
              </Button>
            </div>
          )}
        </div>

        {!isCashier && (
          <div className="panel">
            <h3 className="p-4 font-semibold border-b">
              Recent Returns
              <span className="text-sm font-normal text-slate-500 ml-2">
                ({startDate === endDate ? startDate : `${startDate} → ${endDate}`})
              </span>
            </h3>
            <table className="w-full text-sm">
              <thead className="table-head">
                <tr><th className="p-3 text-left">Return #</th><th className="p-3">Date</th><th className="p-3">Time</th><th className="p-3">Sale #</th><th className="p-3">Refund</th><th className="p-3">Method</th></tr>
              </thead>
              <tbody>
                {returns.length === 0 ? (
                  <tr><td colSpan={6} className="p-8 text-center text-slate-400">No returns for the selected date</td></tr>
                ) : returns.map((r) => (
                  <tr key={r.id} className="border-t">
                    <td className="p-3 font-mono">{r.returnNumber}</td>
                    <td className="p-3 text-slate-500 whitespace-nowrap text-xs">{formatDateOnly(r.createdAt)}</td>
                    <td className="p-3 text-slate-500 whitespace-nowrap text-xs">{formatTimeOnly(r.createdAt)}</td>
                    <td className="p-3">{r.saleNumber}</td>
                    <td className="p-3">PKR {r.totalRefund.toFixed(2)}</td>
                    <td className="p-3 capitalize">{r.refundMethod.replace('_', ' ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal open={!!successReturn} title="Return processed" onClose={() => setSuccessReturn(null)}
        footer={<Button onClick={() => { setSuccessReturn(null); focusElement(searchRef, true); }}>Process another return</Button>}
      >
        {successReturn && (
          <div className="text-center py-4">
            <div className="text-4xl mb-2">↩</div>
            <p className="font-mono text-lg">{successReturn.returnNumber}</p>
            <p className="text-sm text-slate-500 mt-1">{formatDateTime(successReturn.createdAt)}</p>
            <p className="text-2xl font-bold text-green-700 mt-2">PKR {successReturn.totalRefund.toFixed(2)}</p>
            <p className="text-sm text-slate-500 mt-1 capitalize">{successReturn.refundMethod.replace('_', ' ')} refund</p>
          </div>
        )}
      </Modal>

      <ReceiptSearchModal
        open={showReceiptSearch}
        onClose={() => setShowReceiptSearch(false)}
        onSelectReturn={(s) => selectSale(s)}
      />
    </div>
  );
}
