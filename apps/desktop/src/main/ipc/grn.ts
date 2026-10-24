import { and, desc, eq, gte, inArray, like, lte, sql, type SQL } from 'drizzle-orm';
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

/** The database or a transaction on it — the helpers below run inside either. */
type Db = ReturnType<typeof getDb> | Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0];
type GrnItemInput = { productId: string; qty: number; unitCost: number; unitRetail?: number };

/** Keeps a bulk insert well under SQLite's bound-variable limit. */
function chunks<T>(rows: T[], size = 500): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

/**
 * Load several GRNs with vendor, creator and lines in two queries, in `grnIds` order.
 * Mirrors mapGrns in apps/api grn.service.ts — the per-line product lookups it
 * replaces are what made a big records list crawl in cloud mode.
 */
function mapGrns(grnIds: string[]): GrnSummary[] {
  if (!grnIds.length) return [];
  const db = getDb();
  const headerRows = db
    .select({ header: grnHeaders, vendorName: vendors.name, creatorName: users.name })
    .from(grnHeaders)
    .leftJoin(vendors, eq(vendors.id, grnHeaders.vendorId))
    .leftJoin(users, eq(users.id, grnHeaders.createdBy))
    .where(inArray(grnHeaders.id, grnIds))
    .all();
  const lineRows = db
    .select({
      line: grnLines,
      productName: products.name,
      productSku: products.sku,
      productRetail: products.retailPrice,
    })
    .from(grnLines)
    .leftJoin(products, eq(products.id, grnLines.productId))
    .where(inArray(grnLines.grnId, grnIds))
    .all();

  const itemsByGrn = new Map<string, GrnSummary['items']>();
  for (const { line, productName, productSku, productRetail } of lineRows) {
    const list = itemsByGrn.get(line.grnId) ?? [];
    list.push({
      id: line.id,
      productId: line.productId,
      productName: productName ?? 'Unknown',
      productSku: productSku ?? '',
      qty: line.qty,
      unitCost: line.unitCost,
      unitRetail: line.unitRetail ?? productRetail ?? 0,
      lineTotal: line.lineTotal,
    });
    itemsByGrn.set(line.grnId, list);
  }

  const headerById = new Map(headerRows.map((r) => [r.header.id, r]));
  return grnIds.flatMap((id) => {
    const row = headerById.get(id);
    if (!row) return [];
    const { header } = row;
    const items = itemsByGrn.get(id) ?? [];
    return [{
      id: header.id,
      grnNumber: header.grnNumber,
      vendorId: header.vendorId,
      vendorName: row.vendorName ?? 'Unknown',
      invoiceNumber: header.invoiceNumber,
      invoiceTotal: header.invoiceTotal,
      linesTotal: items.reduce((sum, i) => sum + i.lineTotal, 0),
      receivedDate: header.receivedDate,
      status: header.status,
      paymentType: (header.paymentType ?? 'cash') as GrnPaymentType,
      notes: header.notes,
      createdByName: row.creatorName ?? 'Unknown',
      createdAt: header.createdAt,
      updatedAt: header.updatedAt,
      items,
    }];
  });
}

function mapGrn(grnId: string): GrnSummary | null {
  return mapGrns([grnId])[0] ?? null;
}

function retailPriceById(db: Db, ids: string[]): Map<string, number> {
  const unique = [...new Set(ids)];
  if (!unique.length) return new Map();
  const rows = db
    .select({ id: products.id, retailPrice: products.retailPrice })
    .from(products)
    .where(inArray(products.id, unique))
    .all();
  return new Map(rows.map((r) => [r.id, r.retailPrice]));
}

function buildLineRows(
  grnId: string,
  items: GrnItemInput[],
  retailById: Map<string, number>,
  now: string,
  deviceId: string,
  branchId: string,
) {
  return items.map((item) => ({
    id: uuid(),
    grnId,
    productId: item.productId,
    qty: item.qty,
    unitCost: item.unitCost,
    unitRetail: item.unitRetail ?? retailById.get(item.productId) ?? 0,
    lineTotal: item.qty * item.unitCost,
    deviceId,
    branchId,
    createdAt: now,
    updatedAt: now,
  }));
}

/**
 * Add a signed quantity to each product's stock. Always relative (`stock_qty + delta`),
 * never a read-then-write, so a concurrent sale's decrement is never overwritten.
 */
function addStock(tx: Db, items: Array<{ productId: string; qty: number }>, sign: 1 | -1, now: string): void {
  const deltas = new Map<string, number>();
  for (const item of items) deltas.set(item.productId, (deltas.get(item.productId) ?? 0) + sign * item.qty);
  for (const [productId, delta] of deltas) {
    if (delta === 0) continue;
    tx.update(products)
      .set({ stockQty: sql`${products.stockQty} + ${delta}`, updatedAt: now })
      .where(eq(products.id, productId))
      .run();
  }
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

    const retailById = retailPriceById(db, input.items.map((i) => i.productId));
    const missing = input.items.find((i) => !retailById.has(i.productId));
    if (missing) throw new Error(`Product not found: ${missing.productId}`);
    const lineRows = buildLineRows(grnId, input.items, retailById, now, deviceId, branchId);

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

      for (const chunk of chunks(lineRows)) {
        tx.insert(grnLines).values(chunk).run();
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
    const limit = Math.min(params?.limit ?? 50, 500);
    // Filters run in the database. They used to run in JS over the newest `limit * 3`
    // headers, so a vendor or date filter silently missed anything older than that.
    const conditions: SQL[] = [];
    if (params?.status) conditions.push(eq(grnHeaders.status, params.status as GrnSummary['status']));
    if (params?.vendorId) conditions.push(eq(grnHeaders.vendorId, params.vendorId));
    // SQLite LIKE is case-insensitive for ASCII, matching the old lowercase compare.
    if (params?.grnNumber?.trim()) conditions.push(like(grnHeaders.grnNumber, `%${params.grnNumber.trim()}%`));
    if (params?.startDate) conditions.push(gte(grnHeaders.receivedDate, params.startDate));
    if (params?.endDate) conditions.push(lte(grnHeaders.receivedDate, params.endDate));

    const rows = db
      .select({ id: grnHeaders.id })
      .from(grnHeaders)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(grnHeaders.createdAt))
      .limit(limit)
      .all();
    return { success: true, data: mapGrns(rows.map((r) => r.id)) };
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

    // Declared out here because the audit entry below needs it too; inside the
    // transaction it threw a ReferenceError after the GRN had already committed,
    // so a successful finalize was reported as a failure.
    const linesTotal = lines.reduce((sum, l) => sum + l.lineTotal, 0);

    db.transaction((tx) => {
      tx.update(grnHeaders)
        .set({ status: 'finalized', invoiceTotal: linesTotal, updatedAt: now })
        .where(eq(grnHeaders.id, id))
        .run();

      applyFinalizedGrnLineEffects(
        tx,
        id,
        header.grnNumber,
        header.vendorId,
        lines.map((l) => ({ productId: l.productId, qty: l.qty, unitCost: l.unitCost })),
        now,
        deviceId,
        branchId,
      );

      syncProductsFromLatestGrn(tx, lines.map((l) => l.productId), now);
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
  tx: Db,
  productIds: string[],
  now: string,
): void {
  const uniqueIds = [...new Set(productIds)];
  if (!uniqueIds.length) return;

  // One query for every product's finalized lines, newest GRN first — the first row
  // seen per product is its latest. Replaces a header lookup per line per product.
  const lines = tx
    .select({
      productId: grnLines.productId,
      unitCost: grnLines.unitCost,
      unitRetail: grnLines.unitRetail,
    })
    .from(grnLines)
    .innerJoin(grnHeaders, eq(grnHeaders.id, grnLines.grnId))
    .where(and(eq(grnHeaders.status, 'finalized'), inArray(grnLines.productId, uniqueIds)))
    .orderBy(desc(grnHeaders.createdAt))
    .all();

  const latestByProduct = new Map<string, (typeof lines)[number]>();
  for (const line of lines) {
    if (!latestByProduct.has(line.productId)) latestByProduct.set(line.productId, line);
  }

  // A product with no finalized GRN left (e.g. its only GRN was voided) keeps its prices.
  for (const [productId, latestLine] of latestByProduct) {
    tx.update(products)
      .set({
        retailPrice: latestLine.unitRetail ?? sql`${products.retailPrice}`,
        costPrice: latestLine.unitCost,
        updatedAt: now,
      })
      .where(eq(products.id, productId))
      .run();
  }
}

function reverseFinalizedGrnEffects(
  tx: Db,
  grnId: string,
  oldLines: Array<{ productId: string; qty: number }>,
  now: string,
): void {
  addStock(tx, oldLines, -1, now);
  tx.delete(inventoryMovements).where(eq(inventoryMovements.referenceId, grnId)).run();
  tx.delete(productCostHistory).where(eq(productCostHistory.sourceId, grnId)).run();
}

function applyFinalizedGrnLineEffects(
  tx: Db,
  grnId: string,
  grnNumber: string,
  vendorId: string,
  items: GrnItemInput[],
  now: string,
  deviceId: string,
  branchId: string,
): void {
  const known = retailPriceById(tx, items.map((i) => i.productId));
  const missing = items.find((i) => !known.has(i.productId));
  if (missing) throw new Error(`Product not found: ${missing.productId}`);

  addStock(tx, items, 1, now);

  for (const chunk of chunks(items)) {
    tx.insert(inventoryMovements).values(
      chunk.map((item) => ({
        id: uuid(),
        productId: item.productId,
        type: 'purchase' as const,
        qtyChange: item.qty,
        referenceId: grnId,
        notes: `GRN ${grnNumber}`,
        deviceId,
        branchId,
        createdAt: now,
        updatedAt: now,
      })),
    ).run();

    tx.insert(productCostHistory).values(
      chunk.map((item) => ({
        id: uuid(),
        productId: item.productId,
        vendorId,
        costPrice: item.unitCost,
        qty: item.qty,
        sourceType: 'grn' as const,
        sourceId: grnId,
        deviceId,
        branchId,
        createdAt: now,
        updatedAt: now,
      })),
    ).run();
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
        tx.delete(grnLines).where(eq(grnLines.grnId, id)).run();
        const retailById = retailPriceById(tx, input.items.map((i) => i.productId));
        const missing = input.items.find((i) => !retailById.has(i.productId));
        if (missing) throw new Error(`Product not found: ${missing.productId}`);
        const lineRows = buildLineRows(id, input.items, retailById, now, deviceId, branchId);
        headerPatch.invoiceTotal = lineRows.reduce((sum, l) => sum + l.lineTotal, 0);
        for (const chunk of chunks(lineRows)) {
          tx.insert(grnLines).values(chunk).run();
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
