import { assignUniqueSkuPrefixes, formatCategorySku, parseGenericSkuSequence } from '@mama-babi/barcode';
import { eq } from 'drizzle-orm';
import { categories, products } from '@mama-babi/db-schema';
import { getDb } from '../db';

/** Re-derive category sku_prefix from name and align product SKUs (local SQLite). */
export function syncSkuPrefixesLocal(): { categoriesUpdated: number; productsUpdated: number } {
  const db = getDb();
  const now = new Date().toISOString();
  const cats = db.select().from(categories).where(eq(categories.isDeleted, false)).all();
  // Deleted rows keep their SKU and the unique index still covers them, so they are
  // read too — their SKUs are reserved rather than handed out again.
  const productRows = db.select().from(products).all();
  const allProducts = productRows.filter((p) => !p.isDeleted);

  const prefixByCategoryId = assignUniqueSkuPrefixes(
    cats.map((cat) => ({ id: cat.id, name: cat.name })),
  );
  let categoriesUpdated = 0;

  for (const cat of cats) {
    const newPrefix = prefixByCategoryId.get(cat.id) ?? 'GEN';
    if ((cat.skuPrefix ?? '').toUpperCase() !== newPrefix) {
      db.update(categories)
        .set({ skuPrefix: newPrefix, updatedAt: now })
        .where(eq(categories.id, cat.id))
        .run();
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
    db.transaction((tx) => {
      for (const { id } of renames) {
        tx.update(products).set({ sku: `~pending~${id}`, updatedAt: now }).where(eq(products.id, id)).run();
      }
      for (const { id, sku } of renames) {
        tx.update(products).set({ sku, updatedAt: now }).where(eq(products.id, id)).run();
      }
    });
  }

  return { categoriesUpdated, productsUpdated: renames.length };
}
