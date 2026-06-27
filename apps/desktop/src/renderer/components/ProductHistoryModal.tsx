import { useEffect, useMemo, useState } from 'react';
import { Button } from '@mama-babi/ui';
import { getApi } from '@renderer/lib/api';
import { SortableTh } from '@renderer/components/SortableTh';
import { sortByKey, useTableSort } from '@renderer/lib/useTableSort';
import { Modal } from './Modal';
import { formatDateTime } from '@shared/datetime';
import type { ProductHistory } from '@shared/types';

const api = getApi();

type HistoryTab = 'sales' | 'purchases';
type SalesHistSortKey = 'date' | 'qty' | 'price' | 'receipt';
type PurchaseHistSortKey = 'date' | 'supplier' | 'grn' | 'cost' | 'qty';

interface Props {
  open: boolean;
  productId: string | null;
  productName: string;
  onClose: () => void;
}

export function ProductHistoryModal({ open, productId, productName, onClose }: Props) {
  const [history, setHistory] = useState<ProductHistory | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<HistoryTab>('sales');
  const { onSort: onSalesSort, icon: salesIcon, sortKey: salesSortKey, sortDir: salesSortDir } = useTableSort<SalesHistSortKey>('date', 'desc');
  const { onSort: onPurchaseSort, icon: purchaseIcon, sortKey: purchaseSortKey, sortDir: purchaseSortDir } = useTableSort<PurchaseHistSortKey>('date', 'desc');

  const sortedSales = useMemo(
    () => (history ? sortByKey(history.sales, salesSortKey, salesSortDir, {
      date: (e) => e.date,
      qty: (e) => e.qty,
      price: (e) => e.unitCostOrPrice,
      receipt: (e) => e.reference ?? '',
    }) : []),
    [history, salesSortKey, salesSortDir],
  );

  const sortedPurchases = useMemo(
    () => (history ? sortByKey(history.purchases, purchaseSortKey, purchaseSortDir, {
      date: (e) => e.date,
      supplier: (e) => e.vendorOrCustomer ?? '',
      grn: (e) => e.reference,
      cost: (e) => e.unitCostOrPrice,
      qty: (e) => e.qty,
    }) : []),
    [history, purchaseSortKey, purchaseSortDir],
  );

  useEffect(() => {
    if (!open || !productId) {
      setHistory(null);
      setError(null);
      setActiveTab('sales');
      return;
    }
    setLoading(true);
    setError(null);
    setActiveTab('sales');
    api.products.history(productId).then((r) => {
      setLoading(false);
      if (r.success && r.data) setHistory(r.data);
      else setError(r.error ?? 'Could not load product history');
    });
  }, [open, productId]);

  return (
    <Modal
      open={open}
      title={productName || 'Product history'}
      onClose={onClose}
      size="xl"
      footer={<Button variant="ghost" onClick={onClose}>Close</Button>}
    >
      {loading && <p className="text-slate-500 text-center py-8">Loading history…</p>}
      {error && <p className="text-red-600 text-center py-8">{error}</p>}
      {!loading && !error && history && (
        <div>
          <div className="flex gap-2 mb-4">
            {(['sales', 'purchases'] as HistoryTab[]).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2 rounded-lg text-sm font-medium capitalize ${
                  activeTab === tab ? 'bg-primary-100 text-primary-800' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {tab === 'sales' ? 'Sales' : 'Purchases'}
                <span className="ml-1.5 text-xs opacity-70">
                  ({tab === 'sales' ? history.sales.length : history.purchases.length})
                </span>
              </button>
            ))}
          </div>

          {activeTab === 'sales' && (
            history.sales.length === 0 ? (
              <p className="text-sm text-slate-400 py-8 text-center">No sales recorded for this product.</p>
            ) : (
              <div className="border rounded-lg overflow-hidden max-h-64 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 sticky top-0">
                    <tr className="text-left text-slate-500">
                      <SortableTh label="Sale date & time" columnKey="date" onSort={onSalesSort} icon={salesIcon} className="p-2" />
                      <SortableTh label="Qty sold" columnKey="qty" onSort={onSalesSort} icon={salesIcon} className="p-2" align="right" />
                      <SortableTh label="Selling price" columnKey="price" onSort={onSalesSort} icon={salesIcon} className="p-2" align="right" />
                      <SortableTh label="Receipt #" columnKey="receipt" onSort={onSalesSort} icon={salesIcon} className="p-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {sortedSales.map((e, i) => (
                      <tr key={i} className="border-t border-slate-100">
                        <td className="p-2 whitespace-nowrap">{formatDateTime(e.date)}</td>
                        <td className="p-2 text-right">{e.qty}</td>
                        <td className="p-2 text-right">PKR {e.unitCostOrPrice.toFixed(2)}</td>
                        <td className="p-2 font-mono text-xs">{e.reference || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}

          {activeTab === 'purchases' && (
            history.purchases.length === 0 ? (
              <p className="text-sm text-slate-400 py-8 text-center">No GRN purchases recorded for this product.</p>
            ) : (
              <div className="border rounded-lg overflow-hidden max-h-64 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 sticky top-0">
                    <tr className="text-left text-slate-500">
                      <SortableTh label="Purchase date & time" columnKey="date" onSort={onPurchaseSort} icon={purchaseIcon} className="p-2" />
                      <SortableTh label="Supplier" columnKey="supplier" onSort={onPurchaseSort} icon={purchaseIcon} className="p-2" />
                      <SortableTh label="GRN #" columnKey="grn" onSort={onPurchaseSort} icon={purchaseIcon} className="p-2" />
                      <SortableTh label="Cost price" columnKey="cost" onSort={onPurchaseSort} icon={purchaseIcon} className="p-2" align="right" />
                      <SortableTh label="Qty" columnKey="qty" onSort={onPurchaseSort} icon={purchaseIcon} className="p-2" align="right" />
                    </tr>
                  </thead>
                  <tbody>
                    {sortedPurchases.map((e, i) => (
                      <tr key={i} className="border-t border-slate-100">
                        <td className="p-2 whitespace-nowrap">{formatDateTime(e.date)}</td>
                        <td className="p-2">{e.vendorOrCustomer ?? '—'}</td>
                        <td className="p-2 font-mono text-xs">{e.reference}</td>
                        <td className="p-2 text-right">PKR {e.unitCostOrPrice.toFixed(2)}</td>
                        <td className="p-2 text-right">{e.qty}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}
        </div>
      )}
    </Modal>
  );
}
