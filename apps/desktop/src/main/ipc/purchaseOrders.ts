import { and, desc, eq, lte } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import {
  inventoryMovements,
  poItems,
  products,
  purchaseOrders,
  vendors,
} from '@mama-babi/db-schema';
import type {
  ApiResult,
  CreatePoInput,
  PoItemSummary,
  PurchaseOrderSummary,
  ReceivePoInput,
  ReorderSuggestion,
} from '@shared/types';
import { getDb } from '../db';
import { requireRole } from '../session';
import { logAudit } from '../services/audit';
import { getSetting, incrementPoCounter } from '../services/settings';

function buildPoSummary(poId: string): PurchaseOrderSummary | null {
  const db = getDb();
  const po = db.select().from(purchaseOrders).where(eq(purchaseOrders.id, poId)).get();
  if (!po) return null;

  const vendor = db.select().from(vendors).where(eq(vendors.id, po.vendorId)).get();
  const items = db.select().from(poItems).where(eq(poItems.poId, poId)).all();

  const itemSummaries: PoItemSummary[] = items.map((item) => {
    const product = db.select().from(products).where(eq(products.id, item.productId)).get();
    return {
      id: item.id,
      productId: item.productId,
      productName: product?.name ?? 'Unknown',
      productSku: product?.sku ?? '',
      qtyOrdered: item.qtyOrdered,
      qtyReceived: item.qtyReceived,
      unitCost: item.unitCost,
      lineTotal: item.qtyOrdered * item.unitCost,
    };
  });

  return {
    id: po.id,
    poNumber: po.poNumber,
    vendorId: po.vendorId,
    vendorName: vendor?.name ?? 'Unknown',
    status: po.status,
    totalCost: po.totalCost,
    notes: po.notes,
    receivedAt: po.receivedAt,
    createdAt: po.createdAt,
    items: itemSummaries,
  };
}

export function handlePoCreate(input: CreatePoInput): ApiResult<PurchaseOrderSummary> {
  try {
    requireRole('super_admin', 'manager');
    if (!input.items.length) return { success: false, error: 'PO must have at least one item' };

    const db = getDb();
    const vendor = db.select().from(vendors).where(eq(vendors.id, input.vendorId)).get();
    if (!vendor) return { success: false, error: 'Vendor not found' };

    const now = new Date().toISOString();
    const deviceId = getSetting('device_id') ?? 'local-device';
    const branchId = getSetting('branch_id') ?? 'main';
    const poId = uuid();
    const poNumber = incrementPoCounter();

    let totalCost = 0;
    const lineItems: Array<typeof poItems.$inferInsert> = [];

    for (const item of input.items) {
      const product = db
        .select()
        .from(products)
        .where(and(eq(products.id, item.productId), eq(products.isDeleted, false)))
        .get();
      if (!product) return { success: false, error: `Product not found: ${item.productId}` };
      if (item.qtyOrdered <= 0) return { success: false, error: 'Quantity must be positive' };
      if (item.unitCost < 0) return { success: false, error: 'Unit cost cannot be negative' };

      totalCost += item.qtyOrdered * item.unitCost;
      lineItems.push({
        id: uuid(),
        poId,
        productId: item.productId,
        qtyOrdered: item.qtyOrdered,
        qtyReceived: 0,
        unitCost: item.unitCost,
        deviceId,
        branchId,
        createdAt: now,
        updatedAt: now,
      });
    }

    db.transaction((tx) => {
      tx.insert(purchaseOrders)
        .values({
          id: poId,
          poNumber,
          vendorId: input.vendorId,
          status: 'draft',
          totalCost,
          notes: input.notes ?? null,
          deviceId,
          branchId,
          createdAt: now,
          updatedAt: now,
        })
        .run();

      for (const line of lineItems) {
        tx.insert(poItems).values(line).run();
      }
    });

    logAudit('purchase_orders', 'create', poId, undefined, { poNumber, totalCost });
    const summary = buildPoSummary(poId);
    if (!summary) return { success: false, error: 'Failed to load PO' };
    return { success: true, data: summary };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Create failed' };
  }
}

export function handlePoList(limit = 50): ApiResult<PurchaseOrderSummary[]> {
  try {
    requireRole('super_admin', 'manager');
    const db = getDb();
    const rows = db.select().from(purchaseOrders).orderBy(desc(purchaseOrders.createdAt)).limit(limit).all();
    const summaries = rows.map((r) => buildPoSummary(r.id)).filter(Boolean) as PurchaseOrderSummary[];
    return { success: true, data: summaries };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'List failed' };
  }
}

export function handlePoGet(id: string): ApiResult<PurchaseOrderSummary> {
  try {
    requireRole('super_admin', 'manager');
    const summary = buildPoSummary(id);
    if (!summary) return { success: false, error: 'PO not found' };
    return { success: true, data: summary };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Get failed' };
  }
}

export function handlePoUpdateStatus(
  id: string,
  status: 'draft' | 'sent' | 'cancelled',
): ApiResult<PurchaseOrderSummary> {
  try {
    requireRole('super_admin', 'manager');
    const db = getDb();
    const po = db.select().from(purchaseOrders).where(eq(purchaseOrders.id, id)).get();
    if (!po) return { success: false, error: 'PO not found' };

    if (po.status === 'received' || po.status === 'partially_received') {
      return { success: false, error: 'Cannot change status of received PO' };
    }
    if (status === 'sent' && po.status !== 'draft') {
      return { success: false, error: 'Only draft POs can be sent' };
    }
    if (status === 'cancelled' && po.status === 'cancelled') {
      return { success: false, error: 'PO already cancelled' };
    }

    const now = new Date().toISOString();
    db.update(purchaseOrders).set({ status, updatedAt: now }).where(eq(purchaseOrders.id, id)).run();
    logAudit('purchase_orders', 'update_status', id, { status: po.status }, { status });
    const summary = buildPoSummary(id);
    return { success: true, data: summary! };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Update failed' };
  }
}

export function handlePoReceive(input: ReceivePoInput): ApiResult<PurchaseOrderSummary> {
  try {
    requireRole('super_admin', 'manager');
    const db = getDb();
    const po = db.select().from(purchaseOrders).where(eq(purchaseOrders.id, input.poId)).get();
    if (!po) return { success: false, error: 'PO not found' };
    if (po.status === 'cancelled') return { success: false, error: 'Cannot receive cancelled PO' };
    if (po.status === 'draft') return { success: false, error: 'Send PO before receiving' };

    const now = new Date().toISOString();
    const deviceId = getSetting('device_id') ?? 'local-device';
    const branchId = getSetting('branch_id') ?? 'main';

    db.transaction((tx) => {
      for (const recv of input.items) {
        if (recv.qtyReceived <= 0) continue;

        const poItem = tx.select().from(poItems).where(eq(poItems.id, recv.poItemId)).get();
        if (!poItem || poItem.poId !== input.poId) continue;

        const remaining = poItem.qtyOrdered - poItem.qtyReceived;
        const qtyToReceive = Math.min(recv.qtyReceived, remaining);
        if (qtyToReceive <= 0) continue;

        const newQtyReceived = poItem.qtyReceived + qtyToReceive;
        tx.update(poItems)
          .set({ qtyReceived: newQtyReceived, updatedAt: now })
          .where(eq(poItems.id, poItem.id))
          .run();

        const product = tx.select().from(products).where(eq(products.id, poItem.productId)).get()!;
        tx.update(products)
          .set({
            stockQty: product.stockQty + qtyToReceive,
            costPrice: poItem.unitCost,
            updatedAt: now,
          })
          .where(eq(products.id, poItem.productId))
          .run();

        tx.insert(inventoryMovements).values({
          id: uuid(),
          productId: poItem.productId,
          type: 'purchase',
          qtyChange: qtyToReceive,
          referenceId: input.poId,
          notes: `PO ${po.poNumber} receive`,
          deviceId,
          branchId,
          createdAt: now,
          updatedAt: now,
        }).run();
      }

      const allItems = tx.select().from(poItems).where(eq(poItems.poId, input.poId)).all();
      const fullyReceived = allItems.every((i) => i.qtyReceived >= i.qtyOrdered);
      const anyReceived = allItems.some((i) => i.qtyReceived > 0);
      const newStatus = fullyReceived ? 'received' : anyReceived ? 'partially_received' : po.status;

      tx.update(purchaseOrders)
        .set({
          status: newStatus,
          receivedAt: fullyReceived ? now : po.receivedAt,
          updatedAt: now,
        })
        .where(eq(purchaseOrders.id, input.poId))
        .run();
    });

    logAudit('purchase_orders', 'receive', input.poId);
    const summary = buildPoSummary(input.poId);
    return { success: true, data: summary! };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Receive failed' };
  }
}

export function handleReorderSuggestions(): ApiResult<ReorderSuggestion[]> {
  try {
    requireRole('super_admin', 'manager');
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

    const suggestions: ReorderSuggestion[] = rows.map((p) => {
      const vendor = p.vendorId
        ? db.select().from(vendors).where(eq(vendors.id, p.vendorId)).get()
        : null;
      return {
        productId: p.id,
        productName: p.name,
        sku: p.sku,
        stockQty: p.stockQty,
        reorderLevel: p.reorderLevel,
        reorderQty: p.reorderQty > 0 ? p.reorderQty : Math.max(p.reorderLevel - p.stockQty, 1),
        vendorId: p.vendorId,
        vendorName: vendor?.name ?? null,
        costPrice: p.costPrice,
      };
    });

    return { success: true, data: suggestions };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Suggestions failed' };
  }
}
