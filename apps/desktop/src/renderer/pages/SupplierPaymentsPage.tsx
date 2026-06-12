import { useEffect, useState } from 'react';
import { Button } from '@mama-babi/ui';
import { getApi } from '@renderer/lib/api';
import { Modal, ModalActions } from '@renderer/components/Modal';
import { toast } from '@renderer/stores/toastStore';
import { formatDateOnly, formatDateTime, formatTimeOnly, localCalendarDate } from '@shared/datetime';
import type { SupplierLedgerEntry, SupplierPaymentSummary, Vendor } from '@shared/types';

const api = getApi();

export function SupplierPaymentsPage() {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [vendorId, setVendorId] = useState('');
  const [outstanding, setOutstanding] = useState(0);
  const [paymentDate, setPaymentDate] = useState(() => localCalendarDate());
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [payments, setPayments] = useState<SupplierPaymentSummary[]>([]);
  const [ledger, setLedger] = useState<SupplierLedgerEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editPayment, setEditPayment] = useState<SupplierPaymentSummary | null>(null);
  const [editAmount, setEditAmount] = useState('');
  const [editDate, setEditDate] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const loadVendors = async () => {
    const result = await api.vendors.list();
    if (result.success) {
      setVendors(result.data ?? []);
      if (result.data?.[0] && !vendorId) setVendorId(result.data[0].id);
    }
  };

  const loadVendorData = async (id: string) => {
    if (!id) return;
    setLoading(true);
    const [balanceRes, paymentsRes, ledgerRes] = await Promise.all([
      api.supplierPayments.balance(id),
      api.supplierPayments.list({ vendorId: id, limit: 20 }),
      api.supplierPayments.ledger(id),
    ]);
    setLoading(false);
    if (balanceRes.success) setOutstanding(balanceRes.data?.outstandingBalance ?? 0);
    if (paymentsRes.success) setPayments(paymentsRes.data ?? []);
    if (ledgerRes.success) setLedger(ledgerRes.data ?? []);
  };

  useEffect(() => { loadVendors(); }, []);
  useEffect(() => { if (vendorId) loadVendorData(vendorId); }, [vendorId]);

  const handleCreate = async () => {
    if (!vendorId || !amount) return;
    setSaving(true);
    const result = await api.supplierPayments.create({
      vendorId,
      amount: parseFloat(amount),
      paymentDate,
      notes: notes || undefined,
    });
    setSaving(false);
    if (result.success) {
      toast.success(`Payment recorded: ${result.data?.paymentNumber}`);
      setAmount('');
      setNotes('');
      loadVendorData(vendorId);
      loadVendors();
    } else toast.error(result.error ?? 'Payment failed');
  };

  const openEdit = (payment: SupplierPaymentSummary) => {
    setEditPayment(payment);
    setEditAmount(String(payment.amount));
    setEditDate(payment.paymentDate);
    setEditNotes(payment.notes ?? '');
  };

  const handleUpdate = async () => {
    if (!editPayment) return;
    const result = await api.supplierPayments.update(editPayment.id, {
      amount: parseFloat(editAmount),
      paymentDate: editDate,
      notes: editNotes || undefined,
    });
    if (result.success) {
      toast.success('Payment updated');
      setEditPayment(null);
      loadVendorData(vendorId);
      loadVendors();
    } else toast.error(result.error ?? 'Update failed');
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    const result = await api.supplierPayments.delete(deleteId);
    if (result.success) {
      toast.success('Payment deleted');
      setDeleteId(null);
      loadVendorData(vendorId);
      loadVendors();
    } else toast.error(result.error ?? 'Delete failed');
  };

  const selectedVendor = vendors.find((v) => v.id === vendorId);

  return (
    <div className="page-shell">
      <h2 className="text-2xl font-bold mb-2">Supplier Payments</h2>
      <p className="text-slate-500 mb-6">Record payments against supplier credit balances and view the full ledger</p>

      <div className="grid grid-cols-2 gap-6 mb-6">
        <div className="panel p-4 space-y-3">
          <h3 className="font-semibold">Record Payment</h3>
          <label className="text-xs font-medium text-slate-500 uppercase">Supplier</label>
          <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} className="w-full px-3 py-2 border rounded-lg">
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name} {v.outstandingBalance > 0 ? `(PKR ${v.outstandingBalance.toFixed(0)} due)` : ''}
              </option>
            ))}
          </select>

          <div className="p-3 bg-slate-50 rounded-lg">
            <p className="text-xs text-slate-500">Outstanding credit balance</p>
            <p className="text-2xl font-bold text-primary-700">PKR {outstanding.toFixed(2)}</p>
            {selectedVendor?.preferredPaymentType && (
              <p className="text-xs text-slate-400 mt-1">Preferred GRN payment: {selectedVendor.preferredPaymentType}</p>
            )}
          </div>

          <input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} className="w-full px-3 py-2 border rounded-lg" />
          <input type="number" min="0" step="0.01" placeholder="Payment amount (PKR)" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-full px-3 py-2 border rounded-lg" />
          <textarea placeholder="Notes / remarks (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full px-3 py-2 border rounded-lg h-16" />
          <Button onClick={handleCreate} disabled={saving || !amount || parseFloat(amount) <= 0}>
            {saving ? 'Saving…' : 'Record Payment'}
          </Button>
        </div>

        <div className="panel p-4">
          <h3 className="font-semibold mb-3">Recent Payments</h3>
          {loading && payments.length === 0 ? (
            <p className="text-slate-400 text-sm">Loading…</p>
          ) : payments.length === 0 ? (
            <p className="text-slate-400 text-sm">No payments recorded for this supplier</p>
          ) : (
            <div className="space-y-2 max-h-[320px] overflow-y-auto">
              {payments.map((p) => (
                <div key={p.id} className="flex justify-between items-start py-2 border-b text-sm gap-2">
                  <div>
                    <p className="font-mono font-medium">{p.paymentNumber}</p>
                    <p className="text-xs text-slate-500">{formatDateOnly(p.createdAt)} {formatTimeOnly(p.createdAt)}</p>
                    {p.notes && <p className="text-xs text-slate-400 mt-0.5">{p.notes}</p>}
                    <p className="text-xs text-slate-400">Balance after: PKR {p.balanceAfter.toFixed(2)}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-bold text-green-700">PKR {p.amount.toFixed(2)}</p>
                    <div className="flex gap-1 mt-1 justify-end">
                      <Button size="sm" variant="ghost" onClick={() => openEdit(p)}>Edit</Button>
                      <Button size="sm" variant="danger" onClick={() => setDeleteId(p.id)}>Delete</Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="panel">
        <div className="p-4 border-b">
          <h3 className="font-semibold">Supplier Ledger / Statement</h3>
          <p className="text-xs text-slate-500 mt-1">
            {selectedVendor?.name ?? 'Select a supplier'} — complete credit GRN and payment history
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead className="bg-slate-50">
              <tr className="text-left text-slate-500">
                <th className="p-3">Date</th>
                <th className="p-3">Time</th>
                <th className="p-3">Type</th>
                <th className="p-3">Reference</th>
                <th className="p-3 text-right">Debit</th>
                <th className="p-3 text-right">Credit</th>
                <th className="p-3 text-right">Balance</th>
                <th className="p-3">Notes</th>
              </tr>
            </thead>
            <tbody>
              {ledger.length === 0 ? (
                <tr><td colSpan={8} className="p-8 text-center text-slate-400">{loading ? 'Loading…' : 'No ledger entries'}</td></tr>
              ) : ledger.map((entry) => (
                <tr key={`${entry.transactionType}-${entry.id}`} className="border-t">
                  <td className="p-3 whitespace-nowrap">{formatDateOnly(entry.createdAt)}</td>
                  <td className="p-3 whitespace-nowrap">{formatTimeOnly(entry.createdAt)}</td>
                  <td className="p-3 capitalize">{entry.transactionType === 'credit_grn' ? 'Credit GRN' : 'Payment'}</td>
                  <td className="p-3 font-mono text-xs">{entry.referenceNumber}</td>
                  <td className="p-3 text-right text-green-700">{entry.debitAmount > 0 ? `PKR ${entry.debitAmount.toFixed(2)}` : '—'}</td>
                  <td className="p-3 text-right text-red-700">{entry.creditAmount > 0 ? `PKR ${entry.creditAmount.toFixed(2)}` : '—'}</td>
                  <td className="p-3 text-right font-semibold">PKR {entry.runningBalance.toFixed(2)}</td>
                  <td className="p-3 text-slate-500 text-xs">{entry.notes ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Modal open={!!editPayment} title="Edit payment" onClose={() => setEditPayment(null)}
        footer={<ModalActions onCancel={() => setEditPayment(null)} onConfirm={handleUpdate} confirmLabel="Save" />}
      >
        <div className="space-y-3">
          <input type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)} className="w-full px-3 py-2 border rounded-lg" />
          <input type="number" value={editAmount} onChange={(e) => setEditAmount(e.target.value)} className="w-full px-3 py-2 border rounded-lg" />
          <textarea value={editNotes} onChange={(e) => setEditNotes(e.target.value)} className="w-full px-3 py-2 border rounded-lg h-16" />
        </div>
      </Modal>

      <Modal open={!!deleteId} title="Delete payment" onClose={() => setDeleteId(null)}
        footer={<ModalActions onCancel={() => setDeleteId(null)} onConfirm={handleDelete} confirmLabel="Delete" confirmVariant="danger" />}
      >
        <p className="text-slate-600">This will restore the supplier&apos;s outstanding balance. Continue?</p>
      </Modal>
    </div>
  );
}
