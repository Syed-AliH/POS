import { useEffect, useState } from 'react';
import { Button } from '@mama-babi/ui';
import { getApi } from '@renderer/lib/api';
import { formatDateTime } from '@shared/datetime';
import type { StocktakeSession } from '@shared/types';

const api = getApi();

export function StocktakePage() {
  const [session, setSession] = useState<StocktakeSession | null>(null);
  const [history, setHistory] = useState<StocktakeSession[]>([]);
  const [search, setSearch] = useState('');
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');

  const load = async () => {
    const [current, list] = await Promise.all([api.stocktake.current(), api.stocktake.list(10)]);
    if (current.success) setSession(current.data ?? null);
    if (list.success) setHistory(list.data ?? []);
  };

  useEffect(() => { load(); }, []);

  const handleStart = async () => {
    const result = await api.stocktake.start();
    if (result.success) {
      setMessage('Stocktake started');
      setSession(result.data ?? null);
      load();
    } else setMessage(result.error ?? 'Failed');
  };

  const handleSaveCount = async (productId: string) => {
    if (!session || counts[productId] === undefined) return;
    const result = await api.stocktake.count(session.id, productId, parseInt(counts[productId], 10));
    if (result.success) setSession(result.data ?? null);
    else setMessage(result.error ?? 'Failed');
  };

  const handleCancel = async () => {
    if (!session || !confirm('Cancel this stocktake? Progress will be lost.')) return;
    const result = await api.stocktake.cancel(session.id);
    if (result.success) {
      setMessage('Stocktake cancelled');
      setSession(null);
      setCounts({});
      load();
    } else setMessage(result.error ?? 'Failed');
  };

  const handleComplete = async () => {
    if (!session) return;
    const result = await api.stocktake.complete(session.id);
    if (result.success) {
      setMessage(`Stocktake complete. Total variance: ${result.data?.totalVariance}`);
      setSession(null);
      setCounts({});
      load();
    } else setMessage(result.error ?? 'Failed');
  };

  const items = session?.items.filter((i) =>
    !search || i.productName.toLowerCase().includes(search.toLowerCase()) || i.productSku.includes(search),
  ) ?? [];

  const counted = session?.items.filter((i) => i.countedQty != null).length ?? 0;
  const total = session?.items.length ?? 0;

  return (
    <div className="page-shell">
      <h2 className="page-title mb-6">Stocktake</h2>
      {message && <div className="mb-4 p-3 bg-blue-50 rounded-lg text-sm">{message}</div>}

      {!session ? (
        <div className="panel p-6 max-w-md">
          <p className="text-slate-600 mb-4">Start a full inventory count. All active products will be included.</p>
          <Button onClick={handleStart}>Start Stocktake</Button>
          {history.length > 0 && (
            <div className="mt-6">
              <h3 className="font-semibold text-sm mb-2">Previous</h3>
              {history.slice(0, 5).map((h) => (
                <div key={h.id} className="text-sm text-slate-500 py-1">
                  {formatDateTime(h.createdAt)} — {h.status} — variance {h.totalVariance}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div>
          <div className="flex justify-between items-center mb-4">
            <div>
              <p className="font-semibold">In progress — {counted}/{total} counted</p>
              <p className="text-sm text-slate-500">Started by {session.startedByName}</p>
            </div>
            <div className="flex gap-2">
              <Button variant="danger" onClick={handleCancel}>Cancel</Button>
              <Button onClick={handleComplete} disabled={counted < total}>Complete Stocktake</Button>
            </div>
          </div>
          <input placeholder="Search products..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-full max-w-md px-3 py-2 border rounded-lg mb-4" />
          <div className="panel max-h-[32rem] overflow-y-auto">
            {items.map((item) => (
              <div key={item.id} className="flex items-center gap-3 p-3 border-b text-sm">
                <div className="flex-1">
                  <div className="font-medium">{item.productName}</div>
                  <div className="text-slate-500">System: {item.systemQty} {item.variance != null && <span className={item.variance !== 0 ? 'text-red-600' : 'text-green-600'}> ({item.variance > 0 ? '+' : ''}{item.variance})</span>}</div>
                </div>
                <input
                  type="number"
                  placeholder="Count"
                  value={counts[item.productId] ?? (item.countedQty != null ? String(item.countedQty) : '')}
                  onChange={(e) => setCounts({ ...counts, [item.productId]: e.target.value })}
                  className="w-20 px-2 py-1 border rounded"
                />
                <Button size="sm" variant="ghost" onClick={() => handleSaveCount(item.productId)}>Save</Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
