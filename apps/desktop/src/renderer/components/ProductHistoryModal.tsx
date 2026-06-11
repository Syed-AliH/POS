import { useEffect, useState } from 'react';
import { Button } from '@mama-babi/ui';
import { getApi } from '@renderer/lib/api';
import { Modal } from './Modal';
import { formatDateTime } from '@shared/datetime';
import type { ProductHistory } from '@shared/types';

const api = getApi();

type HistoryTab = 'sales' | 'purchases';

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
                  activeTab === tab ? 'bg-pink-100 text-pink-800' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
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
                      <th className="p-2">Sale date & time</th>
                      <th className="p-2 text-right">Qty sold</th>
                      <th className="p-2 text-right">Selling price</th>
                      <th className="p-2">Receipt #</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.sales.map((e, i) => (
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
                      <th className="p-2">Purchase date & time</th>
                      <th className="p-2">Supplier</th>
                      <th className="p-2">GRN #</th>
                      <th className="p-2 text-right">Cost price</th>
                      <th className="p-2 text-right">Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.purchases.map((e, i) => (
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
