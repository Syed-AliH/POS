export function firstWordOf(name: string): string {
  return name.trim().split(/\s+/)[0] ?? '';
}

export function wordsOf(name: string): string[] {
  return name.trim().split(/\s+/).filter(Boolean);
}

/** Master search: first word of product name starts with query (case-insensitive). */
export function matchesMasterSearch(productName: string, master: string): boolean {
  const prefix = master.trim().toLowerCase();
  if (!prefix) return true;
  return firstWordOf(productName).toLowerCase().startsWith(prefix);
}

/** Refine: partial, case-insensitive match on any word in the product name. */
export function matchesRefineSearch(productName: string, refine: string): boolean {
  const term = refine.trim().toLowerCase();
  if (!term) return true;
  return wordsOf(productName).some((word) => word.toLowerCase().includes(term));
}

export interface AdvancedProductSearchFilters {
  sku?: string;
  master?: string;
  refine?: string;
}

export function filterProductsByAdvancedSearch<T extends { name: string; sku: string; barcode: string | null }>(
  rows: T[],
  input: AdvancedProductSearchFilters,
  limit?: number,
): T[] {
  let filtered = rows;

  if (input.sku?.trim()) {
    const s = input.sku.trim().toLowerCase();
    filtered = filtered.filter(
      (r) => r.sku.toLowerCase().startsWith(s) || (r.barcode ?? '').toLowerCase().startsWith(s),
    );
  }
  if (input.master?.trim()) {
    const master = input.master.trim();
    filtered = filtered.filter((r) => matchesMasterSearch(r.name, master));
  }
  if (input.refine?.trim()) {
    const refine = input.refine.trim();
    filtered = filtered.filter((r) => matchesRefineSearch(r.name, refine));
  }

  const hasFilter = !!(input.sku?.trim() || input.master?.trim() || input.refine?.trim());
  const max = limit ?? (hasFilter ? 50 : 500);
  return filtered.slice(0, max);
}
