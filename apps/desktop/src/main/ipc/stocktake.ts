import { and, desc, eq } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import {
  inventoryMovements,
  products,
  stockAdjustments,
  stocktakeItems,
  stocktakeSessions,
  users,
} from '@mama-babi/db-schema';
import type { ApiResult, StocktakeSession } from '@shared/types';
import { getDb } from '../db';
import { requireRole } from '../session';
import { logAudit } from '../services/audit';
import { getSetting } from '../services/settings';

function buildSession(sessionId: string): StocktakeSession | null {
  const db = getDb();
  const session = db.select().from(stocktakeSessions).where(eq(stocktakeSessions.id, sessionId)).get();
  if (!session) return null;

  const starter = db.select().from(users).where(eq(users.id, session.startedBy)).get();
  const items = db.select().from(stocktakeItems).where(eq(stocktakeItems.sessionId, sessionId)).all();

  const mappedItems = items.map((item) => {
    const product = db.select().from(products).where(eq(products.id, item.productId)).get();
    const variance = item.countedQty != null ? item.countedQty - item.systemQty : null;
    return {
      id: item.id,
      productId: item.productId,
      productName: product?.name ?? 'Unknown',
      productSku: product?.sku ?? '',
      systemQty: item.systemQty,
      countedQty: item.countedQty,
      variance,
    };
  });

  const totalVariance = mappedItems.reduce((sum, i) => sum + (i.variance ?? 0), 0);

  return {
    id: session.id,
    startedBy: session.startedBy,
    startedByName: starter?.name ?? 'Unknown',
    status: session.status,
    notes: session.notes,
    completedAt: session.completedAt,
    createdAt: session.createdAt,
    items: mappedItems,
    totalVariance,
  };
}

export function handleStocktakeStart(notes?: string): ApiResult<StocktakeSession> {
  try {
    const session = requireRole('super_admin', 'manager');
    const db = getDb();
    const existing = db
      .select()
      .from(stocktakeSessions)
      .where(eq(stocktakeSessions.status, 'in_progress'))
      .get();
    if (existing) return { success: false, error: 'A stocktake is already in progress' };

    const now = new Date().toISOString();
    const deviceId = getSetting('device_id') ?? 'local-device';
    const branchId = getSetting('branch_id') ?? 'main';
    const sessionId = uuid();

    const activeProducts = db
      .select()
      .from(products)
      .where(and(eq(products.isDeleted, false), eq(products.status, 'active')))
      .all();

    db.transaction((tx) => {
      tx.insert(stocktakeSessions).values({
        id: sessionId,
        startedBy: session.id,
        status: 'in_progress',
        notes: notes ?? null,
        deviceId,
        branchId,
        createdAt: now,
        updatedAt: now,
      }).run();

      for (const product of activeProducts) {
        tx.insert(stocktakeItems).values({
          id: uuid(),
          sessionId,
          productId: product.id,
          systemQty: product.stockQty,
          countedQty: null,
          deviceId,
          branchId,
          createdAt: now,
          updatedAt: now,
        }).run();
      }
    });

    logAudit('stocktake', 'start', sessionId);
    return { success: true, data: buildSession(sessionId)! };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Start failed' };
  }
}

export function handleStocktakeCurrent(): ApiResult<StocktakeSession | null> {
  try {
    requireRole('super_admin', 'manager');
    const db = getDb();
    const row = db
      .select()
      .from(stocktakeSessions)
      .where(eq(stocktakeSessions.status, 'in_progress'))
      .orderBy(desc(stocktakeSessions.createdAt))
      .get();
    return { success: true, data: row ? buildSession(row.id) : null };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Get failed' };
  }
}

export function handleStocktakeCount(sessionId: string, productId: string, countedQty: number): ApiResult<StocktakeSession> {
  try {
    requireRole('super_admin', 'manager');
    const db = getDb();
    const session = db.select().from(stocktakeSessions).where(eq(stocktakeSessions.id, sessionId)).get();
    if (!session || session.status !== 'in_progress') return { success: false, error: 'Stocktake not active' };

    const now = new Date().toISOString();
    db.update(stocktakeItems)
      .set({ countedQty, updatedAt: now })
      .where(and(eq(stocktakeItems.sessionId, sessionId), eq(stocktakeItems.productId, productId)))
      .run();

    return { success: true, data: buildSession(sessionId)! };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Count failed' };
  }
}

export function handleStocktakeComplete(sessionId: string): ApiResult<StocktakeSession> {
  try {
    const sessionUser = requireRole('super_admin', 'manager');
    const db = getDb();
    const session = db.select().from(stocktakeSessions).where(eq(stocktakeSessions.id, sessionId)).get();
    if (!session || session.status !== 'in_progress') return { success: false, error: 'Stocktake not active' };

    const items = db.select().from(stocktakeItems).where(eq(stocktakeItems.sessionId, sessionId)).all();
    const uncounted = items.filter((i) => i.countedQty == null);
    if (uncounted.length) return { success: false, error: `${uncounted.length} products still uncounted` };

    const now = new Date().toISOString();
    const deviceId = getSetting('device_id') ?? 'local-device';
    const branchId = getSetting('branch_id') ?? 'main';

    db.transaction((tx) => {
      for (const item of items) {
        if (item.countedQty === item.systemQty) continue;

        const product = tx.select().from(products).where(eq(products.id, item.productId)).get()!;
        tx.update(products)
          .set({ stockQty: item.countedQty!, updatedAt: now })
          .where(eq(products.id, item.productId))
          .run();

        tx.insert(stockAdjustments).values({
          id: uuid(),
          productId: item.productId,
          qtyBefore: item.systemQty,
          qtyAfter: item.countedQty!,
          reason: 'stocktake',
          approvedBy: sessionUser.id,
          notes: `Stocktake ${sessionId}`,
          deviceId,
          branchId,
          createdAt: now,
          updatedAt: now,
        }).run();

        tx.insert(inventoryMovements).values({
          id: uuid(),
          productId: item.productId,
          type: 'stocktake',
          qtyChange: item.countedQty! - item.systemQty,
          referenceId: sessionId,
          notes: 'Stocktake adjustment',
          deviceId,
          branchId,
          createdAt: now,
          updatedAt: now,
        }).run();
      }

      tx.update(stocktakeSessions)
        .set({ status: 'completed', completedAt: now, updatedAt: now })
        .where(eq(stocktakeSessions.id, sessionId))
        .run();
    });

    logAudit('stocktake', 'complete', sessionId);
    return { success: true, data: buildSession(sessionId)! };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Complete failed' };
  }
}

export function handleStocktakeCancel(sessionId: string): ApiResult<StocktakeSession> {
  try {
    requireRole('super_admin', 'manager');
    const db = getDb();
    const row = db.select().from(stocktakeSessions).where(eq(stocktakeSessions.id, sessionId)).get();
    if (!row) return { success: false, error: 'Session not found' };
    if (row.status !== 'in_progress') return { success: false, error: 'Only in-progress stocktakes can be cancelled' };

    const now = new Date().toISOString();
    db.update(stocktakeSessions)
      .set({ status: 'cancelled', updatedAt: now })
      .where(eq(stocktakeSessions.id, sessionId))
      .run();

    logAudit('stocktake', 'cancel', sessionId);
    return { success: true, data: buildSession(sessionId)! };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Cancel failed' };
  }
}

export function handleStocktakeList(limit = 20): ApiResult<StocktakeSession[]> {
  try {
    requireRole('super_admin', 'manager');
    const db = getDb();
    const rows = db.select().from(stocktakeSessions).orderBy(desc(stocktakeSessions.createdAt)).limit(limit).all();
    return { success: true, data: rows.map((r) => buildSession(r.id)!).filter(Boolean) };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'List failed' };
  }
}
