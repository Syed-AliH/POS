import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, RefreshCw, ShoppingCart, Wifi, WifiOff } from 'lucide-react';
import { Button, Input } from '@mama-babi/ui';
import { IPC_CHANNELS } from '@shared/ipc-channels';
import { useAuthStore } from '../stores/authStore';

type ServerStatus = 'checking' | 'online' | 'offline';

const isNetworkError = (msg: string | null) =>
  !!msg && (msg.includes('reach') || msg.includes('network') || msg.includes('connect') || msg.includes('fetch') || msg.includes('Server URL'));

export function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [serverStatus, setServerStatus] = useState<ServerStatus>('checking');
  const { login, loading, loginError, clearLoginError } = useAuthStore();
  const navigate = useNavigate();

  const checkServer = async () => {
    setServerStatus('checking');
    try {
      const result = await window.electron.ipcRenderer.invoke(IPC_CHANNELS.APP_PING_SERVER) as {
        ok: boolean;
        error?: string;
      };
      setServerStatus(result?.ok ? 'online' : 'offline');
    } catch {
      setServerStatus('offline');
    }
  };

  useEffect(() => {
    void checkServer();
  }, []);

  useEffect(() => {
    if (serverStatus !== 'offline') return;
    const id = setInterval(() => void checkServer(), 15_000);
    return () => clearInterval(id);
  }, [serverStatus]);

  useEffect(() => {
    if (isNetworkError(loginError)) setServerStatus('offline');
  }, [loginError]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) return;
    clearLoginError();
    const ok = await login(username.trim(), password);
    if (ok) {
      setPassword('');
      navigate('/');
    }
  };

  const networkProblem = isNetworkError(loginError);

  return (
    <div className="flex h-screen items-center justify-center bg-surface-muted px-4 dark:bg-slate-950">
      <div className="w-full max-w-md">

        {serverStatus === 'offline' && (
          <div className="mb-4 flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 dark:border-red-800 dark:bg-red-950/50">
            <WifiOff className="h-5 w-5 shrink-0 text-red-500" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-red-700 dark:text-red-400">Server unreachable</p>
              <p className="text-xs text-red-600 dark:text-red-500 mt-0.5">
                Make sure the API server is running. For local testing use http://localhost:3001
              </p>
            </div>
            <button
              onClick={() => void checkServer()}
              className="shrink-0 rounded-lg p-1.5 text-red-500 hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors"
              title="Retry connection"
              type="button"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
        )}

        {serverStatus === 'online' && (
          <div className="mb-4 flex items-center gap-2 rounded-xl border border-green-200 bg-green-50 px-4 py-2 dark:border-green-800 dark:bg-green-950/40">
            <Wifi className="h-4 w-4 text-green-600 dark:text-green-400" />
            <p className="text-xs font-medium text-green-700 dark:text-green-400">Connected to server</p>
          </div>
        )}

        <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-card dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-8 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-primary-50 text-primary-600 dark:bg-primary-950">
              <ShoppingCart className="h-7 w-7" />
            </div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Mama Babi POS</h1>
            <p className="mt-1 text-sm text-slate-500">Enterprise point of sale</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              label="Username"
              value={username}
              onChange={(e) => { setUsername(e.target.value); clearLoginError(); }}
              autoComplete="username"
              disabled={loading || serverStatus === 'offline'}
              placeholder="Enter username"
            />
            <Input
              label="Password"
              type="password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); clearLoginError(); }}
              autoComplete="current-password"
              disabled={loading || serverStatus === 'offline'}
              placeholder="Enter password"
            />
            <Button
              type="submit"
              className="w-full"
              size="lg"
              loading={loading}
              disabled={!username.trim() || !password || serverStatus === 'offline'}
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>

          {loginError && (
            <div className={`mt-4 flex items-start gap-2 rounded-lg px-3 py-2.5 text-sm ${
              networkProblem
                ? 'bg-orange-50 text-orange-700 dark:bg-orange-950/40 dark:text-orange-400'
                : 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400'
            }`}>
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{loginError}</span>
            </div>
          )}

          {serverStatus === 'checking' && (
            <p className="mt-4 text-center text-xs text-slate-400 animate-pulse">Connecting to server…</p>
          )}
        </div>
      </div>
    </div>
  );
}
