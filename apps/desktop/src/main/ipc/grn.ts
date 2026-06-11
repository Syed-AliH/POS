import { desc, eq } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import {
  grnHeaders,
  grnLines,
  inventoryMovements,
  productCostHistory,
  products,
  users,
  vendors,
} from '@mama-babi/db-schema';
import type { ApiResult, CreateGrnInput, GrnListParams, GrnSummary, UpdateGrnInput } from '@shared/types';
import { getDb } from '../db';
import { requireRole, requireSession } from '../session';
import { logAudit } from '../services/audit';
import { getSetting, incrementGrnCounter } from '../services/settings';
import {
  recalculateVendorBalance,
  saveVendorPaymentPreference,
  type GrnPaymentType,
} from '../services/supplierCredit';

function mapGrn(grnId: string): GrnSummary | null {
  const db = getDb();
  const header = db.select().from(grnHeaders).where(eq(grnHeaders.id, grnId)).get();
  if (!header) return null;

  const vendor = db.select().from(vendors).where(eq(vendors.id, header.vendorId)).get();
  const creator = db.select().from(users).where(eq(users.id, header.createdBy)).get();
  const lines = db.select().from(grnLines).where(eq(grnLines.grnId, grnId)).all();

  const items = lines.map((line) => {
    const product = db.select().from(products).where(eq(products.id, line.productId)).get();
    return {
      id: line.id,
      productId: line.productId,
      productName: product?.name ?? 'Unknown',
      productSku: product?.sku ?? '',
      qty: line.qty,
      unitCost: line.unitCost,
      unitRetail: line.unitRetail ?? product?.retailPrice ?? 0,
      lineTotal: line.lineTotal,
    };
  });

  return {
    id: header.id,
    grnNumber: header.grnNumber,
    vendorId: header.vendorId,
    vendorName: vendor?.name ?? 'Unknown',
    invoiceNumber: header.invoiceNumber,
    invoiceTotal: header.invoiceTotal,
    linesTotal: items.reduce((sum, i) => sum + i.lineTotal, 0),
    receivedDate: header.receivedDate,
    status: header.status,
    paymentType: (header.paymentType ?? 'cash') as GrnPaymentType,
    notes: header.notes,
    createdByName: creator?.name ?? 'Unknown',
    createdAt: header.createdAt,
    updatedAt: header.updatedAt,
    items,
  };
}

export function handleGrnCreate(input: CreateGrnInput): ApiResult<GrnSummary> {
  try {
    const session = requireRole('super_admin', 'manager');
    if (!input.vendorId) return { success: false, error: 'Vendor is required' };
    if (!input.items?.length) return { success: false, error: 'Add at least one line' };

    const db = getDb();
    const vendor = db.select().from(vendors).where(eq(vendors.id, input.vendorId)).get();
    if (!vendor) return { success: false, error: 'Vendor not found' };

    const now = new Date().toISOString();
    const deviceId = getSetting('device_id') ?? 'local-device';
    const branchId = getSetting('branch_id') ?? 'main';
    const grnId = uuid();
    const grnNumber = incrementGrnCounter();
    const receivedDate = input.receivedDate ?? now.slice(0, 10);
    const paymentType: GrnPaymentType = input.paymentType ?? (vendor.preferredPaymentType as GrnPaymentType) ?? 'cash';

    const lineRows = input.items.map((item) => {
      const product = db.select().from(products).where(eq(products.id, item.productId)).get();
      if (!product) throw new Error(`Product not found: ${item.productId}`);
      const lineTotal = item.qty * item.unitCost;
      const unitRetail = item.unitRetail ?? product.retailPrice;
      return {
        id: uuid(),
        grnId,
        productId: item.productId,
        qty: item.qty,
        unitCost: item.unitCost,
        unitRetail,
        lineTotal,
        deviceId,
        branchId,
        createdAt: now,
        updatedAt: now,
      };
    });

    const linesTotal = lineRows.reduce((sum, l) => sum + l.lineTotal, 0);

    db.transaction((tx) => {
      tx.insert(grnHeaders).values({
        id: grnId,
        grnNumber,
        vendorId: input.vendorId,
        invoiceNumber: input.invoiceNumber ?? null,
        invoiceTotal: linesTotal,
        receivedDate,
        status: 'draft',
        paymentType,
        notes: input.notes ?? null,
        createdBy: session.id,
        deviceId,
        branchId,
        createdAt: now,
        updatedAt: now,
      }).run();

      for (const line of lineRows) {
        tx.insert(grnLines).values(line).run();
      }
    });

    saveVendorPaymentPreference(input.vendorId, paymentType);
    logAudit('grn', 'create', grnId, undefined, { grnNumber, linesTotal, paymentType });
    const summary = mapGrn(grnId);
    if (!summary) return { success: false, error: 'Failed to load GRN' };
    return { success: true, data: summary };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'GRN create failed' };
  }
}

export function handleGrnList(params?: GrnListParams): ApiResult<GrnSummary[]> {
  try {
    requireRole('super_admin', 'manager');
    const db = getDb();
    const limit = params?.limit ?? 50;
    let rows = db.select().from(grnHeaders).orderBy(desc(grnHeaders.createdAt)).limit(limit * 3).all();

    if (params?.status) rows = rows.filter((r) => r.status === params.status);
    if (params?.vendorId) rows = rows.filter((r) => r.vendorId === params.vendorId);
    if (params?.grnNumber?.trim()) {
      const q = params.grnNumber.trim().toLowerCase();
      rows = rows.filter((r) => r.grnNumber.toLowerCase().includes(q));
    }
    if (params?.startDate) {
      rows = rows.filter((r) => r.receivedDate >= params.startDate!);
    }
    if (params?.endDate) {
      rows = rows.filter((r) => r.receivedDate <= params.endDate!);
    }

    const summaries = rows.slice(0, limit).map((r) => mapGrn(r.id)).filter(Boolean) as GrnSummary[];
    return { success: true, data: summaries };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'GRN list failed' };
  }
}

export function handleGrnGet(id: string): ApiResult<GrnSummary> {
  try {
    requireRole('super_admin', 'manager');
    const summary = mapGrn(id);
    if (!summary) return { success: false, error: 'GRN not found' };
    return { success: true, data: summary };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'GRN get failed' };
  }
}

export function handleGrnFinalize(id: string): ApiResult<GrnSummary> {
  try {
    const session = requireRole('super_admin', 'manager');
    const db = getDb();
    const header = db.select().from(grnHeaders).where(eq(grnHeaders.id, id)).get();
    if (!header) return { success: false, error: 'GRN not found' };
    if (header.status !== 'draft') return { success: false, error: 'Only draft GRNs can be finalized' };

    const lines = db.select().from(grnLines).where(eq(grnLines.grnId, id)).all();
    if (!lines.length) return { success: false, error: 'GRN has no lines' };

    const now = new Date().toISOString();
    const deviceId = getSetting('device_id') ?? 'local-device';
    const branchId = getSetting('branch_id') ?? 'main';

    db.transaction((tx) => {
      const linesTotal = lines.reduce((sum, l) => sum + l.lineTotal, 0);
      tx.update(grnHeaders)
        .set({ status: 'finalized', invoiceTotal: linesTotal, updatedAt: now })
        .where(eq(grnHeaders.id, id))
        .run();

      const affectedProductIds: string[] = [];

      for (const line of lines) {
        const product = tx.select().from(products).where(eq(products.id, line.productId)).get()!;
        affectedProductIds.push(line.productId);
        tx.update(products)
          .set({
            stockQty: product.stockQty + line.qty,
            updatedAt: now,
          })
          .where(eq(products.id, line.productId))
          .run();

        tx.insert(inventoryMovements).values({
          id: uuid(),
          productId: line.productId,
          type: 'purchase',
          qtyChange: line.qty,
          referenceId: id,
          notes: `GRN ${header.grnNumber}`,
          deviceId,
          branchId,
          createdAt: now,
          updatedAt: now,
        }).run();

        tx.insert(productCostHistory).values({
          id: uuid(),
          productId: line.productId,
          vendorId: header.vendorId,
          costPrice: line.unitCost,
          qty: line.qty,
          sourceType: 'grn',
          sourceId: id,
          deviceId,
          branchId,
          createdAt: now,
          updatedAt: now,
        }).run();
      }

      syncProductsFromLatestGrn(tx, affectedProductIds, now);
    });

    const paymentType = (header.paymentType ?? 'cash') as GrnPaymentType;
    saveVendorPaymentPreference(header.vendorId, paymentType);
    recalculateVendorBalance(header.vendorId, now);

    logAudit('grn', 'finalize', id, undefined, { grnNumber: header.grnNumber, linesTotal, paymentType });
    const summary = mapGrn(id);
    return { success: true, data: summary! };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Finalize failed' };
  }
}

/** Apply master product cost/retail from the most recent finalized GRN line per product. */
function syncProductsFromLatestGrn(
  tx: ReturnType<typeof getDb>,
  productIds: string[],
  now: string,
): void {
  const uniqueIds = [...new Set(productIds)];
  for (const productId of uniqueIds) {
    const product = tx.select().from(products).where(eq(products.id, productId)).get();
    if (!product) continue;

    const lines = tx.select().from(grnLines).where(eq(grnLines.productId, productId)).all();
    let latestLine: (typeof lines)[number] | null = null;
    let latestGrnCreatedAt = '';

    for (const line of lines) {
      const header = tx.select().from(grnHeaders).where(eq(grnHeaders.id, line.grnId)).get();
      if (!header || header.status !== 'finalized') continue;
      if (!latestLine || header.createdAt > latestGrnCreatedAt) {
        latestLine = line;
        latestGrnCreatedAt = header.createdAt;
      }
    }

    if (!latestLine) continue;

    const retailPrice = latestLine.unitRetail ?? product.retailPrice;
    tx.update(products)
      .set({
        retailPrice,
        costPrice: latestLine.unitCost,
        updatedAt: now,
      })
      .where(eq(products.id, productId))
      .run();
  }
}

function reverseFinalizedGrnEffects(
  tx: ReturnType<typeof getDb>,
  grnId: string,
  oldLines: Array<{ productId: string; qty: number }>,
  now: string,
): void {
  for (const line of oldLines) {
    const product = tx.select().from(products).where(eq(products.id, line.productId)).get();
    if (!product) continue;
    tx.update(products)
      .set({ stockQty: product.stockQty - line.qty, updatedAt: now })
      .where(eq(products.id, line.productId))
      .run();
  }

  const movements = tx.select().from(inventoryMovements).where(eq(inventoryMovements.referenceId, grnId)).all();
  for (const movement of movements) {
    tx.delete(inventoryMovements).where(eq(inventoryMovements.id, movement.id)).run();
  }

  const costRows = tx.select().from(productCostHistory).where(eq(productCostHistory.sourceId, grnId)).all();
  for (const row of costRows) {
    tx.delete(productCostHistory).where(eq(productCostHistory.id, row.id)).run();
  }
}

function applyFinalizedGrnLineEffects(
  tx: ReturnType<typeof getDb>,
  grnId: string,
  grnNumber: string,
  vendorId: string,
  items: Array<{ productId: string; qty: number; unitCost: number; unitRetail?: number }>,
  now: string,
  deviceId: string,
  branchId: string,
): void {
  const affectedProductIds: string[] = [];

  for (const item of items) {
    const product = tx.select().from(products).where(eq(products.id, item.productId)).get();
    if (!product) throw new Error(`Product not found: ${item.productId}`);
    affectedProductIds.push(item.productId);
    tx.update(products)
      .set({
        stockQty: product.stockQty + item.qty,
        updatedAt: now,
      })
      .where(eq(products.id, item.productId))
      .run();

    tx.insert(inventoryMovements).values({
      id: uuid(),
      productId: item.productId,
      type: 'purchase',
      qtyChange: item.qty,
      referenceId: grnId,
      notes: `GRN ${grnNumber}`,
      deviceId,
      branchId,
      createdAt: now,
      updatedAt: now,
    }).run();

    tx.insert(productCostHistory).values({
      id: uuid(),
      productId: item.productId,
      vendorId,
      costPrice: item.unitCost,
      qty: item.qty,
      sourceType: 'grn',
      sourceId: grnId,
      deviceId,
      branchId,
      createdAt: now,
      updatedAt: now,
    }).run();
  }
}

export function handleGrnUpdate(id: string, input: UpdateGrnInput): ApiResult<GrnSummary> {
  try {
    requireRole('super_admin', 'manager');
    const db = getDb();
    const header = db.select().from(grnHeaders).where(eq(grnHeaders.id, id)).get();
    if (!header) return { success: false, error: 'GRN not found' };
    if (header.status === 'cancelled') return { success: false, error: 'Cancelled GRNs cannot be updated' };

    if (input.items && !input.items.length) return { success: false, error: 'Add at least one line' };

    if (input.vendorId) {
      const vendor = db.select().from(vendors).where(eq(vendors.id, input.vendorId)).get();
      if (!vendor) return { success: false, error: 'Vendor not found' };
    }

    const now = new Date().toISOString();
    const deviceId = getSetting('device_id') ?? 'local-device';
    const branchId = getSetting('branch_id') ?? 'main';
    const vendorId = input.vendorId ?? header.vendorId;
    const oldVendorId = header.vendorId;

    const affectedProductIds = new Set<string>();

    db.transaction((tx) => {
      const oldLines = tx.select().from(grnLines).where(eq(grnLines.grnId, id)).all();
      oldLines.forEach((l) => affectedProductIds.add(l.productId));

      if (header.status === 'finalized' && input.items) {
        reverseFinalizedGrnEffects(tx, id, oldLines, now);
      }

      const headerPatch: Record<string, unknown> = { updatedAt: now };
      if (input.vendorId) headerPatch.vendorId = input.vendorId;
      if (input.invoiceNumber !== undefined) headerPatch.invoiceNumber = input.invoiceNumber || null;
      if (input.paymentType !== undefined) headerPatch.paymentType = input.paymentType;
      if (input.notes !== undefined) headerPatch.notes = input.notes || null;

      if (input.items) {
        for (const line of oldLines) {
          tx.delete(grnLines).where(eq(grnLines.id, line.id)).run();
        }
        const linesTotal = input.items.reduce((sum, item) => sum + item.qty * item.unitCost, 0);
        headerPatch.invoiceTotal = linesTotal;
        for (const item of input.items) {
          const product = tx.select().from(products).where(eq(products.id, item.productId)).get();
          if (!product) throw new Error(`Product not found: ${item.productId}`);
          const lineTotal = item.qty * item.unitCost;
          const unitRetail = item.unitRetail ?? product.retailPrice;
          tx.insert(grnLines).values({
            id: uuid(),
            grnId: id,
            productId: item.productId,
            qty: item.qty,
            unitCost: item.unitCost,
            unitRetail,
            lineTotal,
            deviceId,
            branchId,
            createdAt: now,
            updatedAt: now,
          }).run();
        }

        input.items.forEach((item) => affectedProductIds.add(item.productId));

        if (header.status === 'finalized') {
          applyFinalizedGrnLineEffects(tx, id, header.grnNumber, vendorId, input.items, now, deviceId, branchId);
        }
      }

      tx.update(grnHeaders).set(headerPatch).where(eq(grnHeaders.id, id)).run();

      if (header.status === 'finalized' && affectedProductIds.size > 0) {
        syncProductsFromLatestGrn(tx, [...affectedProductIds], now);
      }
    });

    const updatedPaymentType = (input.paymentType ?? header.paymentType ?? 'cash') as GrnPaymentType;
    saveVendorPaymentPreference(vendorId, updatedPaymentType);
    if (header.status === 'finalized') {
      recalculateVendorBalance(vendorId, now);
      if (oldVendorId !== vendorId) recalculateVendorBalance(oldVendorId, now);
    }

    logAudit('grn', 'update', id, undefined, { status: header.status });
    const summary = mapGrn(id);
    if (!summary) return { success: false, error: 'Failed to load GRN' };
    return { success: true, data: summary };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'GRN update failed' };
  }
}

export function handleGrnCancel(id: string): ApiResult<void> {
  try {
    requireRole('super_admin', 'manager');
    const db = getDb();
    const header = db.select().from(grnHeaders).where(eq(grnHeaders.id, id)).get();
    if (!header) return { success: false, error: 'GRN not found' };
    if (header.status !== 'draft') return { success: false, error: 'Only draft GRNs can be cancelled' };

    const now = new Date().toISOString();
    db.update(grnHeaders).set({ status: 'cancelled', updatedAt: now }).where(eq(grnHeaders.id, id)).run();
    logAudit('grn', 'cancel', id);
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Cancel failed' };
  }
}

export function handleGrnVoid(id: string): ApiResult<void> {
  try {
    requireRole('super_admin', 'manager');
    const db = getDb();
    const header = db.select().from(grnHeaders).where(eq(grnHeaders.id, id)).get();
    if (!header) return { success: false, error: 'GRN not found' };
    if (header.status !== 'finalized') return { success: false, error: 'Only finalized GRNs can be voided' };

    const now = new Date().toISOString();
    const oldLines = db.select().from(grnLines).where(eq(grnLines.grnId, id)).all();
    const affectedProductIds = oldLines.map((l) => l.productId);

    db.transaction((tx) => {
      reverseFinalizedGrnEffects(tx, id, oldLines, now);
      tx.update(grnHeaders)
        .set({ status: 'cancelled', updatedAt: now })
        .where(eq(grnHeaders.id, id))
        .run();
      if (affectedProductIds.length > 0) {
        syncProductsFromLatestGrn(tx, affectedProductIds, now);
      }
    });

    recalculateVendorBalance(header.vendorId, now);
    logAudit('grn', 'void', id, undefined, { grnNumber: header.grnNumber });
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Void failed' };
  }
}
