/** Word separators: whitespace plus common punctuation used inside product names. */
const WORD_SPLIT = /[\s\-/\\,._()[\]|+&]+/;

export function firstWordOf(name: string): string {
  return wordsOf(name)[0] ?? '';
}

export function wordsOf(name: string): string[] {
  return name.trim().split(WORD_SPLIT).filter(Boolean);
}

/** True when the query is a prefix of any individual word in the product name. */
export function matchesWordPrefix(productName: string, query: string): boolean {
  const prefix = query.trim().toLowerCase();
  if (!prefix) return true;
  // A multi-word query is matched word-for-word: each term must prefix some word.
  const terms = prefix.split(WORD_SPLIT).filter(Boolean);
  const words = wordsOf(productName).map((w) => w.toLowerCase());
  return terms.every((term) => words.some((word) => word.startsWith(term)));
}

/**
 * Master search: the product name itself starts with the query, so typing "a" lists
 * the products that begin with A — not every product that happens to contain a word
 * starting with A. Refine is the filter that looks inside the name.
 */
export function matchesMasterSearch(productName: string, master: string): boolean {
  const prefix = master.trim().toLowerCase();
  if (!prefix) return true;
  return productName.trim().toLowerCase().startsWith(prefix);
}

/** Refine: narrows the master results — any word of the name starts with the query. */
export function matchesRefineSearch(productName: string, refine: string): boolean {
  return matchesWordPrefix(productName, refine);
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

  // No default cap: this filters an in-memory catalogue, and a cap (it was 500 with no
  // filter, 200 with one) silently dropped products from product search once the shop
  // passed 500 items — browsing never showed the rest, a broad filter stopped at 200.
  return limit != null ? filtered.slice(0, limit) : filtered;
}
