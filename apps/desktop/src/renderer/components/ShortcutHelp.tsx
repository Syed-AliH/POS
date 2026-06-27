import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';

const CHECKOUT_SHORTCUTS = [
  { key: 'F1', label: 'Focus product search (type 2+ letters, ↑↓ Enter)' },
  { key: 'F2', label: 'Hold sale' },
  { key: 'F3', label: 'Resume held sale' },
  { key: 'F4', label: 'Charge / complete sale' },
  { key: 'F5', label: 'Focus customer search' },
  { key: 'F6', label: 'Focus cash tendered' },
  { key: 'Esc', label: 'Clear cart (confirm) / close dialog' },
];

const WORKFLOW_GUIDE = [
  { step: '1', label: 'Products (manager)', desc: 'Add products or import from Excel' },
  { step: '2', label: 'Checkout', desc: 'F1 search → add to cart → F4 charge' },
  { step: '3', label: 'Sales', desc: 'View receipt, reprint, or start return' },
  { step: '4', label: 'Returns', desc: 'Enter sale # → select items → F4 refund' },
];

const RETURNS_SHORTCUTS = [
  { key: 'F1', label: 'Focus sale lookup' },
  { key: 'F4', label: 'Submit return' },
];

const GLOBAL_SHORTCUTS = [
  { key: 'Alt+1…9', label: 'Jump to nav item (left to right)' },
  { key: 'F1', label: 'Page action or this help (on Checkout: search)' },
  { key: 'Shift+F1', label: 'Show keyboard shortcuts' },
];

export function ShortcutHelp() {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const session = useAuthStore((s) => s.session);

  useEffect(() => {
    const toggle = () => setOpen((v) => !v);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F1' && e.shiftKey) {
        e.preventDefault();
        toggle();
      }
      if (e.key === 'Escape' && open) {
        e.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);

  useEffect(() => {
    (window as Window & { showShortcutHelp?: () => void }).showShortcutHelp = () => setOpen(true);
    return () => {
      delete (window as Window & { showShortcutHelp?: () => void }).showShortcutHelp;
    };
  }, []);

  if (!open) return null;

  const pageShortcuts =
    location.pathname.includes('/checkout')
      ? CHECKOUT_SHORTCUTS
      : location.pathname.includes('/returns')
        ? RETURNS_SHORTCUTS
        : [];

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[100]" onClick={() => setOpen(false)}>
      <div className="panel w-full max-w-lg p-6 shadow-xl dark:shadow-none" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-1 text-lg font-semibold text-slate-900 dark:text-slate-50">Keyboard Shortcuts</h3>
        <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">Logged in as {session?.name} ({session?.role})</p>

        <div className="space-y-4 max-h-[28rem] overflow-y-auto">
          {pageShortcuts.length > 0 && (
            <section>
              <h4 className="text-xs font-semibold text-slate-400 uppercase mb-2">This page</h4>
              {pageShortcuts.map((s) => (
                <div key={s.key} className="flex justify-between border-b border-slate-100 py-1.5 text-sm dark:border-slate-800">
                  <span className="text-slate-700 dark:text-slate-300">{s.label}</span>
                  <kbd className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs dark:bg-slate-800 dark:text-slate-200">{s.key}</kbd>
                </div>
              ))}
            </section>
          )}
          <section>
            <h4 className="text-xs font-semibold text-slate-400 uppercase mb-2">Full POS workflow</h4>
            {WORKFLOW_GUIDE.map((w) => (
              <div key={w.step} className="flex gap-3 py-1.5 text-sm border-b border-slate-100">
                <span className="w-5 h-5 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center text-xs font-bold shrink-0">{w.step}</span>
                <div><span className="font-medium">{w.label}</span><span className="text-slate-500"> — {w.desc}</span></div>
              </div>
            ))}
          </section>
          <section>
            <h4 className="text-xs font-semibold text-slate-400 uppercase mb-2">Global</h4>
            {GLOBAL_SHORTCUTS.map((s) => (
              <div key={s.key} className="flex justify-between py-1.5 text-sm border-b border-slate-100">
                <span>{s.label}</span>
                <kbd className="px-2 py-0.5 bg-slate-100 rounded text-xs font-mono">{s.key}</kbd>
              </div>
            ))}
          </section>
        </div>

        <button
          type="button"
          onClick={() => setOpen(false)}
          className="w-full mt-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg"
        >
          Close (Esc)
        </button>
      </div>
    </div>
  );
}
