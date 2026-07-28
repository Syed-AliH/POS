import { and, eq, sql } from 'drizzle-orm';
import { promoCodes } from '@mama-babi/db-pg';
import type { PostgresClient } from '@mama-babi/db-pg';
import { v4 as uuid } from 'uuid';

interface PromoCodeInput {
  code: string;
  description?: string;
  type: 'percent' | 'fixed';
  value: number;
  startDate?: string;
  endDate?: string;
  minPurchase?: number;
  productIds?: string[];
  categoryIds?: string[];
  usageLimit?: number;
  isActive?: boolean;
}

interface ValidateInput {
  code: string;
  items: Array<{ productId: string; quantity: number; unitPrice: number; categoryId?: string | null }>;
  subtotal: number;
}

function parseIds(json: string | null): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseBoundary(value: string, isEnd: boolean): number | null {
  const v = value.trim();
  if (!v) return null;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(v);
  const iso = dateOnly ? `${v}T${isEnd ? '23:59:59.999' : '00:00:00'}` : v;
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? null : ms;
}

function isActiveNow(startDate: string | null, endDate: string | null): boolean {
  const nowMs = Date.now();
  if (startDate) {
    const start = parseBoundary(startDate, false);
    if (start != null && nowMs < start) return false;
  }
  if (endDate) {
    const end = parseBoundary(endDate, true);
    if (end != null && nowMs > end) return false;
  }
  return true;
}

function mapPromoCode(row: typeof promoCodes.$inferSelect) {
  return {
    id: row.id,
    code: row.code,
    description: row.description,
    type: row.type as 'percent' | 'fixed',
    value: row.value,
    startDate: row.startDate,
    endDate: row.endDate,
    minPurchase: row.minPurchase,
    productIds: parseIds(row.productIds),
    categoryIds: parseIds(row.categoryIds),
    usageLimit: row.usageLimit,
    usageCount: row.usageCount,
    isActive: row.isActive,
  };
}

export async function listPromoCodes(db: PostgresClient) {
  const rows = await db.select().from(promoCodes).where(eq(promoCodes.isDeleted, false));
  return { success: true as const, data: rows.map(mapPromoCode) };
}

export async function createPromoCode(db: PostgresClient, input: PromoCodeInput) {
  const now = new Date().toISOString();
  const id = uuid();
  const code = input.code.trim().toUpperCase();
  const existing = await db.select().from(promoCodes).where(eq(promoCodes.code, code)).limit(1);
  if (existing.length) return { success: false as const, error: 'Promo code already exists' };

  await db.insert(promoCodes).values({
    id,
    code,
    description: input.description ?? null,
    type: input.type,
    value: input.value,
    startDate: input.startDate ?? null,
    endDate: input.endDate ?? null,
    minPurchase: input.minPurchase ?? null,
    productIds: input.productIds?.length ? JSON.stringify(input.productIds) : null,
    categoryIds: input.categoryIds?.length ? JSON.stringify(input.categoryIds) : null,
    usageLimit: input.usageLimit ?? null,
    usageCount: 0,
    isActive: input.isActive ?? true,
    createdAt: now,
    updatedAt: now,
  });
  const [row] = await db.select().from(promoCodes).where(eq(promoCodes.id, id)).limit(1);
  return { success: true as const, data: mapPromoCode(row!) };
}

export async function updatePromoCode(db: PostgresClient, id: string, input: Partial<PromoCodeInput>) {
  const [existing] = await db.select().from(promoCodes).where(eq(promoCodes.id, id)).limit(1);
  if (!existing) return { success: false as const, error: 'Promo code not found' };
  const now = new Date().toISOString();

  await db
    .update(promoCodes)
    .set({
      code: input.code ? input.code.trim().toUpperCase() : existing.code,
      description: input.description !== undefined ? input.description : existing.description,
      type: input.type ?? existing.type,
      value: input.value ?? existing.value,
      startDate: input.startDate !== undefined ? input.startDate : existing.startDate,
      endDate: input.endDate !== undefined ? input.endDate : existing.endDate,
      minPurchase: input.minPurchase !== undefined ? input.minPurchase : existing.minPurchase,
      productIds:
        input.productIds !== undefined
          ? input.productIds.length
            ? JSON.stringify(input.productIds)
            : null
          : existing.productIds,
      categoryIds:
        input.categoryIds !== undefined
          ? input.categoryIds.length
            ? JSON.stringify(input.categoryIds)
            : null
          : existing.categoryIds,
      usageLimit: input.usageLimit !== undefined ? input.usageLimit : existing.usageLimit,
      isActive: input.isActive ?? existing.isActive,
      updatedAt: now,
    })
    .where(eq(promoCodes.id, id));
  const [row] = await db.select().from(promoCodes).where(eq(promoCodes.id, id)).limit(1);
  return { success: true as const, data: mapPromoCode(row!) };
}

export async function deletePromoCode(db: PostgresClient, id: string) {
  const now = new Date().toISOString();
  await db.update(promoCodes).set({ isDeleted: true, updatedAt: now }).where(eq(promoCodes.id, id));
  return { success: true as const, data: { id } };
}

export async function validatePromoCode(db: PostgresClient, input: ValidateInput) {
  const code = input.code.trim().toUpperCase();
  const [row] = await db
    .select()
    .from(promoCodes)
    .where(and(eq(promoCodes.code, code), eq(promoCodes.isDeleted, false)))
    .limit(1);

  if (!row) return { success: false as const, error: 'Invalid promo code' };
  if (!row.isActive) return { success: false as const, error: 'Promo code is inactive' };
  if (!isActiveNow(row.startDate, row.endDate)) return { success: false as const, error: 'Promo code is not valid at this time' };
  if (row.usageLimit != null && row.usageCount >= row.usageLimit) {
    return { success: false as const, error: 'Promo code usage limit reached' };
  }
  if (row.minPurchase && input.subtotal < row.minPurchase) {
    return { success: false as const, error: `Minimum purchase of ${row.minPurchase} required` };
  }

  const productIds = parseIds(row.productIds);
  const categoryIds = parseIds(row.categoryIds);
  const targeted = productIds.length > 0 || categoryIds.length > 0;

  const eligibleItems = targeted
    ? input.items.filter(
        (i) => productIds.includes(i.productId) || (i.categoryId ? categoryIds.includes(i.categoryId) : false),
      )
    : input.items;

  if (!eligibleItems.length) return { success: false as const, error: 'No eligible items in cart for this promo code' };

  const applicableSubtotal = eligibleItems.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);
  const discountAmount =
    row.type === 'percent'
      ? Math.min(applicableSubtotal * (row.value / 100), input.subtotal)
      : Math.min(row.value, applicableSubtotal);

  if (discountAmount <= 0) return { success: false as const, error: 'Promo code gives no discount for this cart' };

  return {
    success: true as const,
    data: {
      promoCodeId: row.id,
      code: row.code,
      discountAmount,
      eligibleProductIds: eligibleItems.map((i) => i.productId),
    },
  };
}

export async function redeemPromoCode(db: PostgresClient, id: string) {
  await db
    .update(promoCodes)
    .set({ usageCount: sql`${promoCodes.usageCount} + 1`, updatedAt: new Date().toISOString() })
    .where(eq(promoCodes.id, id));
  return { success: true as const, data: { id } };
}
