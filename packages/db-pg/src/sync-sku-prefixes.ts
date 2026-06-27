import { deriveSkuPrefix, formatCategorySku, parseGenericSkuSequence } from '@mama-babi/barcode';
import { eq } from 'drizzle-orm';
import { categories, products } from './schema';
import type { PostgresClient } from './client';

export interface SkuPrefixSyncResult {
  categoriesUpdated: number;
  productsUpdated: number;
}

/** Re-derive category sku_prefix from name and align product SKUs to the new prefix. */
export async function syncSkuPrefixes(db: PostgresClient): Promise<SkuPrefixSyncResult> {
  const now = new Date().toISOString();
  const cats = await db.select().from(categories).where(eq(categories.isDeleted, false));
  const allProducts = await db.select().from(products).where(eq(products.isDeleted, false));

  const prefixByCategoryId = new Map<string, string>();
  let categoriesUpdated = 0;

  for (const cat of cats) {
    const newPrefix = deriveSkuPrefix(cat.name).slice(0, 4);
    prefixByCategoryId.set(cat.id, newPrefix);
    if ((cat.skuPrefix ?? '').toUpperCase() !== newPrefix) {
      await db
        .update(categories)
        .set({ skuPrefix: newPrefix, updatedAt: now })
        .where(eq(categories.id, cat.id));
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
      await db
        .update(products)
        .set({ sku: newSku, updatedAt: now })
        .where(eq(products.id, product.id));
      productsUpdated++;
    }
  }

  return { categoriesUpdated, productsUpdated };
}
