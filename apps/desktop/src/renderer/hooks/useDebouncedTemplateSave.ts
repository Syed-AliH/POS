import { useEffect, useRef } from 'react';

/**
 * Persists draft changes to the database after the user stops editing.
 * Flushes any pending save when the component unmounts (e.g. navigating to Labels).
 */
export function useDebouncedTemplateSave(
  dirty: boolean,
  save: (options?: { silent?: boolean }) => Promise<unknown>,
  debounceMs = 800,
) {
  const readyRef = useRef(false);
  const saveRef = useRef(save);
  const dirtyRef = useRef(dirty);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  saveRef.current = save;
  dirtyRef.current = dirty;

  useEffect(() => {
    const t = setTimeout(() => {
      readyRef.current = true;
    }, 400);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!readyRef.current || !dirty) return;

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void saveRef.current({ silent: true });
    }, debounceMs);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [dirty, debounceMs]);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (dirtyRef.current && readyRef.current) {
        void saveRef.current({ silent: true });
      }
    };
  }, []);
}
