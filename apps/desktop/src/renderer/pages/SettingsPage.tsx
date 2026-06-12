import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileText, Sticker } from 'lucide-react';
import { Button } from '@mama-babi/ui';
import { getApi } from '@renderer/lib/api';
import { useAuthStore } from '../stores/authStore';
import { formatDateTime } from '@shared/datetime';
import type {
  AuditLogEntry,
  BackupInfo,
  LabelTemplateSummary,
  PrinterInfo,
  ReceiptTemplate,
  StaffUser,
  SyncQueueItem,
  UserRole,
} from '@shared/types';

const api = getApi();

type Tab = 'general' | 'printers' | 'currency' | 'backup' | 'staff' | 'templates' | 'audit' | 'sync';

export function SettingsPage() {
  const { session } = useAuthStore();
  const [tab, setTab] = useState<Tab>('general');
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [printers, setPrinters] = useState<PrinterInfo[]>([]);
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [staff, setStaff] = useState<StaffUser[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [syncQueue, setSyncQueue] = useState<SyncQueueItem[]>([]);
  const [syncStatus, setSyncStatus] = useState({ enabled: false, pending: 0, lastSync: null as string | null });
  const [receiptTemplates, setReceiptTemplates] = useState<ReceiptTemplate[]>([]);
  const [labelTemplates, setLabelTemplates] = useState<LabelTemplateSummary[]>([]);
  const [newStaff, setNewStaff] = useState({ name: '', username: '', password: '', role: 'cashier' as UserRole });
  const [editingStaffId, setEditingStaffId] = useState<string | null>(null);
  const [editStaff, setEditStaff] = useState({ name: '', username: '', password: '', role: 'cashier' as UserRole });
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  const isSuperAdmin = session?.role === 'super_admin';

  const load = async () => {
    const [s, p, b, st, au, sq, ss, rt, lt] = await Promise.all([
      api.settings.getAll(),
      api.settings.listPrinters(),
      api.backup.list(),
      isSuperAdmin ? api.staff.list() : Promise.resolve({ success: true, data: [] }),
      api.audit.list({ limit: 50 }),
      isSuperAdmin ? api.sync.queueList(30) : Promise.resolve({ success: true, data: [] }),
      api.sync.status(),
      api.templates.receiptList(),
      api.labels.templates(),
    ]);
    if (s.success) setSettings(s.data ?? {});
    if (p.success) setPrinters(p.data ?? []);
    if (b.success) setBackups(b.data ?? []);
    if (st.success) setStaff(st.data ?? []);
    if (au.success) setAuditLogs(au.data ?? []);
    if (sq.success) setSyncQueue(sq.data ?? []);
    if (ss.success && ss.data) setSyncStatus(ss.data);
    if (rt.success) setReceiptTemplates(rt.data ?? []);
    if (lt.success) setLabelTemplates(lt.data ?? []);
  };

  useEffect(() => { load(); }, [isSuperAdmin]);

  const updateField = (key: string, value: string) => setSettings((prev) => ({ ...prev, [key]: value }));

  const handleSave = async (extra: Record<string, string> = {}) => {
    setSaving(true);
    const result = await api.settings.set({
      settings: {
        store_name: settings.store_name ?? '',
        store_address: settings.store_address ?? '',
        store_phone: settings.store_phone ?? '',
        currency: settings.currency ?? 'PKR',
        tax_inclusive: settings.tax_inclusive ?? 'true',
        default_tax_rate: settings.default_tax_rate ?? '17',
        receipt_printer: settings.receipt_printer ?? '',
        label_printer: settings.label_printer ?? '',
        auto_print_receipt: settings.auto_print_receipt ?? 'true',
        return_policy_days: settings.return_policy_days ?? '7',
        secondary_currency: settings.secondary_currency ?? 'USD',
        exchange_rate: settings.exchange_rate ?? '0.0036',
        ...extra,
      },
    });
    setMessage(result.success ? 'Settings saved' : result.error ?? 'Save failed');
    setSaving(false);
  };

  const handleBackup = async () => {
    const result = await api.backup.create();
    setMessage(result.success ? `Backup created: ${result.data?.filename}` : result.error ?? 'Backup failed');
    if (result.success) load();
  };

  const handleRestore = async (filename: string) => {
    if (!confirm(`Restore from ${filename}? The app will restart.`)) return;
    const result = await api.backup.restore(filename);
    setMessage(result.success ? 'Restoring… app will restart' : result.error ?? 'Restore failed');
  };

  const handleCreateStaff = async () => {
    const result = await api.staff.create(newStaff);
    if (result.success) {
      setMessage(`Staff created: ${result.data?.name}`);
      setNewStaff({ name: '', username: '', password: '', role: 'cashier' });
      load();
    } else setMessage(result.error ?? 'Failed');
  };

  const toggleStaffActive = async (user: StaffUser) => {
    const result = await api.staff.update(user.id, { isActive: !user.isActive });
    if (result.success) load();
  };

  const startEditStaff = (user: StaffUser) => {
    setEditingStaffId(user.id);
    setEditStaff({ name: user.name, username: user.username ?? '', password: '', role: user.role });
  };

  const handleUpdateStaff = async () => {
    if (!editingStaffId || !editStaff.name.trim()) return;
    const input: { name: string; role: UserRole; username?: string; password?: string } = {
      name: editStaff.name,
      role: editStaff.role,
    };
    if (editStaff.username.trim()) input.username = editStaff.username;
    if (editStaff.password.trim()) input.password = editStaff.password;
    const result = await api.staff.update(editingStaffId, input);
    if (result.success) {
      setMessage('Staff updated');
      setEditingStaffId(null);
      setEditStaff({ name: '', username: '', password: '', role: 'cashier' });
      load();
    } else setMessage(result.error ?? 'Update failed');
  };

  const formatSize = (bytes: number) =>
    bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

  const tabs: Tab[] = ['general', 'printers', 'currency', 'backup', 'templates', 'audit', 'sync'];
  if (isSuperAdmin) tabs.splice(4, 0, 'staff');

  return (
    <div className="page-shell">
      <h2 className="page-title mb-6">Settings</h2>
      {message && <div className="mb-4 rounded-lg bg-blue-50 p-3 text-sm dark:bg-primary-950 dark:text-primary-200">{message}</div>}

      <div className="flex flex-wrap gap-2 mb-6">
        {tabs.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-lg text-sm font-medium capitalize ${
              tab === t ? 'tab-pill-active' : 'tab-pill'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'general' && (
        <div className="panel p-6 max-w-lg space-y-4">
          <input placeholder="Store name" value={settings.store_name ?? ''} onChange={(e) => updateField('store_name', e.target.value)} className="w-full px-3 py-2 border rounded-lg" />
          <input placeholder="Address" value={settings.store_address ?? ''} onChange={(e) => updateField('store_address', e.target.value)} className="w-full px-3 py-2 border rounded-lg" />
          <input placeholder="Phone" value={settings.store_phone ?? ''} onChange={(e) => updateField('store_phone', e.target.value)} className="w-full px-3 py-2 border rounded-lg" />
          <div className="grid grid-cols-2 gap-4">
            <input placeholder="Currency" value={settings.currency ?? 'PKR'} onChange={(e) => updateField('currency', e.target.value)} className="px-3 py-2 border rounded-lg" />
            <input type="number" placeholder="Tax %" value={settings.default_tax_rate ?? '17'} onChange={(e) => updateField('default_tax_rate', e.target.value)} className="px-3 py-2 border rounded-lg" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm text-slate-600">Return policy (days)</label>
              <input type="number" value={settings.return_policy_days ?? '7'} onChange={(e) => updateField('return_policy_days', e.target.value)} className="w-full mt-1 px-3 py-2 border rounded-lg" />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={settings.tax_inclusive === 'true'} onChange={(e) => updateField('tax_inclusive', e.target.checked ? 'true' : 'false')} />
                Tax inclusive
              </label>
            </div>
          </div>
          <p className="text-xs text-slate-400">Database is stored locally unencrypted (SQLCipher planned for production hardening).</p>
          <Button onClick={() => handleSave()} disabled={saving}>Save</Button>
        </div>
      )}

      {tab === 'printers' && (
        <div className="panel p-6 max-w-lg space-y-4">
          <select value={settings.receipt_printer ?? ''} onChange={(e) => updateField('receipt_printer', e.target.value)} className="w-full px-3 py-2 border rounded-lg">
            <option value="">Receipt: Preview mode</option>
            {printers.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
          </select>
          <select value={settings.label_printer ?? ''} onChange={(e) => updateField('label_printer', e.target.value)} className="w-full px-3 py-2 border rounded-lg">
            <option value="">Label: Same as receipt</option>
            {printers.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
          </select>
          <Button onClick={() => handleSave()} disabled={saving}>Save Printers</Button>
        </div>
      )}

      {tab === 'currency' && (
        <div className="panel p-6 max-w-lg space-y-4">
          <p className="text-sm text-slate-500">Display secondary currency equivalent at checkout (base currency unchanged).</p>
          <input placeholder="Secondary currency code" value={settings.secondary_currency ?? 'USD'} onChange={(e) => updateField('secondary_currency', e.target.value)} className="w-full px-3 py-2 border rounded-lg" />
          <input type="number" step="0.0001" placeholder="Exchange rate (1 PKR = ?)" value={settings.exchange_rate ?? ''} onChange={(e) => updateField('exchange_rate', e.target.value)} className="w-full px-3 py-2 border rounded-lg" />
          <Button onClick={() => handleSave()} disabled={saving}>Save Currency</Button>
        </div>
      )}

      {tab === 'backup' && (
        <div className="panel p-6 max-w-2xl">
          <div className="flex justify-between mb-4">
            <p className="text-sm text-slate-500">Local SQLite backups</p>
            {isSuperAdmin && <Button variant="secondary" onClick={handleBackup}>Create Backup</Button>}
          </div>
          {backups.map((b) => (
            <div key={b.filename} className="flex justify-between p-3 border rounded-lg text-sm mb-2">
              <div><div className="font-medium">{b.filename}</div><div className="text-slate-500">{formatSize(b.size)}</div></div>
              {isSuperAdmin && <Button variant="ghost" size="sm" onClick={() => handleRestore(b.filename)}>Restore</Button>}
            </div>
          ))}
        </div>
      )}

      {tab === 'staff' && isSuperAdmin && (
        <div className="grid grid-cols-2 gap-6">
          <div className="panel p-4 space-y-3">
            <h3 className="font-semibold">Add Staff</h3>
            <input placeholder="Name" value={newStaff.name} onChange={(e) => setNewStaff({ ...newStaff, name: e.target.value })} className="w-full px-3 py-2 border rounded-lg" />
            <select value={newStaff.role} onChange={(e) => setNewStaff({ ...newStaff, role: e.target.value as UserRole })} className="w-full px-3 py-2 border rounded-lg">
              <option value="cashier">Cashier</option>
              <option value="manager">Manager</option>
              <option value="super_admin">Super Admin</option>
            </select>
            <input placeholder="Username" value={newStaff.username} onChange={(e) => setNewStaff({ ...newStaff, username: e.target.value })} className="w-full px-3 py-2 border rounded-lg" />
            <input type="password" placeholder="Password (6+ chars)" value={newStaff.password} onChange={(e) => setNewStaff({ ...newStaff, password: e.target.value })} className="w-full px-3 py-2 border rounded-lg" />
            <Button onClick={handleCreateStaff}>Create</Button>
          </div>
          <div className="panel p-4 space-y-3">
            {editingStaffId && (
              <div className="p-3 border rounded-lg space-y-2 bg-slate-50">
                <h4 className="font-medium text-sm">Edit Staff</h4>
                <input value={editStaff.name} onChange={(e) => setEditStaff({ ...editStaff, name: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm" />
                <select value={editStaff.role} onChange={(e) => setEditStaff({ ...editStaff, role: e.target.value as UserRole })} className="w-full px-3 py-2 border rounded-lg text-sm">
                  <option value="cashier">Cashier</option>
                  <option value="manager">Manager</option>
                  <option value="super_admin">Super Admin</option>
                </select>
                <input placeholder="Username" value={editStaff.username} onChange={(e) => setEditStaff({ ...editStaff, username: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm" />
                <input type="password" placeholder="New password (leave blank to keep)" value={editStaff.password} onChange={(e) => setEditStaff({ ...editStaff, password: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm" />
                <div className="flex gap-2">
                  <Button size="sm" onClick={handleUpdateStaff}>Save</Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditingStaffId(null)}>Cancel</Button>
                </div>
              </div>
            )}
            {staff.map((u) => (
              <div key={u.id} className="flex justify-between items-center py-2 border-b text-sm">
                <button onClick={() => startEditStaff(u)} className="text-left hover:text-primary-600">
                  {u.name} <span className="text-slate-400">({u.username ?? '—'} · {u.role})</span>
                </button>
                <button onClick={() => toggleStaffActive(u)} className={`text-xs px-2 py-1 rounded ${u.isActive ? 'bg-green-100' : 'bg-slate-100'}`}>
                  {u.isActive ? 'Active' : 'Inactive'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'templates' && (
        <div className="grid md:grid-cols-2 gap-6 max-w-3xl">
          <Link
            to="/receipt-designer"
            className="group panel p-6 transition-all hover:border-primary-300 hover:shadow-md dark:hover:border-primary-700"
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary-50 text-primary-600 mb-4 group-hover:bg-primary-100">
              <FileText className="h-6 w-6" />
            </div>
            <h3 className="font-semibold text-lg mb-1">Receipt Designer</h3>
            <p className="text-sm text-slate-500 mb-4">
              Customize store header, footer, sections, and thermal paper width with live preview.
            </p>
            {receiptTemplates.map((tpl) => (
              <div key={tpl.id} className="text-xs text-slate-400 border-t pt-2 mt-2">
                {tpl.name} · {tpl.widthMm}mm {tpl.isDefault && '· Default'}
              </div>
            ))}
            <span className="text-sm font-medium text-primary-600">Open designer →</span>
          </Link>

          <Link
            to="/label-designer"
            className="group panel p-6 transition-all hover:border-primary-300 hover:shadow-md dark:hover:border-primary-700"
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary-50 text-primary-600 mb-4 group-hover:bg-primary-100">
              <Sticker className="h-6 w-6" />
            </div>
            <h3 className="font-semibold text-lg mb-1">Label Designer</h3>
            <p className="text-sm text-slate-500 mb-4">
              Position product name, price, barcode, and custom text on thermal labels.
            </p>
            {labelTemplates.map((tpl) => (
              <div key={tpl.id} className="text-xs text-slate-400 border-t pt-2 mt-2">
                {tpl.name} · {tpl.widthMm}×{tpl.heightMm}mm {tpl.isDefault && '· Default'}
              </div>
            ))}
            <span className="text-sm font-medium text-primary-600">Open designer →</span>
          </Link>
        </div>
      )}

      {tab === 'audit' && (
        <div className="panel max-h-[32rem] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 sticky top-0"><tr><th className="p-2 text-left">Time</th><th className="p-2 text-left">User</th><th className="p-2 text-left">Module</th><th className="p-2 text-left">Action</th></tr></thead>
            <tbody>
              {auditLogs.map((l) => (
                <tr key={l.id} className="border-t">
                  <td className="p-2 text-slate-500 whitespace-nowrap text-xs">{formatDateTime(l.createdAt)}</td>
                  <td className="p-2">{l.userName ?? '—'}</td>
                  <td className="p-2">{l.module}</td>
                  <td className="p-2">{l.action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'sync' && (
        <div className="panel p-6 max-w-2xl">
          <p className="text-sm mb-4">Cloud sync: <strong>{syncStatus.enabled ? 'Enabled' : 'Disabled (local-first)'}</strong> · Pending: {syncStatus.pending}</p>
          <p className="text-xs text-slate-400 mb-4">Supabase sync engine is stubbed. Queue entries will populate when cloud sync is enabled.</p>
          {syncQueue.length > 0 ? syncQueue.map((q) => (
            <div key={q.id} className="text-sm py-1 border-b">{q.tableName} · {q.operation} · {q.status}</div>
          )) : <p className="text-slate-400 text-sm">Sync queue empty</p>}
        </div>
      )}
    </div>
  );
}
