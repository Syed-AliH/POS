import {
  brands,
  categories,
  customers,
  grnHeaders,
  grnLines,
  inventoryMovements,
  products,
  saleItems,
  sales,
  vendors,
} from '@mama-babi/db-schema';
import { getDb } from '../db';

/** Remove stale local business data so cloud mode never shows old SQLite products. */
export function purgeLocalBusinessData(): void {
  const db = getDb();
  for (const table of [
    saleItems,
    sales,
    grnLines,
    grnHeaders,
    inventoryMovements,
    products,
    categories,
    brands,
    vendors,
    customers,
  ]) {
    db.delete(table).run();
  }
  console.log('[main] Cleared local business data (cloud mode uses API)');
}
