import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileText, Sticker } from 'lucide-react';
import { Button } from '@mama-babi/ui';
import { getApi } from '@renderer/lib/api';
import { DatabaseSettings } from '@renderer/components/DatabaseSettings';
import { SortableTh } from '@renderer/components/SortableTh';
import { sortByKey, useTableSort } from '@renderer/lib/useTableSort';
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

type Tab = 'general' | 'printers' | 'currency' | 'backup' | 'staff' | 'database' | 'templates' | 'audit' | 'sync';
type AuditSortKey = 'time' | 'user' | 'module' | 'action';

export function SettingsPage() {
  const { session } = useAuthStore();
  const [tab, setTab] = useState<Tab>('general');
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [printers, setPrinters] = useState<PrinterInfo[]>([]);
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [backingUp, setBackingUp] = useState(false);
  const [backupStatus, setBackupStatus] = useState<{
    nextDueAt: string | null;
    lastError: string | null;
    directory: string;
  } | null>(null);
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
  const { onSort: onAuditSort, icon: auditIcon, sortKey: auditSortKey, sortDir: auditSortDir } = useTableSort<AuditSortKey>('time', 'desc');

  const sortedAuditLogs = useMemo(
    () => sortByKey(auditLogs, auditSortKey, auditSortDir, {
      time: (l) => l.createdAt,
      user: (l) => l.userName ?? '',
      module: (l) => l.module,
      action: (l) => l.action,
    }),
    [auditLogs, auditSortKey, auditSortDir],
  );

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
    if (p.success) {
      setPrinters(p.data ?? []);
      const refreshed = await api.settings.getAll();
      if (refreshed.success) setSettings(refreshed.data ?? {});
    }
    if (b.success) setBackups(b.data ?? []);
    const bs = await api.backup.status();
    if (bs.success && bs.data) setBackupStatus(bs.data);
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
        tax_inclusive: 'true',
        default_tax_rate: '0',
        receipt_printer: settings.receipt_printer ?? '',
        receipt_paper_mm: settings.receipt_paper_mm ?? '58',
        receipt_ink_level: settings.receipt_ink_level ?? '3',
        label_printer: settings.label_printer ?? '',
        label_print_offset_mm: settings.label_print_offset_mm ?? '0',
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
    setBackingUp(true);
    const result = await api.backup.create();
    setBackingUp(false);
    setMessage(result.success ? `Backup created: ${result.data?.filename}` : result.error ?? 'Backup failed');
    if (result.success) load();
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
  // Database credentials are an owner-level concern — super admins only.
  if (isSuperAdmin) tabs.splice(4, 0, 'staff', 'database');

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
          <input placeholder="Currency" value={settings.currency ?? 'PKR'} onChange={(e) => updateField('currency', e.target.value)} className="px-3 py-2 border rounded-lg" />
          <div>
            <label className="text-sm text-slate-600">Return policy (days)</label>
            <input type="number" value={settings.return_policy_days ?? '7'} onChange={(e) => updateField('return_policy_days', e.target.value)} className="w-full mt-1 px-3 py-2 border rounded-lg" />
          </div>
          <p className="text-xs text-slate-400">Database is stored locally unencrypted (SQLCipher planned for production hardening).</p>
          <Button onClick={() => handleSave()} disabled={saving}>Save</Button>
        </div>
      )}

      {tab === 'printers' && (
        <div className="panel p-6 max-w-lg space-y-4">
          <p className="text-sm text-slate-500 rounded-lg bg-slate-50 dark:bg-slate-800 px-3 py-2">
            Choose a receipt printer for silent printing at checkout, or leave on <strong>Print preview</strong> to open the system print dialog. Labels print to the Gainscha printer below.
          </p>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Receipt printer</label>
          <select
            value={settings.receipt_printer ?? ''}
            onChange={(e) => updateField('receipt_printer', e.target.value)}
            className="w-full px-3 py-2 border rounded-lg"
          >
            <option value="">Print preview (no hardware printer)</option>
            {printers.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
                {p.isDefault ? ' (Windows default)' : ''}
                {/gainscha|gs-\d|label/i.test(p.name) ? ' — label printer' : ''}
              </option>
            ))}
          </select>
          <p className="text-xs text-slate-500">
            Use a <strong>thermal receipt</strong> printer (58/80 mm, ESC/POS). Do not select the Gainscha label printer here.
          </p>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Physical paper roll width</label>
          <select
            value={settings.receipt_paper_mm ?? '58'}
            onChange={(e) => updateField('receipt_paper_mm', e.target.value)}
            className="w-full px-3 py-2 border rounded-lg"
          >
            <option value="58">58 mm roll (~2.3 in wide)</option>
            <option value="80">80 mm roll (~3.1 in wide)</option>
          </select>
          <p className="text-xs text-slate-500">
            Measure the <strong>paper roll</strong>, not the Windows printer page size. POS-80 accepts 80&nbsp;mm rolls
            (~3.1&nbsp;in); if you loaded a 58&nbsp;mm roll, choose 58&nbsp;mm here even on an 80&nbsp;mm printer.
            Receipt Designer width can differ — the layout is scaled to this roll.
          </p>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Receipt ink level</label>
          <select
            value={settings.receipt_ink_level ?? '3'}
            onChange={(e) => updateField('receipt_ink_level', e.target.value)}
            className="w-full px-3 py-2 border rounded-lg"
          >
            <option value="1">1 — lightest, thinnest strokes</option>
            <option value="2">2</option>
            <option value="3">3 — balanced (default)</option>
            <option value="4">4 — heavier, for faint receipts</option>
            <option value="5">5 — heaviest</option>
          </select>
          <p className="text-xs text-slate-500">
            If receipts print <strong>faint or brown</strong>, raise this. If letters look
            <strong> smudged or filled in</strong>, lower it. This thickens the printed image;
            it does not change the printer&apos;s own heat setting. Takes effect on the next receipt.
          </p>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Label printer</label>
          <select value={settings.label_printer ?? ''} onChange={(e) => updateField('label_printer', e.target.value)} className="w-full px-3 py-2 border rounded-lg">
            <option value="">Label: Auto-detect Gainscha</option>
            {printers.map((p) => <option key={p.name} value={p.name}>{p.name}{p.name.toLowerCase().includes('gainscha') ? ' (recommended)' : ''}</option>)}
          </select>
          <div className="rounded-lg bg-slate-50 dark:bg-slate-800 px-3 py-3 text-sm text-slate-600 dark:text-slate-300">
            <p className="mb-2">
              Multi-column rolls (e.g. 38×28 2UP) are configured per template — columns, gaps, margins, and alignment offsets.
            </p>
            <Link to="/label-template-config" className="font-medium text-primary-600 hover:underline">
              Open Label Template & Printer Config →
            </Link>
          </div>
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
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <p className="font-medium text-slate-900 dark:text-slate-100">Database backups</p>
              <p className="mt-0.5 text-sm text-slate-500">
                Runs automatically every 6 hours while the app is open. The last {backups.length > 0 ? backups.length : 0} of 28 are kept.
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button variant="ghost" onClick={() => void api.backup.reveal()}>Open folder</Button>
              {isSuperAdmin && (
                <Button variant="secondary" onClick={handleBackup} disabled={backingUp}>
                  {backingUp ? 'Backing up…' : 'Back up now'}
                </Button>
              )}
            </div>
          </div>

          {backupStatus?.lastError && (
            <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
              Last automatic backup failed: {backupStatus.lastError}
            </p>
          )}

          {backups.length === 0 ? (
            <p className="rounded-lg bg-amber-50 px-3 py-3 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
              No backups yet. The first one runs a minute after the app starts.
            </p>
          ) : (
            <>
              <p className="mb-3 text-xs text-slate-400">
                Next automatic backup: {backupStatus?.nextDueAt ? formatDateTime(backupStatus.nextDueAt) : '—'}
              </p>
              {backups.map((b) => (
                <div key={b.filename} className="mb-2 flex items-center justify-between rounded-lg border p-3 text-sm">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{b.filename}</div>
                    <div className="text-slate-500">
                      {formatDateTime(b.createdAt)} · {formatSize(b.size)}
                    </div>
                  </div>
                </div>
              ))}
            </>
          )}

          <p className="mt-4 border-t pt-4 text-xs text-slate-400">
            These back up the shared Postgres database, so restoring one affects every terminal. That is
            done deliberately from a computer with database tools, not from this screen — use
            <strong> Open folder</strong> to copy a backup somewhere safe. Keep copies off this machine:
            a backup stored only on the till is lost with the till.
          </p>
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

      {tab === 'database' && isSuperAdmin && <DatabaseSettings />}

      {tab === 'templates' && (
        <div className="grid md:grid-cols-3 gap-6 max-w-5xl">
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

          <Link
            to="/label-template-config"
            className="group panel p-6 transition-all hover:border-primary-300 hover:shadow-md dark:hover:border-primary-700"
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary-50 text-primary-600 mb-4 group-hover:bg-primary-100">
              <Sticker className="h-6 w-6" />
            </div>
            <h3 className="font-semibold text-lg mb-1">Label Roll Config</h3>
            <p className="text-sm text-slate-500 mb-4">
              Columns, gaps, margins, DPI, scale, and calibration for 2UP thermal rolls.
            </p>
            {labelTemplates.filter((t) => t.isDefault).map((tpl) => (
              <div key={tpl.id} className="text-xs text-slate-400 border-t pt-2 mt-2">
                Default: {tpl.name} · {tpl.rollConfig?.columns ?? 1}-up · gap {tpl.rollConfig?.horizontalGapMm ?? 0} mm
              </div>
            ))}
            <span className="text-sm font-medium text-primary-600">Configure roll →</span>
          </Link>
        </div>
      )}

      {tab === 'audit' && (
        <div className="panel max-h-[32rem] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 sticky top-0">
              <tr>
                <SortableTh label="Time" columnKey="time" onSort={onAuditSort} icon={auditIcon} className="p-2" />
                <SortableTh label="User" columnKey="user" onSort={onAuditSort} icon={auditIcon} className="p-2" />
                <SortableTh label="Module" columnKey="module" onSort={onAuditSort} icon={auditIcon} className="p-2" />
                <SortableTh label="Action" columnKey="action" onSort={onAuditSort} icon={auditIcon} className="p-2" />
              </tr>
            </thead>
            <tbody>
              {sortedAuditLogs.map((l) => (
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
