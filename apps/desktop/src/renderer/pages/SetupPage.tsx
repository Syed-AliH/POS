import { useState } from 'react';
import { Globe, ShoppingCart } from 'lucide-react';
import { Button, Input } from '@mama-babi/ui';
import { apiUrlValidationError } from '@shared/apiUrl';
import { IPC_CHANNELS } from '@shared/ipc-channels';

interface Props {
  onSaved: () => void;
}

export function SetupPage({ onSaved }: Props) {
  const [apiUrl, setApiUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    const url = apiUrl.trim();
    const validationError = apiUrlValidationError(url);
    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);
    setError(null);

    const ping = await window.electron.ipcRenderer.invoke(IPC_CHANNELS.APP_SAVE_CONFIG, { apiUrl: url }) as {
      success: boolean;
      error?: string;
    };
    if (!ping?.success) {
      setError(ping.error ?? 'Failed to save configuration.');
      setSaving(false);
      return;
    }

    const health = await window.electron.ipcRenderer.invoke(IPC_CHANNELS.APP_PING_SERVER) as {
      ok: boolean;
      error?: string;
    };
    if (!health?.ok) {
      setError(health.error ?? 'Could not connect to that server.');
      setSaving(false);
      return;
    }

    setSaving(false);
    onSaved();
  };

  return (
    <div className="flex h-screen items-center justify-center bg-surface-muted px-4 dark:bg-slate-950">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-card dark:border-slate-800 dark:bg-slate-900">

        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-primary-50 text-primary-600 dark:bg-primary-950">
            <ShoppingCart className="h-7 w-7" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Welcome to Mama Babi POS</h1>
          <p className="mt-1 text-sm text-slate-500">One-time server setup required</p>
        </div>

        <div className="mb-6 flex gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 dark:border-blue-800 dark:bg-blue-950/40">
          <Globe className="mt-0.5 h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
          <p className="text-xs text-blue-700 dark:text-blue-300">
            Enter your <strong>POS API server URL</strong> — not the database link.
            Example: <code className="text-blue-800 dark:text-blue-200">http://localhost:3001</code> for local testing,
            or your hosted API like <code className="text-blue-800 dark:text-blue-200">https://api.yourbusiness.com</code>.
          </p>
        </div>

        <div className="space-y-4">
          <Input
            label="API Server URL"
            value={apiUrl}
            onChange={(e) => { setApiUrl(e.target.value); setError(null); }}
            placeholder="http://localhost:3001"
            disabled={saving}
            autoFocus
            onKeyDown={(e) => { if (e.key === 'Enter') void handleSave(); }}
          />

          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/40 dark:text-red-400">
              {error}
            </p>
          )}

          <Button
            className="w-full"
            size="lg"
            onClick={() => void handleSave()}
            loading={saving}
            disabled={!apiUrl.trim() || saving}
          >
            {saving ? 'Connecting…' : 'Save & Continue'}
          </Button>
        </div>

        <p className="mt-6 text-center text-xs text-slate-400">
          The database runs on the server — you only need the API address here.
        </p>
      </div>
    </div>
  );
}
