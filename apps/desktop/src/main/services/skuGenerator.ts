import { and, eq, like } from 'drizzle-orm';
import { categories, products } from '@mama-babi/db-schema';
import { getDb } from '../db';

export function generateCategorySku(categoryId: string): string {
  const db = getDb();
  const cat = db.select().from(categories).where(eq(categories.id, categoryId)).get();
  const prefix = cat?.skuPrefix?.trim().toUpperCase() || 'GEN';
  const pattern = `MB-${prefix}-%`;
  const existing = db
    .select()
    .from(products)
    .where(like(products.sku, pattern))
    .all();

  let maxSeq = 0;
  for (const p of existing) {
    const parts = p.sku.split('-');
    const seq = parseInt(parts[parts.length - 1] ?? '0', 10);
    if (!Number.isNaN(seq) && seq > maxSeq) maxSeq = seq;
  }

  return `MB-${prefix}-${String(maxSeq + 1).padStart(4, '0')}`;
}

export function deriveSkuPrefix(categoryName: string): string {
  const words = categoryName.trim().split(/\s+/);
  if (words.length >= 2) {
    return (words[0].slice(0, 2) + words[1].slice(0, 1)).toUpperCase();
  }
  return categoryName.replace(/[^a-zA-Z]/g, '').slice(0, 3).toUpperCase() || 'GEN';
}
