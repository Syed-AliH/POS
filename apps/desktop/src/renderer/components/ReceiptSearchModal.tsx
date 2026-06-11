import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@mama-babi/ui';
import { getApi } from '@renderer/lib/api';
import { formatDateOnly, formatTimeOnly, localCalendarDate } from '@shared/datetime';
import { Modal } from './Modal';
import { ReceiptPreview } from './ReceiptPreview';
import { toast } from '@renderer/stores/toastStore';
import type { ReceiptPreview as ReceiptPreviewData, SaleSummary } from '@shared/types';

const api = getApi();

interface Props {
  open: boolean;
  onClose: () => void;
  onSelectReturn?: (sale: SaleSummary) => void;
}

export function ReceiptSearchModal({ open, onClose, onSelectReturn }: Props) {
  const navigate = useNavigate();
  const today = localCalendarDate();
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [search, setSearch] = useState('');
  const [sales, setSales] = useState<SaleSummary[]>([]);
  const [selected, setSelected] = useState<SaleSummary | null>(null);
  const [preview, setPreview] = useState<ReceiptPreviewData | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await api.sales.list({
      status: 'completed',
      startDate,
      endDate,
      search: search || undefined,
      limit: 100,
    });
    setLoading(false);
    if (result.success) setSales(result.data ?? []);
  }, [startDate, endDate, search]);

  useEffect(() => {
    if (open) {
      setStartDate(today);
      setEndDate(today);
      setSearch('');
      setSelected(null);
      setPreview(null);
    }
  }, [open, today]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const selectSale = async (sale: SaleSummary) => {
    setSelected(sale);
    const result = await api.sales.receiptPreview(sale.id);
    if (result.success) setPreview(result.data ?? null);
  };

  const handleReprint = async () => {
    if (!selected) return;
    const result = await api.print.receipt(selected.id);
    if (result.success) toast.success('Receipt sent to printer');
    else toast.error(result.error ?? 'Print failed');
  };

  const handleStartReturn = () => {
    if (!selected) return;
    if (onSelectReturn) {
      onSelectReturn(selected);
      onClose();
    } else {
      navigate(`/returns?sale=${encodeURIComponent(selected.saleNumber)}`);
      onClose();
    }
  };

  return (
    <Modal
      open={open}
      title="View Receipts"
      onClose={onClose}
      panelClassName="w-[920px] max-w-[920px] h-[560px]"
      bodyClassName="flex flex-col"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Close</Button>
          {selected && (
            <>
              <Button variant="secondary" onClick={handleReprint}>Reprint</Button>
              <Button onClick={handleStartReturn}>Start Return</Button>
            </>
          )}
        </>
      }
    >
      <div className="flex gap-3 mb-3 shrink-0">
        <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="px-3 py-2 border rounded-lg text-sm" />
        <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="px-3 py-2 border rounded-lg text-sm" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Sale #, cashier, amount" className="flex-1 px-3 py-2 border rounded-lg text-sm" />
        <Button size="sm" onClick={load}>Search</Button>
      </div>
      <div className="grid grid-cols-2 gap-4 flex-1 min-h-0 h-[400px]">
        <div className="border rounded-lg h-full overflow-y-auto">
          {loading && <div className="h-full flex items-center justify-center text-slate-400">Loading…</div>}
          {!loading && sales.length === 0 && <div className="h-full flex items-center justify-center text-slate-400">No receipts found</div>}
          {sales.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => selectSale(s)}
              className={`w-full text-left px-3 py-2 border-b text-sm ${selected?.id === s.id ? 'bg-pink-50' : 'hover:bg-slate-50'}`}
            >
              <div className="font-mono font-medium">{s.saleNumber}</div>
              <div className="text-xs text-slate-500">
                {s.cashierName} · PKR {s.totalAmount.toFixed(0)} · {formatDateOnly(s.createdAt)} {formatTimeOnly(s.createdAt)}
              </div>
            </button>
          ))}
        </div>
        <div className="border rounded-lg h-full overflow-y-auto flex items-start justify-center p-2">
          {preview ? <ReceiptPreview data={preview} /> : <div className="h-full flex items-center justify-center text-slate-400 text-sm">Select a receipt to preview</div>}
        </div>
      </div>
    </Modal>
  );
}
