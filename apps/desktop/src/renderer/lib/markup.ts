/** % suffix → cost + that % of cost; plain number → fixed price */
export function parseMarkupInput(value: string, cost: number): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.includes('%')) {
    const pct = parseFloat(trimmed.replace(/%/g, '').trim());
    if (isNaN(pct) || cost <= 0) return undefined;
    return cost + cost * (pct / 100);
  }
  const amount = parseFloat(trimmed);
  if (isNaN(amount)) return undefined;
  return amount;
}

export function formatPriceValue(price: number): string {
  return Number.isInteger(price) ? String(price) : price.toFixed(2);
}

export function resolveMarkupToPrice(value: string, cost: number): string {
  const trimmed = value.trim();
  if (!trimmed || !trimmed.includes('%')) return trimmed;
  const price = parseMarkupInput(trimmed, cost);
  if (price == null) return trimmed;
  return formatPriceValue(price);
}
