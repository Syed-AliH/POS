import { and, desc, eq, gte, ilike, inArray, lte, sql, type SQL } from 'drizzle-orm';
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
type Tx = Parameters<Parameters<PostgresClient['transaction']>[0]>[0];
type GrnItemInput = { productId: string; qty: number; unitCost: number; unitRetail?: number };

// Every statement here is a round trip to a remote Postgres, so GRN work is done in a
// fixed handful of set-based statements rather than a few per line. A 200-line GRN
// used to cost well over a thousand queries to save, which is what made Update and
// Finalize hang and the records list time out.

/** Keeps a bulk insert well under Postgres's 65,535 bind-parameter limit. */
function chunks<T>(rows: T[], size = 500): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

/** Load several GRNs with their vendor, creator and lines in two queries, in `grnIds` order. */
async function mapGrns(db: PostgresClient, grnIds: string[]) {
  if (!grnIds.length) return [];
  const [headerRows, lineRows] = await Promise.all([
    db
      .select({ header: grnHeaders, vendorName: vendors.name, creatorName: users.name })
      .from(grnHeaders)
      .leftJoin(vendors, eq(vendors.id, grnHeaders.vendorId))
      .leftJoin(users, eq(users.id, grnHeaders.createdBy))
      .where(inArray(grnHeaders.id, grnIds)),
    db
      .select({
        line: grnLines,
        productName: products.name,
        productSku: products.sku,
        productRetail: products.retailPrice,
      })
      .from(grnLines)
      .leftJoin(products, eq(products.id, grnLines.productId))
      .where(inArray(grnLines.grnId, grnIds)),
  ]);

  const itemsByGrn = new Map<string, Array<{
    id: string;
    productId: string;
    productName: string;
    productSku: string;
    qty: number;
    unitCost: number;
    unitRetail: number;
    lineTotal: number;
  }>>();
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

export async function mapGrn(db: PostgresClient, grnId: string) {
  const [summary] = await mapGrns(db, [grnId]);
  return summary ?? null;
}

/** Returns the first product id in `ids` that doesn't exist, or null when all do. */
async function findMissingProduct(db: PostgresClient | Tx, ids: string[]): Promise<string | null> {
  const unique = [...new Set(ids)];
  if (!unique.length) return null;
  const found = await db.select({ id: products.id }).from(products).where(inArray(products.id, unique));
  const foundIds = new Set(found.map((r) => r.id));
  return unique.find((id) => !foundIds.has(id)) ?? null;
}

async function retailPriceById(db: PostgresClient | Tx, ids: string[]): Promise<Map<string, number>> {
  const unique = [...new Set(ids)];
  if (!unique.length) return new Map();
  const rows = await db
    .select({ id: products.id, retailPrice: products.retailPrice })
    .from(products)
    .where(inArray(products.id, unique));
  return new Map(rows.map((r) => [r.id, r.retailPrice]));
}

/**
 * Add a signed quantity to each product's stock in one statement. Always relative
 * (`stock_qty + delta`), never a read-then-write, so a sale rung up on another till
 * mid-GRN is never overwritten.
 */
async function addStock(tx: Tx, items: Array<{ productId: string; qty: number }>, sign: 1 | -1, now: string) {
  const deltas = new Map<string, number>();
  for (const item of items) deltas.set(item.productId, (deltas.get(item.productId) ?? 0) + sign * item.qty);
  const entries = [...deltas].filter(([, delta]) => delta !== 0);
  if (!entries.length) return;
  const values = sql.join(entries.map(([id, delta]) => sql`(${id}, ${delta}::integer)`), sql`, `);
  await tx.execute(sql`
    update products
    set stock_qty = products.stock_qty + v.delta, updated_at = ${now}
    from (values ${values}) as v(id, delta)
    where products.id = v.id
  `);
}

/** Apply master product cost/retail from the most recent finalized GRN line per product. */
async function syncProductsFromLatestGrn(tx: Tx, productIds: string[], now: string) {
  const uniqueIds = [...new Set(productIds)];
  if (!uniqueIds.length) return;

  const latest = await tx
    .selectDistinctOn([grnLines.productId], {
      productId: grnLines.productId,
      unitCost: grnLines.unitCost,
      unitRetail: grnLines.unitRetail,
    })
    .from(grnLines)
    .innerJoin(grnHeaders, eq(grnHeaders.id, grnLines.grnId))
    .where(and(eq(grnHeaders.status, 'finalized'), inArray(grnLines.productId, uniqueIds)))
    .orderBy(grnLines.productId, desc(grnHeaders.createdAt));
  // A product with no finalized GRN left (e.g. its only GRN was voided) keeps its prices.
  if (!latest.length) return;

  const values = sql.join(
    latest.map(
      (r) => sql`(${r.productId}, ${r.unitCost}::double precision, ${r.unitRetail}::double precision)`,
    ),
    sql`, `,
  );
  await tx.execute(sql`
    update products
    set cost_price = v.cost,
        retail_price = coalesce(v.retail, products.retail_price),
        updated_at = ${now}
    from (values ${values}) as v(id, cost, retail)
    where products.id = v.id
  `);
}

async function reverseFinalizedGrnEffects(
  tx: Tx,
  grnId: string,
  oldLines: Array<{ productId: string; qty: number }>,
  now: string,
) {
  await addStock(tx, oldLines, -1, now);
  await tx.delete(inventoryMovements).where(eq(inventoryMovements.referenceId, grnId));
  await tx.delete(productCostHistory).where(eq(productCostHistory.sourceId, grnId));
}

async function applyFinalizedGrnLineEffects(
  tx: Tx,
  grnId: string,
  grnNumber: string,
  vendorId: string,
  items: GrnItemInput[],
  now: string,
  deviceId: string,
  branchId: string,
) {
  const missing = await findMissingProduct(tx, items.map((i) => i.productId));
  if (missing) throw new Error(`Product not found: ${missing}`);

  await addStock(tx, items, 1, now);

  for (const chunk of chunks(items)) {
    await tx.insert(inventoryMovements).values(
      chunk.map((item) => ({
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
      })),
    );
    await tx.insert(productCostHistory).values(
      chunk.map((item) => ({
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
      })),
    );
  }
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

export async function createGrn(
  db: PostgresClient,
  sessionId: string,
  input: {
    vendorId: string;
    invoiceNumber?: string;
    receivedDate?: string;
    paymentType?: GrnPaymentType;
    notes?: string;
    items: GrnItemInput[];
  },
): Promise<ApiResult<NonNullable<Awaited<ReturnType<typeof mapGrn>>>>> {
  if (!input.vendorId) return { success: false, error: 'Vendor is required' };
  if (!input.items?.length) return { success: false, error: 'Add at least one line' };

  const [[vendor], retailById, deviceSetting, branchSetting] = await Promise.all([
    db.select().from(vendors).where(eq(vendors.id, input.vendorId)).limit(1),
    retailPriceById(db, input.items.map((i) => i.productId)),
    getSetting(db, 'device_id'),
    getSetting(db, 'branch_id'),
  ]);
  if (!vendor) return { success: false, error: 'Vendor not found' };
  const missing = input.items.find((i) => !retailById.has(i.productId));
  if (missing) return { success: false, error: `Product not found: ${missing.productId}` };

  const now = new Date().toISOString();
  const deviceId = deviceSetting ?? 'cloud';
  const branchId = branchSetting ?? 'main';
  const grnId = uuid();
  const grnNumber = await incrementGrnCounter(db);
  const receivedDate = input.receivedDate ?? now.slice(0, 10);
  const paymentType: GrnPaymentType =
    input.paymentType ?? (vendor.preferredPaymentType as GrnPaymentType) ?? 'cash';

  const lineRows = buildLineRows(grnId, input.items, retailById, now, deviceId, branchId);
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
    for (const chunk of chunks(lineRows)) {
      await tx.insert(grnLines).values(chunk);
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
  const limit = Math.min(params?.limit ?? 50, 500);
  // Filters run in the database. They used to run in JS over the newest `limit * 3`
  // headers, so a vendor or date filter silently missed anything older than that.
  const conditions: SQL[] = [];
  if (params?.status) conditions.push(eq(grnHeaders.status, params.status as 'draft' | 'finalized' | 'cancelled'));
  if (params?.vendorId) conditions.push(eq(grnHeaders.vendorId, params.vendorId));
  if (params?.grnNumber?.trim()) conditions.push(ilike(grnHeaders.grnNumber, `%${params.grnNumber.trim()}%`));
  if (params?.startDate) conditions.push(gte(grnHeaders.receivedDate, params.startDate));
  if (params?.endDate) conditions.push(lte(grnHeaders.receivedDate, params.endDate));

  const rows = await db
    .select({ id: grnHeaders.id })
    .from(grnHeaders)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(grnHeaders.createdAt))
    .limit(limit);

  const summaries = await mapGrns(db, rows.map((r) => r.id));
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

    await syncProductsFromLatestGrn(tx, affectedProductIds, now);
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
    items?: GrnItemInput[];
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

  const retailById = input.items ? await retailPriceById(db, input.items.map((i) => i.productId)) : new Map();
  const missing = input.items?.find((i) => !retailById.has(i.productId));
  if (missing) return { success: false, error: `Product not found: ${missing.productId}` };

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
      await tx.delete(grnLines).where(eq(grnLines.grnId, id));
      const lineRows = buildLineRows(id, input.items, retailById, now, deviceId, branchId);
      headerPatch.invoiceTotal = lineRows.reduce((sum, l) => sum + l.lineTotal, 0);
      for (const chunk of chunks(lineRows)) {
        await tx.insert(grnLines).values(chunk);
      }
      input.items.forEach((item) => affectedProductIds.add(item.productId));

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
      await syncProductsFromLatestGrn(tx, [...affectedProductIds], now);
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
      await syncProductsFromLatestGrn(tx, affectedProductIds, now);
    }
  });

  await recalculateVendorBalance(db, header.vendorId, now);
  return { success: true as const, data: undefined };
}
