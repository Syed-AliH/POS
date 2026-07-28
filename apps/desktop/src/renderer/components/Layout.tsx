import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Moon, Sun, Keyboard } from 'lucide-react';
import { Spinner } from '@mama-babi/ui';
import { IPC_CHANNELS } from '@shared/ipc-channels';
import { useAuthStore } from '../stores/authStore';
import { useCartStore } from '../stores/cartStore';
import { useThemeStore } from '../stores/themeStore';
import { toast } from '../stores/toastStore';
import { initShortcutBridge, registerGlobalShortcuts, setActiveRoute } from '../lib/shortcuts';
import { flattenNavForShortcuts, Sidebar } from './layout/Sidebar';
import { ShortcutHelp } from './ShortcutHelp';
import { ToastHost } from './ToastHost';
import { UpdateNotifier } from './UpdateNotifier';

const WORKFLOW_HINTS: Record<string, string> = {
  '/checkout': 'F1 search · F4 charge · F2 hold · F3 resume',
  '/returns': 'F1 sale lookup · F4 process return',
  '/products': 'Add product → Test in Checkout',
  '/grn': 'F1 product search · add lines and save or finalize',
  '/sales': 'Return or reprint from sale row',
};

type ServerStatus = 'checking' | 'online' | 'offline';

function ServerStatusBadge() {
  const [status, setStatus] = useState<ServerStatus>('checking');

  const checkServer = useCallback(async () => {
    try {
      const result = await window.electron.ipcRenderer.invoke(IPC_CHANNELS.APP_PING_SERVER) as {
        ok: boolean;
        error?: string;
      };
      setStatus(result?.ok ? 'online' : 'offline');
    } catch {
      setStatus('offline');
    }
  }, []);

  useEffect(() => {
    void checkServer();
    const id = setInterval(() => void checkServer(), 30_000);
    return () => clearInterval(id);
  }, [checkServer]);

  if (status === 'checking') {
    return (
      <span className="hidden rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400 sm:inline">
        Checking…
      </span>
    );
  }

  if (status === 'online') {
    return (
      <span className="hidden rounded-md bg-green-50 px-2 py-1 text-xs font-medium text-green-700 dark:bg-green-950 dark:text-green-400 sm:inline">
        Online
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => void checkServer()}
      className="hidden rounded-md bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100 dark:bg-amber-950 dark:text-amber-300 dark:hover:bg-amber-900 sm:inline"
      title="Cannot reach the API server — click to retry"
    >
      Offline
    </button>
  );
}

export function Layout() {
  const { session, logout } = useAuthStore();
  const cartItems = useCartStore((s) => s.items.length);
  const clearCart = useCartStore((s) => s.clear);
  const { theme, toggleTheme } = useThemeStore();
  const navigate = useNavigate();
  const location = useLocation();

  const workflowHint = Object.entries(WORKFLOW_HINTS).find(([path]) => location.pathname.includes(path))?.[1];

  // Receipts print asynchronously so the till is never blocked; a failure has to be
  // loud, because the cashier has already moved on to the next customer.
  useEffect(() => {
    return window.electron?.print?.onStatus?.((s) => {
      if (s.state === 'failed') {
        toast.error(`Receipt ${s.saleNumber} did not print — ${s.error ?? 'printer error'}`);
      }
    });
  }, []);

  const visibleNav = useMemo(
    () => (session ? flattenNavForShortcuts(session.role) : []),
    [session],
  );

  useEffect(() => initShortcutBridge(), []);

  useEffect(() => {
    setActiveRoute(location.pathname);
  }, [location.pathname]);

  useEffect(() => {
    const altNav: Record<string, () => void> = {};
    visibleNav.slice(0, 9).forEach((item, index) => {
      altNav[`Alt+${index + 1}`] = () => navigate(item.to);
    });
    altNav.F1 = () => window.showShortcutHelp?.();
    return registerGlobalShortcuts(altNav);
  }, [visibleNav, navigate]);

  if (!session) return null;

  return (
    <div className="flex h-screen bg-surface-muted dark:bg-slate-950">
      <Sidebar role={session.role} />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center justify-between border-b border-slate-200 bg-white/95 px-4 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
          <div className="min-w-0">
            {workflowHint && (
              <p className="truncate text-xs font-medium text-primary-700 dark:text-primary-300">{workflowHint}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => window.showShortcutHelp?.()}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
              title="Shift+F1"
            >
              <Keyboard className="h-4 w-4" />
              <span className="hidden sm:inline">Shortcuts</span>
            </button>
            <button
              type="button"
              onClick={toggleTheme}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
              aria-label="Toggle theme"
            >
              {theme === 'light' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
            </button>
            <ServerStatusBadge />
            <span className="hidden text-sm font-medium text-slate-700 dark:text-slate-300 md:inline">{session.name}</span>
            <button
              type="button"
              onClick={() => {
                if (cartItems > 0) {
                  if (!confirm(`Cart has ${cartItems} item(s). Logout anyway?`)) return;
                  clearCart();
                }
                logout();
              }}
              className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-danger-600 dark:text-slate-400 dark:hover:bg-slate-800"
            >
              Logout
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-hidden">
          <Suspense fallback={<Spinner className="h-full" label="Loading page…" />}>
            <Outlet />
          </Suspense>
        </main>
      </div>

      <ShortcutHelp />
      <ToastHost />
      <UpdateNotifier />
    </div>
  );
}
