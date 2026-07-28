import { useEffect, useState } from 'react';
import { Database, Eye, EyeOff, ShieldCheck } from 'lucide-react';
import { Button } from '@mama-babi/ui';
import { IPC_CHANNELS } from '@shared/ipc-channels';
import { formatDateTime } from '@shared/datetime';
import type { DatabaseConnectionInfo } from '@shared/databaseUrl';

type Result<T> = { success: true; data: T } | { success: false; error: string };
type DbConfig = DatabaseConnectionInfo & { editable: boolean };

type Feedback = { kind: 'success' | 'error' | 'info'; text: string } | null;

function invoke<T>(channel: string, ...args: unknown[]): Promise<Result<T>> {
  return window.electron.ipcRenderer.invoke(channel, ...args) as Promise<Result<T>>;
}

export function DatabaseSettings() {
  const [config, setConfig] = useState<DbConfig | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const loadConfig = async () => {
    const result = await invoke<DbConfig>(IPC_CHANNELS.DB_GET_CONFIG);
    if (result.success) {
      setConfig(result.data);
      setLoadError(null);
    } else {
      setLoadError(result.error);
    }
  };

  useEffect(() => {
    void loadConfig();
  }, []);

  const busy = testing || saving;
  const canSubmit = password.length > 0 && !busy && config?.editable;

  const handleTest = async () => {
    setTesting(true);
    setFeedback(null);
    const result = await invoke<{ ok: true }>(IPC_CHANNELS.DB_TEST_CONNECTION, password);
    setTesting(false);
    setFeedback(
      result.success
        ? { kind: 'success', text: 'Connection succeeded. This password works — click Save to apply it.' }
        : { kind: 'error', text: result.error },
    );
  };

  const handleSave = async () => {
    setSaving(true);
    setFeedback({ kind: 'info', text: 'Verifying the password and restarting the database connection…' });
    const result = await invoke<{ restarted: boolean }>(IPC_CHANNELS.DB_SAVE_PASSWORD, password);
    setSaving(false);

    if (!result.success) {
      setFeedback({ kind: 'error', text: result.error });
      return;
    }

    setPassword('');
    setShowPassword(false);
    await loadConfig();
    setFeedback({
      kind: 'success',
      text: result.data.restarted
        ? 'Password saved. The app is now connected using the new password.'
        : 'Password saved and verified, but the background service did not restart. Restart the app to finish applying it.',
    });
  };

  if (loadError) {
    return (
      <div className="panel max-w-2xl p-6">
        <p className="text-sm text-red-600">{loadError}</p>
      </div>
    );
  }

  if (!config) {
    return (
      <div className="panel max-w-2xl p-6">
        <p className="text-sm text-slate-500">Loading database settings…</p>
      </div>
    );
  }

  return (
    <div className="panel max-w-2xl space-y-6 p-6">
      <div className="flex items-start gap-3">
        <Database className="mt-0.5 h-5 w-5 shrink-0 text-primary-500" />
        <div>
          <h3 className="font-semibold text-slate-900 dark:text-slate-100">Database Connection</h3>
          <p className="mt-0.5 text-sm text-slate-500">
            Update the password here whenever it is changed on the database server. No reinstall needed.
          </p>
        </div>
      </div>

      {/* Read-only context so the admin can confirm which database they are changing. */}
      <dl className="grid grid-cols-1 gap-3 rounded-xl bg-slate-50 p-4 text-sm sm:grid-cols-2 dark:bg-slate-800">
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-400">Host</dt>
          <dd className="mt-0.5 break-all font-medium text-slate-700 dark:text-slate-200">{config.host}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-400">Database</dt>
          <dd className="mt-0.5 font-medium text-slate-700 dark:text-slate-200">{config.database}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-400">Username</dt>
          <dd className="mt-0.5 font-medium text-slate-700 dark:text-slate-200">{config.username}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-400">Password last changed</dt>
          <dd className="mt-0.5 font-medium text-slate-700 dark:text-slate-200">
            {config.passwordUpdatedAt ? formatDateTime(config.passwordUpdatedAt) : 'Never changed here'}
          </dd>
        </div>
      </dl>

      {!config.editable ? (
        <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">
          This terminal connects through a remote server, so the database password is managed on that
          server rather than here.
        </p>
      ) : (
        <>
          <div>
            <label htmlFor="db-password" className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
              New database password
            </label>
            <div className="relative">
              <input
                id="db-password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setFeedback(null);
                }}
                disabled={busy}
                autoComplete="off"
                spellCheck={false}
                placeholder={config.hasStoredPassword ? 'Enter the new password' : 'Enter the database password'}
                className="w-full rounded-lg border px-3 py-2 pr-20 font-mono text-sm disabled:bg-slate-50"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                disabled={busy}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1 rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700"
              >
                {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
            <p className="mt-1.5 flex items-center gap-1.5 text-xs text-slate-400">
              <ShieldCheck className="h-3.5 w-3.5" />
              Encrypted with Windows account protection before it is written to disk.
            </p>
          </div>

          {feedback && (
            <p
              className={`rounded-xl px-4 py-3 text-sm ${
                feedback.kind === 'success'
                  ? 'bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300'
                  : feedback.kind === 'error'
                    ? 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300'
                    : 'bg-slate-50 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
              }`}
            >
              {feedback.text}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => void handleSave()} disabled={!canSubmit}>
              {saving ? 'Saving…' : 'Save & apply'}
            </Button>
            <button
              type="button"
              onClick={() => void handleTest()}
              disabled={!canSubmit}
              className="rounded-lg border px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              {testing ? 'Testing…' : 'Test connection'}
            </button>
          </div>

          <p className="text-xs text-slate-400">
            The password is checked against the database before anything is saved. If it is wrong, the
            current connection is left untouched. Saving briefly restarts the background service, so
            avoid doing it mid-sale.
          </p>
        </>
      )}
    </div>
  );
}
