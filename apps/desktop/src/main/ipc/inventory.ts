import { and, desc, eq, lte } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import { inventoryMovements, products, stockAdjustments } from '@mama-babi/db-schema';
import type { ApiResult, InventoryMovement, StockAdjustmentInput } from '@shared/types';
import { getDb } from '../db';
import { requireRole, requireSession } from '../session';
import { logAudit } from '../services/audit';
import { getSetting } from '../services/settings';

export function handleInventoryAdjust(input: StockAdjustmentInput): ApiResult<{ qtyBefore: number; qtyAfter: number }> {
  try {
    const session = requireRole('super_admin', 'manager');
    const db = getDb();
    const now = new Date().toISOString();
    const deviceId = getSetting('device_id') ?? 'local-device';
    const branchId = getSetting('branch_id') ?? 'main';

    const product = db.select().from(products).where(eq(products.id, input.productId)).get();
    if (!product) return { success: false, error: 'Product not found' };

    const qtyBefore = product.stockQty;
    const qtyAfter = input.qtyAfter;
    const qtyChange = qtyAfter - qtyBefore;

    db.transaction((tx) => {
      tx.update(products).set({ stockQty: qtyAfter, updatedAt: now }).where(eq(products.id, input.productId)).run();
      tx.insert(stockAdjustments).values({
        id: uuid(),
        productId: input.productId,
        qtyBefore,
        qtyAfter,
        reason: input.reason,
        approvedBy: session.id,
        notes: input.notes ?? null,
        deviceId,
        branchId,
        createdAt: now,
        updatedAt: now,
      }).run();
      tx.insert(inventoryMovements).values({
        id: uuid(),
        productId: input.productId,
        type: 'adjustment',
        qtyChange,
        referenceId: null,
        notes: `${input.reason}: ${input.notes ?? ''}`,
        deviceId,
        branchId,
        createdAt: now,
        updatedAt: now,
      }).run();
    });

    logAudit('inventory', 'adjust', input.productId, { qtyBefore }, { qtyAfter, reason: input.reason });
    return { success: true, data: { qtyBefore, qtyAfter } };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Adjust failed' };
  }
}

export function handleLowStock(): ApiResult<Array<{ id: string; name: string; sku: string; stockQty: number; reorderLevel: number }>> {
  try {
    requireSession();
    const db = getDb();
    const rows = db
      .select()
      .from(products)
      .where(
        and(
          eq(products.isDeleted, false),
          eq(products.status, 'active'),
          lte(products.stockQty, products.reorderLevel),
        ),
      )
      .all();

    return {
      success: true,
      data: rows.map((p) => ({
        id: p.id,
        name: p.name,
        sku: p.sku,
        stockQty: p.stockQty,
        reorderLevel: p.reorderLevel,
      })),
    };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Low stock failed' };
  }
}

export function handleMovementHistory(productId?: string, limit = 100): ApiResult<InventoryMovement[]> {
  try {
    requireSession();
    const db = getDb();
    let rows = db.select().from(inventoryMovements).orderBy(desc(inventoryMovements.createdAt)).limit(limit).all();
    if (productId) rows = rows.filter((r) => r.productId === productId);

    const data: InventoryMovement[] = rows.map((r) => {
      const product = db.select().from(products).where(eq(products.id, r.productId)).get();
      return {
        id: r.id,
        productId: r.productId,
        productName: product?.name ?? 'Unknown',
        type: r.type,
        qtyChange: r.qtyChange,
        notes: r.notes,
        createdAt: r.createdAt,
      };
    });

    return { success: true, data };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'History failed' };
  }
}
