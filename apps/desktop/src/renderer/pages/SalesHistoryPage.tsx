import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@mama-babi/ui';
import { getApi } from '@renderer/lib/api';
import { SortableTh } from '@renderer/components/SortableTh';
import { sortByKey, useTableSort } from '@renderer/lib/useTableSort';
import { Modal, ModalActions } from '@renderer/components/Modal';
import { ProductSearchModal } from '@renderer/components/ProductSearchModal';
import { ReceiptPreview } from '@renderer/components/ReceiptPreview';
import { toast } from '@renderer/stores/toastStore';
import { useCartStore } from '@renderer/stores/cartStore';
import { formatDateOnly, formatTimeOnly, localCalendarDate } from '@shared/datetime';
import type { CartItem, Customer, Product, ReceiptPreview as ReceiptPreviewData, SaleSummary } from '@shared/types';

const api = getApi();

type SaleSortKey = 'sale' | 'status' | 'customer' | 'date' | 'time' | 'total';
type EditItemSortKey = 'item' | 'qty' | 'total';

const STATUS_FILTERS = [
  { value: 'completed', label: 'Completed' },
  { value: 'held', label: 'Held' },
  { value: 'voided', label: 'Voided' },
  { value: 'all', label: 'All' },
];

function shiftedDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return localCalendarDate(d);
}

const DATE_PRESETS = [
  { label: 'Today', range: () => ({ start: localCalendarDate(), end: localCalendarDate() }) },
  { label: '7 days', range: () => ({ start: shiftedDate(-6), end: localCalendarDate() }) },
  { label: '30 days', range: () => ({ start: shiftedDate(-29), end: localCalendarDate() }) },
];

const STATUS_BADGE: Record<string, string> = {
  completed: 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300',
  held: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  voided: 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
  returned: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300',
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_BADGE[status] ?? STATUS_BADGE.voided}`}>
      {status}
    </span>
  );
}

export function SalesHistoryPage() {
  const navigate = useNavigate();
  const restoreHeldSale = useCartStore((s) => s.restoreHeldSale);
  const loadSaleForEdit = useCartStore((s) => s.loadSaleForEdit);
  const [pendingEdit, setPendingEdit] = useState<SaleSummary | null>(null);
  const [sales, setSales] = useState<SaleSummary[]>([]);
  const [statusFilter, setStatusFilter] = useState('completed');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<SaleSummary | null>(null);
  const [voidId, setVoidId] = useState<string | null>(null);
  const [startDate, setStartDate] = useState(() => localCalendarDate());
  const [endDate, setEndDate] = useState(() => localCalendarDate());
  const [preview, setPreview] = useState<ReceiptPreviewData | null>(null);
  const [editItems, setEditItems] = useState<CartItem[]>([]);
  const [showProductSearch, setShowProductSearch] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [loading, setLoading] = useState(false);
  const { onSort, icon, sortKey, sortDir } = useTableSort<SaleSortKey>('date', 'desc');
  const { onSort: onEditSort, icon: editIcon, sortKey: editSortKey, sortDir: editSortDir } = useTableSort<EditItemSortKey>('item');

  const load = async () => {
    setLoading(true);
    const result = await api.sales.list({
      limit: 100,
      status: statusFilter === 'all' ? undefined : statusFilter,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      search: search || undefined,
    });
    setLoading(false);
    if (result.success) setSales(result.data ?? []);
  };

  useEffect(() => { load(); }, [statusFilter, startDate, endDate]);

  const filtered = sales.filter((s) =>
    !search || s.saleNumber.toLowerCase().includes(search.toLowerCase()),
  );

  const filteredTotal = useMemo(
    () => filtered.reduce((sum, s) => sum + (s.status === 'voided' ? 0 : s.totalAmount), 0),
    [filtered],
  );

  const sortedSales = useMemo(
    () => sortByKey(filtered, sortKey, sortDir, {
      sale: (s) => s.saleNumber,
      status: (s) => s.status,
      customer: (s) => s.customerName ?? '',
      date: (s) => s.createdAt,
      time: (s) => s.createdAt,
      total: (s) => s.totalAmount,
    }),
    [filtered, sortKey, sortDir],
  );

  const sortedEditItems = useMemo(
    () => sortByKey(editItems, editSortKey, editSortDir, {
      item: (i) => i.productName,
      qty: (i) => i.quantity,
      total: (i) => i.lineTotal,
    }),
    [editItems, editSortKey, editSortDir],
  );

  const editSubtotal = useMemo(
    () => editItems.reduce((sum, i) => sum + i.lineTotal, 0),
    [editItems],
  );

  const editTotal = useMemo(() => {
    if (!selected || selected.subtotal <= 0) return editSubtotal;
    return selected.totalAmount * (editSubtotal / selected.subtotal);
  }, [selected, editSubtotal]);

  const editDirty = useMemo(() => {
    if (!selected) return false;
    const original = selected.items.map((i) => `${i.productId}:${i.quantity}`).sort().join('|');
    const edited = editItems.map((i) => `${i.productId}:${i.quantity}`).sort().join('|');
    return original !== edited;
  }, [selected, editItems]);

  const displayPreview = useMemo((): ReceiptPreviewData | null => {
    if (!preview || !selected) return preview;
    if (!editDirty) return preview;
    const ratio = selected.subtotal > 0 ? editSubtotal / selected.subtotal : 1;
    return {
      ...preview,
      items: editItems.map((i) => ({
        name: i.productName,
        qty: i.quantity,
        unitPrice: i.unitPrice,
        lineTotal: i.lineTotal,
      })),
      subtotal: editSubtotal,
      discountAmount: selected.discountAmount * ratio,
      taxAmount: selected.taxAmount * ratio,
      totalAmount: editTotal,
      changeGiven:
        selected.paymentMethod === 'cash' && selected.amountTendered != null
          ? Math.max(0, selected.amountTendered - editTotal)
          : preview.changeGiven,
    };
  }, [preview, selected, editItems, editDirty, editSubtotal, editTotal]);

  const handleVoid = async () => {
    if (!voidId) return;
    const result = await api.sales.void(voidId);
    if (result.success) {
      toast.success(`Voided: ${result.data?.saleNumber}`);
      setVoidId(null);
      setSelected(null);
      setPreview(null);
      setEditItems([]);
      load();
    } else toast.error(result.error ?? 'Void failed');
  };

  const handleDiscardHeld = async (id: string) => {
    const result = await api.sales.discardHeld(id);
    if (result.success) {
      toast.info('Held sale discarded');
      setSelected(null);
      setEditItems([]);
      load();
    } else toast.error(result.error ?? 'Discard failed');
  };

  const handleReprint = async (id: string) => {
    const result = await api.print.receipt(id);
    if (result.success) toast.success('Receipt sent to printer');
    else toast.error(result.error ?? 'Print failed');
  };

  const viewDetail = async (id: string) => {
    const [saleResult, previewResult] = await Promise.all([
      api.sales.get(id),
      api.sales.receiptPreview(id),
    ]);
    if (saleResult.success && saleResult.data) {
      setSelected(saleResult.data);
      setEditItems(saleResult.data.items.map((i) => ({ ...i })));
    }
    if (previewResult.success) setPreview(previewResult.data ?? null);
  };

  const recalcLine = (item: CartItem, quantity: number): CartItem => {
    const lineTotal = item.unitPrice * quantity * (1 - item.discountPercent / 100);
    return { ...item, quantity, lineTotal };
  };

  const updateEditQty = (productId: string, quantity: number) => {
    if (quantity <= 0) {
      setEditItems((items) => items.filter((i) => i.productId !== productId));
      return;
    }
    setEditItems((items) =>
      items.map((i) => (i.productId === productId ? recalcLine(i, quantity) : i)),
    );
  };

  const addProductToEdit = (product: Product) => {
    setEditItems((items) => {
      const existing = items.find((i) => i.productId === product.id);
      if (existing) {
        return items.map((i) =>
          i.productId === product.id ? recalcLine(i, i.quantity + 1) : i,
        );
      }
      const unitPrice = product.salePrice ?? product.retailPrice;
      return [
        ...items,
        {
          productId: product.id,
          productName: product.name,
          productSku: product.sku,
          barcode: product.barcode ?? '',
          quantity: 1,
          unitPrice,
          discountPercent: 0,
          taxRate: product.taxRate,
          lineTotal: unitPrice,
        },
      ];
    });
    toast.success(`Added: ${product.name}`);
  };

  const handleUpdateSale = async () => {
    if (!selected || !editItems.length) {
      toast.warning('Add at least one item to the bill');
      return;
    }
    setUpdating(true);
    const result = await api.sales.update({
      saleId: selected.id,
      items: editItems.map((i) => ({
        productId: i.productId,
        quantity: i.quantity,
        discountPercent: i.discountPercent,
      })),
      customerId: selected.customerId ?? undefined,
      customerName: selected.customerName ?? undefined,
      customerPhone: selected.customerPhone ?? undefined,
      amountTendered: selected.amountTendered ?? undefined,
    });
    setUpdating(false);
    if (result.success && result.data) {
      await viewDetail(result.data.id);
      load();
      toast.success(`Sale ${result.data.saleNumber} updated — PKR ${result.data.totalAmount.toFixed(2)}`);
    } else {
      toast.error(result.error ?? 'Update failed');
    }
  };

  /** Opens a paid bill in Checkout so items can be added/removed, then settled by difference. */
  const openInCheckout = async (sale: SaleSummary) => {
    const full = await api.sales.get(sale.id);
    if (!full.success || !full.data) { toast.error('Could not load bill'); return; }
    let customer: Customer | null = null;
    if (full.data.customerId) {
      const c = await api.customers.get(full.data.customerId);
      if (c.success && c.data) customer = c.data;
    }
    loadSaleForEdit(full.data, customer);
    navigate('/checkout');
  };

  const handleEditInCheckout = (sale: SaleSummary) => {
    const cart = useCartStore.getState();
    // Loading a bill replaces the cart, so don't silently discard an in-progress sale.
    if (cart.items.length && cart.editingSale?.id !== sale.id) {
      setPendingEdit(sale);
      return;
    }
    void openInCheckout(sale);
  };

  const handleResumeHeld = async (sale: SaleSummary) => {
    const full = await api.sales.get(sale.id);
    if (!full.success || !full.data) { toast.error('Could not load held sale'); return; }
    let customer: Customer | null = null;
    if (full.data.customerId) {
      const c = await api.customers.get(full.data.customerId);
      if (c.success && c.data) customer = c.data;
    }
    restoreHeldSale(full.data, customer);
    toast.success(`Resuming ${full.data.heldKey ?? full.data.saleNumber}`);
    navigate('/checkout');
  };

  const startReturn = (saleNumber: string) => {
    navigate(`/returns?sale=${encodeURIComponent(saleNumber)}`);
  };

  return (
    <div className="page-shell">
      <div className="mb-4">
        <h2 className="text-2xl font-bold">Sales History</h2>
        <p className="text-sm text-slate-500">Click a bill to edit it in Checkout</p>
      </div>

      <div className="panel mb-4 p-4">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Status</label>
            <div className="flex gap-1">
              {STATUS_FILTERS.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => setStatusFilter(f.value)}
                  className={`rounded-lg px-3 py-2 text-sm font-medium ${
                    statusFilter === f.value
                      ? 'bg-primary-600 text-white'
                      : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Date range</label>
            <div className="flex items-center gap-2">
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900" />
              <span className="text-slate-400">→</span>
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900" />
              {DATE_PRESETS.map((p) => (
                <Button key={p.label} size="sm" variant="ghost" onClick={() => { const r = p.range(); setStartDate(r.start); setEndDate(r.end); }}>
                  {p.label}
                </Button>
              ))}
            </div>
          </div>

          <div className="ml-auto">
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Search</label>
            <input
              placeholder="Bill number…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && load()}
              className="w-56 rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
            />
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-4 border-t border-slate-100 pt-3 text-sm dark:border-slate-800">
          <span className="text-slate-500">
            <strong className="text-slate-800 dark:text-slate-100">{filtered.length}</strong> bills
          </span>
          <span className="text-slate-500">
            <strong className="text-slate-800 dark:text-slate-100">PKR {filteredTotal.toFixed(2)}</strong>
          </span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 panel max-h-[calc(100vh-320px)] overflow-auto">
          {loading ? (
            <div className="p-12 text-center text-slate-400">Loading sales…</div>
          ) : filtered.length === 0 ? (
            <div className="p-12 text-center">
              <p className="text-slate-500 font-medium">No bills match these filters</p>
              <Button className="mt-4" onClick={() => navigate('/checkout')}>Go to Checkout</Button>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="table-head sticky top-0 z-10">
                <tr>
                  <SortableTh label="Bill #" columnKey="sale" onSort={onSort} icon={icon} className="p-3" />
                  <SortableTh label="Status" columnKey="status" onSort={onSort} icon={icon} className="p-3" />
                  <SortableTh label="Customer" columnKey="customer" onSort={onSort} icon={icon} className="p-3" />
                  <SortableTh label="Date" columnKey="date" onSort={onSort} icon={icon} className="p-3" />
                  <SortableTh label="Time" columnKey="time" onSort={onSort} icon={icon} className="p-3" />
                  <SortableTh label="Total" columnKey="total" onSort={onSort} icon={icon} className="p-3" align="right" />
                  <th className="p-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedSales.map((s) => (
                  <tr
                    key={s.id}
                    className={`border-t cursor-pointer row-hover ${selected?.id === s.id ? 'row-active' : ''}`}
                    title={s.status === 'completed' ? 'Click to edit this bill in Checkout' : undefined}
                    onClick={() => {
                      if (s.status === 'completed') handleEditInCheckout(s);
                      else if (s.status === 'held') handleResumeHeld(s);
                      else viewDetail(s.id);
                    }}
                  >
                    <td className="p-3">
                      <div className="font-mono font-medium text-slate-900 dark:text-slate-100">{s.saleNumber}</div>
                      <div className="text-xs text-slate-400">{s.items.length} item(s) · {s.paymentMethod}</div>
                    </td>
                    <td className="p-3"><StatusBadge status={s.status} /></td>
                    <td className="p-3 text-slate-600 dark:text-slate-300">{s.customerName ?? '—'}</td>
                    <td className="p-3 text-slate-500 whitespace-nowrap">{formatDateOnly(s.createdAt)}</td>
                    <td className="p-3 text-slate-500 whitespace-nowrap">{formatTimeOnly(s.createdAt)}</td>
                    <td className="p-3 text-right font-semibold tabular-nums">PKR {s.totalAmount.toFixed(2)}</td>
                    <td className="p-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex gap-1 flex-wrap justify-end">
                        {s.status === 'completed' && (
                          <>
                            <Button size="sm" onClick={() => handleEditInCheckout(s)}>Edit</Button>
                            <Button variant="ghost" size="sm" onClick={() => viewDetail(s.id)}>Receipt</Button>
                            <Button variant="ghost" size="sm" onClick={() => handleReprint(s.id)}>Print</Button>
                            <Button variant="ghost" size="sm" onClick={() => startReturn(s.saleNumber)}>Return</Button>
                            <Button variant="danger" size="sm" onClick={() => setVoidId(s.id)}>Void</Button>
                          </>
                        )}
                        {s.status === 'held' && (
                          <>
                            <Button variant="secondary" size="sm" onClick={() => handleResumeHeld(s)}>Resume</Button>
                            <Button variant="danger" size="sm" onClick={() => handleDiscardHeld(s.id)}>Discard</Button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {selected ? (
          <div className="space-y-4">
            <div className="panel p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-mono text-lg font-semibold text-slate-900 dark:text-slate-100">{selected.saleNumber}</p>
                  <p className="text-xs text-slate-500">
                    {formatDateOnly(selected.createdAt)} {formatTimeOnly(selected.createdAt)} · {selected.cashierName}
                  </p>
                </div>
                <StatusBadge status={selected.status} />
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-y-1 text-sm">
                <dt className="text-slate-500">Customer</dt>
                <dd className="text-right">{selected.customerName ?? '—'}</dd>
                <dt className="text-slate-500">Payment</dt>
                <dd className="text-right capitalize">{selected.paymentMethod}</dd>
                <dt className="text-slate-500">Subtotal</dt>
                <dd className="text-right tabular-nums">PKR {selected.subtotal.toFixed(2)}</dd>
                {selected.discountAmount !== 0 && (
                  <>
                    <dt className="text-slate-500">{selected.discountAmount > 0 ? 'Discount' : 'Surcharge'}</dt>
                    <dd className={`text-right tabular-nums ${selected.discountAmount > 0 ? 'text-green-700' : 'text-amber-700'}`}>
                      {selected.discountAmount > 0 ? '-' : '+'} PKR {Math.abs(selected.discountAmount).toFixed(2)}
                    </dd>
                  </>
                )}
                {selected.discountReason && (
                  <dd className="col-span-2 text-xs text-slate-400">{selected.discountReason}</dd>
                )}
                <dt className="border-t border-slate-100 pt-1 font-semibold dark:border-slate-800">Total paid</dt>
                <dd className="border-t border-slate-100 pt-1 text-right font-bold text-primary-700 tabular-nums dark:border-slate-800 dark:text-primary-400">
                  PKR {selected.totalAmount.toFixed(2)}
                </dd>
              </dl>
            </div>

            {displayPreview && (
              <div>
                {editDirty && selected.status === 'completed' && (
                  <p className="text-xs text-amber-600 text-center mb-2">Draft receipt — press Update Sale to save</p>
                )}
                <ReceiptPreview data={displayPreview} />
              </div>
            )}

            {selected.status === 'completed' && (
              <div className="panel p-4 space-y-3">
                <div className="flex justify-between items-center">
                  <label className="text-xs font-medium text-slate-500 uppercase">Quick item edit</label>
                  <Button size="sm" variant="secondary" onClick={() => setShowProductSearch(true)}>Add product</Button>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-slate-500 border-b">
                      <SortableTh label="Item" columnKey="item" onSort={onEditSort} icon={editIcon} className="p-1.5" />
                      <SortableTh label="Qty" columnKey="qty" onSort={onEditSort} icon={editIcon} className="p-1.5" />
                      <SortableTh label="Total" columnKey="total" onSort={onEditSort} icon={editIcon} className="p-1.5" align="right" />
                    </tr>
                  </thead>
                  <tbody>
                    {sortedEditItems.map((item) => (
                      <tr key={item.productId} className="border-t">
                        <td className="p-1.5">{item.productName}</td>
                        <td className="p-1.5">
                          <div className="flex items-center gap-1">
                            <button type="button" className="w-7 h-7 rounded bg-slate-100 text-sm" onClick={() => updateEditQty(item.productId, item.quantity - 1)}>-</button>
                            <span className="w-5 text-center text-sm">{item.quantity}</span>
                            <button type="button" className="w-7 h-7 rounded bg-slate-100 text-sm" onClick={() => updateEditQty(item.productId, item.quantity + 1)}>+</button>
                          </div>
                        </td>
                        <td className="p-1.5 text-right">PKR {item.lineTotal.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="flex justify-between items-center p-2 bg-blue-50 border border-blue-200 rounded-lg text-sm">
                  <span className="font-medium text-blue-900">Bill total</span>
                  <span className="font-bold text-blue-800">PKR {(editDirty ? editTotal : selected.totalAmount).toFixed(2)}</span>
                </div>
                <Button onClick={handleUpdateSale} disabled={updating || !editDirty || !editItems.length} className="w-full">
                  {updating ? 'Updating…' : 'Update Sale'}
                </Button>
              </div>
            )}

            <div className="flex flex-col gap-2">
              {selected.status === 'completed' && (
                <>
                  <Button size="sm" onClick={() => handleEditInCheckout(selected)}>Edit in Checkout</Button>
                  <Button size="sm" variant="secondary" onClick={() => startReturn(selected.saleNumber)}>Process Return</Button>
                  <Button size="sm" variant="secondary" onClick={() => handleReprint(selected.id)}>Reprint Receipt</Button>
                </>
              )}
              {selected.status === 'held' && (
                <Button size="sm" onClick={() => handleResumeHeld(selected)}>Resume in Checkout</Button>
              )}
            </div>
          </div>
        ) : (
          <div className="bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-dashed p-6 text-center text-slate-400 text-sm">
            Select a bill to preview its receipt
          </div>
        )}
      </div>

      <Modal open={!!voidId} title="Void sale" onClose={() => setVoidId(null)}
        footer={<ModalActions onCancel={() => setVoidId(null)} onConfirm={handleVoid} confirmLabel="Void sale" confirmVariant="danger" />}
      >
        <p className="text-slate-600">This cannot be undone. Manager role required.</p>
      </Modal>

      <Modal open={!!pendingEdit} title="Replace current cart?" onClose={() => setPendingEdit(null)}
        footer={
          <ModalActions
            onCancel={() => setPendingEdit(null)}
            onConfirm={() => {
              const sale = pendingEdit;
              setPendingEdit(null);
              if (sale) void openInCheckout(sale);
            }}
            confirmLabel="Open bill"
          />
        }
      >
        <p className="text-slate-600">
          Checkout has an unsaved cart. Opening bill {pendingEdit?.saleNumber} will replace it.
        </p>
      </Modal>

      <ProductSearchModal
        open={showProductSearch}
        onClose={() => setShowProductSearch(false)}
        onSelect={addProductToEdit}
      />
    </div>
  );
}
