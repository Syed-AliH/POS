import { useEffect, useRef } from 'react';
import { useAuthStore } from '../stores/authStore';

const LOCK_MS = 5 * 60 * 1000;

export function useAutoLock() {
  const logout = useAuthStore((s) => s.logout);
  const session = useAuthStore((s) => s.session);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!session) return;

    const reset = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => logout(), LOCK_MS);
    };

    const events = ['mousedown', 'keydown', 'touchstart', 'scroll'];
    events.forEach((e) => window.addEventListener(e, reset));
    reset();

    return () => {
      if (timer.current) clearTimeout(timer.current);
      events.forEach((e) => window.removeEventListener(e, reset));
    };
  }, [session, logout]);
}
