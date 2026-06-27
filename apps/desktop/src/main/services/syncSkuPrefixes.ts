import { deriveSkuPrefix, formatCategorySku, parseGenericSkuSequence } from '@mama-babi/barcode';
import { eq } from 'drizzle-orm';
import { categories, products } from '@mama-babi/db-schema';
import { getDb } from '../db';

/** Re-derive category sku_prefix from name and align product SKUs (local SQLite). */
export function syncSkuPrefixesLocal(): { categoriesUpdated: number; productsUpdated: number } {
  const db = getDb();
  const now = new Date().toISOString();
  const cats = db.select().from(categories).where(eq(categories.isDeleted, false)).all();
  const allProducts = db.select().from(products).where(eq(products.isDeleted, false)).all();

  const prefixByCategoryId = new Map<string, string>();
  let categoriesUpdated = 0;

  for (const cat of cats) {
    const newPrefix = deriveSkuPrefix(cat.name).slice(0, 4);
    prefixByCategoryId.set(cat.id, newPrefix);
    if ((cat.skuPrefix ?? '').toUpperCase() !== newPrefix) {
      db.update(categories)
        .set({ skuPrefix: newPrefix, updatedAt: now })
        .where(eq(categories.id, cat.id))
        .run();
      categoriesUpdated++;
    }
  }

  const usedSkus = new Set<string>();
  let productsUpdated = 0;

  const sorted = [...allProducts].sort((a, b) => {
    const catA = cats.find((c) => c.id === a.categoryId)?.name ?? '';
    const catB = cats.find((c) => c.id === b.categoryId)?.name ?? '';
    if (catA !== catB) return catA.localeCompare(catB);
    return a.sku.localeCompare(b.sku);
  });

  for (const product of sorted) {
    const prefix = (product.categoryId && prefixByCategoryId.get(product.categoryId)) || 'GEN';
    let seq = parseGenericSkuSequence(product.sku) ?? 1;
    let newSku = formatCategorySku(prefix, seq);

    while (usedSkus.has(newSku)) {
      seq += 1;
      newSku = formatCategorySku(prefix, seq);
    }
    usedSkus.add(newSku);

    if (product.sku !== newSku) {
      db.update(products)
        .set({ sku: newSku, updatedAt: now })
        .where(eq(products.id, product.id))
        .run();
      productsUpdated++;
    }
  }

  return { categoriesUpdated, productsUpdated };
}
