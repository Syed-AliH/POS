let skuCounter = Date.now() % 100000;

export function generateSku(prefix = 'MB'): string {
  skuCounter += 1;
  return `${prefix}-${String(skuCounter).padStart(6, '0')}`;
}

/**
 * Generate a unique 10-digit numeric barcode.
 * 10 digits is not a valid EAN/UPC length, so JsBarcode always renders it
 * as CODE128 — giving a consistent barcode type for all products.
 */
export function generateBarcode(): string {
  const base = Date.now().toString().slice(-8);
  return `89${base.padStart(8, '0').slice(0, 8)}`;  // "89" + 8 digits = 10 digits
}

const MAX_SKU_PREFIX_LEN = 4;

function cleanWordLetters(word: string): string {
  return word.replace(/[^a-zA-Z]/g, '').toUpperCase();
}

/**
 * Ordered prefix candidates for a category name (shortest first, max 4 chars).
 * Two+ words: BS → BST (first + first + last of second word) → further variants on collision.
 */
export function generateSkuPrefixCandidates(categoryName: string): string[] {
  const words = categoryName.trim().split(/\s+/).filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];

  const add = (candidate: string) => {
    const c = candidate.toUpperCase().slice(0, MAX_SKU_PREFIX_LEN);
    if (c.length >= 2 && !seen.has(c)) {
      seen.add(c);
      out.push(c);
    }
  };

  if (words.length >= 2) {
    const a = cleanWordLetters(words[0]);
    const b = cleanWordLetters(words[1]);
    if (a && b) {
      add(a[0] + b[0]);
      if (b.length >= 2) add(a[0] + b[0] + b[b.length - 1]);
      if (b.length >= 2) add(a[0] + b.slice(0, 2));
      if (a.length >= 2) add(a.slice(0, 2) + b[0]);
      if (a.length >= 2) add(a[0] + a[a.length - 1] + b[0]);
      if (b.length >= 3) add(a[0] + b.slice(0, 3));
      if (a.length >= 2 && b.length >= 2) add(a.slice(0, 2) + b.slice(0, 2));
      if (a.length >= 2 && b.length >= 2) {
        add(a[0] + b[0] + a[a.length - 1] + b[b.length - 1]);
      }

      const joined = words.map(cleanWordLetters).join('');
      for (let len = 2; len <= MAX_SKU_PREFIX_LEN && len <= joined.length; len++) {
        add(joined.slice(0, len));
      }
    }
  }

  const letters = categoryName.replace(/[^a-zA-Z]/g, '').toUpperCase();
  if (!letters) {
    return out.length ? out : ['GEN'];
  }

  if (words.length < 2) {
    for (let len = 2; len <= MAX_SKU_PREFIX_LEN && len <= letters.length; len++) {
      add(letters.slice(0, len));
    }
    if (letters.length >= 3) add(letters[0] + letters.slice(-2));
    if (letters.length >= 3) add(letters[0] + letters[1] + letters[letters.length - 1]);
  }

  if (!out.length) add('GEN');
  return out;
}

/** Base prefix (first candidate): one word → first two letters; two+ words → first letter of each. */
export function deriveSkuPrefix(categoryName: string): string {
  return generateSkuPrefixCandidates(categoryName)[0] ?? 'GEN';
}

/** Pick the first unused prefix candidate for this category name. */
export function resolveUniqueSkuPrefix(categoryName: string, usedPrefixes: Iterable<string>): string {
  const used = new Set([...usedPrefixes].map((p) => p.trim().toUpperCase()).filter(Boolean));
  for (const candidate of generateSkuPrefixCandidates(categoryName)) {
    if (!used.has(candidate)) return candidate;
  }

  const base = deriveSkuPrefix(categoryName).slice(0, 3);
  for (let i = 2; i <= 9; i++) {
    const fallback = `${base}${i}`.slice(0, MAX_SKU_PREFIX_LEN);
    if (!used.has(fallback)) return fallback;
  }
  return base.slice(0, MAX_SKU_PREFIX_LEN);
}

/** Assign collision-free prefixes to categories (deterministic: alphabetical by name). */
export function assignUniqueSkuPrefixes(
  items: Array<{ id: string; name: string }>,
): Map<string, string> {
  const used = new Set<string>();
  const result = new Map<string, string>();
  const sorted = [...items].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
  );

  for (const item of sorted) {
    const prefix = resolveUniqueSkuPrefix(item.name, used);
    used.add(prefix);
    result.set(item.id, prefix);
  }

  return result;
}

/** Parse numeric sequence from SKU-{prefix}-#### or legacy MB-{prefix}-####. */
export function parseGenericSkuSequence(sku: string): number | null {
  const m = sku.trim().match(/^(?:SKU|MB)-[A-Za-z0-9]+-(\d+)$/i);
  return m ? parseInt(m[1], 10) : null;
}

/** Format SKU as SKU-[PREFIX]-[0001]. */
export function formatCategorySku(prefix: string, sequence: number): string {
  const p = prefix.trim().toUpperCase() || 'GEN';
  return `SKU-${p}-${String(sequence).padStart(4, '0')}`;
}

/** Parse numeric sequence from SKU-{prefix}-#### or legacy MB-{prefix}-###. */
export function parseSkuSequence(sku: string, prefix: string): number | null {
  const p = prefix.trim().toUpperCase();
  for (const re of [
    new RegExp(`^SKU-${p}-(\\d+)$`, 'i'),
    new RegExp(`^MB-${p}-(\\d+)$`, 'i'),
  ]) {
    const m = sku.match(re);
    if (m) return parseInt(m[1], 10);
  }
  return null;
}

/** Next sequence number for a category prefix given existing SKUs in that category. */
export function nextSkuSequence(existingSkus: string[], prefix: string): number {
  let maxSeq = 0;
  for (const sku of existingSkus) {
    const seq = parseSkuSequence(sku, prefix);
    if (seq !== null && seq > maxSeq) maxSeq = seq;
  }
  return maxSeq + 1;
}
