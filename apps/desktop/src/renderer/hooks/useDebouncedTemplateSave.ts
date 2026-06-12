import { useEffect, useRef } from 'react';

/**
 * Persists draft changes to the database after the user stops editing.
 */
export function useDebouncedTemplateSave(
  dirty: boolean,
  save: (options?: { silent?: boolean }) => Promise<boolean>,
  debounceMs = 1500,
) {
  const readyRef = useRef(false);
  const saveRef = useRef(save);
  saveRef.current = save;

  useEffect(() => {
    const t = setTimeout(() => {
      readyRef.current = true;
    }, 400);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!readyRef.current || !dirty) return;

    const timer = setTimeout(() => {
      void saveRef.current({ silent: true });
    }, debounceMs);

    return () => clearTimeout(timer);
  }, [dirty, debounceMs]);
}
