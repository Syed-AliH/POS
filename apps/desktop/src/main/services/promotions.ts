import { and, eq } from 'drizzle-orm';
import { promotions } from '@mama-babi/db-schema';
import type { PromotionPreview, PromotionPreviewInput } from '@shared/types';
import { getDb } from '../db';

function parseIds(json: string | null): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Parse a promotion boundary into epoch ms. Supports both date-only ("YYYY-MM-DD")
 * and datetime ("YYYY-MM-DDTHH:mm") strings. Date-only start = beginning of day,
 * date-only end = end of day, so a whole-day range stays inclusive.
 */
function parseBoundary(value: string, isEnd: boolean): number | null {
  const v = value.trim();
  if (!v) return null;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(v);
  const iso = dateOnly ? `${v}T${isEnd ? '23:59:59.999' : '00:00:00'}` : v;
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? null : ms;
}

function isPromotionActive(
  startDate: string | null,
  endDate: string | null,
  now: Date = new Date(),
): boolean {
  const nowMs = now.getTime();
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

function promotionAppliesToCart(
  promo: typeof promotions.$inferSelect,
  input: PromotionPreviewInput,
): boolean {
  if (!isPromotionActive(promo.startDate, promo.endDate)) return false;
  if (promo.minPurchase && input.subtotal < promo.minPurchase) return false;

  const productIds = parseIds(promo.productIds);
  const categoryIds = parseIds(promo.categoryIds);

  if (!productIds.length && !categoryIds.length) return true;

  return input.items.some((item) => {
    if (productIds.includes(item.productId)) return true;
    if (item.categoryId && categoryIds.includes(item.categoryId)) return true;
    return false;
  });
}

function calcPromotionDiscount(
  promo: typeof promotions.$inferSelect,
  input: PromotionPreviewInput,
): number {
  const productIds = parseIds(promo.productIds);
  const categoryIds = parseIds(promo.categoryIds);

  let applicableSubtotal = input.subtotal;
  if (productIds.length || categoryIds.length) {
    applicableSubtotal = input.items.reduce((sum, item) => {
      const matches =
        productIds.includes(item.productId) ||
        (item.categoryId ? categoryIds.includes(item.categoryId) : false);
      return matches ? sum + item.unitPrice * item.quantity : sum;
    }, 0);
  }

  if (promo.type === 'percent') {
    return Math.min(applicableSubtotal * (promo.value / 100), input.subtotal);
  }
  return Math.min(promo.value, input.subtotal);
}

export function calculatePromotionPreviews(input: PromotionPreviewInput): PromotionPreview[] {
  const db = getDb();
  const activePromos = db
    .select()
    .from(promotions)
    .where(and(eq(promotions.isActive, true), eq(promotions.isDeleted, false)))
    .all();

  const applicable = activePromos
    .filter((p) => promotionAppliesToCart(p, input))
    .map((p) => ({
      promotionId: p.id,
      promotionName: p.name,
      discountAmount: calcPromotionDiscount(p, input),
      isStackable: p.isStackable,
      // A promotion that targets specific products/categories only discounts its own
      // matching lines, so multiple such promotions can each apply at the same time.
      isTargeted: parseIds(p.productIds).length > 0 || parseIds(p.categoryIds).length > 0,
    }))
    .filter((p) => p.discountAmount > 0);

  if (!applicable.length) return [];

  // Targeted promotions (category/product specific) each apply independently.
  const targeted = applicable.filter((p) => p.isTargeted);
  const cartWide = applicable.filter((p) => !p.isTargeted);

  const targetedResults = targeted.map(({ promotionId, promotionName, discountAmount }) => ({
    promotionId,
    promotionName,
    discountAmount,
  }));

  if (!cartWide.length) return targetedResults;

  const stackable = cartWide.filter((p) => p.isStackable);
  const nonStackable = cartWide.filter((p) => !p.isStackable);

  const combine = (results: PromotionPreview[]): PromotionPreview[] => [...targetedResults, ...results];

  if (stackable.length && nonStackable.length) {
    const bestNonStackable = nonStackable.reduce((a, b) =>
      a.discountAmount >= b.discountAmount ? a : b,
    );
    const stackTotal = stackable.reduce((sum, p) => sum + p.discountAmount, 0);
    if (stackTotal >= bestNonStackable.discountAmount) {
      return combine(stackable.map(({ promotionId, promotionName, discountAmount }) => ({
        promotionId,
        promotionName,
        discountAmount,
      })));
    }
    return combine([{ promotionId: bestNonStackable.promotionId, promotionName: bestNonStackable.promotionName, discountAmount: bestNonStackable.discountAmount }]);
  }

  if (stackable.length) {
    return combine(stackable.map(({ promotionId, promotionName, discountAmount }) => ({
      promotionId,
      promotionName,
      discountAmount,
    })));
  }

  const best = nonStackable.reduce((a, b) => (a.discountAmount >= b.discountAmount ? a : b));
  return combine([{ promotionId: best.promotionId, promotionName: best.promotionName, discountAmount: best.discountAmount }]);
}

export function validatePromotionDiscount(
  input: PromotionPreviewInput,
  requestedDiscount: number,
  promotionIds?: string[],
): { valid: boolean; discount: number; promotionIds: string[] } {
  const previews = calculatePromotionPreviews(input);
  if (!previews.length) {
    return { valid: requestedDiscount === 0, discount: 0, promotionIds: [] };
  }

  if (promotionIds?.length) {
    const selected = previews.filter((p) => promotionIds.includes(p.promotionId));
    const total = selected.reduce((sum, p) => sum + p.discountAmount, 0);
    return {
      valid: Math.abs(total - requestedDiscount) < 0.01,
      discount: total,
      promotionIds: selected.map((p) => p.promotionId),
    };
  }

  const bestTotal = previews.reduce((sum, p) => sum + p.discountAmount, 0);
  const bestSingle = Math.max(...previews.map((p) => p.discountAmount));
  const expected = Math.max(bestTotal, bestSingle);
  return {
    valid: requestedDiscount <= expected + 0.01,
    discount: Math.min(requestedDiscount, expected),
    promotionIds: previews.map((p) => p.promotionId),
  };
}
