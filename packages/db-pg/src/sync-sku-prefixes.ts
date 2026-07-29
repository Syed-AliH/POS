import { assignUniqueSkuPrefixes, formatCategorySku, parseGenericSkuSequence } from '@mama-babi/barcode';
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
  // Deleted rows keep their SKU and the unique index still covers them, so they are
  // read too — their SKUs are reserved rather than handed out again.
  const productRows = await db.select().from(products);
  const allProducts = productRows.filter((p) => !p.isDeleted);

  const prefixByCategoryId = assignUniqueSkuPrefixes(
    cats.map((cat) => ({ id: cat.id, name: cat.name })),
  );
  let categoriesUpdated = 0;

  for (const cat of cats) {
    const newPrefix = prefixByCategoryId.get(cat.id) ?? 'GEN';
    if ((cat.skuPrefix ?? '').toUpperCase() !== newPrefix) {
      await db
        .update(categories)
        .set({ skuPrefix: newPrefix, updatedAt: now })
        .where(eq(categories.id, cat.id));
      categoriesUpdated++;
    }
  }

  const usedSkus = new Set<string>(productRows.filter((p) => p.isDeleted).map((p) => p.sku));
  const renames: Array<{ id: string; sku: string }> = [];

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

    if (product.sku !== newSku) renames.push({ id: product.id, sku: newSku });
  }

  // A product's target SKU is often still held by a product later in the list, so
  // writing them one by one trips the unique index. Park every rename on a throwaway
  // SKU first, then write the real ones — no intermediate state can collide.
  if (renames.length) {
    await db.transaction(async (tx) => {
      for (const { id } of renames) {
        await tx.update(products).set({ sku: `~pending~${id}`, updatedAt: now }).where(eq(products.id, id));
      }
      for (const { id, sku } of renames) {
        await tx.update(products).set({ sku, updatedAt: now }).where(eq(products.id, id));
      }
    });
  }

  return { categoriesUpdated, productsUpdated: renames.length };
}
