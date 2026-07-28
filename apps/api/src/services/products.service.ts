import { and, eq, ilike, or, sql } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import {
  generateBarcode,
  deriveSkuPrefix,
  formatCategorySku,
  nextSkuSequence,
  resolveUniqueSkuPrefix,
} from '@mama-babi/barcode';
import { categories, grnHeaders, grnLines, products, returnItems, returns, saleItems, sales, vendors } from '@mama-babi/db-pg';
import type { PostgresClient } from '@mama-babi/db-pg';
import type { ApiResult } from '../types';
import { getSetting } from './settings.service';

type ProductRow = typeof products.$inferSelect;

function mapProduct(row: ProductRow) {
  return {
    id: row.id,
    name: row.name,
    sku: row.sku,
    barcode: row.barcode,
    categoryId: row.categoryId,
    brandId: row.brandId,
    vendorId: row.vendorId,
    costPrice: row.costPrice,
    retailPrice: row.retailPrice,
    salePrice: row.salePrice,
    taxRate: row.taxRate,
    stockQty: row.stockQty,
    reorderLevel: row.reorderLevel,
    status: row.status,
    imagePath: row.imagePath,
    description: row.description,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Everything the till needs to search and sell, and nothing else.
 *
 * The checkout screen used to fetch the full product rows (30+ columns) twice on
 * mount and again after every sale, purely to search and to read stock. This is one
 * projected query the client can cache and search locally, so typing costs no network.
 */
export async function getProductSearchPayload(db: PostgresClient) {
  const rows = await db
    .select({
      id: products.id,
      name: products.name,
      sku: products.sku,
      barcode: products.barcode,
      retailPrice: products.retailPrice,
      salePrice: products.salePrice,
      taxRate: products.taxRate,
      stockQty: products.stockQty,
      categoryId: products.categoryId,
      updatedAt: products.updatedAt,
    })
    .from(products)
    .where(and(eq(products.isDeleted, false), eq(products.status, 'active')));

  // Max updatedAt doubles as a cheap version stamp for the client cache.
  let version = '';
  for (const r of rows) if (r.updatedAt > version) version = r.updatedAt;

  return {
    success: true as const,
    data: {
      version,
      count: rows.length,
      products: rows.map(({ updatedAt: _ignored, ...p }) => p),
    },
  };
}

export async function searchProducts(db: PostgresClient, query: string) {
  const term = query.trim();
  if (!term) return { success: true as const, data: [] };
  const pattern = `%${term}%`;
  const rows = await db
    .select()
    .from(products)
    .where(
      and(
        eq(products.isDeleted, false),
        eq(products.status, 'active'),
        or(ilike(products.name, pattern), ilike(products.sku, pattern), ilike(products.barcode, pattern)),
      ),
    )
    .limit(50);
  return { success: true as const, data: rows.map(mapProduct) };
}

/** Keep in sync with apps/desktop/src/shared/productSearch.ts */
const WORD_SPLIT = /[\s\-/\\,._()[\]|+&]+/;

function nameWords(name: string): string[] {
  return name.trim().split(WORD_SPLIT).filter(Boolean);
}

/** True when the query is a prefix of any individual word in the product name. */
function matchesWordPrefix(name: string, query: string): boolean {
  const prefix = query.trim().toLowerCase();
  if (!prefix) return true;
  const terms = prefix.split(WORD_SPLIT).filter(Boolean);
  const words = nameWords(name).map((w) => w.toLowerCase());
  return terms.every((term) => words.some((word) => word.startsWith(term)));
}

function escapeLike(value: string): string {
  return value.replace(/([\\%_])/g, '\\$1');
}

export async function advancedSearchProducts(
  db: PostgresClient,
  input: { sku?: string; master?: string; refine?: string },
) {
  const sku = input.sku?.trim();
  const master = input.master?.trim();
  const refine = input.refine?.trim();

  const conditions = [eq(products.isDeleted, false), eq(products.status, 'active')];

  if (sku) {
    const skuPattern = `${escapeLike(sku.toLowerCase())}%`;
    conditions.push(
      sql`(lower(${products.sku}) like ${skuPattern} or lower(coalesce(${products.barcode}, '')) like ${skuPattern})`,
    );
  }
  // Master matches the start of the name, so it is a real indexable prefix.
  if (master) {
    conditions.push(sql`lower(${products.name}) like ${`${escapeLike(master.toLowerCase())}%`}`);
  }
  // Refine matches the start of any word, so SQL can only prefilter on "contains";
  // the exact word-boundary check happens in JS below.
  if (refine) {
    for (const term of refine.toLowerCase().split(WORD_SPLIT).filter(Boolean)) {
      conditions.push(sql`lower(${products.name}) like ${`%${escapeLike(term)}%`}`);
    }
  }

  const hasFilter = !!(sku || master || refine);
  let rows = await db
    .select()
    .from(products)
    .where(and(...conditions))
    .limit(hasFilter ? 2000 : 500);

  if (master) {
    const prefix = master.toLowerCase();
    rows = rows.filter((row) => row.name.trim().toLowerCase().startsWith(prefix));
  }
  if (refine) rows = rows.filter((row) => matchesWordPrefix(row.name, refine));

  const max = hasFilter ? 200 : 500;
  return { success: true as const, data: rows.slice(0, max).map(mapProduct) };
}

export async function listProducts(db: PostgresClient, params?: { status?: string; limit?: number }) {
  const limit = params?.limit ?? 500;
  let rows = await db.select().from(products).where(eq(products.isDeleted, false)).limit(limit);
  if (params?.status) rows = rows.filter((r) => r.status === params.status);
  return { success: true as const, data: rows.map(mapProduct) };
}

export async function getProduct(db: PostgresClient, id: string): Promise<ApiResult<ReturnType<typeof mapProduct>>> {
  const [row] = await db.select().from(products).where(eq(products.id, id)).limit(1);
  if (!row) return { success: false, error: 'Product not found' };
  return { success: true, data: mapProduct(row) };
}

export async function barcodeLookup(db: PostgresClient, barcode: string) {
  const trimmed = barcode.trim();
  if (!trimmed) return { success: true as const, data: null };
  const active = and(eq(products.isDeleted, false), eq(products.status, 'active'));
  const [byBarcode] = await db.select().from(products).where(and(eq(products.barcode, trimmed), active)).limit(1);
  if (byBarcode) return { success: true as const, data: mapProduct(byBarcode) };
  const [bySku] = await db.select().from(products).where(and(eq(products.sku, trimmed), active)).limit(1);
  if (bySku) return { success: true as const, data: mapProduct(bySku) };
  return { success: true as const, data: null };
}

async function productNameExists(
  db: PostgresClient,
  name: string,
  excludeId?: string,
): Promise<boolean> {
  const trimmed = name.trim();
  if (!trimmed) return false;
  const conditions = [
    eq(products.isDeleted, false),
    sql`lower(${products.name}) = lower(${trimmed})`,
  ];
  if (excludeId) conditions.push(sql`${products.id} != ${excludeId}`);
  const [row] = await db.select({ id: products.id }).from(products).where(and(...conditions)).limit(1);
  return !!row;
}

export async function createProduct(db: PostgresClient, input: {
  name: string;
  sku?: string;
  barcode?: string;
  categoryId?: string;
  brandId?: string;
  vendorId?: string;
  costPrice?: number;
  retailPrice?: number;
  salePrice?: number;
  taxRate?: number;
  stockQty?: number;
  reorderLevel?: number;
  description?: string;
}) {
  const now = new Date().toISOString();
  const deviceId = (await getSetting(db, 'device_id')) ?? 'cloud';
  const branchId = (await getSetting(db, 'branch_id')) ?? 'main';
  const id = uuid();
  const name = input.name.trim();
  if (!name) return { success: false, error: 'Product name is required' };
  if (!input.categoryId) return { success: false, error: 'Category is required' };
  if (!input.retailPrice || input.retailPrice <= 0) {
    return { success: false, error: 'Retail price must be greater than 0' };
  }
  if (await productNameExists(db, name)) {
    return { success: false, error: `A product named "${name}" already exists` };
  }

  const sku = input.sku?.trim() || await generateCategorySku(db, input.categoryId);
  const barcode = input.barcode?.trim() || generateBarcode();

  try {
    await db.insert(products).values({
      id,
      name: name.trim(),
      sku,
      barcode,
      categoryId: input.categoryId ?? null,
      brandId: input.brandId ?? null,
      vendorId: input.vendorId ?? null,
      costPrice: input.costPrice ?? 0,
      retailPrice: input.retailPrice ?? 0,
      salePrice: input.salePrice ?? null,
      baseRetailPrice: input.retailPrice ?? 0,
      baseSalePrice: input.salePrice ?? null,
      taxRate: input.taxRate ?? 0,
      stockQty: input.stockQty ?? 0,
      reorderLevel: input.reorderLevel ?? 0,
      description: input.description ?? null,
      status: 'active',
      deviceId,
      branchId,
      createdAt: now,
      updatedAt: now,
    });
  } catch (err) {
    const pg = err as { code?: string; constraint?: string; detail?: string };
    if (pg.code === '23505' && pg.constraint === 'products_sku_unique') {
      return { success: false, error: `SKU "${sku}" is already in use` };
    }
    if (pg.code === '23505' && pg.constraint === 'products_barcode_unique') {
      return { success: false, error: `Barcode "${barcode}" is already in use` };
    }
    throw err;
  }

  const created = await getProduct(db, id);
  return created;
}

export async function updateProduct(
  db: PostgresClient,
  id: string,
  input: Partial<{
    name: string;
    categoryId: string | null;
    brandId: string | null;
    vendorId: string | null;
    costPrice: number;
    retailPrice: number;
    salePrice: number | null;
    taxRate: number;
    stockQty: number;
    reorderLevel: number;
    description: string | null;
    status: 'active' | 'archived' | 'discontinued';
  }>,
) {
  const [existing] = await db.select().from(products).where(eq(products.id, id)).limit(1);
  if (!existing) return { success: false, error: 'Product not found' };

  const nextName = input.name !== undefined ? input.name.trim() : existing.name;
  if (!nextName) return { success: false, error: 'Product name is required' };
  if (input.name !== undefined && await productNameExists(db, nextName, id)) {
    return { success: false, error: `A product named "${nextName}" already exists` };
  }

  const now = new Date().toISOString();
  await db
    .update(products)
    .set({
      name: nextName,
      categoryId: input.categoryId !== undefined ? input.categoryId : existing.categoryId,
      brandId: input.brandId !== undefined ? input.brandId : existing.brandId,
      vendorId: input.vendorId !== undefined ? input.vendorId : existing.vendorId,
      costPrice: input.costPrice ?? existing.costPrice,
      retailPrice: input.retailPrice ?? existing.retailPrice,
      salePrice: input.salePrice !== undefined ? input.salePrice : existing.salePrice,
      taxRate: input.taxRate ?? existing.taxRate,
      reorderLevel: input.reorderLevel ?? existing.reorderLevel,
      description: input.description !== undefined ? input.description : existing.description,
      status: input.status ?? existing.status,
      updatedAt: now,
    })
    .where(eq(products.id, id));
  return getProduct(db, id);
}

/** Round a price up/down to the nearest clean retail value (nearest 10). */
function roundRetailPrice(price: number): number {
  return Math.round(price / 10) * 10;
}

export async function bulkIncreasePrice(
  db: PostgresClient,
  input: {
    percent: number;
    productIds?: string[];
    categoryIds?: string[];
    applyToAll?: boolean;
  },
): Promise<ApiResult<{ updated: number }>> {
  const percent = Number(input.percent);
  if (!Number.isFinite(percent) || percent === 0) {
    return { success: false, error: 'Enter a non-zero percentage' };
  }

  const scopes = [];
  if (input.productIds?.length) scopes.push(inArrayIds(input.productIds));
  if (input.categoryIds?.length) scopes.push(inCategoryIds(input.categoryIds));
  if (!scopes.length && !input.applyToAll) {
    return { success: false, error: 'Select products, categories, or apply to all' };
  }

  const conditions = [eq(products.isDeleted, false), eq(products.status, 'active')];
  const scopeClause = scopes.length ? or(...scopes) : undefined;
  const where = scopeClause ? and(...conditions, scopeClause) : and(...conditions);

  const rows = await db.select().from(products).where(where);
  if (!rows.length) return { success: true, data: { updated: 0 } };

  const factor = 1 + percent / 100;
  const now = new Date().toISOString();
  let updated = 0;

  await db.transaction(async (tx) => {
    for (const row of rows) {
      const nextRetail = roundRetailPrice(row.retailPrice * factor);
      const nextSale = row.salePrice != null ? roundRetailPrice(row.salePrice * factor) : row.salePrice;
      await tx
        .update(products)
        .set({
          retailPrice: nextRetail,
          salePrice: nextSale,
          // Snapshot the pre-change price so the change can be undone.
          prevRetailPrice: row.retailPrice,
          prevSalePrice: row.salePrice,
          // Capture the original baseline the first time a product is ever adjusted.
          baseRetailPrice: row.baseRetailPrice ?? row.retailPrice,
          baseSalePrice: row.baseSalePrice ?? row.salePrice,
          updatedAt: now,
        })
        .where(eq(products.id, row.id));
      updated += 1;
    }
  });

  return { success: true, data: { updated } };
}

export async function bulkRevertPrice(
  db: PostgresClient,
  input: {
    mode: 'original' | 'last';
    productIds?: string[];
    categoryIds?: string[];
    applyToAll?: boolean;
  },
): Promise<ApiResult<{ updated: number }>> {
  if (input.mode !== 'original' && input.mode !== 'last') {
    return { success: false, error: 'Invalid revert mode' };
  }

  const scopes = [];
  if (input.productIds?.length) scopes.push(inArrayIds(input.productIds));
  if (input.categoryIds?.length) scopes.push(inCategoryIds(input.categoryIds));
  if (!scopes.length && !input.applyToAll) {
    return { success: false, error: 'Select products, categories, or apply to all' };
  }

  const conditions = [eq(products.isDeleted, false), eq(products.status, 'active')];
  const scopeClause = scopes.length ? or(...scopes) : undefined;
  const where = scopeClause ? and(...conditions, scopeClause) : and(...conditions);

  const rows = await db.select().from(products).where(where);
  if (!rows.length) return { success: true, data: { updated: 0 } };

  const now = new Date().toISOString();
  let updated = 0;

  await db.transaction(async (tx) => {
    for (const row of rows) {
      const targetRetail = input.mode === 'original' ? row.baseRetailPrice : row.prevRetailPrice;
      // No snapshot to restore for this product — leave it untouched.
      if (targetRetail == null) continue;
      const targetSale = input.mode === 'original' ? row.baseSalePrice : row.prevSalePrice;
      await tx
        .update(products)
        .set({ retailPrice: targetRetail, salePrice: targetSale, updatedAt: now })
        .where(eq(products.id, row.id));
      updated += 1;
    }
  });

  return { success: true, data: { updated } };
}

function inArrayIds(ids: string[]) {
  return sql`${products.id} in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`;
}

function inCategoryIds(ids: string[]) {
  return sql`${products.categoryId} in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`;
}

export async function listCategories(db: PostgresClient) {
  let rows = await db.select().from(categories).where(eq(categories.isDeleted, false));

  // Fresh databases (no seed) start with zero categories — bootstrap one default
  if (rows.length === 0) {
    await insertCategory(db, 'General', '#3B82F6', 'GEN');
    rows = await db.select().from(categories).where(eq(categories.isDeleted, false));
  }

  return {
    success: true as const,
    data: rows.map((r) => ({
      id: r.id,
      name: r.name,
      parentId: r.parentId,
      color: r.color,
      skuPrefix: r.skuPrefix,
    })),
  };
}

function deriveCategoryPrefix(categoryName: string, skuPrefix?: string | null): string {
  return skuPrefix?.trim().toUpperCase() || deriveSkuPrefix(categoryName);
}

async function generateCategorySku(db: PostgresClient, categoryId: string): Promise<string> {
  const [cat] = await db.select().from(categories).where(eq(categories.id, categoryId)).limit(1);
  const prefix = deriveCategoryPrefix(cat?.name ?? '', cat?.skuPrefix);
  const p = prefix.trim().toUpperCase() || 'GEN';

  // SKU is globally unique — scan all matching SKUs for this prefix, not just this category.
  const existing = await db
    .select({ sku: products.sku })
    .from(products)
    .where(
      or(ilike(products.sku, `SKU-${p}-%`), ilike(products.sku, `MB-${p}-%`)),
    );

  const seq = nextSkuSequence(existing.map((row) => row.sku), p);
  return formatCategorySku(p, seq);
}

async function findCategoryIdByName(db: PostgresClient, categoryName: string): Promise<string | null> {
  const [row] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(sql`lower(${categories.name}) = lower(${categoryName})`)
    .limit(1);
  return row?.id ?? null;
}

async function resolveCategoryId(
  db: PostgresClient,
  categoryName: string,
  cache: Map<string, string>,
): Promise<string> {
  const key = categoryName.toLowerCase();
  const cached = cache.get(key);
  if (cached) return cached;

  const existingId = await findCategoryIdByName(db, categoryName);
  if (existingId) {
    cache.set(key, existingId);
    return existingId;
  }

  const created = await insertCategory(db, categoryName, '#6366f1');
  cache.set(key, created.id);
  return created.id;
}

export async function importProductRows(
  db: PostgresClient,
  rows: Array<{
    name: string;
    category: string;
    cost_price?: number;
    retail_price: number;
    sale_price?: number;
  }>,
): Promise<ApiResult<{ imported: number; errors: string[] }>> {
  if (!rows.length) return { success: false, error: 'No rows found in file' };

  const errors: string[] = [];
  let imported = 0;
  const categoryCache = new Map<string, string>();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2;
    const name = String(row.name ?? '').trim();
    if (!name) {
      errors.push(`Row ${rowNum}: Name is required`);
      continue;
    }

    const retailPrice = Number(row.retail_price);
    if (!retailPrice || retailPrice <= 0) {
      errors.push(`Row ${rowNum} "${name}": Valid Retail Price is required`);
      continue;
    }

    const categoryName = String(row.category ?? '').trim();
    if (!categoryName) {
      errors.push(`Row ${rowNum} "${name}": Category is required`);
      continue;
    }

    try {
      const categoryId = await resolveCategoryId(db, categoryName, categoryCache);
      const result = await createProduct(db, {
        name,
        categoryId,
        costPrice: Number(row.cost_price ?? 0) || 0,
        retailPrice,
        salePrice: row.sale_price ? Number(row.sale_price) || undefined : undefined,
        taxRate: 0,
        stockQty: 0,
      });

      if (result.success) imported++;
      else errors.push(`Row ${rowNum} "${name}": ${result.error}`);
    } catch (err) {
      errors.push(`Row ${rowNum} "${name}": ${err instanceof Error ? err.message : 'Import failed'}`);
    }
  }

  return { success: true, data: { imported, errors } };
}

async function getExistingSkuPrefixes(db: PostgresClient): Promise<string[]> {
  const rows = await db
    .select({ skuPrefix: categories.skuPrefix })
    .from(categories)
    .where(eq(categories.isDeleted, false));
  return rows.map((row) => (row.skuPrefix ?? '').trim().toUpperCase()).filter(Boolean);
}

async function insertCategory(
  db: PostgresClient,
  name: string,
  color?: string,
  skuPrefix?: string,
) {
  const now = new Date().toISOString();
  const id = uuid();
  const deviceId = (await getSetting(db, 'device_id')) ?? 'cloud';
  const branchId = (await getSetting(db, 'branch_id')) ?? 'main';
  const prefix = skuPrefix?.trim()
    ? skuPrefix.trim().toUpperCase().slice(0, 4)
    : resolveUniqueSkuPrefix(name, await getExistingSkuPrefixes(db)).slice(0, 4);

  await db.insert(categories).values({
    id,
    name: name.trim(),
    color: color ?? '#EC4899',
    skuPrefix: prefix,
    deviceId,
    branchId,
    createdAt: now,
    updatedAt: now,
  });

  return { id, name: name.trim(), parentId: null, color: color ?? '#EC4899', skuPrefix: prefix };
}

export async function createCategory(db: PostgresClient, name: string, color?: string, skuPrefix?: string) {
  const trimmed = name.trim();
  if (!trimmed) return { success: false as const, error: 'Category name is required' };
  const data = await insertCategory(db, trimmed, color, skuPrefix);
  return { success: true as const, data };
}

export async function updateCategory(
  db: PostgresClient,
  id: string,
  input: { name?: string; color?: string; skuPrefix?: string },
) {
  const [existing] = await db.select().from(categories).where(eq(categories.id, id)).limit(1);
  if (!existing || existing.isDeleted) return { success: false as const, error: 'Category not found' };

  const now = new Date().toISOString();
  const name = input.name?.trim() || existing.name;
  const skuPrefix = input.skuPrefix?.trim().toUpperCase().slice(0, 4) ?? existing.skuPrefix;

  await db
    .update(categories)
    .set({
      name,
      color: input.color ?? existing.color,
      skuPrefix,
      updatedAt: now,
    })
    .where(eq(categories.id, id));

  return {
    success: true as const,
    data: {
      id: existing.id,
      name,
      parentId: existing.parentId,
      color: input.color ?? existing.color,
      skuPrefix,
    },
  };
}

export interface ProductHistoryEntry {
  date: string;
  type: 'purchase' | 'sale' | 'return';
  reference: string;
  vendorOrCustomer: string | null;
  qty: number;
  unitCostOrPrice: number;
  total: number;
}

export async function getProductHistory(
  db: PostgresClient,
  productId: string,
): Promise<ApiResult<{ productId: string; purchases: ProductHistoryEntry[]; sales: ProductHistoryEntry[]; returns: ProductHistoryEntry[] }>> {
  const [product] = await db.select().from(products).where(eq(products.id, productId)).limit(1);
  if (!product) return { success: false, error: 'Product not found' };

  const lineRows = await db.select().from(grnLines).where(eq(grnLines.productId, productId));
  const purchases: ProductHistoryEntry[] = [];

  for (const line of lineRows) {
    const [grn] = await db.select().from(grnHeaders).where(eq(grnHeaders.id, line.grnId)).limit(1);
    if (!grn || grn.status !== 'finalized') continue;
    const [vendor] = await db.select().from(vendors).where(eq(vendors.id, grn.vendorId)).limit(1);
    purchases.push({
      date: grn.updatedAt ?? line.updatedAt ?? line.createdAt,
      type: 'purchase',
      reference: grn.grnNumber,
      vendorOrCustomer: vendor?.name ?? null,
      qty: line.qty,
      unitCostOrPrice: line.unitCost,
      total: line.lineTotal,
    });
  }
  purchases.sort((a, b) => b.date.localeCompare(a.date));

  const saleRows = await db.select().from(saleItems).where(eq(saleItems.productId, productId));
  const salesHistory: ProductHistoryEntry[] = [];
  for (const item of saleRows) {
    const [sale] = await db.select().from(sales).where(eq(sales.id, item.saleId)).limit(1);
    if (!sale || sale.status === 'held' || sale.status === 'voided') continue;
    salesHistory.push({
      date: sale.createdAt ?? item.createdAt,
      type: 'sale',
      reference: sale.saleNumber ?? '',
      vendorOrCustomer: null,
      qty: item.quantity,
      unitCostOrPrice: item.unitPrice,
      total: item.lineTotal,
    });
  }
  salesHistory.sort((a, b) => b.date.localeCompare(a.date));

  const returnRows = await db.select().from(returnItems).where(eq(returnItems.productId, productId));
  const returnsHistory: ProductHistoryEntry[] = [];
  for (const ri of returnRows) {
    const [ret] = await db.select().from(returns).where(eq(returns.id, ri.returnId)).limit(1);
    returnsHistory.push({
      date: ret?.createdAt ?? ri.createdAt,
      type: 'return',
      reference: ret?.returnNumber ?? '',
      vendorOrCustomer: null,
      qty: ri.qtyReturned,
      unitCostOrPrice: ri.unitRefund,
      total: ri.qtyReturned * ri.unitRefund,
    });
  }
  returnsHistory.sort((a, b) => b.date.localeCompare(a.date));

  return {
    success: true,
    data: {
      productId,
      purchases,
      sales: salesHistory.slice(0, 50),
      returns: returnsHistory.slice(0, 50),
    },
  };
}
