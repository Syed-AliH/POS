import { and, eq, inArray, like, or, sql } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import {
  categories,
  grnHeaders,
  grnLines,
  products,
  returnItems,
  returns,
  saleItems,
  sales,
  vendors,
} from '@mama-babi/db-schema';
import { generateBarcode } from '@mama-babi/barcode';
import type { AdvancedProductSearchInput, ApiResult, BulkPriceIncreaseInput, BulkPriceRevertInput, Category, Product, ProductHistory, ProductInput } from '@shared/types';
import { filterProductsByAdvancedSearch } from '@shared/productSearch';
import { getDb } from '../db';
import { requireRole, requireSession } from '../session';
import { logAudit } from '../services/audit';
import { seedDemoProducts } from '../services/demoProducts';
import { generateCategorySku, resolveUniqueSkuPrefix } from '../services/skuGenerator';

function mapProduct(row: typeof products.$inferSelect): Product {
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

export function handleProductSearch(query: string): ApiResult<Product[]> {
  try {
    requireSession();
    const db = getDb();
    const term = query.trim();
    if (!term) return { success: true, data: [] };
    const pattern = `%${term.toLowerCase()}%`;
    const rows = db
      .select()
      .from(products)
      .where(
        and(
          eq(products.isDeleted, false),
          eq(products.status, 'active'),
          or(
            sql`lower(${products.name}) like ${pattern}`,
            sql`lower(${products.sku}) like ${pattern}`,
            sql`lower(${products.barcode}) like ${pattern}`,
          ),
        ),
      )
      .limit(50)
      .all();
    return { success: true, data: rows.map(mapProduct) };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Search failed' };
  }
}

function productNameExists(
  db: ReturnType<typeof getDb>,
  name: string,
  excludeId?: string,
): boolean {
  const trimmed = name.trim();
  if (!trimmed) return false;
  const conditions = [
    eq(products.isDeleted, false),
    sql`lower(${products.name}) = lower(${trimmed})`,
  ];
  if (excludeId) conditions.push(sql`${products.id} != ${excludeId}`);
  const row = db.select({ id: products.id }).from(products).where(and(...conditions)).get();
  return !!row;
}

export function handleProductList(params?: { status?: string; limit?: number }): ApiResult<Product[]> {
  try {
    requireSession();
    const db = getDb();
    const limit = params?.limit ?? 100;
    let rows = db.select().from(products).where(eq(products.isDeleted, false)).limit(limit).all();
    if (params?.status) {
      rows = rows.filter((r) => r.status === params.status);
    }
    return { success: true, data: rows.map(mapProduct) };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'List failed' };
  }
}

export function handleProductGet(id: string): ApiResult<Product> {
  try {
    requireSession();
    const db = getDb();
    const row = db.select().from(products).where(eq(products.id, id)).get();
    if (!row) return { success: false, error: 'Product not found' };
    return { success: true, data: mapProduct(row) };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Get failed' };
  }
}

export function handleBarcodeLookup(barcode: string): ApiResult<Product | null> {
  try {
    requireSession();
    const db = getDb();
    const trimmed = barcode.trim();
    if (!trimmed) return { success: true, data: null };

    const activeProduct = and(
      eq(products.isDeleted, false),
      eq(products.status, 'active'),
    );

    const byBarcode = db
      .select()
      .from(products)
      .where(and(eq(products.barcode, trimmed), activeProduct))
      .get();
    if (byBarcode) return { success: true, data: mapProduct(byBarcode) };

    const bySku = db
      .select()
      .from(products)
      .where(and(eq(products.sku, trimmed), activeProduct))
      .get();
    if (bySku) return { success: true, data: mapProduct(bySku) };

    return { success: true, data: null };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Lookup failed' };
  }
}

export function handleProductCreate(input: ProductInput): ApiResult<Product> {
  try {
    requireRole('super_admin', 'manager');
    const name = input.name?.trim() ?? '';
    if (!name) return { success: false, error: 'Product name is required' };
    if (!input.categoryId) return { success: false, error: 'Category is required' };
    if (!input.retailPrice || input.retailPrice <= 0) {
      return { success: false, error: 'Retail price must be greater than 0' };
    }
    const db = getDb();
    if (productNameExists(db, name)) {
      return { success: false, error: `A product named "${name}" already exists` };
    }
    const now = new Date().toISOString();
    const id = uuid();
    const sku = generateCategorySku(input.categoryId);
    const barcode = generateBarcode();

    const row = {
      id,
      name,
      sku,
      barcode,
      categoryId: input.categoryId ?? null,
      brandId: input.brandId ?? null,
      vendorId: input.vendorId ?? null,
      costPrice: input.costPrice,
      retailPrice: input.retailPrice,
      salePrice: input.salePrice ?? null,
      baseRetailPrice: input.retailPrice,
      baseSalePrice: input.salePrice ?? null,
      taxRate: input.taxRate ?? 17,
      stockQty: input.stockQty ?? 0,
      reorderLevel: input.reorderLevel ?? 10,
      description: input.description ?? null,
      status: 'active' as const,
      deviceId: 'local-device',
      branchId: 'main',
      createdAt: now,
      updatedAt: now,
    };

    db.insert(products).values(row).run();
    logAudit('products', 'create', id, undefined, row);
    return { success: true, data: mapProduct(row as typeof products.$inferSelect) };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Create failed' };
  }
}

export function handleProductUpdate(id: string, input: Partial<ProductInput>): ApiResult<Product> {
  try {
    requireRole('super_admin', 'manager');
    const db = getDb();
    const existing = db.select().from(products).where(eq(products.id, id)).get();
    if (!existing) return { success: false, error: 'Product not found' };

    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) return { success: false, error: 'Product name is required' };
      if (productNameExists(db, name, id)) {
        return { success: false, error: `A product named "${name}" already exists` };
      }
      input = { ...input, name };
    }

    const now = new Date().toISOString();
    const { stockQty: _stockQty, ...rest } = input;
    const updates = { ...rest, updatedAt: now };
    db.update(products).set(updates).where(eq(products.id, id)).run();

    const updated = db.select().from(products).where(eq(products.id, id)).get()!;
    logAudit('products', 'update', id, existing, updated);
    return { success: true, data: mapProduct(updated) };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Update failed' };
  }
}

/** Round a price to the nearest clean retail value (nearest 10). */
function roundRetailPrice(price: number): number {
  return Math.round(price / 10) * 10;
}

export function handleProductBulkPriceIncrease(
  input: BulkPriceIncreaseInput,
): ApiResult<{ updated: number }> {
  try {
    requireRole('super_admin', 'manager');
    const percent = Number(input.percent);
    if (!Number.isFinite(percent) || percent === 0) {
      return { success: false, error: 'Enter a non-zero percentage' };
    }
    if (!input.productIds?.length && !input.categoryIds?.length && !input.applyToAll) {
      return { success: false, error: 'Select products, categories, or apply to all' };
    }

    const db = getDb();
    const conditions = [eq(products.isDeleted, false), eq(products.status, 'active')];
    const scopes = [];
    if (input.productIds?.length) scopes.push(inArray(products.id, input.productIds));
    if (input.categoryIds?.length) scopes.push(inArray(products.categoryId, input.categoryIds));
    const where = scopes.length ? and(...conditions, or(...scopes)) : and(...conditions);

    const rows = db.select().from(products).where(where).all();
    if (!rows.length) return { success: true, data: { updated: 0 } };

    const factor = 1 + percent / 100;
    const now = new Date().toISOString();
    let updated = 0;

    db.transaction((tx) => {
      for (const row of rows) {
        const nextRetail = roundRetailPrice(row.retailPrice * factor);
        const nextSale = row.salePrice != null ? roundRetailPrice(row.salePrice * factor) : row.salePrice;
        tx.update(products)
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
          .where(eq(products.id, row.id))
          .run();
        updated += 1;
      }
    });

    logAudit('products', 'bulk-price-increase', 'bulk', undefined, input);
    return { success: true, data: { updated } };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Bulk price update failed' };
  }
}

export function handleProductBulkPriceRevert(
  input: BulkPriceRevertInput,
): ApiResult<{ updated: number }> {
  try {
    requireRole('super_admin', 'manager');
    if (input.mode !== 'original' && input.mode !== 'last') {
      return { success: false, error: 'Invalid revert mode' };
    }
    if (!input.productIds?.length && !input.categoryIds?.length && !input.applyToAll) {
      return { success: false, error: 'Select products, categories, or apply to all' };
    }

    const db = getDb();
    const conditions = [eq(products.isDeleted, false), eq(products.status, 'active')];
    const scopes = [];
    if (input.productIds?.length) scopes.push(inArray(products.id, input.productIds));
    if (input.categoryIds?.length) scopes.push(inArray(products.categoryId, input.categoryIds));
    const where = scopes.length ? and(...conditions, or(...scopes)) : and(...conditions);

    const rows = db.select().from(products).where(where).all();
    if (!rows.length) return { success: true, data: { updated: 0 } };

    const now = new Date().toISOString();
    let updated = 0;

    db.transaction((tx) => {
      for (const row of rows) {
        const targetRetail = input.mode === 'original' ? row.baseRetailPrice : row.prevRetailPrice;
        if (targetRetail == null) continue;
        const targetSale = input.mode === 'original' ? row.baseSalePrice : row.prevSalePrice;
        tx.update(products)
          .set({ retailPrice: targetRetail, salePrice: targetSale, updatedAt: now })
          .where(eq(products.id, row.id))
          .run();
        updated += 1;
      }
    });

    logAudit('products', 'bulk-price-revert', 'bulk', undefined, input);
    return { success: true, data: { updated } };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Bulk price revert failed' };
  }
}

export function handleProductArchive(id: string): ApiResult<Product> {
  try {
    requireRole('super_admin', 'manager');
    const db = getDb();
    const existing = db.select().from(products).where(eq(products.id, id)).get();
    if (!existing) return { success: false, error: 'Product not found' };

    const now = new Date().toISOString();
    db.update(products)
      .set({ status: 'archived', isDeleted: true, updatedAt: now })
      .where(eq(products.id, id))
      .run();

    logAudit('products', 'archive', id);
    const updated = db.select().from(products).where(eq(products.id, id)).get()!;
    return { success: true, data: mapProduct(updated) };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Archive failed' };
  }
}

function getExistingSkuPrefixes(db: ReturnType<typeof getDb>): string[] {
  return db
    .select({ skuPrefix: categories.skuPrefix })
    .from(categories)
    .where(eq(categories.isDeleted, false))
    .all()
    .map((row) => (row.skuPrefix ?? '').trim().toUpperCase())
    .filter(Boolean);
}

export function handleCategoryCreate(name: string, color?: string, skuPrefix?: string): ApiResult<Category> {
  try {
    requireRole('super_admin', 'manager');
    const db = getDb();
    const now = new Date().toISOString();
    const id = uuid();
    const prefix = skuPrefix?.trim()
      ? skuPrefix.trim().toUpperCase().slice(0, 4)
      : resolveUniqueSkuPrefix(name, getExistingSkuPrefixes(db)).slice(0, 4);
    db.insert(categories).values({
      id,
      name,
      color: color ?? '#EC4899',
      skuPrefix: prefix,
      deviceId: 'local-device',
      branchId: 'main',
      createdAt: now,
      updatedAt: now,
    }).run();
    return { success: true, data: { id, name, color: color ?? '#EC4899', skuPrefix: prefix } };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Create failed' };
  }
}

export function handleCategoryUpdate(id: string, input: { name?: string; color?: string; skuPrefix?: string }): ApiResult<Category> {
  try {
    requireRole('super_admin', 'manager');
    const db = getDb();
    const existing = db.select().from(categories).where(eq(categories.id, id)).get();
    if (!existing) return { success: false, error: 'Category not found' };
    const now = new Date().toISOString();
    db.update(categories).set({
      name: input.name ?? existing.name,
      color: input.color ?? existing.color,
      skuPrefix: input.skuPrefix?.trim().toUpperCase() ?? existing.skuPrefix,
      updatedAt: now,
    }).where(eq(categories.id, id)).run();
    const row = db.select().from(categories).where(eq(categories.id, id)).get()!;
    return { success: true, data: { id: row.id, name: row.name, color: row.color, skuPrefix: row.skuPrefix } };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Update failed' };
  }
}

export function handleCategoryList(): ApiResult<Category[]> {
  try {
    requireSession();
    const db = getDb();
    let rows = db.select().from(categories).where(eq(categories.isDeleted, false)).all();
    if (rows.length === 0) {
      handleCategoryCreate('General', '#3B82F6', 'GEN');
      rows = db.select().from(categories).where(eq(categories.isDeleted, false)).all();
    }
    return {
      success: true,
      data: rows.map((r) => ({ id: r.id, name: r.name, color: r.color, skuPrefix: r.skuPrefix })),
    };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Category list failed' };
  }
}

export function handleProductAdvancedSearch(input: AdvancedProductSearchInput): ApiResult<Product[]> {
  try {
    requireSession();
    const db = getDb();
    const rows = db
      .select()
      .from(products)
      .where(and(eq(products.isDeleted, false), eq(products.status, 'active')))
      .all()
      .map(mapProduct);

    return { success: true, data: filterProductsByAdvancedSearch(rows, input) };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Search failed' };
  }
}

export function handleProductHistory(productId: string): ApiResult<ProductHistory> {
  try {
    requireSession();
    const db = getDb();

    const grnPurchaseRows = db
      .select()
      .from(grnLines)
      .where(eq(grnLines.productId, productId))
      .all()
      .map((line) => {
        const grn = db.select().from(grnHeaders).where(eq(grnHeaders.id, line.grnId)).get();
        if (!grn || grn.status !== 'finalized') return null;
        const vendor = db.select().from(vendors).where(eq(vendors.id, grn.vendorId)).get();
        return {
          date: grn.updatedAt ?? line.updatedAt ?? line.createdAt,
          type: 'purchase' as const,
          reference: grn.grnNumber,
          vendorOrCustomer: vendor?.name ?? null,
          qty: line.qty,
          unitCostOrPrice: line.unitCost,
          total: line.lineTotal,
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null)
      .sort((a, b) => b.date.localeCompare(a.date));

    const saleRows = db.select().from(saleItems).where(eq(saleItems.productId, productId)).all();
    const salesHistory = saleRows
      .map((item) => {
        const sale = db.select().from(sales).where(eq(sales.id, item.saleId)).get();
        if (!sale || sale.status === 'held' || sale.status === 'voided') return null;
        return {
          date: sale.createdAt ?? item.createdAt,
          type: 'sale' as const,
          reference: sale.saleNumber ?? '',
          vendorOrCustomer: null,
          qty: item.quantity,
          unitCostOrPrice: item.unitPrice,
          total: item.lineTotal,
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null)
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 50);

    const returnRows = db.select().from(returnItems).all().filter((ri) => {
      const si = db.select().from(saleItems).where(eq(saleItems.id, ri.saleItemId)).get();
      return si?.productId === productId;
    });
    const returnsHistory = returnRows.map((ri) => {
      const ret = db.select().from(returns).where(eq(returns.id, ri.returnId)).get();
      return {
        date: ret?.createdAt ?? ri.createdAt,
        type: 'return' as const,
        reference: ret?.returnNumber ?? '',
        vendorOrCustomer: null,
        qty: ri.qtyReturned,
        unitCostOrPrice: ri.unitRefund,
        total: ri.qtyReturned * ri.unitRefund,
      };
    }).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 50);

    return {
      success: true,
      data: { productId, purchases: grnPurchaseRows, sales: salesHistory, returns: returnsHistory },
    };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'History failed' };
  }
}

export function handleProductSeedDemo(): ApiResult<{ added: number; skipped: number }> {
  try {
    requireRole('super_admin', 'manager');
    const result = seedDemoProducts({ skipExisting: true });
    logAudit('products', 'seed_demo', undefined, undefined, result);
    return { success: true, data: result };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Seed failed' };
  }
}

export function handleProductImportCsv(csvContent: string): ApiResult<{ imported: number; errors: string[] }> {
  try {
    requireRole('super_admin', 'manager');
    const lines = csvContent.trim().split('\n');
    if (lines.length < 2) return { success: false, error: 'CSV must have header and at least one row' };

    const headers = lines[0].split(',').map((h) => h.trim().toLowerCase());
    const errors: string[] = [];
    let imported = 0;

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map((c) => c.trim());
      const row: Record<string, string> = {};
      headers.forEach((h, idx) => { row[h] = cols[idx] ?? ''; });

      if (!row.name || !row.retail_price) {
        errors.push(`Row ${i + 1}: missing name or retail_price`);
        continue;
      }

      const result = handleProductCreate({
        name: row.name,
        sku: row.sku || undefined,
        barcode: row.barcode || undefined,
        costPrice: parseFloat(row.cost_price || '0'),
        retailPrice: parseFloat(row.retail_price),
        stockQty: parseInt(row.stock_qty || '0', 10),
        taxRate: parseFloat(row.tax_rate || '17'),
      });

      if (result.success) imported++;
      else errors.push(`Row ${i + 1}: ${result.error}`);
    }

    logAudit('products', 'import_csv', undefined, undefined, { imported, errorCount: errors.length });
    return { success: true, data: { imported, errors } };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Import failed' };
  }
}

type ImportRow = {
  name: string;
  category: string;
  cost_price?: string | number;
  retail_price: string | number;
  sale_price?: string | number;
};

export function handleProductImportRows(
  rows: ImportRow[],
): ApiResult<{ imported: number; errors: string[] }> {
  try {
    requireRole('super_admin', 'manager');
    if (!rows.length) return { success: false, error: 'No rows found in file' };

    const db = getDb();
    const errors: string[] = [];
    let imported = 0;
    const categoryCache = new Map<string, string>(); // name.lower → id
    const usedPrefixes = new Set(getExistingSkuPrefixes(db));

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2;

      const name = String(row.name ?? '').trim();
      if (!name) { errors.push(`Row ${rowNum}: Name is required`); continue; }

      const retailPrice = parseFloat(String(row.retail_price ?? '0'));
      if (!retailPrice || retailPrice <= 0) {
        errors.push(`Row ${rowNum} "${name}": Valid Retail Price is required`);
        continue;
      }

      const categoryName = String(row.category ?? '').trim();
      if (!categoryName) { errors.push(`Row ${rowNum} "${name}": Category is required`); continue; }

      let categoryId = categoryCache.get(categoryName.toLowerCase());
      if (!categoryId) {
        const existing = db.select({ id: categories.id })
          .from(categories)
          .where(sql`lower(${categories.name}) = lower(${categoryName})`)
          .get();
        if (existing) {
          categoryId = existing.id;
        } else {
          const now = new Date().toISOString();
          const catId = uuid();
          const prefix = resolveUniqueSkuPrefix(categoryName, usedPrefixes).slice(0, 4);
          usedPrefixes.add(prefix);
          db.insert(categories).values({
            id: catId,
            name: categoryName,
            color: '#6366f1',
            skuPrefix: prefix,
            deviceId: 'local-device',
            branchId: 'main',
            createdAt: now,
            updatedAt: now,
          }).run();
          categoryId = catId;
        }
        categoryCache.set(categoryName.toLowerCase(), categoryId);
      }

      const result = handleProductCreate({
        name,
        categoryId,
        costPrice: parseFloat(String(row.cost_price ?? '0')) || 0,
        retailPrice,
        salePrice: row.sale_price ? parseFloat(String(row.sale_price)) || undefined : undefined,
        taxRate: 0,
        stockQty: 0,
      });

      if (result.success) imported++;
      else errors.push(`Row ${rowNum} "${name}": ${result.error}`);
    }

    logAudit('products', 'import_excel', undefined, undefined, { imported, errorCount: errors.length });
    return { success: true, data: { imported, errors } };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Import failed' };
  }
}
