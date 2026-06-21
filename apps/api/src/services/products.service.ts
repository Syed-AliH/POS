import { and, eq, like, or } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import { generateBarcode } from '@mama-babi/barcode';
import { categories, products } from '@mama-babi/db-pg';
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

export async function searchProducts(db: PostgresClient, query: string) {
  const q = `%${query}%`;
  const rows = await db
    .select()
    .from(products)
    .where(
      and(
        eq(products.isDeleted, false),
        eq(products.status, 'active'),
        or(like(products.name, q), like(products.sku, q), like(products.barcode, q)),
      ),
    )
    .limit(50);
  return { success: true as const, data: rows.map(mapProduct) };
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
  const sku = input.sku?.trim() || `SKU-${id.slice(0, 8).toUpperCase()}`;
  const barcode = input.barcode?.trim() || generateBarcode();

  await db.insert(products).values({
    id,
    name: input.name.trim(),
    sku,
    barcode,
    categoryId: input.categoryId ?? null,
    brandId: input.brandId ?? null,
    vendorId: input.vendorId ?? null,
    costPrice: input.costPrice ?? 0,
    retailPrice: input.retailPrice ?? 0,
    salePrice: input.salePrice ?? null,
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
  const now = new Date().toISOString();
  await db
    .update(products)
    .set({
      name: input.name ?? existing.name,
      categoryId: input.categoryId !== undefined ? input.categoryId : existing.categoryId,
      brandId: input.brandId !== undefined ? input.brandId : existing.brandId,
      vendorId: input.vendorId !== undefined ? input.vendorId : existing.vendorId,
      costPrice: input.costPrice ?? existing.costPrice,
      retailPrice: input.retailPrice ?? existing.retailPrice,
      salePrice: input.salePrice !== undefined ? input.salePrice : existing.salePrice,
      taxRate: input.taxRate ?? existing.taxRate,
      stockQty: input.stockQty ?? existing.stockQty,
      reorderLevel: input.reorderLevel ?? existing.reorderLevel,
      description: input.description !== undefined ? input.description : existing.description,
      status: input.status ?? existing.status,
      updatedAt: now,
    })
    .where(eq(products.id, id));
  return getProduct(db, id);
}

export async function listCategories(db: PostgresClient) {
  const rows = await db.select().from(categories).where(eq(categories.isDeleted, false));
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

export async function createCategory(db: PostgresClient, name: string, color?: string, skuPrefix?: string) {
  const now = new Date().toISOString();
  const id = uuid();
  const deviceId = (await getSetting(db, 'device_id')) ?? 'cloud';
  const branchId = (await getSetting(db, 'branch_id')) ?? 'main';
  await db.insert(categories).values({
    id,
    name,
    color: color ?? null,
    skuPrefix: skuPrefix ?? null,
    deviceId,
    branchId,
    createdAt: now,
    updatedAt: now,
  });
  return { success: true as const, data: { id, name, parentId: null, color: color ?? null, skuPrefix: skuPrefix ?? null } };
}
