import { and, desc, eq, gte, ilike, inArray, lt, or, sql } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import { customers, inventoryMovements, products, saleItems, sales, users } from '@mama-babi/db-pg';
import type { PostgresClient } from '@mama-babi/db-pg';
import { coerceReportDateRange, isoRangeBounds } from '../lib/reportDateRange';
import { getSetting, nextSaleNumber, getAllSettings } from './settings.service';

function calcLineTotal(unitPrice: number, qty: number, discountPercent: number): number {
  const subtotal = unitPrice * qty;
  return subtotal - subtotal * (discountPercent / 100);
}

function calcTax(amount: number, taxRate: number, inclusive: boolean): number {
  if (inclusive) return amount - amount / (1 + taxRate / 100);
  return amount * (taxRate / 100);
}

type SaleRow = typeof sales.$inferSelect;

/**
 * Builds summaries for a page of sales in a fixed number of queries.
 *
 * The database is remote, so each round trip costs ~120ms regardless of how little
 * it returns. Doing this per sale (4+ queries each) made the sales list take seconds;
 * this version is 3 sequential steps no matter how many sales are on the page.
 */
export async function buildSaleSummaries(db: PostgresClient, rows: SaleRow[]) {
  if (!rows.length) return [];

  const saleIds = rows.map((r) => r.id);
  const cashierIds = [...new Set(rows.map((r) => r.cashierId).filter(Boolean))];
  const customerIds = [...new Set(rows.map((r) => r.customerId).filter((id): id is string => !!id))];

  const [items, cashierRows, customerRows] = await Promise.all([
    db.select().from(saleItems).where(inArray(saleItems.saleId, saleIds)),
    cashierIds.length
      ? db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, cashierIds))
      : Promise.resolve([]),
    customerIds.length
      ? db
          .select({ id: customers.id, name: customers.name, phone: customers.phone })
          .from(customers)
          .where(inArray(customers.id, customerIds))
      : Promise.resolve([]),
  ]);

  const productIds = [...new Set(items.map((i) => i.productId))];
  const productInfo = productIds.length
    ? await db
        .select({ id: products.id, barcode: products.barcode, costPrice: products.costPrice })
        .from(products)
        .where(inArray(products.id, productIds))
    : [];

  const cashierById = new Map(cashierRows.map((c) => [c.id, c.name]));
  const customerById = new Map(customerRows.map((c) => [c.id, c]));
  const barcodeById = new Map(productInfo.map((p) => [p.id, p.barcode]));
  const costById = new Map(productInfo.map((p) => [p.id, p.costPrice]));

  const itemsBySale = new Map<string, typeof items>();
  for (const item of items) {
    const list = itemsBySale.get(item.saleId);
    if (list) list.push(item);
    else itemsBySale.set(item.saleId, [item]);
  }

  return rows.map((sale) => {
    const customer = sale.customerId ? customerById.get(sale.customerId) : undefined;
    const productRows = (itemsBySale.get(sale.id) ?? []).map((item) => {
      const unitCost = costById.get(item.productId) ?? 0;
      return {
        saleItemId: item.id,
        productId: item.productId,
        productName: item.productName,
        productSku: item.productSku,
        barcode: barcodeById.get(item.productId) ?? '',
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        unitCost,
        lineCost: unitCost * item.quantity,
        discountPercent: item.discountPercent,
        taxRate: item.taxRate,
        lineTotal: item.lineTotal,
      };
    });

    return {
      id: sale.id,
      saleNumber: sale.saleNumber,
      cashierId: sale.cashierId,
      cashierName: cashierById.get(sale.cashierId) ?? 'Unknown',
      customerId: sale.customerId,
      customerName: customer?.name ?? null,
      customerPhone: customer?.phone ?? null,
      subtotal: sale.subtotal,
      discountAmount: sale.discountAmount,
      discountReason: sale.discountReason,
      taxAmount: sale.taxAmount,
      totalAmount: sale.totalAmount,
      paymentMethod: sale.paymentMethod,
      amountTendered: sale.amountTendered,
      changeGiven: sale.changeGiven,
      status: sale.status,
      heldKey: sale.heldKey,
      createdAt: sale.createdAt,
      items: productRows,
    };
  });
}

export async function buildSaleSummary(db: PostgresClient, saleId: string) {
  const [sale] = await db.select().from(sales).where(eq(sales.id, saleId)).limit(1);
  if (!sale) return null;

  const [cashier] = await db.select().from(users).where(eq(users.id, sale.cashierId)).limit(1);
  const customer = sale.customerId
    ? (await db.select().from(customers).where(eq(customers.id, sale.customerId)).limit(1))[0]
    : undefined;
  const items = await db.select().from(saleItems).where(eq(saleItems.saleId, saleId));

  // One query for all line-item barcodes/costs instead of one per line.
  const itemProductIds = [...new Set(items.map((i) => i.productId))];
  const productInfoRows = itemProductIds.length
    ? await db
        .select({ id: products.id, barcode: products.barcode, costPrice: products.costPrice })
        .from(products)
        .where(inArray(products.id, itemProductIds))
    : [];
  const barcodeById = new Map(productInfoRows.map((p) => [p.id, p.barcode]));
  const costById = new Map(productInfoRows.map((p) => [p.id, p.costPrice]));

  const productRows = items.map((item) => {
    // Cost isn't stored per line, so we report the product's current cost price —
    // same basis as the estimated-cost figure on the reports/owner dashboard.
    const unitCost = costById.get(item.productId) ?? 0;
    return {
      saleItemId: item.id,
      productId: item.productId,
      productName: item.productName,
      productSku: item.productSku,
      barcode: barcodeById.get(item.productId) ?? '',
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      unitCost,
      lineCost: unitCost * item.quantity,
      discountPercent: item.discountPercent,
      taxRate: item.taxRate,
      lineTotal: item.lineTotal,
    };
  });

  return {
    id: sale.id,
    saleNumber: sale.saleNumber,
    cashierId: sale.cashierId,
    cashierName: cashier?.name ?? 'Unknown',
    customerId: sale.customerId,
    customerName: customer?.name ?? null,
    customerPhone: customer?.phone ?? null,
    subtotal: sale.subtotal,
    discountAmount: sale.discountAmount,
    discountReason: sale.discountReason,
    taxAmount: sale.taxAmount,
    totalAmount: sale.totalAmount,
    paymentMethod: sale.paymentMethod,
    amountTendered: sale.amountTendered,
    changeGiven: sale.changeGiven,
    status: sale.status,
    heldKey: sale.heldKey,
    createdAt: sale.createdAt,
    items: productRows,
  };
}

async function findOrCreateCustomer(
  db: PostgresClient,
  customerId?: string,
  customerName?: string,
  customerPhone?: string,
): Promise<string | null> {
  if (customerId) return customerId;
  const name = customerName?.trim();
  const phone = customerPhone?.trim();
  if (!name && !phone) return null;

  if (phone) {
    const [byPhone] = await db.select().from(customers).where(eq(customers.phone, phone)).limit(1);
    if (byPhone) return byPhone.id;
  }

  if (!name) return null;
  const now = new Date().toISOString();
  const id = uuid();
  const deviceId = (await getSetting(db, 'device_id')) ?? 'cloud';
  const branchId = (await getSetting(db, 'branch_id')) ?? 'main';
  await db.insert(customers).values({
    id,
    name,
    phone: phone ?? null,
    deviceId,
    branchId,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

export async function createSale(
  db: PostgresClient,
  sessionId: string,
  input: {
    items: Array<{ productId: string; quantity: number; discountPercent?: number; unitPrice?: number }>;
    customerId?: string;
    customerName?: string;
    customerPhone?: string;
    paymentMethod: 'cash' | 'card' | 'bank_transfer' | 'wallet' | 'online';
    amountTendered?: number;
    discountAmount?: number;
    discountReason?: string;
    adjustmentAmount?: number;
    status?: 'completed' | 'held';
    heldKey?: string;
    notes?: string;
    heldSaleId?: string;
  },
) {
  if (input.paymentMethod === 'bank_transfer') {
    return { success: false, error: 'Bank transfer is no longer accepted' };
  }
  if (!input.items.length) return { success: false, error: 'Cart is empty' };

  // The database is remote (~120ms per round trip), so the reads that do not depend
  // on each other are issued together and the writes are batched into one transaction.
  const productIds = [...new Set(input.items.map((i) => i.productId))];
  const [settings, productList, cashierRow] = await Promise.all([
    getAllSettings(db),
    db
      .select()
      .from(products)
      .where(and(inArray(products.id, productIds), eq(products.isDeleted, false))),
    db.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, sessionId)).limit(1),
  ]);

  const inclusive = settings['tax_inclusive'] === 'true';
  const now = new Date().toISOString();
  const deviceId = settings['device_id'] ?? 'cloud';
  const branchId = settings['branch_id'] ?? 'main';

  let customerId: string | null = null;
  try {
    customerId = await findOrCreateCustomer(db, input.customerId, input.customerName, input.customerPhone);
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Customer save failed' };
  }

  const saleId = uuid();
  const productMap = new Map(productList.map((p) => [p.id, p]));

  let subtotal = 0;
  let taxAmount = 0;
  const lineItems: Array<typeof saleItems.$inferInsert> = [];

  for (const item of input.items) {
    const product = productMap.get(item.productId);
    if (!product) return { success: false, error: `Product not found: ${item.productId}` };

    // A resumed hold keeps the price it was saved at; a fresh line uses the current price.
    const unitPrice = item.unitPrice ?? product.salePrice ?? product.retailPrice;
    const discountPercent = item.discountPercent ?? 0;
    const lineTotal = calcLineTotal(unitPrice, item.quantity, discountPercent);
    const lineTax = calcTax(lineTotal, product.taxRate, inclusive);

    subtotal += lineTotal;
    taxAmount += lineTax;

    lineItems.push({
      id: uuid(),
      saleId,
      productId: product.id,
      productName: product.name,
      productSku: product.sku,
      quantity: item.quantity,
      unitPrice,
      discountPercent,
      taxRate: product.taxRate,
      lineTotal,
      deviceId,
      branchId,
      createdAt: now,
      updatedAt: now,
    });
  }

  // Positive adjustment = surcharge (raises total), negative = extra discount.
  const adjustment = input.adjustmentAmount ?? 0;
  const discountAmount = (input.discountAmount ?? 0) - adjustment;
  let discountReason = input.discountReason ?? null;
  if (adjustment !== 0) {
    const label = adjustment < 0
      ? `Adjustment discount (${Math.abs(adjustment).toFixed(2)})`
      : `Surcharge (${adjustment.toFixed(2)})`;
    discountReason = discountReason ? `${discountReason}; ${label}` : label;
  }
  const totalAmount = Math.max(
    0,
    inclusive ? subtotal - discountAmount : subtotal - discountAmount + taxAmount,
  );

  if (input.paymentMethod === 'cash' && input.amountTendered != null && input.amountTendered < totalAmount) {
    return { success: false, error: 'Insufficient amount tendered' };
  }

  const changeGiven =
    input.paymentMethod === 'cash' && input.amountTendered
      ? Math.max(0, input.amountTendered - totalAmount)
      : null;

  let saleNumber = '';
  await db.transaction(async (tx) => {
    const txDb = tx as unknown as PostgresClient;
    // Allocated inside the transaction so a failed sale cannot burn a receipt number.
    saleNumber = input.status === 'held' ? `HOLD-${Date.now()}` : await nextSaleNumber(txDb);

    await tx.insert(sales).values({
      id: saleId,
      saleNumber,
      cashierId: sessionId,
      customerId,
      subtotal,
      discountAmount,
      discountReason,
      taxAmount,
      totalAmount,
      paymentMethod: input.paymentMethod,
      amountTendered: input.amountTendered ?? null,
      changeGiven,
      status: input.status ?? 'completed',
      heldKey: input.heldKey ?? null,
      notes: input.notes ?? null,
      deviceId,
      branchId,
      createdAt: now,
      updatedAt: now,
    });

    if (lineItems.length) await tx.insert(saleItems).values(lineItems);

    if (input.status !== 'held') {
      // Quantities per product, so a cart with the same product on two lines
      // decrements once with the combined amount.
      const qtyByProduct = new Map<string, number>();
      for (const item of input.items) {
        qtyByProduct.set(item.productId, (qtyByProduct.get(item.productId) ?? 0) + item.quantity);
      }

      // One statement for every line instead of one round trip per line. Still a
      // relative decrement, so it stays safe against concurrent sales.
      await applyStockDeltas(tx, [...qtyByProduct].map(([id, qty]) => ({ id, delta: -qty })), now);

      await tx.insert(inventoryMovements).values(
        [...qtyByProduct].map(([productId, qty]) => ({
          id: uuid(),
          productId,
          type: 'sale',
          qtyChange: -qty,
          referenceId: saleId,
          notes: `Sale ${saleNumber}`,
          deviceId,
          branchId,
          createdAt: now,
          updatedAt: now,
        })),
      );
    }

    // Superseding the hold belongs to the same commit as the sale that replaces it.
    if (input.heldSaleId && input.status !== 'held') {
      await tx
        .update(sales)
        .set({ status: 'voided', notes: `Converted to ${saleNumber}`, updatedAt: now })
        .where(and(eq(sales.id, input.heldSaleId), eq(sales.status, 'held')));
    }
  });

  // Built from what we already have rather than re-reading the sale (5 more round trips).
  const customerRow = customerId
    ? { name: input.customerName?.trim() || null, phone: input.customerPhone?.trim() || null }
    : null;
  return {
    success: true,
    data: {
      id: saleId,
      saleNumber,
      cashierId: sessionId,
      cashierName: cashierRow[0]?.name ?? 'Unknown',
      customerId,
      customerName: customerRow?.name ?? null,
      customerPhone: customerRow?.phone ?? null,
      subtotal,
      discountAmount,
      discountReason,
      taxAmount,
      totalAmount,
      paymentMethod: input.paymentMethod,
      amountTendered: input.amountTendered ?? null,
      changeGiven,
      status: input.status ?? 'completed',
      heldKey: input.heldKey ?? null,
      createdAt: now,
      items: lineItems.map((line) => {
        const product = productMap.get(line.productId);
        const unitCost = product?.costPrice ?? 0;
        return {
          saleItemId: line.id as string,
          productId: line.productId,
          productName: line.productName,
          productSku: line.productSku,
          barcode: product?.barcode ?? '',
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          unitCost,
          lineCost: unitCost * line.quantity,
          discountPercent: line.discountPercent ?? 0,
          taxRate: line.taxRate ?? 0,
          lineTotal: line.lineTotal,
        };
      }),
    },
  };
}

/** Applies relative stock changes for many products in a single statement. */
async function applyStockDeltas(
  tx: { execute: (q: ReturnType<typeof sql>) => Promise<unknown> },
  deltas: Array<{ id: string; delta: number }>,
  now: string,
) {
  if (!deltas.length) return;
  const values = sql.join(
    deltas.map((d) => sql`(${d.id}, ${d.delta}::int)`),
    sql`, `,
  );
  await tx.execute(sql`
    update products p
       set stock_qty = p.stock_qty + v.delta,
           updated_at = ${now}
      from (values ${values}) as v(id, delta)
     where p.id = v.id
  `);
}

/**
 * Edits a completed (already paid) bill in place: re-prices the lines, adjusts stock by the
 * quantity delta and rewrites the totals. The sale number, status and payment method are kept,
 * so the caller settles only the difference against the previous total.
 */
export async function updateSale(
  db: PostgresClient,
  input: {
    saleId: string;
    items: Array<{ productId: string; quantity: number; discountPercent?: number; unitPrice?: number }>;
    customerId?: string;
    customerName?: string;
    customerPhone?: string;
    amountTendered?: number;
    discountAmount?: number;
    discountReason?: string;
  },
) {
  if (!input.items.length) return { success: false, error: 'Sale must have at least one item' };

  // Independent reads, issued together — each costs a remote round trip.
  const [[sale], settings, oldItems] = await Promise.all([
    db.select().from(sales).where(eq(sales.id, input.saleId)).limit(1),
    getAllSettings(db),
    db.select().from(saleItems).where(eq(saleItems.saleId, input.saleId)),
  ]);
  if (!sale) return { success: false, error: 'Sale not found' };
  if (sale.status !== 'completed') return { success: false, error: 'Only completed sales can be updated' };

  const inclusive = settings['tax_inclusive'] === 'true';
  const now = new Date().toISOString();
  const deviceId = sale.deviceId;
  const branchId = sale.branchId;

  let customerId: string | null = sale.customerId;
  try {
    customerId = await findOrCreateCustomer(
      db,
      input.customerId ?? sale.customerId ?? undefined,
      input.customerName,
      input.customerPhone,
    );
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Customer save failed' };
  }

  const oldQtyByProduct = new Map<string, number>();
  // Price the bill was saved at, per product — editing must not silently re-price a line.
  const savedPriceByProduct = new Map<string, number>();
  for (const item of oldItems) {
    oldQtyByProduct.set(item.productId, (oldQtyByProduct.get(item.productId) ?? 0) + item.quantity);
    if (!savedPriceByProduct.has(item.productId)) savedPriceByProduct.set(item.productId, item.unitPrice);
  }

  const merged = new Map<string, { quantity: number; discountPercent: number; unitPrice?: number }>();
  for (const item of input.items) {
    // Negative lines are returns and must survive the merge; only a zero line drops out.
    if (item.quantity === 0) continue;
    const existing = merged.get(item.productId);
    if (existing) existing.quantity += item.quantity;
    else merged.set(item.productId, {
      quantity: item.quantity,
      discountPercent: item.discountPercent ?? 0,
      unitPrice: item.unitPrice ?? savedPriceByProduct.get(item.productId),
    });
  }
  if (!merged.size) return { success: false, error: 'Sale must have at least one item' };

  const productList = await db
    .select()
    .from(products)
    .where(and(inArray(products.id, [...merged.keys()]), eq(products.isDeleted, false)));
  const productMap = new Map(productList.map((p) => [p.id, p]));

  let subtotal = 0;
  let taxAmount = 0;
  const lineItems: Array<typeof saleItems.$inferInsert> = [];

  for (const [productId, row] of merged) {
    const product = productMap.get(productId);
    if (!product) return { success: false, error: `Product not found: ${productId}` };

    const unitPrice = row.unitPrice ?? product.salePrice ?? product.retailPrice;
    const lineTotal = calcLineTotal(unitPrice, row.quantity, row.discountPercent);
    subtotal += lineTotal;
    taxAmount += calcTax(lineTotal, product.taxRate, inclusive);

    lineItems.push({
      id: uuid(),
      saleId: input.saleId,
      productId: product.id,
      productName: product.name,
      productSku: product.sku,
      quantity: row.quantity,
      unitPrice,
      discountPercent: row.discountPercent,
      taxRate: product.taxRate,
      lineTotal,
      deviceId,
      branchId,
      createdAt: now,
      updatedAt: now,
    });
  }

  const discountAmount =
    input.discountAmount != null
      ? input.discountAmount
      : sale.subtotal > 0
        ? (sale.discountAmount * subtotal) / sale.subtotal
        : sale.discountAmount;
  const discountReason = input.discountReason ?? sale.discountReason;
  const totalAmount = Math.max(
    0,
    inclusive ? subtotal - discountAmount : subtotal - discountAmount + taxAmount,
  );
  const amountTendered = input.amountTendered ?? sale.amountTendered;
  const changeGiven =
    sale.paymentMethod === 'cash' && amountTendered != null
      ? Math.max(0, amountTendered - totalAmount)
      : sale.changeGiven;

  const stockChanges: Array<{ id: string; delta: number }> = [];
  const movements: Array<typeof inventoryMovements.$inferInsert> = [];
  for (const productId of new Set([...oldQtyByProduct.keys(), ...merged.keys()])) {
    const delta = (merged.get(productId)?.quantity ?? 0) - (oldQtyByProduct.get(productId) ?? 0);
    if (delta === 0) continue;
    stockChanges.push({ id: productId, delta: -delta });
    movements.push({
      id: uuid(),
      productId,
      type: 'adjustment',
      qtyChange: -delta,
      referenceId: input.saleId,
      notes: `Sale edit ${sale.saleNumber}`,
      deviceId,
      branchId,
      createdAt: now,
      updatedAt: now,
    });
  }

  await db.transaction(async (tx) => {
    // One statement for all stock changes rather than one round trip per product.
    await applyStockDeltas(tx, stockChanges, now);
    if (movements.length) await tx.insert(inventoryMovements).values(movements);

    await tx.delete(saleItems).where(eq(saleItems.saleId, input.saleId));
    await tx.insert(saleItems).values(lineItems);

    await tx
      .update(sales)
      .set({
        customerId,
        subtotal,
        discountAmount,
        discountReason,
        taxAmount,
        totalAmount,
        amountTendered,
        changeGiven,
        updatedAt: now,
      })
      .where(eq(sales.id, input.saleId));
  });

  // Re-uses the bulk builder (2 round trips) instead of re-reading the sale row by row.
  const [summary] = await buildSaleSummaries(db, [
    {
      ...sale,
      customerId,
      subtotal,
      discountAmount,
      discountReason,
      taxAmount,
      totalAmount,
      amountTendered,
      changeGiven,
      updatedAt: now,
    },
  ]);
  if (!summary) return { success: false, error: 'Failed to load sale' };
  return { success: true, data: summary };
}

export async function voidSale(db: PostgresClient, id: string) {
  const [sale] = await db.select().from(sales).where(eq(sales.id, id)).limit(1);
  if (!sale) return { success: false, error: 'Sale not found' };
  if (sale.status === 'voided') return { success: false, error: 'Already voided' };

  const now = new Date().toISOString();
  const items = await db.select().from(saleItems).where(eq(saleItems.saleId, id));

  await db.transaction(async (tx) => {
    await tx.update(sales).set({ status: 'voided', updatedAt: now }).where(eq(sales.id, id));

    // Restock only sales that actually decremented inventory (completed ones).
    if (sale.status === 'completed') {
      const movements: Array<typeof inventoryMovements.$inferInsert> = [];
      for (const item of items) {
        await tx
          .update(products)
          .set({ stockQty: sql`${products.stockQty} + ${item.quantity}`, updatedAt: now })
          .where(eq(products.id, item.productId));

        movements.push({
          id: uuid(),
          productId: item.productId,
          type: 'void',
          qtyChange: item.quantity,
          referenceId: id,
          notes: `Void sale ${sale.saleNumber}`,
          deviceId: sale.deviceId,
          branchId: sale.branchId,
          createdAt: now,
          updatedAt: now,
        });
      }
      if (movements.length) await tx.insert(inventoryMovements).values(movements);
    }
  });

  const summary = await buildSaleSummary(db, id);
  if (!summary) return { success: false, error: 'Failed to load sale' };
  return { success: true, data: summary };
}

export async function listSales(
  db: PostgresClient,
  params?: { status?: string; limit?: number; search?: string; startDate?: string; endDate?: string },
) {
  const limit = params?.limit ?? 50;
  const conditions = [];

  if (params?.status) {
    conditions.push(eq(sales.status, params.status as 'completed' | 'held' | 'voided' | 'returned'));
  }

  if (params?.startDate || params?.endDate) {
    const range = coerceReportDateRange({
      startDate: params.startDate,
      endDate: params.endDate,
    });
    const { startInclusive, endExclusive } = isoRangeBounds(range);
    conditions.push(gte(sales.createdAt, startInclusive));
    conditions.push(lt(sales.createdAt, endExclusive));
  }

  if (params?.search?.trim()) {
    const term = params.search.trim();
    const pattern = `%${term}%`;
    const matchingCustomers = await db
      .select({ id: customers.id })
      .from(customers)
      .where(or(ilike(customers.name, pattern), ilike(customers.phone, pattern)));
    const customerIds = matchingCustomers.map((c) => c.id);
    const saleNumberMatch = sql`lower(${sales.saleNumber}) like ${`%${term.toLowerCase()}%`}`;
    if (customerIds.length) {
      conditions.push(or(saleNumberMatch, inArray(sales.customerId, customerIds)));
    } else {
      conditions.push(saleNumberMatch);
    }
  }

  const where = conditions.length ? and(...conditions) : undefined;
  const rows = await db
    .select()
    .from(sales)
    .where(where)
    .orderBy(desc(sales.createdAt))
    .limit(limit);

  return { success: true as const, data: await buildSaleSummaries(db, rows) };
}

export async function lookupSaleByNumber(db: PostgresClient, saleNumber: string) {
  const trimmed = saleNumber.trim();
  if (!trimmed) return { success: false as const, error: 'Sale number is required' };
  const [sale] = await db
    .select()
    .from(sales)
    .where(sql`lower(${sales.saleNumber}) = ${trimmed.toLowerCase()}`)
    .limit(1);
  if (!sale) return { success: false as const, error: 'Sale not found' };
  return getSale(db, sale.id);
}

export async function getSaleReceiptPreview(db: PostgresClient, saleId: string) {
  const summary = await buildSaleSummary(db, saleId);
  if (!summary) return { success: false as const, error: 'Sale not found' };
  const settings = await getAllSettings(db);
  return {
    success: true as const,
    data: {
      saleNumber: summary.saleNumber,
      storeName: settings.store_name ?? 'Mama Babi',
      storeAddress: settings.store_address ?? '',
      storePhone: settings.store_phone ?? '',
      cashierName: summary.cashierName,
      createdAt: summary.createdAt,
      items: summary.items.map((i) => ({
        name: i.productName,
        qty: i.quantity,
        unitPrice: i.unitPrice,
        lineTotal: i.lineTotal,
      })),
      subtotal: summary.subtotal,
      discountAmount: summary.discountAmount,
      taxAmount: summary.taxAmount,
      totalAmount: summary.totalAmount,
      paymentMethod: summary.paymentMethod,
      amountTendered: summary.amountTendered,
      changeGiven: summary.changeGiven,
      footerMessage: settings.receipt_footer ?? 'Thank you for shopping!',
    },
  };
}

export async function getSale(db: PostgresClient, id: string) {
  const summary = await buildSaleSummary(db, id);
  if (!summary) return { success: false, error: 'Sale not found' };
  return { success: true as const, data: summary };
}

export async function discardHeldSale(db: PostgresClient, id: string) {
  const [sale] = await db.select().from(sales).where(eq(sales.id, id)).limit(1);
  if (!sale) return { success: false, error: 'Sale not found' };
  if (sale.status !== 'held') return { success: false, error: 'Not a held sale' };
  await db
    .update(sales)
    .set({ status: 'voided', updatedAt: new Date().toISOString() })
    .where(eq(sales.id, id));
  return { success: true as const, data: undefined };
}

export async function resumeHeldSale(db: PostgresClient, heldKey: string) {
  const rows = await db.select().from(sales).where(eq(sales.heldKey, heldKey));
  const held = rows.find((r) => r.status === 'held');
  if (!held) return { success: false, error: 'Held sale not found' };
  const summary = await buildSaleSummary(db, held.id);
  if (!summary) return { success: false, error: 'Failed to load held sale' };
  return { success: true as const, data: summary };
}
