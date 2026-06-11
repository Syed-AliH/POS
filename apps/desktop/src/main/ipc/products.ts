import { and, eq, like, or } from 'drizzle-orm';
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
import type { AdvancedProductSearchInput, ApiResult, Category, Product, ProductHistory, ProductInput } from '@shared/types';
import { getDb } from '../db';
import { requireRole, requireSession } from '../session';
import { logAudit } from '../services/audit';
import { seedDemoProducts } from '../services/demoProducts';
import { deriveSkuPrefix, generateCategorySku } from '../services/skuGenerator';

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
    const q = `%${query}%`;
    const rows = db
      .select()
      .from(products)
      .where(
        and(
          eq(products.isDeleted, false),
          eq(products.status, 'active'),
          or(like(products.name, q), like(products.sku, q), like(products.barcode, q)),
        ),
      )
      .limit(50)
      .all();
    return { success: true, data: rows.map(mapProduct) };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Search failed' };
  }
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
    const row = db
      .select()
      .from(products)
      .where(and(eq(products.barcode, barcode.trim()), eq(products.isDeleted, false), eq(products.status, 'active')))
      .get();
    return { success: true, data: row ? mapProduct(row) : null };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Lookup failed' };
  }
}

export function handleProductCreate(input: ProductInput): ApiResult<Product> {
  try {
    requireRole('super_admin', 'manager');
    if (!input.name?.trim()) return { success: false, error: 'Product name is required' };
    if (!input.categoryId) return { success: false, error: 'Category is required' };
    if (!input.retailPrice || input.retailPrice <= 0) {
      return { success: false, error: 'Retail price must be greater than 0' };
    }
    const db = getDb();
    const now = new Date().toISOString();
    const id = uuid();
    const sku = generateCategorySku(input.categoryId);
    const barcode = generateBarcode();

    const row = {
      id,
      name: input.name,
      sku,
      barcode,
      categoryId: input.categoryId ?? null,
      brandId: input.brandId ?? null,
      vendorId: input.vendorId ?? null,
      costPrice: input.costPrice,
      retailPrice: input.retailPrice,
      salePrice: input.salePrice ?? null,
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

    const now = new Date().toISOString();
    const updates = { ...input, updatedAt: now };
    db.update(products).set(updates).where(eq(products.id, id)).run();

    const updated = db.select().from(products).where(eq(products.id, id)).get()!;
    logAudit('products', 'update', id, existing, updated);
    return { success: true, data: mapProduct(updated) };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Update failed' };
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

export function handleCategoryCreate(name: string, color?: string, skuPrefix?: string): ApiResult<Category> {
  try {
    requireRole('super_admin', 'manager');
    const db = getDb();
    const now = new Date().toISOString();
    const id = uuid();
    const prefix = (skuPrefix?.trim().toUpperCase() || deriveSkuPrefix(name)).slice(0, 4);
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
    const rows = db.select().from(categories).where(eq(categories.isDeleted, false)).all();
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
    let rows = db.select().from(products).where(and(eq(products.isDeleted, false), eq(products.status, 'active'))).all();

    if (input.sku?.trim()) {
      const s = input.sku.trim().toLowerCase();
      rows = rows.filter((r) => r.sku.toLowerCase().startsWith(s) || r.barcode.startsWith(s));
    }
    if (input.master?.trim()) {
      const m = input.master.trim().toLowerCase();
      rows = rows.filter((r) => r.name.toLowerCase().startsWith(m));
    }
    if (input.refine?.trim()) {
      const f = input.refine.trim().toLowerCase();
      rows = rows.filter((r) => r.name.toLowerCase().includes(f));
    }

    return { success: true, data: rows.slice(0, 50).map(mapProduct) };
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
