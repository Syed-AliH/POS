import type { SaleSummary } from './types';

/** "cash", "card", … or, for a split bill, "Cash 3000 + Card 2000". */
export function formatPayment(
  sale: Pick<SaleSummary, 'paymentMethod' | 'totalAmount' | 'splitCashAmount' | 'splitOtherMethod'>,
): string {
  if (sale.paymentMethod === 'split' && sale.splitCashAmount != null) {
    const other = sale.splitOtherMethod === 'online' ? 'Online' : 'Card';
    const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));
    return `Cash ${fmt(sale.splitCashAmount)} + ${other} ${fmt(sale.totalAmount - sale.splitCashAmount)}`;
  }
  return sale.paymentMethod.replace('_', ' ');
}
