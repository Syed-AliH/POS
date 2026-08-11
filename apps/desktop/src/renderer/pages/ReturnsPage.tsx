import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@mama-babi/ui';
import { getApi } from '@renderer/lib/api';
import { SortableTh } from '@renderer/components/SortableTh';
import { sortByKey, useTableSort } from '@renderer/lib/useTableSort';
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
type SaleLookupSortKey = 'sale' | 'date' | 'time' | 'amount' | 'customer' | 'phone';
type ReturnItemSortKey = 'item' | 'sold' | 'returnQty' | 'restock';
type ReturnHistorySortKey = 'returnNum' | 'date' | 'time' | 'sale' | 'refund' | 'method';

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

  const [lookupMode, setLookupMode] = useState<LookupMode>('saleNumber');
  const [searchQuery, setSearchQuery] = useState('');
  const [sale, setSale] = useState<SaleSummary | null>(null);
  const [allSales, setAllSales] = useState<SaleSummary[]>([]);
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
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 6);
    return localCalendarDate(d);
  });
  const [endDate, setEndDate] = useState(() => localCalendarDate());
  const searchRef = useRef<HTMLInputElement>(null);
  const submitRef = useRef<() => void>(() => undefined);
  const { onSort: onSaleSort, icon: saleSortIcon, sortKey: saleSortKey, sortDir: saleSortDir } = useTableSort<SaleLookupSortKey>('date', 'desc');
  const { onSort: onItemSort, icon: itemSortIcon, sortKey: itemSortKey, sortDir: itemSortDir } = useTableSort<ReturnItemSortKey>('item');
  const { onSort: onReturnSort, icon: returnSortIcon, sortKey: returnSortKey, sortDir: returnSortDir } = useTableSort<ReturnHistorySortKey>('date', 'desc');

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

  const sortedFilteredSales = useMemo(
    () => sortByKey(filteredSales, saleSortKey, saleSortDir, {
      sale: (s) => s.saleNumber,
      date: (s) => s.createdAt,
      time: (s) => s.createdAt,
      amount: (s) => s.totalAmount,
      customer: (s) => s.customerName ?? '',
      phone: (s) => s.customerPhone ?? '',
    }),
    [filteredSales, saleSortKey, saleSortDir],
  );

  const sortedReturnItems = useMemo(() => {
    if (!sale) return [];
    const items = sale.items.filter((i) => i.saleItemId);
    return sortByKey(items, itemSortKey, itemSortDir, {
      item: (i) => i.productName,
      sold: (i) => i.quantity,
      returnQty: (i) => returnQtys[i.saleItemId!] ?? 0,
      restock: (i) => (restockFlags[i.saleItemId!] ?? true) ? 1 : 0,
    });
  }, [sale, itemSortKey, itemSortDir, returnQtys, restockFlags]);

  const sortedReturns = useMemo(
    () => sortByKey(returns, returnSortKey, returnSortDir, {
      returnNum: (r) => r.returnNumber,
      date: (r) => r.createdAt,
      time: (r) => r.createdAt,
      sale: (r) => r.saleNumber,
      refund: (r) => r.totalRefund,
      method: (r) => r.refundMethod,
    }),
    [returns, returnSortKey, returnSortDir],
  );

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
      await loadAllSales();
      return;
    }

    if (lookupMode === 'saleNumber') {
      setLoading(true);
      const result = await api.sales.lookup(q);
      setLoading(false);
      if (result.success && result.data) {
        await selectSale(result.data);
      } else {
        toast.error(result.error ?? 'Sale not found');
      }
      return;
    }

    // Name/phone search uses API (sale # is handled above)
    if (lookupMode !== 'saleNumber') {
      setLoading(true);
      const result = await api.sales.list({
        status: 'completed',
        limit: 50,
        search: q,
        startDate,
        endDate,
      });
      setLoading(false);
      if (result.success) {
        const matches = result.data ?? [];
        setAllSales(matches);
        if (matches.length === 1) {
          await selectSale(matches[0]);
        } else if (!matches.length) {
          toast.error('No matching sales found');
        } else {
          toast.info(`${matches.length} sales match — click a row to select`);
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
    focusElement(searchRef, true);
  };

  return (
    <div className="h-full flex flex-col">
      <WorkflowStepper steps={STEPS} currentStep={workflowStep} />

      <div className="flex-1 overflow-y-auto p-6">
        <div className="flex justify-between items-center mb-6 flex-wrap gap-3">
          <div>
            {/* Reached from a bill in Sales History rather than the sidebar. */}
            <button
              type="button"
              onClick={() => navigate('/sales')}
              className="mb-1 text-sm font-medium text-primary-700 hover:underline dark:text-primary-400"
            >
              ← Back to Sales History
            </button>
            <h2 className="text-2xl font-bold">Returns</h2>
            <p className="text-sm text-slate-500">Return policy: {returnPolicyDays} days from purchase</p>
          </div>
          <div className="flex gap-2 items-center flex-wrap">
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="px-3 py-2 border rounded-lg text-sm" />
            <span className="text-slate-400 text-sm">to</span>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="px-3 py-2 border rounded-lg text-sm" />
          </div>
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

            {!sale && (
              <div className="flex-1 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="table-head">
                    <tr className="text-left border-b">
                      <SortableTh label="Sale #" columnKey="sale" onSort={onSaleSort} icon={saleSortIcon} className="p-2 pl-3" />
                      <SortableTh label="Date" columnKey="date" onSort={onSaleSort} icon={saleSortIcon} className="p-2" />
                      <SortableTh label="Time" columnKey="time" onSort={onSaleSort} icon={saleSortIcon} className="p-2" />
                      <SortableTh label="Amount" columnKey="amount" onSort={onSaleSort} icon={saleSortIcon} className="p-2" align="right" />
                      <SortableTh label="Customer" columnKey="customer" onSort={onSaleSort} icon={saleSortIcon} className="p-2" />
                      <SortableTh label="Phone" columnKey="phone" onSort={onSaleSort} icon={saleSortIcon} className="p-2 pr-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {sortedFilteredSales.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="p-8 text-center text-slate-400">
                          {loading
                            ? 'Loading sales…'
                            : 'No sales found — try a different date range or search'}
                        </td>
                      </tr>
                    ) : sortedFilteredSales.map((row) => (
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
                {sortedFilteredSales.length > 0 && (
                  <p className="text-xs text-slate-400 px-3 py-2 border-t">
                    {sortedFilteredSales.length} sale{sortedFilteredSales.length !== 1 ? 's' : ''}
                    {searchQuery.trim() ? ' matching filter' : ` for ${startDate === endDate ? startDate : `${startDate} → ${endDate}`}`}
                    {' '}— click a row to view receipt
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
                    <SortableTh label="Item" columnKey="item" onSort={onItemSort} icon={itemSortIcon} className="p-2" />
                    <SortableTh label="Sold" columnKey="sold" onSort={onItemSort} icon={itemSortIcon} className="p-2" />
                    <SortableTh label="Return qty" columnKey="returnQty" onSort={onItemSort} icon={itemSortIcon} className="p-2" />
                    <SortableTh label="Restock" columnKey="restock" onSort={onItemSort} icon={itemSortIcon} className="p-2" />
                  </tr>
                </thead>
                <tbody>
                  {sortedReturnItems.map((item) => item.saleItemId && (
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

        <div className="panel">
            <h3 className="p-4 font-semibold border-b">
              Recent Returns
              <span className="text-sm font-normal text-slate-500 ml-2">
                ({startDate === endDate ? startDate : `${startDate} → ${endDate}`})
              </span>
            </h3>
            <table className="w-full text-sm">
              <thead className="table-head">
                <tr>
                  <SortableTh label="Return #" columnKey="returnNum" onSort={onReturnSort} icon={returnSortIcon} className="p-3" />
                  <SortableTh label="Date" columnKey="date" onSort={onReturnSort} icon={returnSortIcon} className="p-3" />
                  <SortableTh label="Time" columnKey="time" onSort={onReturnSort} icon={returnSortIcon} className="p-3" />
                  <SortableTh label="Sale #" columnKey="sale" onSort={onReturnSort} icon={returnSortIcon} className="p-3" />
                  <SortableTh label="Refund" columnKey="refund" onSort={onReturnSort} icon={returnSortIcon} className="p-3" />
                  <SortableTh label="Method" columnKey="method" onSort={onReturnSort} icon={returnSortIcon} className="p-3" />
                </tr>
              </thead>
              <tbody>
                {sortedReturns.length === 0 ? (
                  <tr><td colSpan={6} className="p-8 text-center text-slate-400">No returns for the selected date</td></tr>
                ) : sortedReturns.map((r) => (
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
