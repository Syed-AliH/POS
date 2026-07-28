import { useEffect, useMemo, useState } from 'react';
import { Button } from '@mama-babi/ui';
import { getApi } from '@renderer/lib/api';
import { SortableTh } from '@renderer/components/SortableTh';
import { sortByKey, useTableSort } from '@renderer/lib/useTableSort';
import { Modal, ModalActions } from '@renderer/components/Modal';
import { EodReportForm } from '@renderer/components/EodReportForm';
import { formatDateTime } from '@shared/datetime';
import type { EodClosingRecord, EodReport, ShiftSummary } from '@shared/types';

const api = getApi();

type ClosingSortKey = 'date' | 'sales' | 'txns';
type ShiftSortKey = 'cashier' | 'start' | 'end' | 'status';

export function ShiftsPage() {
  const [currentShift, setCurrentShift] = useState<ShiftSummary | null>(null);
  const [shifts, setShifts] = useState<ShiftSummary[]>([]);
  const [eod, setEod] = useState<EodReport | null>(null);
  const [closings, setClosings] = useState<EodClosingRecord[]>([]);
  const [selectedClosing, setSelectedClosing] = useState<EodClosingRecord | null>(null);
  const [openingFloat, setOpeningFloat] = useState('');
  const [closingFloat, setClosingFloat] = useState('');
  const [eodClosingFloat, setEodClosingFloat] = useState('');
  const [closingFilterStart, setClosingFilterStart] = useState('');
  const [closingFilterEnd, setClosingFilterEnd] = useState('');
  const [showCloseDay, setShowCloseDay] = useState(false);
  const [message, setMessage] = useState('');
  const { onSort: onClosingSort, icon: closingIcon, sortKey: closingSortKey, sortDir: closingSortDir } = useTableSort<ClosingSortKey>('date', 'desc');
  const { onSort: onShiftSort, icon: shiftIcon, sortKey: shiftSortKey, sortDir: shiftSortDir } = useTableSort<ShiftSortKey>('start', 'desc');

  const sortedClosings = useMemo(
    () => sortByKey(closings, closingSortKey, closingSortDir, {
      date: (c) => c.closingDate,
      sales: (c) => c.totalSales,
      txns: (c) => c.transactionCount,
    }),
    [closings, closingSortKey, closingSortDir],
  );

  const sortedShifts = useMemo(
    () => sortByKey(shifts, shiftSortKey, shiftSortDir, {
      cashier: (s) => s.cashierName,
      start: (s) => s.startTime,
      end: (s) => s.endTime ?? '',
      status: (s) => s.status,
    }),
    [shifts, shiftSortKey, shiftSortDir],
  );

  const load = async () => {
    const [current, list, report, closingList] = await Promise.all([
      api.shifts.current(),
      api.shifts.list(20),
      api.reports.eod(),
      api.eod.closingsList({ startDate: closingFilterStart || undefined, endDate: closingFilterEnd || undefined, limit: 30 }),
    ]);
    if (current.success) setCurrentShift(current.data ?? null);
    if (list.success) setShifts(list.data ?? []);
    if (report.success) setEod(report.data ?? null);
    if (closingList.success) setClosings(closingList.data ?? []);
  };

  useEffect(() => { load(); }, [closingFilterStart, closingFilterEnd]);

  const handleStart = async () => {
    const result = await api.shifts.start(parseFloat(openingFloat || '0'));
    if (result.success) { setMessage('Shift started'); setOpeningFloat(''); load(); }
    else setMessage(result.error ?? 'Failed');
  };

  const handleEnd = async () => {
    const result = await api.shifts.end(parseFloat(closingFloat || '0'));
    if (result.success) {
      setMessage(`Shift closed. Variance: PKR ${result.data?.difference?.toFixed(2) ?? '0'}`);
      setClosingFloat('');
      load();
    } else setMessage(result.error ?? 'Failed');
  };

  const handleCloseDay = async () => {
    const result = await api.eod.closeDay(undefined, eodClosingFloat ? parseFloat(eodClosingFloat) : undefined);
    if (result.success) {
      setMessage(`Day closed: ${result.data?.closingDate}`);
      setShowCloseDay(false);
      setEodClosingFloat('');
      load();
    } else setMessage(result.error ?? 'Close day failed');
  };

  const handleEodPrint = async () => {
    const result = await api.print.zReport();
    setMessage(result.success ? 'Z-Report sent to printer' : result.error ?? 'Print failed');
  };

  const viewClosing = async (id: string) => {
    const result = await api.eod.closingGet(id);
    if (result.success) setSelectedClosing(result.data ?? null);
  };

  return (
    <div className="page-shell">
      <h2 className="page-title mb-6">Shifts & End of Day</h2>
      {message && <div className="mb-4 p-3 bg-blue-50 rounded-lg text-sm">{message}</div>}

      <div className="grid grid-cols-2 gap-6 mb-6">
        <div className="panel p-4">
          <h3 className="font-semibold mb-3">Current Shift</h3>
          {currentShift ? (
            <div className="space-y-2 text-sm">
              <p>Cashier: {currentShift.cashierName}</p>
              <p>Started: {formatDateTime(currentShift.startTime)}</p>
              <p>Opening float: PKR {currentShift.openingFloat.toFixed(2)}</p>
              <div className="flex gap-2 mt-4">
                <input type="number" value={closingFloat} onChange={(e) => setClosingFloat(e.target.value)} placeholder="Closing cash count" className="flex-1 px-3 py-2 border rounded-lg" />
                <Button variant="secondary" onClick={handleEnd}>Close Shift</Button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              <input type="number" value={openingFloat} onChange={(e) => setOpeningFloat(e.target.value)} placeholder="Opening float" className="flex-1 px-3 py-2 border rounded-lg" />
              <Button onClick={handleStart}>Start Shift</Button>
            </div>
          )}
        </div>

        <div className="panel p-4">
          <h3 className="font-semibold mb-3">Day Actions</h3>
          {eod ? (
            <div className="space-y-1 text-sm text-slate-500">
              <p>System-computed reference for {eod.date}:</p>
              <p>Cash: PKR {eod.cashSales.toFixed(2)} · Card: PKR {eod.cardSales.toFixed(2)} · Online/Wallet: PKR {eod.walletSales.toFixed(2)}</p>
              <p>Expenses: PKR {eod.expensesTotal.toFixed(2)} · Expected cash: PKR {eod.expectedCash.toFixed(2)}</p>
            </div>
          ) : (
            <p className="text-sm text-slate-400">No computed EOD data yet.</p>
          )}
          <div className="flex gap-2 mt-4">
            <Button onClick={() => setShowCloseDay(true)} disabled={!eod}>Close Day (save snapshot)</Button>
            <Button variant="secondary" onClick={handleEodPrint}>Print Z-Report</Button>
          </div>
        </div>
      </div>

      <div className="mb-6">
        <EodReportForm />
      </div>

      <div className="grid grid-cols-2 gap-6 mb-6">
        <div className="panel">
          <div className="p-4 border-b flex gap-2 items-center">
            <h3 className="font-semibold flex-1">Historical Closings</h3>
            <input type="date" value={closingFilterStart} onChange={(e) => setClosingFilterStart(e.target.value)} className="px-2 py-1 border rounded text-sm" />
            <input type="date" value={closingFilterEnd} onChange={(e) => setClosingFilterEnd(e.target.value)} className="px-2 py-1 border rounded text-sm" />
          </div>
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr className="text-left text-slate-500">
                <SortableTh label="Date" columnKey="date" onSort={onClosingSort} icon={closingIcon} className="p-3" />
                <SortableTh label="Sales" columnKey="sales" onSort={onClosingSort} icon={closingIcon} className="p-3" align="right" />
                <SortableTh label="Transactions" columnKey="txns" onSort={onClosingSort} icon={closingIcon} className="p-3" align="right" />
              </tr>
            </thead>
            <tbody>
              {sortedClosings.map((c) => (
                <tr key={c.id} className="border-t cursor-pointer hover:bg-slate-50" onClick={() => viewClosing(c.id)}>
                  <td className="p-3">{c.closingDate}</td>
                  <td className="p-3 text-right">PKR {c.totalSales.toFixed(0)}</td>
                  <td className="p-3 text-right text-slate-500">{c.transactionCount} txns</td>
                </tr>
              ))}
              {sortedClosings.length === 0 && <tr><td colSpan={3} className="p-6 text-center text-slate-400">No closings yet</td></tr>}
            </tbody>
          </table>
        </div>

        {selectedClosing ? (
          <div className="panel p-4 text-sm space-y-1">
            <h3 className="font-semibold mb-2">Closing: {selectedClosing.closingDate}</h3>
            <p>Total Sales: PKR {selectedClosing.totalSales.toFixed(2)} ({selectedClosing.transactionCount} txns)</p>
            <p>Returns: PKR {selectedClosing.returnsTotal.toFixed(2)}</p>
            <p>Expenses: PKR {selectedClosing.expensesTotal.toFixed(2)}</p>
            <p>Cash Collected: PKR {selectedClosing.cashCollected.toFixed(2)}</p>
            <p>Opening Float: PKR {selectedClosing.openingFloat.toFixed(2)}</p>
            {selectedClosing.closingFloat != null && <p>Closing Float: PKR {selectedClosing.closingFloat.toFixed(2)}</p>}
            {selectedClosing.variance != null && <p>Variance: PKR {selectedClosing.variance.toFixed(2)}</p>}
            <div className="mt-2 pt-2 border-t">
              <p className="font-medium">Payment breakdown:</p>
              {Object.entries(selectedClosing.paymentBreakdown).map(([method, amount]) => (
                <p key={method} className="capitalize">{method.replace('_', ' ')}: PKR {amount.toFixed(2)}</p>
              ))}
            </div>
            <p className="text-xs text-slate-400 mt-2">Closed {formatDateTime(selectedClosing.closedAt)}</p>
          </div>
        ) : (
          <div className="bg-slate-50 rounded-xl border border-dashed p-6 text-center text-slate-400 text-sm">Select a closing record for details</div>
        )}
      </div>

      <div className="panel">
        <h3 className="p-4 font-semibold border-b">Shift History</h3>
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr className="text-left text-slate-500">
              <SortableTh label="Cashier" columnKey="cashier" onSort={onShiftSort} icon={shiftIcon} className="p-3" />
              <SortableTh label="Start" columnKey="start" onSort={onShiftSort} icon={shiftIcon} className="p-3" />
              <SortableTh label="End" columnKey="end" onSort={onShiftSort} icon={shiftIcon} className="p-3" />
              <SortableTh label="Status" columnKey="status" onSort={onShiftSort} icon={shiftIcon} className="p-3" />
            </tr>
          </thead>
          <tbody>
            {sortedShifts.map((s) => (
              <tr key={s.id} className="border-t">
                <td className="p-3">{s.cashierName}</td>
                <td className="p-3 whitespace-nowrap text-xs">{formatDateTime(s.startTime)}</td>
                <td className="p-3 whitespace-nowrap text-xs">{s.endTime ? formatDateTime(s.endTime) : '—'}</td>
                <td className="p-3 capitalize">{s.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={showCloseDay} title="Close Day" onClose={() => setShowCloseDay(false)}
        footer={<ModalActions onCancel={() => setShowCloseDay(false)} onConfirm={handleCloseDay} confirmLabel="Close Day" />}
      >
        {eod && (
          <div className="space-y-2 text-sm">
            <p>This will persist today&apos;s EOD snapshot.</p>
            <p>Expected cash: PKR {eod.expectedCash.toFixed(2)}</p>
            <p>Net after expenses: PKR {eod.netClosing.toFixed(2)}</p>
            <input type="number" placeholder="Actual closing cash (optional)" value={eodClosingFloat} onChange={(e) => setEodClosingFloat(e.target.value)} className="w-full px-3 py-2 border rounded-lg mt-2" />
          </div>
        )}
      </Modal>
    </div>
  );
}
