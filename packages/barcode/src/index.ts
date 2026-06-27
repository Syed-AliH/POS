let skuCounter = Date.now() % 100000;

export function generateSku(prefix = 'MB'): string {
  skuCounter += 1;
  return `${prefix}-${String(skuCounter).padStart(6, '0')}`;
}

export function generateBarcode(): string {
  const base = Date.now().toString().slice(-11);
  return `89${base.padStart(11, '0').slice(0, 11)}`;
}

/** Derive a short category prefix: one word → first two letters (Toys → TO); two+ words → first letter of each (Stuff Toys → ST). */
export function deriveSkuPrefix(categoryName: string): string {
  const words = categoryName.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    const a = words[0].replace(/[^a-zA-Z]/g, '');
    const b = words[1].replace(/[^a-zA-Z]/g, '');
    if (a && b) return (a[0] + b[0]).toUpperCase();
  }

  const letters = categoryName.replace(/[^a-zA-Z]/g, '').toUpperCase();
  if (!letters) return 'GEN';
  return letters.slice(0, 2) || 'GE';
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
