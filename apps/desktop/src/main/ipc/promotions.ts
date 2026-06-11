import { eq } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import { promotions } from '@mama-babi/db-schema';
import type { ApiResult, Promotion, PromotionInput, PromotionPreview, PromotionPreviewInput } from '@shared/types';
import { getDb } from '../db';
import { requireRole, requireSession } from '../session';
import { logAudit } from '../services/audit';
import { getSetting } from '../services/settings';
import { calculatePromotionPreviews } from '../services/promotions';

function parseIds(json: string | null): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function mapPromotion(row: typeof promotions.$inferSelect): Promotion {
  return {
    id: row.id,
    name: row.name,
    type: row.type as 'percent' | 'fixed',
    value: row.value,
    startDate: row.startDate,
    endDate: row.endDate,
    minPurchase: row.minPurchase,
    productIds: parseIds(row.productIds),
    categoryIds: parseIds(row.categoryIds),
    isStackable: row.isStackable,
    isActive: row.isActive,
  };
}

export function handlePromotionList(): ApiResult<Promotion[]> {
  try {
    requireRole('super_admin', 'manager');
    const db = getDb();
    const rows = db.select().from(promotions).where(eq(promotions.isDeleted, false)).all();
    return { success: true, data: rows.map(mapPromotion) };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'List failed' };
  }
}

export function handlePromotionCreate(input: PromotionInput): ApiResult<Promotion> {
  try {
    requireRole('super_admin', 'manager');
    const db = getDb();
    const now = new Date().toISOString();
    const deviceId = getSetting('device_id') ?? 'local-device';
    const branchId = getSetting('branch_id') ?? 'main';
    const id = uuid();

    db.insert(promotions)
      .values({
        id,
        name: input.name,
        type: input.type,
        value: input.value,
        startDate: input.startDate ?? null,
        endDate: input.endDate ?? null,
        minPurchase: input.minPurchase ?? null,
        productIds: input.productIds?.length ? JSON.stringify(input.productIds) : null,
        categoryIds: input.categoryIds?.length ? JSON.stringify(input.categoryIds) : null,
        isStackable: input.isStackable ?? false,
        isActive: input.isActive ?? true,
        deviceId,
        branchId,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    logAudit('promotions', 'create', id, undefined, { name: input.name });
    const row = db.select().from(promotions).where(eq(promotions.id, id)).get()!;
    return { success: true, data: mapPromotion(row) };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Create failed' };
  }
}

export function handlePromotionUpdate(id: string, input: Partial<PromotionInput>): ApiResult<Promotion> {
  try {
    requireRole('super_admin', 'manager');
    const db = getDb();
    const existing = db.select().from(promotions).where(eq(promotions.id, id)).get();
    if (!existing) return { success: false, error: 'Promotion not found' };

    const now = new Date().toISOString();
    db.update(promotions)
      .set({
        name: input.name ?? existing.name,
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
        isStackable: input.isStackable ?? existing.isStackable,
        isActive: input.isActive ?? existing.isActive,
        updatedAt: now,
      })
      .where(eq(promotions.id, id))
      .run();

    logAudit('promotions', 'update', id);
    const row = db.select().from(promotions).where(eq(promotions.id, id)).get()!;
    return { success: true, data: mapPromotion(row) };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Update failed' };
  }
}

export function handlePromotionPreview(input: PromotionPreviewInput): ApiResult<PromotionPreview[]> {
  try {
    requireSession();
    const previews = calculatePromotionPreviews(input);
    return { success: true, data: previews };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Preview failed' };
  }
}
