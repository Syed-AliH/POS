import { eq, or, sql } from 'drizzle-orm';
import { deriveSkuPrefix, formatCategorySku, nextSkuSequence } from '@mama-babi/barcode';
import { categories, products } from '@mama-babi/db-schema';
import { getDb } from '../db';

export { deriveSkuPrefix, resolveUniqueSkuPrefix } from '@mama-babi/barcode';

export function generateCategorySku(categoryId: string): string {
  const db = getDb();
  const cat = db.select().from(categories).where(eq(categories.id, categoryId)).get();
  const prefix = cat?.skuPrefix?.trim().toUpperCase() || deriveSkuPrefix(cat?.name ?? '');
  const p = prefix.trim().toUpperCase() || 'GEN';

  // SKU is globally unique — scan all matching SKUs for this prefix, not just this category.
  const existing = db
    .select({ sku: products.sku })
    .from(products)
    .where(
      or(sql`lower(${products.sku}) like ${`sku-${p.toLowerCase()}-%`}`, sql`lower(${products.sku}) like ${`mb-${p.toLowerCase()}-%`}`),
    )
    .all();

  const seq = nextSkuSequence(existing.map((row) => row.sku), p);
  return formatCategorySku(p, seq);
}
