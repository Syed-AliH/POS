import { and, eq, sql } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import { promoCodes } from '@mama-babi/db-schema';
import type {
  ApiResult,
  PromoCode,
  PromoCodeInput,
  PromoCodeValidateInput,
  PromoCodeValidateResult,
} from '@shared/types';
import { getDb } from '../db';
import { requireRole, requireSession } from '../session';
import { logAudit } from '../services/audit';
import { getSetting } from '../services/settings';

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

function mapPromoCode(row: typeof promoCodes.$inferSelect): PromoCode {
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

export function handlePromoCodeList(): ApiResult<PromoCode[]> {
  try {
    requireRole('super_admin', 'manager');
    const db = getDb();
    const rows = db.select().from(promoCodes).where(eq(promoCodes.isDeleted, false)).all();
    return { success: true, data: rows.map(mapPromoCode) };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'List failed' };
  }
}

export function handlePromoCodeCreate(input: PromoCodeInput): ApiResult<PromoCode> {
  try {
    requireRole('super_admin', 'manager');
    const db = getDb();
    const now = new Date().toISOString();
    const code = input.code.trim().toUpperCase();
    const existing = db.select().from(promoCodes).where(eq(promoCodes.code, code)).get();
    if (existing && !existing.isDeleted) return { success: false, error: 'Promo code already exists' };

    const id = uuid();
    const deviceId = getSetting('device_id') ?? 'local-device';
    const branchId = getSetting('branch_id') ?? 'main';

    db.insert(promoCodes)
      .values({
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
        deviceId,
        branchId,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    logAudit('promo_codes', 'create', id, undefined, { code });
    const row = db.select().from(promoCodes).where(eq(promoCodes.id, id)).get()!;
    return { success: true, data: mapPromoCode(row) };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Create failed' };
  }
}

export function handlePromoCodeUpdate(id: string, input: Partial<PromoCodeInput>): ApiResult<PromoCode> {
  try {
    requireRole('super_admin', 'manager');
    const db = getDb();
    const existing = db.select().from(promoCodes).where(eq(promoCodes.id, id)).get();
    if (!existing) return { success: false, error: 'Promo code not found' };

    const now = new Date().toISOString();
    db.update(promoCodes)
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
      .where(eq(promoCodes.id, id))
      .run();

    logAudit('promo_codes', 'update', id);
    const row = db.select().from(promoCodes).where(eq(promoCodes.id, id)).get()!;
    return { success: true, data: mapPromoCode(row) };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Update failed' };
  }
}

export function handlePromoCodeDelete(id: string): ApiResult<{ id: string }> {
  try {
    requireRole('super_admin', 'manager');
    const db = getDb();
    db.update(promoCodes)
      .set({ isDeleted: true, updatedAt: new Date().toISOString() })
      .where(eq(promoCodes.id, id))
      .run();
    logAudit('promo_codes', 'delete', id);
    return { success: true, data: { id } };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Delete failed' };
  }
}

export function handlePromoCodeValidate(input: PromoCodeValidateInput): ApiResult<PromoCodeValidateResult> {
  try {
    requireSession();
    const db = getDb();
    const code = input.code.trim().toUpperCase();
    const row = db
      .select()
      .from(promoCodes)
      .where(and(eq(promoCodes.code, code), eq(promoCodes.isDeleted, false)))
      .get();

    if (!row) return { success: false, error: 'Invalid promo code' };
    if (!row.isActive) return { success: false, error: 'Promo code is inactive' };
    if (!isActiveNow(row.startDate, row.endDate)) return { success: false, error: 'Promo code is not valid at this time' };
    if (row.usageLimit != null && row.usageCount >= row.usageLimit) {
      return { success: false, error: 'Promo code usage limit reached' };
    }
    if (row.minPurchase && input.subtotal < row.minPurchase) {
      return { success: false, error: `Minimum purchase of ${row.minPurchase} required` };
    }

    const productIds = parseIds(row.productIds);
    const categoryIds = parseIds(row.categoryIds);
    const targeted = productIds.length > 0 || categoryIds.length > 0;

    const eligibleItems = targeted
      ? input.items.filter(
          (i) => productIds.includes(i.productId) || (i.categoryId ? categoryIds.includes(i.categoryId) : false),
        )
      : input.items;

    if (!eligibleItems.length) return { success: false, error: 'No eligible items in cart for this promo code' };

    const applicableSubtotal = eligibleItems.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);
    const discountAmount =
      row.type === 'percent'
        ? Math.min(applicableSubtotal * (row.value / 100), input.subtotal)
        : Math.min(row.value, applicableSubtotal);

    if (discountAmount <= 0) return { success: false, error: 'Promo code gives no discount for this cart' };

    return {
      success: true,
      data: {
        promoCodeId: row.id,
        code: row.code,
        discountAmount,
        eligibleProductIds: eligibleItems.map((i) => i.productId),
      },
    };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Validation failed' };
  }
}

export function handlePromoCodeRedeem(id: string): ApiResult<{ id: string }> {
  try {
    requireSession();
    const db = getDb();
    db.update(promoCodes)
      .set({ usageCount: sql`${promoCodes.usageCount} + 1`, updatedAt: new Date().toISOString() })
      .where(eq(promoCodes.id, id))
      .run();
    return { success: true, data: { id } };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Redeem failed' };
  }
}
