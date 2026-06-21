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
} from '@mama-babi/db-pg';
import type { PostgresClient } from '@mama-babi/db-pg';
import type { ApiResult } from '../types';
import { getSetting, incrementGrnCounter } from './settings.service';
import { recalculateVendorBalance, saveVendorPaymentPreference } from './vendors.service';

type GrnPaymentType = 'cash' | 'credit';

export async function mapGrn(db: PostgresClient, grnId: string) {
  const [header] = await db.select().from(grnHeaders).where(eq(grnHeaders.id, grnId)).limit(1);
  if (!header) return null;

  const [vendor] = await db.select().from(vendors).where(eq(vendors.id, header.vendorId)).limit(1);
  const [creator] = await db.select().from(users).where(eq(users.id, header.createdBy)).limit(1);
  const lines = await db.select().from(grnLines).where(eq(grnLines.grnId, grnId));

  const items = await Promise.all(
    lines.map(async (line) => {
      const [product] = await db.select().from(products).where(eq(products.id, line.productId)).limit(1);
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
    }),
  );

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

async function syncProductsFromLatestGrn(
  _db: PostgresClient,
  tx: Parameters<Parameters<PostgresClient['transaction']>[0]>[0],
  productIds: string[],
  now: string,
) {
  const uniqueIds = [...new Set(productIds)];
  for (const productId of uniqueIds) {
    const [product] = await tx.select().from(products).where(eq(products.id, productId)).limit(1);
    if (!product) continue;

    const lines = await tx.select().from(grnLines).where(eq(grnLines.productId, productId));
    let latestLine: (typeof lines)[number] | null = null;
    let latestGrnCreatedAt = '';

    for (const line of lines) {
      const [header] = await tx.select().from(grnHeaders).where(eq(grnHeaders.id, line.grnId)).limit(1);
      if (!header || header.status !== 'finalized') continue;
      if (!latestLine || header.createdAt > latestGrnCreatedAt) {
        latestLine = line;
        latestGrnCreatedAt = header.createdAt;
      }
    }

    if (!latestLine) continue;

    await tx
      .update(products)
      .set({
        retailPrice: latestLine.unitRetail ?? product.retailPrice,
        costPrice: latestLine.unitCost,
        updatedAt: now,
      })
      .where(eq(products.id, productId));
  }
}

async function reverseFinalizedGrnEffects(
  tx: Parameters<Parameters<PostgresClient['transaction']>[0]>[0],
  grnId: string,
  oldLines: Array<{ productId: string; qty: number }>,
  now: string,
) {
  for (const line of oldLines) {
    const [product] = await tx.select().from(products).where(eq(products.id, line.productId)).limit(1);
    if (!product) continue;
    await tx
      .update(products)
      .set({ stockQty: product.stockQty - line.qty, updatedAt: now })
      .where(eq(products.id, line.productId));
  }

  const movements = await tx
    .select()
    .from(inventoryMovements)
    .where(eq(inventoryMovements.referenceId, grnId));
  for (const movement of movements) {
    await tx.delete(inventoryMovements).where(eq(inventoryMovements.id, movement.id));
  }

  const costRows = await tx
    .select()
    .from(productCostHistory)
    .where(eq(productCostHistory.sourceId, grnId));
  for (const row of costRows) {
    await tx.delete(productCostHistory).where(eq(productCostHistory.id, row.id));
  }
}

async function applyFinalizedGrnLineEffects(
  tx: Parameters<Parameters<PostgresClient['transaction']>[0]>[0],
  grnId: string,
  grnNumber: string,
  vendorId: string,
  items: Array<{ productId: string; qty: number; unitCost: number; unitRetail?: number }>,
  now: string,
  deviceId: string,
  branchId: string,
) {
  for (const item of items) {
    const [product] = await tx.select().from(products).where(eq(products.id, item.productId)).limit(1);
    if (!product) throw new Error(`Product not found: ${item.productId}`);

    await tx
      .update(products)
      .set({ stockQty: product.stockQty + item.qty, updatedAt: now })
      .where(eq(products.id, item.productId));

    await tx.insert(inventoryMovements).values({
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
    });

    await tx.insert(productCostHistory).values({
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
    });
  }
}

export async function createGrn(
  db: PostgresClient,
  sessionId: string,
  input: {
    vendorId: string;
    invoiceNumber?: string;
    receivedDate?: string;
    paymentType?: GrnPaymentType;
    notes?: string;
    items: Array<{ productId: string; qty: number; unitCost: number; unitRetail?: number }>;
  },
): Promise<ApiResult<NonNullable<Awaited<ReturnType<typeof mapGrn>>>>> {
  if (!input.vendorId) return { success: false, error: 'Vendor is required' };
  if (!input.items?.length) return { success: false, error: 'Add at least one line' };

  const [vendor] = await db.select().from(vendors).where(eq(vendors.id, input.vendorId)).limit(1);
  if (!vendor) return { success: false, error: 'Vendor not found' };

  const now = new Date().toISOString();
  const deviceId = (await getSetting(db, 'device_id')) ?? 'cloud';
  const branchId = (await getSetting(db, 'branch_id')) ?? 'main';
  const grnId = uuid();
  const grnNumber = await incrementGrnCounter(db);
  const receivedDate = input.receivedDate ?? now.slice(0, 10);
  const paymentType: GrnPaymentType =
    input.paymentType ?? (vendor.preferredPaymentType as GrnPaymentType) ?? 'cash';

  const lineRows: Array<{
    id: string;
    grnId: string;
    productId: string;
    qty: number;
    unitCost: number;
    unitRetail: number;
    lineTotal: number;
    deviceId: string;
    branchId: string;
    createdAt: string;
    updatedAt: string;
  }> = [];
  for (const item of input.items) {
    const [product] = await db.select().from(products).where(eq(products.id, item.productId)).limit(1);
    if (!product) return { success: false, error: `Product not found: ${item.productId}` };
    const lineTotal = item.qty * item.unitCost;
    lineRows.push({
      id: uuid(),
      grnId,
      productId: item.productId,
      qty: item.qty,
      unitCost: item.unitCost,
      unitRetail: item.unitRetail ?? product.retailPrice,
      lineTotal,
      deviceId,
      branchId,
      createdAt: now,
      updatedAt: now,
    });
  }

  const linesTotal = lineRows.reduce((sum, l) => sum + l.lineTotal, 0);

  await db.transaction(async (tx) => {
    await tx.insert(grnHeaders).values({
      id: grnId,
      grnNumber,
      vendorId: input.vendorId,
      invoiceNumber: input.invoiceNumber ?? null,
      invoiceTotal: linesTotal,
      receivedDate,
      status: 'draft',
      paymentType,
      notes: input.notes ?? null,
      createdBy: sessionId,
      deviceId,
      branchId,
      createdAt: now,
      updatedAt: now,
    });
    for (const line of lineRows) {
      await tx.insert(grnLines).values(line);
    }
  });

  await saveVendorPaymentPreference(db, input.vendorId, paymentType);
  const summary = await mapGrn(db, grnId);
  if (!summary) return { success: false, error: 'Failed to load GRN' };
  return { success: true, data: summary };
}

export async function listGrns(
  db: PostgresClient,
  params?: {
    status?: string;
    vendorId?: string;
    grnNumber?: string;
    startDate?: string;
    endDate?: string;
    limit?: number;
  },
) {
  const limit = params?.limit ?? 50;
  let rows = await db.select().from(grnHeaders).orderBy(desc(grnHeaders.createdAt)).limit(limit * 3);

  if (params?.status) rows = rows.filter((r) => r.status === params.status);
  if (params?.vendorId) rows = rows.filter((r) => r.vendorId === params.vendorId);
  if (params?.grnNumber?.trim()) {
    const q = params.grnNumber.trim().toLowerCase();
    rows = rows.filter((r) => r.grnNumber.toLowerCase().includes(q));
  }
  if (params?.startDate) rows = rows.filter((r) => r.receivedDate >= params.startDate!);
  if (params?.endDate) rows = rows.filter((r) => r.receivedDate <= params.endDate!);

  const summaries = (
    await Promise.all(rows.slice(0, limit).map((r) => mapGrn(db, r.id)))
  ).filter(Boolean) as NonNullable<Awaited<ReturnType<typeof mapGrn>>>[];

  return { success: true as const, data: summaries };
}

export async function getGrn(db: PostgresClient, id: string) {
  const summary = await mapGrn(db, id);
  if (!summary) return { success: false, error: 'GRN not found' };
  return { success: true as const, data: summary };
}

export async function finalizeGrn(db: PostgresClient, id: string) {
  const [header] = await db.select().from(grnHeaders).where(eq(grnHeaders.id, id)).limit(1);
  if (!header) return { success: false, error: 'GRN not found' };
  if (header.status !== 'draft') return { success: false, error: 'Only draft GRNs can be finalized' };

  const lines = await db.select().from(grnLines).where(eq(grnLines.grnId, id));
  if (!lines.length) return { success: false, error: 'GRN has no lines' };

  const now = new Date().toISOString();
  const deviceId = (await getSetting(db, 'device_id')) ?? 'cloud';
  const branchId = (await getSetting(db, 'branch_id')) ?? 'main';
  const linesTotal = lines.reduce((sum, l) => sum + l.lineTotal, 0);
  const affectedProductIds = lines.map((l) => l.productId);

  await db.transaction(async (tx) => {
    await tx
      .update(grnHeaders)
      .set({ status: 'finalized', invoiceTotal: linesTotal, updatedAt: now })
      .where(eq(grnHeaders.id, id));

    await applyFinalizedGrnLineEffects(
      tx,
      id,
      header.grnNumber,
      header.vendorId,
      lines.map((l) => ({
        productId: l.productId,
        qty: l.qty,
        unitCost: l.unitCost,
        unitRetail: l.unitRetail ?? undefined,
      })),
      now,
      deviceId,
      branchId,
    );

    await syncProductsFromLatestGrn(db, tx, affectedProductIds, now);
  });

  const paymentType = (header.paymentType ?? 'cash') as GrnPaymentType;
  await saveVendorPaymentPreference(db, header.vendorId, paymentType);
  await recalculateVendorBalance(db, header.vendorId, now);

  const summary = await mapGrn(db, id);
  return { success: true as const, data: summary! };
}

export async function updateGrn(
  db: PostgresClient,
  id: string,
  input: {
    vendorId?: string;
    invoiceNumber?: string;
    paymentType?: GrnPaymentType;
    notes?: string;
    items?: Array<{ productId: string; qty: number; unitCost: number; unitRetail?: number }>;
  },
) {
  const [header] = await db.select().from(grnHeaders).where(eq(grnHeaders.id, id)).limit(1);
  if (!header) return { success: false, error: 'GRN not found' };
  if (header.status === 'cancelled') return { success: false, error: 'Cancelled GRNs cannot be updated' };
  if (input.items && !input.items.length) return { success: false, error: 'Add at least one line' };

  if (input.vendorId) {
    const [vendor] = await db.select().from(vendors).where(eq(vendors.id, input.vendorId)).limit(1);
    if (!vendor) return { success: false, error: 'Vendor not found' };
  }

  const now = new Date().toISOString();
  const deviceId = (await getSetting(db, 'device_id')) ?? 'cloud';
  const branchId = (await getSetting(db, 'branch_id')) ?? 'main';
  const vendorId = input.vendorId ?? header.vendorId;
  const oldVendorId = header.vendorId;
  const affectedProductIds = new Set<string>();

  await db.transaction(async (tx) => {
    const oldLines = await tx.select().from(grnLines).where(eq(grnLines.grnId, id));
    oldLines.forEach((l) => affectedProductIds.add(l.productId));

    if (header.status === 'finalized' && input.items) {
      await reverseFinalizedGrnEffects(tx, id, oldLines, now);
    }

    const headerPatch: Record<string, unknown> = { updatedAt: now };
    if (input.vendorId) headerPatch.vendorId = input.vendorId;
    if (input.invoiceNumber !== undefined) headerPatch.invoiceNumber = input.invoiceNumber || null;
    if (input.paymentType !== undefined) headerPatch.paymentType = input.paymentType;
    if (input.notes !== undefined) headerPatch.notes = input.notes || null;

    if (input.items) {
      for (const line of oldLines) {
        await tx.delete(grnLines).where(eq(grnLines.id, line.id));
      }
      const linesTotal = input.items.reduce((sum, item) => sum + item.qty * item.unitCost, 0);
      headerPatch.invoiceTotal = linesTotal;

      for (const item of input.items) {
        const [product] = await tx.select().from(products).where(eq(products.id, item.productId)).limit(1);
        if (!product) throw new Error(`Product not found: ${item.productId}`);
        const lineTotal = item.qty * item.unitCost;
        await tx.insert(grnLines).values({
          id: uuid(),
          grnId: id,
          productId: item.productId,
          qty: item.qty,
          unitCost: item.unitCost,
          unitRetail: item.unitRetail ?? product.retailPrice,
          lineTotal,
          deviceId,
          branchId,
          createdAt: now,
          updatedAt: now,
        });
        affectedProductIds.add(item.productId);
      }

      if (header.status === 'finalized') {
        await applyFinalizedGrnLineEffects(
          tx,
          id,
          header.grnNumber,
          vendorId,
          input.items,
          now,
          deviceId,
          branchId,
        );
      }
    }

    await tx.update(grnHeaders).set(headerPatch).where(eq(grnHeaders.id, id));

    if (header.status === 'finalized' && affectedProductIds.size > 0) {
      await syncProductsFromLatestGrn(db, tx, [...affectedProductIds], now);
    }
  });

  const updatedPaymentType = (input.paymentType ?? header.paymentType ?? 'cash') as GrnPaymentType;
  await saveVendorPaymentPreference(db, vendorId, updatedPaymentType);
  if (header.status === 'finalized') {
    await recalculateVendorBalance(db, vendorId, now);
    if (oldVendorId !== vendorId) await recalculateVendorBalance(db, oldVendorId, now);
  }

  const summary = await mapGrn(db, id);
  if (!summary) return { success: false, error: 'Failed to load GRN' };
  return { success: true, data: summary };
}

export async function cancelGrn(db: PostgresClient, id: string) {
  const [header] = await db.select().from(grnHeaders).where(eq(grnHeaders.id, id)).limit(1);
  if (!header) return { success: false, error: 'GRN not found' };
  if (header.status !== 'draft') return { success: false, error: 'Only draft GRNs can be cancelled' };
  const now = new Date().toISOString();
  await db.update(grnHeaders).set({ status: 'cancelled', updatedAt: now }).where(eq(grnHeaders.id, id));
  return { success: true as const, data: undefined };
}

export async function voidGrn(db: PostgresClient, id: string) {
  const [header] = await db.select().from(grnHeaders).where(eq(grnHeaders.id, id)).limit(1);
  if (!header) return { success: false, error: 'GRN not found' };
  if (header.status !== 'finalized') return { success: false, error: 'Only finalized GRNs can be voided' };

  const now = new Date().toISOString();
  const oldLines = await db.select().from(grnLines).where(eq(grnLines.grnId, id));
  const affectedProductIds = oldLines.map((l) => l.productId);

  await db.transaction(async (tx) => {
    await reverseFinalizedGrnEffects(tx, id, oldLines, now);
    await tx.update(grnHeaders).set({ status: 'cancelled', updatedAt: now }).where(eq(grnHeaders.id, id));
    if (affectedProductIds.length > 0) {
      await syncProductsFromLatestGrn(db, tx, affectedProductIds, now);
    }
  });

  await recalculateVendorBalance(db, header.vendorId, now);
  return { success: true as const, data: undefined };
}
