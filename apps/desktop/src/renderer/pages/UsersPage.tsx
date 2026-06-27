import { useState, useEffect, useCallback, useMemo } from 'react';
import { Eye, EyeOff, Lock, MoreVertical, Pencil, Plus, RotateCcw, Search, ShieldCheck, Trash2, UserCheck, UserX, X } from 'lucide-react';
import { Button } from '@mama-babi/ui';
import { getApi } from '@renderer/lib/api';
import { SortableTh } from '@renderer/components/SortableTh';
import { sortByKey, useTableSort } from '@renderer/lib/useTableSort';
import { useAuthStore } from '../stores/authStore';
import type { CreateStaffInput, StaffUser, UpdateStaffInput, UserRole } from '@shared/types';
import { PERMISSION_GROUPS, getDefaultPermissions } from '@shared/permissions';
import type { Permission } from '@shared/permissions';

const api = getApi();

type UserSortKey = 'name' | 'username' | 'contact' | 'role' | 'status' | 'created' | 'lastLogin';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ROLE_LABELS: Record<UserRole, string> = {
  super_admin: 'Administrator',
  manager: 'Manager',
  cashier: 'Salesman / Cashier',
};

const ROLE_COLORS: Record<UserRole, string> = {
  super_admin: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300',
  manager: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  cashier: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300',
};

function StatusBadge({ active }: { active: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
      active
        ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
        : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
    }`}>
      {active ? 'Active' : 'Inactive'}
    </span>
  );
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

// ─── Password strength ────────────────────────────────────────────────────────

function passwordStrength(pw: string): { score: number; label: string; color: string } {
  if (pw.length === 0) return { score: 0, label: '', color: '' };
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  const levels = [
    { score: 1, label: 'Very weak', color: 'bg-red-500' },
    { score: 2, label: 'Weak', color: 'bg-orange-500' },
    { score: 3, label: 'Fair', color: 'bg-yellow-500' },
    { score: 4, label: 'Strong', color: 'bg-lime-500' },
    { score: 5, label: 'Very strong', color: 'bg-green-500' },
  ];
  const level = levels[Math.min(score, 5) - 1] ?? levels[0];
  return { score, ...level };
}

// ─── Permission Matrix ────────────────────────────────────────────────────────

function PermissionMatrix({
  value,
  onChange,
}: {
  value: Permission[];
  onChange: (perms: Permission[]) => void;
}) {
  const toggle = (perm: Permission) => {
    if (value.includes(perm)) {
      onChange(value.filter((p) => p !== perm));
    } else {
      onChange([...value, perm]);
    }
  };

  const toggleGroup = (perms: Permission[]) => {
    const allOn = perms.every((p) => value.includes(p));
    if (allOn) {
      onChange(value.filter((p) => !perms.includes(p)));
    } else {
      const set = new Set([...value, ...perms]);
      onChange([...set]);
    }
  };

  return (
    <div className="space-y-4 mt-2">
      {PERMISSION_GROUPS.map((group) => {
        const allOn = group.permissions.every((p) => value.includes(p.key));
        const someOn = group.permissions.some((p) => value.includes(p.key));

        return (
          <div key={group.label} className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
            <button
              type="button"
              className="flex w-full items-center justify-between bg-slate-50 dark:bg-slate-800/60 px-3 py-2 text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700/60 transition-colors"
              onClick={() => toggleGroup(group.permissions.map((p) => p.key))}
            >
              <span>{group.label}</span>
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                allOn
                  ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
                  : someOn
                    ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300'
                    : 'bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-400'
              }`}>
                {allOn ? 'All on' : someOn ? 'Partial' : 'All off'}
              </span>
            </button>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 p-3 sm:grid-cols-3">
              {group.permissions.map(({ key, label }) => (
                <label key={key} className="flex items-center gap-2 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={value.includes(key)}
                    onChange={() => toggle(key)}
                    className="h-4 w-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500"
                  />
                  <span className="text-xs text-slate-600 dark:text-slate-400 group-hover:text-slate-900 dark:group-hover:text-slate-200">
                    {label}
                  </span>
                </label>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Create / Edit Dialog ─────────────────────────────────────────────────────

interface UserFormProps {
  user?: StaffUser;
  onClose: () => void;
  onSaved: () => void;
}

function UserFormDialog({ user, onClose, onSaved }: UserFormProps) {
  const isEdit = !!user;

  const [name, setName] = useState(user?.name ?? '');
  const [username, setUsername] = useState(user?.username ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [role, setRole] = useState<UserRole>(user?.role ?? 'cashier');
  const [isActive, setIsActive] = useState(user?.isActive ?? true);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [permissions, setPermissions] = useState<Permission[]>(
    (user?.permissions as Permission[]) ?? getDefaultPermissions('cashier'),
  );
  const [tab, setTab] = useState<'info' | 'permissions'>('info');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);

  // When role changes, auto-populate default permissions if not edit mode
  const handleRoleChange = (newRole: UserRole) => {
    setRole(newRole);
    if (!isEdit) {
      setPermissions(getDefaultPermissions(newRole) as Permission[]);
    }
  };

  const validate = () => {
    const errs: Record<string, string> = {};
    if (!name.trim()) errs['name'] = 'Full name is required';
    if (!isEdit && !username.trim()) errs['username'] = 'Username is required';
    if (!isEdit || password) {
      if (!isEdit && !password) errs['password'] = 'Password is required';
      if (password && password.length < 8) errs['password'] = 'Minimum 8 characters';
      if (password && password !== confirmPassword) errs['confirmPassword'] = 'Passwords do not match';
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errs['email'] = 'Invalid email';
    return errs;
  };

  const handleSave = async () => {
    const errs = validate();
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }

    setSaving(true);
    setErrors({});

    let result;
    if (isEdit && user) {
      const input: UpdateStaffInput = {
        name: name.trim(),
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        role,
        isActive,
        permissions,
      };
      if (password.trim()) input.password = password;
      result = await api.staff.update(user.id, input);
    } else {
      const input: CreateStaffInput = {
        name: name.trim(),
        username: username.trim().toLowerCase(),
        password,
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        role,
        permissions,
      };
      result = await api.staff.create(input);
    }

    setSaving(false);
    if (result.success) {
      setSuccess(true);
      setTimeout(() => { setSuccess(false); onSaved(); onClose(); }, 1200);
    } else {
      setErrors({ general: result.error ?? 'An error occurred' });
    }
  };

  if (success) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <div className="rounded-2xl bg-white dark:bg-slate-900 p-8 shadow-2xl flex flex-col items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/40">
            <UserCheck className="h-8 w-8 text-green-600 dark:text-green-400" />
          </div>
          <p className="text-lg font-semibold text-slate-900 dark:text-white">
            {isEdit ? 'User Updated' : 'User Created'}
          </p>
          <p className="text-sm text-slate-500">Changes saved successfully.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-2xl rounded-2xl bg-white dark:bg-slate-900 shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 px-6 py-4">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
            {isEdit ? `Edit User — ${user!.username}` : 'Create New User'}
          </h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-slate-200 dark:border-slate-700 px-6 pt-3">
          {(['info', 'permissions'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm font-medium rounded-t-lg capitalize transition-colors ${
                tab === t
                  ? 'border-b-2 border-primary-600 text-primary-700 dark:text-primary-400'
                  : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
              }`}
            >
              {t === 'info' ? 'User Info' : 'Permissions'}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-6 py-4">
          {errors['general'] && (
            <div className="mb-4 rounded-lg bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-400">
              {errors['general']}
            </div>
          )}

          {tab === 'info' && (
            <div className="space-y-4">
              {/* Full Name */}
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Full Name <span className="text-red-500">*</span>
                </label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="John Smith"
                  className={`w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary-500 dark:bg-slate-800 dark:text-white ${
                    errors['name'] ? 'border-red-400' : 'border-slate-300 dark:border-slate-600'
                  }`}
                />
                {errors['name'] && <p className="mt-1 text-xs text-red-600">{errors['name']}</p>}
              </div>

              {/* Username */}
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Username {!isEdit && <span className="text-red-500">*</span>}
                </label>
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="johnsmith"
                  disabled={isEdit}
                  className={`w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary-500 dark:bg-slate-800 dark:text-white disabled:opacity-50 disabled:bg-slate-100 dark:disabled:bg-slate-700 ${
                    errors['username'] ? 'border-red-400' : 'border-slate-300 dark:border-slate-600'
                  }`}
                />
                {isEdit && (
                  <p className="mt-1 text-xs text-slate-400">Username cannot be changed after creation.</p>
                )}
                {errors['username'] && <p className="mt-1 text-xs text-red-600">{errors['username']}</p>}
              </div>

              {/* Email + Phone */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Email</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="john@store.com"
                    className={`w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary-500 dark:bg-slate-800 dark:text-white ${
                      errors['email'] ? 'border-red-400' : 'border-slate-300 dark:border-slate-600'
                    }`}
                  />
                  {errors['email'] && <p className="mt-1 text-xs text-red-600">{errors['email']}</p>}
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Phone</label>
                  <input
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+92 300 0000000"
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary-500 dark:bg-slate-800 dark:text-white"
                  />
                </div>
              </div>

              {/* Role + Status */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Role <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={role}
                    onChange={(e) => handleRoleChange(e.target.value as UserRole)}
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary-500 dark:bg-slate-800 dark:text-white"
                  >
                    <option value="cashier">Salesman / Cashier</option>
                    <option value="manager">Manager</option>
                    <option value="super_admin">Administrator</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Status</label>
                  <select
                    value={isActive ? 'active' : 'inactive'}
                    onChange={(e) => setIsActive(e.target.value === 'active')}
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary-500 dark:bg-slate-800 dark:text-white"
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>
              </div>

              {/* Password */}
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  {isEdit ? 'New Password (leave blank to keep current)' : 'Password'}{!isEdit && <span className="text-red-500"> *</span>}
                </label>
                <div className="relative">
                  <input
                    type={showPw ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={isEdit ? '••••••••' : 'Minimum 8 characters'}
                    className={`w-full rounded-lg border px-3 py-2 pr-10 text-sm outline-none focus:ring-2 focus:ring-primary-500 dark:bg-slate-800 dark:text-white ${
                      errors['password'] ? 'border-red-400' : 'border-slate-300 dark:border-slate-600'
                    }`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw(!showPw)}
                    className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600"
                  >
                    {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {password && (() => {
                  const strength = passwordStrength(password);
                  return (
                    <div className="mt-1.5 flex items-center gap-2">
                      <div className="flex gap-0.5">
                        {[1, 2, 3, 4, 5].map((i) => (
                          <div
                            key={i}
                            className={`h-1 w-6 rounded-full transition-all ${
                              i <= strength.score ? strength.color : 'bg-slate-200 dark:bg-slate-600'
                            }`}
                          />
                        ))}
                      </div>
                      <span className="text-xs text-slate-500">{strength.label}</span>
                    </div>
                  );
                })()}
                {errors['password'] && <p className="mt-1 text-xs text-red-600">{errors['password']}</p>}
              </div>

              {/* Confirm Password */}
              {(!isEdit || password) && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Confirm Password {!isEdit && <span className="text-red-500">*</span>}
                  </label>
                  <input
                    type={showPw ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter password"
                    className={`w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary-500 dark:bg-slate-800 dark:text-white ${
                      errors['confirmPassword'] ? 'border-red-400' : 'border-slate-300 dark:border-slate-600'
                    }`}
                  />
                  {errors['confirmPassword'] && <p className="mt-1 text-xs text-red-600">{errors['confirmPassword']}</p>}
                </div>
              )}
            </div>
          )}

          {tab === 'permissions' && (
            <div>
              <div className="mb-4 flex items-center justify-between">
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Customize exactly which features this user can access. Click a section header to toggle all.
                </p>
                <button
                  type="button"
                  onClick={() => setPermissions(getDefaultPermissions(role) as Permission[])}
                  className="text-xs text-primary-600 hover:underline"
                >
                  Reset to role defaults
                </button>
              </div>
              <PermissionMatrix value={permissions} onChange={setPermissions} />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t border-slate-200 dark:border-slate-700 px-6 py-4">
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create User'}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Reset Password Dialog ────────────────────────────────────────────────────

function ResetPasswordDialog({ user, onClose, onSaved }: { user: StaffUser; onClose: () => void; onSaved: () => void }) {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleReset = async () => {
    setError('');
    if (password.length < 8) { setError('Password must be at least 8 characters'); return; }
    if (password !== confirmPassword) { setError('Passwords do not match'); return; }

    setSaving(true);
    const result = await api.staff.resetPassword(user.id, { password });
    setSaving(false);

    if (result.success) {
      setSuccess(true);
      setTimeout(() => { setSuccess(false); onSaved(); onClose(); }, 1200);
    } else {
      setError(result.error ?? 'Reset failed');
    }
  };

  if (success) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <div className="rounded-2xl bg-white dark:bg-slate-900 p-8 shadow-2xl flex flex-col items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/40">
            <Lock className="h-8 w-8 text-green-600 dark:text-green-400" />
          </div>
          <p className="text-lg font-semibold text-slate-900 dark:text-white">Password Reset</p>
          <p className="text-sm text-slate-500">Password changed successfully.</p>
        </div>
      </div>
    );
  }

  const strength = passwordStrength(password);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Reset Password</h2>
            <p className="text-sm text-slate-500">{user.name} ({user.username})</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-6 py-4 space-y-4">
          {error && (
            <div className="rounded-lg bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-400">
              {error}
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">New Password</label>
            <div className="relative">
              <input
                type={showPw ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Minimum 8 characters"
                className="w-full rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-2 pr-10 text-sm outline-none focus:ring-2 focus:ring-primary-500 dark:bg-slate-800 dark:text-white"
              />
              <button type="button" onClick={() => setShowPw(!showPw)} className="absolute right-3 top-2.5 text-slate-400">
                {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {password && (
              <div className="mt-1.5 flex items-center gap-2">
                <div className="flex gap-0.5">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <div key={i} className={`h-1 w-6 rounded-full transition-all ${i <= strength.score ? strength.color : 'bg-slate-200 dark:bg-slate-600'}`} />
                  ))}
                </div>
                <span className="text-xs text-slate-500">{strength.label}</span>
              </div>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Confirm Password</label>
            <input
              type={showPw ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Re-enter password"
              className="w-full rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary-500 dark:bg-slate-800 dark:text-white"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-slate-200 dark:border-slate-700 px-6 py-4">
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleReset} disabled={saving}>
            {saving ? 'Resetting…' : 'Reset Password'}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Confirm Dialog ───────────────────────────────────────────────────────────

function ConfirmDialog({
  title,
  message,
  confirmLabel,
  variant = 'danger',
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  variant?: 'danger' | 'warning';
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-slate-900 shadow-2xl p-6 flex flex-col gap-4">
        <h2 className={`text-lg font-semibold ${variant === 'danger' ? 'text-red-700 dark:text-red-400' : 'text-orange-700 dark:text-orange-400'}`}>
          {title}
        </h2>
        <p className="text-sm text-slate-600 dark:text-slate-400">{message}</p>
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onCancel}>Cancel</Button>
          <button
            onClick={onConfirm}
            className={`rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors ${
              variant === 'danger' ? 'bg-red-600 hover:bg-red-700' : 'bg-orange-500 hover:bg-orange-600'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Users Page ──────────────────────────────────────────────────────────

export function UsersPage() {
  const { session } = useAuthStore();
  const [users, setUsers] = useState<StaffUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterRole, setFilterRole] = useState<UserRole | 'all'>('all');
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'inactive'>('all');
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  // Dialog state
  const [showCreate, setShowCreate] = useState(false);
  const [editUser, setEditUser] = useState<StaffUser | null>(null);
  const [resetPwUser, setResetPwUser] = useState<StaffUser | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<StaffUser | null>(null);
  const [confirmToggle, setConfirmToggle] = useState<StaffUser | null>(null);
  const { onSort, icon, sortKey, sortDir } = useTableSort<UserSortKey>('name');

  const isSuperAdmin = session?.role === 'super_admin';

  const load = useCallback(async () => {
    setLoading(true);
    const result = await api.staff.list();
    if (result.success) setUsers(result.data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = () => setOpenMenuId(null);
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, []);

  const filtered = users.filter((u) => {
    if (filterRole !== 'all' && u.role !== filterRole) return false;
    if (filterStatus === 'active' && !u.isActive) return false;
    if (filterStatus === 'inactive' && u.isActive) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      if (
        !u.name.toLowerCase().includes(q) &&
        !(u.username ?? '').toLowerCase().includes(q) &&
        !(u.email ?? '').toLowerCase().includes(q)
      ) return false;
    }
    return true;
  });

  const sortedUsers = useMemo(
    () => sortByKey(filtered, sortKey, sortDir, {
      name: (u) => u.name,
      username: (u) => u.username ?? '',
      contact: (u) => `${u.email ?? ''} ${u.phone ?? ''}`,
      role: (u) => u.role,
      status: (u) => (u.isActive ? 'active' : 'inactive'),
      created: (u) => u.createdAt,
      lastLogin: (u) => u.lastLoginAt ?? '',
    }),
    [filtered, sortKey, sortDir],
  );

  const handleToggleActive = async (user: StaffUser) => {
    await api.staff.update(user.id, { isActive: !user.isActive });
    setConfirmToggle(null);
    void load();
  };

  const handleDelete = async (user: StaffUser) => {
    await api.staff.delete(user.id);
    setConfirmDelete(null);
    void load();
  };

  if (!isSuperAdmin) {
    return (
      <div className="page-shell flex items-center justify-center">
        <div className="text-center">
          <ShieldCheck className="mx-auto h-12 w-12 text-slate-300 mb-3" />
          <p className="text-slate-500">Administrator access required</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page-shell">
      {/* Dialogs */}
      {showCreate && (
        <UserFormDialog onClose={() => setShowCreate(false)} onSaved={load} />
      )}
      {editUser && (
        <UserFormDialog user={editUser} onClose={() => setEditUser(null)} onSaved={load} />
      )}
      {resetPwUser && (
        <ResetPasswordDialog user={resetPwUser} onClose={() => setResetPwUser(null)} onSaved={load} />
      )}
      {confirmDelete && (
        <ConfirmDialog
          title="Delete User"
          message={`Are you sure you want to delete "${confirmDelete.name}"? This action cannot be undone.`}
          confirmLabel="Delete"
          variant="danger"
          onConfirm={() => handleDelete(confirmDelete)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
      {confirmToggle && (
        <ConfirmDialog
          title={confirmToggle.isActive ? 'Deactivate User' : 'Activate User'}
          message={`${confirmToggle.isActive ? 'Deactivate' : 'Activate'} "${confirmToggle.name}"?`}
          confirmLabel={confirmToggle.isActive ? 'Deactivate' : 'Activate'}
          variant="warning"
          onConfirm={() => handleToggleActive(confirmToggle)}
          onCancel={() => setConfirmToggle(null)}
        />
      )}

      {/* Page Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="page-title">User Management</h1>
          <p className="text-sm text-slate-500 mt-0.5">Manage staff accounts, roles, and permissions</p>
        </div>
        <Button onClick={() => setShowCreate(true)}>
          <Plus className="h-4 w-4 mr-1" />
          Add User
        </Button>
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, username, email…"
            className="w-full rounded-lg border border-slate-300 dark:border-slate-600 pl-9 pr-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary-500 dark:bg-slate-800 dark:text-white"
          />
        </div>
        <select
          value={filterRole}
          onChange={(e) => setFilterRole(e.target.value as UserRole | 'all')}
          className="rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary-500 dark:bg-slate-800 dark:text-white"
        >
          <option value="all">All Roles</option>
          <option value="super_admin">Administrator</option>
          <option value="manager">Manager</option>
          <option value="cashier">Salesman / Cashier</option>
        </select>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value as 'all' | 'active' | 'inactive')}
          className="rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary-500 dark:bg-slate-800 dark:text-white"
        >
          <option value="all">All Status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      {/* Table */}
      <div className="panel overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-slate-400">Loading users…</div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-400">
            <ShieldCheck className="h-10 w-10 mb-2" />
            <p>No users found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
                  <SortableTh label="Name" columnKey="name" onSort={onSort} icon={icon} className="px-4 py-3 font-medium text-slate-500" />
                  <SortableTh label="Username" columnKey="username" onSort={onSort} icon={icon} className="px-4 py-3 font-medium text-slate-500" />
                  <SortableTh label="Contact" columnKey="contact" onSort={onSort} icon={icon} className="px-4 py-3 font-medium text-slate-500 hidden md:table-cell" />
                  <SortableTh label="Role" columnKey="role" onSort={onSort} icon={icon} className="px-4 py-3 font-medium text-slate-500" />
                  <SortableTh label="Status" columnKey="status" onSort={onSort} icon={icon} className="px-4 py-3 font-medium text-slate-500" />
                  <SortableTh label="Created" columnKey="created" onSort={onSort} icon={icon} className="px-4 py-3 font-medium text-slate-500 hidden lg:table-cell" />
                  <SortableTh label="Last Login" columnKey="lastLogin" onSort={onSort} icon={icon} className="px-4 py-3 font-medium text-slate-500 hidden lg:table-cell" />
                  <th className="px-4 py-3 text-right font-medium text-slate-500">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {sortedUsers.map((user) => (
                  <tr key={user.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-100 dark:bg-primary-900/40 text-primary-700 dark:text-primary-400 font-semibold text-xs uppercase shrink-0">
                          {user.name.slice(0, 2)}
                        </div>
                        <span className="font-medium text-slate-900 dark:text-white">{user.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                      {user.username ?? '—'}
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell text-slate-500 dark:text-slate-400">
                      <div>{user.email ?? '—'}</div>
                      {user.phone && <div className="text-xs">{user.phone}</div>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${ROLE_COLORS[user.role]}`}>
                        {ROLE_LABELS[user.role]}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge active={user.isActive} />
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell text-slate-500 dark:text-slate-400 text-xs">
                      {formatDate(user.createdAt)}
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell text-slate-500 dark:text-slate-400 text-xs">
                      {formatDate(user.lastLoginAt)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="relative inline-block">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenMenuId(openMenuId === user.id ? null : user.id);
                          }}
                          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-600 dark:hover:text-slate-200"
                        >
                          <MoreVertical className="h-4 w-4" />
                        </button>

                        {openMenuId === user.id && (
                          <div
                            className="absolute right-0 z-10 mt-1 w-48 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-lg py-1"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              onClick={() => { setEditUser(user); setOpenMenuId(null); }}
                              className="flex w-full items-center gap-2 px-4 py-2 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
                            >
                              <Pencil className="h-4 w-4" />
                              Edit User
                            </button>
                            <button
                              onClick={() => { setResetPwUser(user); setOpenMenuId(null); }}
                              className="flex w-full items-center gap-2 px-4 py-2 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
                            >
                              <RotateCcw className="h-4 w-4" />
                              Reset Password
                            </button>
                            <div className="my-1 border-t border-slate-100 dark:border-slate-700" />
                            <button
                              onClick={() => { setConfirmToggle(user); setOpenMenuId(null); }}
                              className="flex w-full items-center gap-2 px-4 py-2 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
                            >
                              {user.isActive ? <UserX className="h-4 w-4 text-orange-500" /> : <UserCheck className="h-4 w-4 text-green-500" />}
                              {user.isActive ? 'Deactivate' : 'Activate'}
                            </button>
                            <button
                              onClick={() => { setConfirmDelete(user); setOpenMenuId(null); }}
                              className="flex w-full items-center gap-2 px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
                            >
                              <Trash2 className="h-4 w-4" />
                              Delete User
                            </button>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="mt-4 flex gap-4 text-sm text-slate-500 dark:text-slate-400">
        <span>{users.length} total</span>
        <span>{users.filter((u) => u.isActive).length} active</span>
        <span>{users.filter((u) => !u.isActive).length} inactive</span>
      </div>
    </div>
  );
}
