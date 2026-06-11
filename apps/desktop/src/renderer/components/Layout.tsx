import { Suspense, useEffect, useMemo } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { useCartStore } from '../stores/cartStore';
import { useAutoLock } from '../hooks/useAutoLock';
import { initShortcutBridge, registerGlobalShortcuts, setActiveRoute } from '../lib/shortcuts';
import { ShortcutHelp } from './ShortcutHelp';
import { ToastHost } from './ToastHost';

const navItems = [
  { to: '/checkout', label: 'Checkout', roles: ['cashier', 'manager', 'super_admin'] },
  { to: '/returns', label: 'Returns', roles: ['cashier', 'manager', 'super_admin'] },
  { to: '/sales', label: 'Sales', roles: ['cashier', 'manager', 'super_admin'] },
  { to: '/dashboard', label: 'Dashboard', roles: ['manager', 'super_admin'] },
  { to: '/products', label: 'Products', roles: ['manager', 'super_admin'] },
  { to: '/grn', label: 'GRN', roles: ['manager', 'super_admin'] },
  { to: '/reports', label: 'Reports', roles: ['manager', 'super_admin'] },
  { to: '/more', label: 'More', roles: ['manager', 'super_admin'] },
  { to: '/settings', label: 'Settings', roles: ['manager', 'super_admin'] },
];

const WORKFLOW_HINTS: Record<string, string> = {
  '/checkout': 'F1 search · F4 charge · F2 hold · F3 resume',
  '/returns': 'F1 sale lookup · F4 process return',
  '/products': 'Add product → Test in Checkout',
  '/grn': 'F1 product search · add lines and save or finalize',
  '/sales': 'Return or reprint from sale row',
};

export function Layout() {
  const { session, logout } = useAuthStore();
  const cartItems = useCartStore((s) => s.items.length);
  const clearCart = useCartStore((s) => s.clear);
  const navigate = useNavigate();
  const location = useLocation();
  useAutoLock();

  const workflowHint = Object.entries(WORKFLOW_HINTS).find(([path]) => location.pathname.includes(path))?.[1];

  const visibleNav = useMemo(
    () => navItems.filter((item) => session && item.roles.includes(session.role)),
    [session],
  );

  useEffect(() => initShortcutBridge(), []);

  useEffect(() => {
    setActiveRoute(location.pathname);
  }, [location.pathname]);

  useEffect(() => {
    const altNav: Record<string, () => void> = {};
    visibleNav.forEach((item, index) => {
      altNav[`Alt+${index + 1}`] = () => navigate(item.to);
    });
    altNav.F1 = () => window.showShortcutHelp?.();
    return registerGlobalShortcuts(altNav);
  }, [visibleNav, navigate]);

  return (
    <div className="h-screen flex flex-col">
      <header className="bg-white border-b border-slate-200 px-4 py-2 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-6">
          <h1 className="text-lg font-bold text-pink-700">Mama Babi POS</h1>
          <nav className="flex gap-1 overflow-x-auto max-w-[70vw]">
            {visibleNav.map((item, index) => (
              <NavLink
                key={item.to}
                to={item.to}
                title={`Alt+${index + 1}`}
                className={({ isActive }) =>
                  `px-4 py-2 rounded-lg text-sm font-medium min-h-[44px] flex items-center ${
                    isActive ? 'bg-pink-100 text-pink-800' : 'text-slate-600 hover:bg-slate-100'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => window.showShortcutHelp?.()}
            className="text-xs text-slate-500 hover:text-pink-700 px-2 py-1 rounded hover:bg-slate-100"
            title="Shift+F1"
          >
            Shortcuts
          </button>
          <span className="text-xs px-2 py-1 rounded bg-slate-100 text-slate-600">Offline</span>
          <span className="text-sm text-slate-700">{session?.name}</span>
          <button
            onClick={() => {
              if (cartItems > 0) {
                if (!confirm(`Cart has ${cartItems} item(s). Logout anyway?`)) return;
                clearCart();
              }
              logout();
            }}
            className="text-sm text-slate-500 hover:text-red-600 min-h-[44px] px-3"
          >
            Logout
          </button>
        </div>
      </header>
      {workflowHint && (
        <div className="px-4 py-1.5 bg-pink-50 border-b border-pink-100 text-xs text-pink-800 shrink-0">
          {workflowHint}
        </div>
      )}
      <main className="flex-1 overflow-hidden">
        <Suspense
          fallback={(
            <div className="h-full flex items-center justify-center text-slate-500">
              Loading…
            </div>
          )}
        >
          <Outlet />
        </Suspense>
      </main>
      <ShortcutHelp />
      <ToastHost />
    </div>
  );
}
