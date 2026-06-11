import { useEffect, useState } from 'react';
import { Button } from '@mama-babi/ui';
import { getApi } from '@renderer/lib/api';
import { formatDateTime } from '@shared/datetime';
import type { GiftCard } from '@shared/types';

const api = getApi();

export function GiftCardsPage() {
  const [cards, setCards] = useState<GiftCard[]>([]);
  const [issueAmount, setIssueAmount] = useState('');
  const [reloadCode, setReloadCode] = useState('');
  const [reloadAmount, setReloadAmount] = useState('');
  const [lookupCode, setLookupCode] = useState('');
  const [lookupResult, setLookupResult] = useState<GiftCard | null>(null);
  const [message, setMessage] = useState('');

  const load = async () => {
    const result = await api.giftCards.list();
    if (result.success) setCards(result.data ?? []);
  };

  useEffect(() => { load(); }, []);

  const handleIssue = async () => {
    const amount = parseFloat(issueAmount);
    if (!amount) return;
    const result = await api.giftCards.issue({ initialBalance: amount });
    if (result.success) {
      setMessage(`Issued: ${result.data?.code} — PKR ${result.data?.currentBalance}`);
      setIssueAmount('');
      load();
    } else setMessage(result.error ?? 'Failed');
  };

  const handleReload = async () => {
    const result = await api.giftCards.reload({ code: reloadCode, amount: parseFloat(reloadAmount) });
    if (result.success) {
      setMessage(`Reloaded ${reloadCode}: PKR ${result.data?.currentBalance}`);
      setReloadCode('');
      setReloadAmount('');
      load();
    } else setMessage(result.error ?? 'Failed');
  };

  const handleDeactivate = async (id: string) => {
    if (!confirm('Deactivate this gift card?')) return;
    const result = await api.giftCards.deactivate(id);
    if (result.success) {
      setMessage('Gift card deactivated');
      load();
    } else setMessage(result.error ?? 'Failed');
  };

  const handleLookup = async () => {
    const result = await api.giftCards.lookup(lookupCode);
    if (result.success) setLookupResult(result.data ?? null);
    else { setLookupResult(null); setMessage(result.error ?? 'Not found'); }
  };

  return (
    <div className="h-full overflow-y-auto p-6">
      <h2 className="text-2xl font-bold mb-6">Gift Cards</h2>
      {message && <div className="mb-4 p-3 bg-blue-50 rounded-lg text-sm">{message}</div>}

      <div className="grid grid-cols-3 gap-6 mb-6">
        <div className="bg-white rounded-xl border p-4 space-y-3">
          <h3 className="font-semibold">Issue New Card</h3>
          <input type="number" placeholder="Amount (PKR)" value={issueAmount} onChange={(e) => setIssueAmount(e.target.value)} className="w-full px-3 py-2 border rounded-lg" />
          <Button onClick={handleIssue}>Issue Card</Button>
        </div>
        <div className="bg-white rounded-xl border p-4 space-y-3">
          <h3 className="font-semibold">Reload Card</h3>
          <input placeholder="Card code" value={reloadCode} onChange={(e) => setReloadCode(e.target.value)} className="w-full px-3 py-2 border rounded-lg" />
          <input type="number" placeholder="Amount" value={reloadAmount} onChange={(e) => setReloadAmount(e.target.value)} className="w-full px-3 py-2 border rounded-lg" />
          <Button variant="secondary" onClick={handleReload}>Reload</Button>
        </div>
        <div className="bg-white rounded-xl border p-4 space-y-3">
          <h3 className="font-semibold">Lookup</h3>
          <input placeholder="Card code" value={lookupCode} onChange={(e) => setLookupCode(e.target.value)} className="w-full px-3 py-2 border rounded-lg" />
          <Button variant="ghost" onClick={handleLookup}>Check Balance</Button>
          {lookupResult && (
            <p className="text-sm font-medium text-green-700">Balance: PKR {lookupResult.currentBalance.toFixed(2)} ({lookupResult.status})</p>
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl border">
        <h3 className="p-4 font-semibold border-b">Recent Cards</h3>
        <table className="w-full text-sm">
          <thead className="bg-slate-50"><tr><th className="p-3 text-left">Code</th><th className="p-3 text-left">Balance</th><th className="p-3 text-left">Status</th><th className="p-3 text-left">Created</th><th className="p-3"></th></tr></thead>
          <tbody>
            {cards.map((c) => (
              <tr key={c.id} className="border-t">
                <td className="p-3 font-mono">{c.code}</td>
                <td className="p-3">PKR {c.currentBalance.toFixed(2)}</td>
                <td className="p-3 capitalize">{c.status}</td>
                <td className="p-3 text-slate-500 whitespace-nowrap text-xs">{formatDateTime(c.createdAt)}</td>
                <td className="p-3">
                  {c.status === 'active' && (
                    <Button size="sm" variant="danger" onClick={() => handleDeactivate(c.id)}>Deactivate</Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
