import { useCallback, useMemo, useState } from 'react';

export type SortDir = 'asc' | 'desc';

export function compareSortValues(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), undefined, { sensitivity: 'base' });
}

export function useTableSort<K extends string>(initialKey: K, initialDir: SortDir = 'asc') {
  const [sortKey, setSortKey] = useState<K>(initialKey);
  const [sortDir, setSortDir] = useState<SortDir>(initialDir);

  const onSort = useCallback((key: K) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir('asc');
    }
  }, [sortKey]);

  const icon = useCallback(
    (key: K) => (sortKey === key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''),
    [sortKey, sortDir],
  );

  return { sortKey, sortDir, onSort, icon };
}

export function useSortedRows<T, K extends string>(
  rows: T[],
  sortKey: K,
  sortDir: SortDir,
  getValue: (row: T, key: K) => unknown,
): T[] {
  return useMemo(() => {
    const sorted = [...rows].sort((a, b) => {
      const cmp = compareSortValues(getValue(a, sortKey), getValue(b, sortKey));
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [rows, sortKey, sortDir, getValue]);
}

export function sortByKey<T, K extends string>(
  rows: T[],
  sortKey: K,
  sortDir: SortDir,
  accessors: Record<K, (row: T) => unknown>,
): T[] {
  const getValue = accessors[sortKey];
  return [...rows].sort((a, b) => {
    const cmp = compareSortValues(getValue(a), getValue(b));
    return sortDir === 'asc' ? cmp : -cmp;
  });
}
