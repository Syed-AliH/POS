import { closeTopModal, hasOpenModal } from './modalStack';

type ShortcutHandler = () => void;

const pageHandlersByRoute = new Map<string, Map<string, ShortcutHandler>>();
let activeRoute = '';
let globalHandlers = new Map<string, ShortcutHandler>();
let initialized = false;

export function setActiveRoute(path: string): void {
  activeRoute = path;
}

export function getActiveRoute(): string {
  return activeRoute;
}

export function normalizeShortcutKey(key: string): string {
  if (/^f\d{1,2}$/i.test(key)) return key.toUpperCase();
  return key;
}

export function registerPageShortcuts(route: string, handlers: Record<string, ShortcutHandler>): () => void {
  const map = new Map(
    Object.entries(handlers).map(([key, handler]) => [normalizeShortcutKey(key), handler]),
  );
  pageHandlersByRoute.set(route, map);
  return () => {
    pageHandlersByRoute.delete(route);
  };
}

export function registerGlobalShortcuts(handlers: Record<string, ShortcutHandler>): () => void {
  globalHandlers = new Map(
    Object.entries(handlers).map(([key, handler]) => [normalizeShortcutKey(key), handler]),
  );
  return () => {
    globalHandlers.clear();
  };
}

function dispatchShortcut(key: string): boolean {
  // Nothing behind an open dialog reacts to shortcuts — F4 must not charge the sale
  // from inside product search. F-keys arrive here over IPC too, so the check lives here.
  if (hasOpenModal()) return false;
  const normalized = normalizeShortcutKey(key);
  const pageHandler = pageHandlersByRoute.get(activeRoute)?.get(normalized);
  if (pageHandler) {
    pageHandler();
    return true;
  }
  const globalHandler = globalHandlers.get(normalized);
  if (globalHandler) {
    globalHandler();
    return true;
  }
  return false;
}

function handleKeyDown(e: KeyboardEvent): void {
  const key = normalizeShortcutKey(e.key);
  const isFn = /^F\d{1,2}$/.test(key);

  if (key === 'Escape') {
    // An open dialog owns Escape: close the top one and stop there. The page's own
    // Escape (e.g. checkout's "Clear cart?") runs later, in the bubble phase, and only
    // if nothing focused — an inline quantity editor, say — already handled the key.
    if (closeTopModal()) {
      e.preventDefault();
      e.stopPropagation();
    }
    return;
  }

  if (isFn) {
    if (dispatchShortcut(key)) {
      e.preventDefault();
      e.stopPropagation();
    }
    return;
  }

  if (e.altKey && /^[1-9]$/.test(e.key)) {
    if (dispatchShortcut(`Alt+${e.key}`)) {
      e.preventDefault();
      e.stopPropagation();
    }
    return;
  }

  if (e.ctrlKey && !e.altKey && !e.metaKey && key.length === 1) {
    if (dispatchShortcut(`Ctrl+${key.toUpperCase()}`)) {
      e.preventDefault();
      e.stopPropagation();
    }
  }
}

function handleEscapeBubble(e: KeyboardEvent): void {
  if (e.key !== 'Escape' || e.defaultPrevented) return;
  if (dispatchShortcut('Escape')) e.preventDefault();
}

export function initShortcutBridge(): () => void {
  if (initialized) return () => undefined;
  initialized = true;

  window.addEventListener('keydown', handleKeyDown, true);
  window.addEventListener('keydown', handleEscapeBubble);

  const unsubscribeIpc = window.electron?.shortcuts?.onKey?.((key) => {
    dispatchShortcut(key);
  });

  return () => {
    window.removeEventListener('keydown', handleKeyDown, true);
    window.removeEventListener('keydown', handleEscapeBubble);
    unsubscribeIpc?.();
    pageHandlersByRoute.clear();
    activeRoute = '';
    globalHandlers.clear();
    initialized = false;
  };
}

export function focusElement(ref: { current: HTMLElement | null }, flash = true): void {
  const el = ref.current;
  if (!el) return;
  el.focus();
  if (flash && el instanceof HTMLInputElement) {
    el.select();
    el.classList.add('ring-4', 'ring-primary-400');
    window.setTimeout(() => el.classList.remove('ring-4', 'ring-primary-400'), 600);
  }
}
