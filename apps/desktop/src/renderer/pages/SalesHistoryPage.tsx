import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@mama-babi/ui';
import { getApi } from '@renderer/lib/api';
import { Modal, ModalActions } from '@renderer/components/Modal';
import { ProductSearchModal } from '@renderer/components/ProductSearchModal';
import { ReceiptPreview } from '@renderer/components/ReceiptPreview';
import { toast } from '@renderer/stores/toastStore';
import { useCartStore } from '@renderer/stores/cartStore';
import { formatDateOnly, formatTimeOnly, localCalendarDate } from '@shared/datetime';
import type { CartItem, Customer, Product, ReceiptPreview as ReceiptPreviewData, SaleSummary } from '@shared/types';

const api = getApi();

export function SalesHistoryPage() {
  const navigate = useNavigate();
  const restoreHeldSale = useCartStore((s) => s.restoreHeldSale);
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
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-2xl font-bold">Sales History</h2>
          <p className="text-sm text-slate-500">Select a sale to view receipt, edit bill, or process a return</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="px-3 py-2 border rounded-lg text-sm" />
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="px-3 py-2 border rounded-lg text-sm" />
          <input placeholder="Search sale #…" value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} className="px-3 py-2 border rounded-lg text-sm w-48" />
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="px-3 py-2 border rounded-lg text-sm">
            <option value="completed">Completed</option>
            <option value="held">Held</option>
            <option value="voided">Voided</option>
            <option value="all">All</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 panel overflow-hidden">
          {loading ? (
            <div className="p-12 text-center text-slate-400">Loading sales…</div>
          ) : filtered.length === 0 ? (
            <div className="p-12 text-center">
              <p className="text-slate-500 font-medium">No sales found for the selected date</p>
              <p className="text-sm text-slate-400 mt-2">Change the date range above or complete a sale in Checkout</p>
              <Button className="mt-4" onClick={() => navigate('/checkout')}>Go to Checkout</Button>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="table-head">
                <tr>
                  <th className="p-3 text-left">Sale #</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Customer</th>
                  <th className="p-3">Date</th>
                  <th className="p-3">Time</th>
                  <th className="p-3 text-right">Total</th>
                  <th className="p-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => (
                  <tr key={s.id} className={`border-t cursor-pointer row-hover ${selected?.id === s.id ? 'row-active' : ''}`} onClick={() => viewDetail(s.id)}>
                    <td className="p-3 font-mono">{s.saleNumber}</td>
                    <td className="p-3 capitalize">{s.status}</td>
                    <td className="p-3 text-slate-600">{s.customerName ?? '—'}</td>
                    <td className="p-3 text-slate-500 whitespace-nowrap">{formatDateOnly(s.createdAt)}</td>
                    <td className="p-3 text-slate-500 whitespace-nowrap">{formatTimeOnly(s.createdAt)}</td>
                    <td className="p-3 text-right font-semibold">PKR {s.totalAmount.toFixed(2)}</td>
                    <td className="p-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex gap-1 flex-wrap">
                        {s.status === 'completed' && (
                          <>
                            <Button variant="ghost" size="sm" onClick={() => viewDetail(s.id)}>Edit</Button>
                            <Button variant="ghost" size="sm" onClick={() => handleReprint(s.id)}>Print</Button>
                            <Button variant="secondary" size="sm" onClick={() => startReturn(s.saleNumber)}>Return</Button>
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
                  <label className="text-xs font-medium text-slate-500 uppercase">Edit bill</label>
                  <Button size="sm" variant="secondary" onClick={() => setShowProductSearch(true)}>Add product</Button>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-slate-500 border-b">
                      <th className="p-1.5">Item</th>
                      <th className="p-1.5">Qty</th>
                      <th className="p-1.5 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {editItems.map((item) => (
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
            Select a sale to view receipt and edit the bill
          </div>
        )}
      </div>

      <Modal open={!!voidId} title="Void sale" onClose={() => setVoidId(null)}
        footer={<ModalActions onCancel={() => setVoidId(null)} onConfirm={handleVoid} confirmLabel="Void sale" confirmVariant="danger" />}
      >
        <p className="text-slate-600">This cannot be undone. Manager role required.</p>
      </Modal>

      <ProductSearchModal
        open={showProductSearch}
        onClose={() => setShowProductSearch(false)}
        onSelect={addProductToEdit}
      />
    </div>
  );
}
