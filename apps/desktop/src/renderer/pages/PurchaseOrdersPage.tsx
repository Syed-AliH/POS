import { useEffect, useState } from 'react';
import { Button } from '@mama-babi/ui';
import { getApi } from '@renderer/lib/api';
import type { Product, PurchaseOrderSummary, ReorderSuggestion, Vendor } from '@shared/types';

const api = getApi();

interface PoLine {
  productId: string;
  productName: string;
  qtyOrdered: number;
  unitCost: number;
}

export function PurchaseOrdersPage() {
  const [orders, setOrders] = useState<PurchaseOrderSummary[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [suggestions, setSuggestions] = useState<ReorderSuggestion[]>([]);
  const [vendorId, setVendorId] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<PoLine[]>([]);
  const [selectedPo, setSelectedPo] = useState<PurchaseOrderSummary | null>(null);
  const [receiveQty, setReceiveQty] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');

  const load = async () => {
    const [o, v, p, s] = await Promise.all([
      api.purchaseOrders.list(),
      api.vendors.list(),
      api.products.list(),
      api.purchaseOrders.reorderSuggestions(),
    ]);
    if (o.success) setOrders(o.data ?? []);
    if (v.success) setVendors(v.data ?? []);
    if (p.success) setProducts(p.data ?? []);
    if (s.success) setSuggestions(s.data ?? []);
  };

  useEffect(() => { load(); }, []);

  const addLine = (product: Product, qty = 1, unitCost?: number) => {
    setLines((prev) => {
      const existing = prev.find((l) => l.productId === product.id);
      if (existing) {
        return prev.map((l) =>
          l.productId === product.id ? { ...l, qtyOrdered: l.qtyOrdered + qty } : l,
        );
      }
      return [
        ...prev,
        {
          productId: product.id,
          productName: product.name,
          qtyOrdered: qty,
          unitCost: unitCost ?? product.costPrice,
        },
      ];
    });
  };

  const createFromSuggestions = (vendorFilter?: string) => {
    const filtered = vendorFilter
      ? suggestions.filter((s) => s.vendorId === vendorFilter)
      : suggestions;
    if (!filtered.length) return;
    const vid = vendorFilter ?? filtered[0].vendorId ?? '';
    if (vid) setVendorId(vid);
    setLines(
      filtered.map((s) => ({
        productId: s.productId,
        productName: s.productName,
        qtyOrdered: s.reorderQty,
        unitCost: s.costPrice,
      })),
    );
    setMessage(`Added ${filtered.length} items from reorder suggestions`);
  };

  const handleCreatePo = async () => {
    if (!vendorId || !lines.length) return;
    const result = await api.purchaseOrders.create({
      vendorId,
      notes: notes || undefined,
      items: lines.map((l) => ({
        productId: l.productId,
        qtyOrdered: l.qtyOrdered,
        unitCost: l.unitCost,
      })),
    });
    if (result.success) {
      setMessage(`PO created: ${result.data?.poNumber}`);
      setLines([]);
      setNotes('');
      load();
    } else {
      setMessage(result.error ?? 'Create failed');
    }
  };

  const handleSend = async (id: string) => {
    const result = await api.purchaseOrders.updateStatus(id, 'sent');
    if (result.success) {
      setMessage(`PO sent: ${result.data?.poNumber}`);
      load();
      if (selectedPo?.id === id) setSelectedPo(result.data ?? null);
    } else {
      setMessage(result.error ?? 'Send failed');
    }
  };

  const handleReceive = async () => {
    if (!selectedPo) return;
    const items = selectedPo.items
      .map((item) => ({
        poItemId: item.id,
        qtyReceived: parseInt(receiveQty[item.id] || '0', 10),
      }))
      .filter((i) => i.qtyReceived > 0);
    if (!items.length) return;

    const result = await api.purchaseOrders.receive({ poId: selectedPo.id, items });
    if (result.success) {
      setMessage(`Received stock for ${result.data?.poNumber}`);
      setSelectedPo(result.data ?? null);
      setReceiveQty({});
      load();
    } else {
      setMessage(result.error ?? 'Receive failed');
    }
  };

  return (
    <div className="page-shell">
      <h2 className="page-title mb-6">Purchase Orders</h2>
      {message && <div className="mb-4 p-3 bg-blue-50 rounded-lg text-sm">{message}</div>}

      <div className="grid grid-cols-2 gap-6 mb-6">
        <div className="panel p-4">
          <div className="flex justify-between items-center mb-3">
            <h3 className="font-semibold">Reorder Suggestions ({suggestions.length})</h3>
            <Button size="sm" variant="secondary" onClick={() => createFromSuggestions()}>Use All</Button>
          </div>
          <div className="max-h-40 overflow-y-auto space-y-1 text-sm">
            {suggestions.map((s) => (
              <div key={s.productId} className="flex justify-between p-2 bg-red-50 rounded">
                <span>{s.productName}</span>
                <span>Need {s.reorderQty} · {s.vendorName ?? 'No vendor'}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="panel p-4 space-y-3">
          <h3 className="font-semibold">Create PO</h3>
          <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} className="w-full px-3 py-2 border rounded-lg">
            <option value="">Select vendor</option>
            {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
          <select
            onChange={(e) => {
              const p = products.find((x) => x.id === e.target.value);
              if (p) addLine(p);
              e.target.value = '';
            }}
            className="w-full px-3 py-2 border rounded-lg"
          >
            <option value="">Add product...</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.name} (stock: {p.stockQty})</option>)}
          </select>
          {lines.map((l) => (
            <div key={l.productId} className="flex gap-2 items-center text-sm">
              <span className="flex-1">{l.productName}</span>
              <input
                type="number"
                value={l.qtyOrdered}
                onChange={(e) =>
                  setLines((prev) =>
                    prev.map((x) =>
                      x.productId === l.productId ? { ...x, qtyOrdered: parseInt(e.target.value, 10) || 0 } : x,
                    ),
                  )
                }
                className="w-16 px-2 py-1 border rounded"
              />
              <input
                type="number"
                value={l.unitCost}
                onChange={(e) =>
                  setLines((prev) =>
                    prev.map((x) =>
                      x.productId === l.productId ? { ...x, unitCost: parseFloat(e.target.value) || 0 } : x,
                    ),
                  )
                }
                className="w-20 px-2 py-1 border rounded"
              />
              <button className="text-red-500" onClick={() => setLines((prev) => prev.filter((x) => x.productId !== l.productId))}>×</button>
            </div>
          ))}
          <input placeholder="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full px-3 py-2 border rounded-lg" />
          <Button onClick={handleCreatePo} disabled={!vendorId || !lines.length}>Create Draft PO</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div className="panel p-4">
          <h3 className="font-semibold mb-3">PO List</h3>
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {orders.map((po) => (
              <button
                key={po.id}
                onClick={() => { setSelectedPo(po); setReceiveQty({}); }}
                className={`w-full text-left p-3 border rounded-lg ${selectedPo?.id === po.id ? 'bg-primary-50 border-primary-300' : 'hover:bg-slate-50'}`}
              >
                <div className="flex justify-between">
                  <span className="font-medium">{po.poNumber}</span>
                  <span className="text-xs px-2 py-0.5 rounded bg-slate-100">{po.status}</span>
                </div>
                <div className="text-sm text-slate-500">{po.vendorName} · PKR {po.totalCost.toFixed(2)}</div>
              </button>
            ))}
          </div>
        </div>

        {selectedPo && (
          <div className="panel p-4">
            <div className="flex justify-between items-start mb-3">
              <div>
                <h3 className="font-semibold">{selectedPo.poNumber}</h3>
                <p className="text-sm text-slate-500">{selectedPo.vendorName} · {selectedPo.status}</p>
              </div>
              <div className="flex gap-2">
                {selectedPo.status === 'draft' && (
                  <Button size="sm" onClick={() => handleSend(selectedPo.id)}>Mark Sent</Button>
                )}
                {(selectedPo.status === 'draft' || selectedPo.status === 'sent') && (
                  <Button size="sm" variant="danger" onClick={async () => {
                    const r = await api.purchaseOrders.updateStatus(selectedPo.id, 'cancelled');
                    if (r.success) { setMessage('PO cancelled'); setSelectedPo(r.data ?? null); load(); }
                    else setMessage(r.error ?? 'Cancel failed');
                  }}>Cancel</Button>
                )}
              </div>
            </div>
            <div className="space-y-2 mb-4">
              {selectedPo.items.map((item) => (
                <div key={item.id} className="flex justify-between text-sm p-2 bg-slate-50 rounded">
                  <span>{item.productName}</span>
                  <span>{item.qtyReceived}/{item.qtyOrdered} @ {item.unitCost.toFixed(2)}</span>
                </div>
              ))}
            </div>
            {(selectedPo.status === 'sent' || selectedPo.status === 'partially_received') && (
              <div className="border-t pt-4 space-y-2">
                <h4 className="font-medium text-sm">Receive Stock</h4>
                {selectedPo.items
                  .filter((i) => i.qtyReceived < i.qtyOrdered)
                  .map((item) => (
                    <div key={item.id} className="flex gap-2 items-center text-sm">
                      <span className="flex-1">{item.productName}</span>
                      <span className="text-slate-400">max {item.qtyOrdered - item.qtyReceived}</span>
                      <input
                        type="number"
                        placeholder="Qty"
                        value={receiveQty[item.id] ?? ''}
                        onChange={(e) => setReceiveQty({ ...receiveQty, [item.id]: e.target.value })}
                        className="w-20 px-2 py-1 border rounded"
                      />
                    </div>
                  ))}
                <Button onClick={handleReceive}>Receive</Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
