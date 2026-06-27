import { and, desc, eq, gte, ilike, inArray, lt, or, sql } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import { customers, inventoryMovements, products, saleItems, sales, users } from '@mama-babi/db-pg';
import type { PostgresClient } from '@mama-babi/db-pg';
import { coerceReportDateRange, isoRangeBounds } from '../lib/reportDateRange';
import { getSetting, incrementSaleCounter, getAllSettings } from './settings.service';

function calcLineTotal(unitPrice: number, qty: number, discountPercent: number): number {
  const subtotal = unitPrice * qty;
  return subtotal - subtotal * (discountPercent / 100);
}

function calcTax(amount: number, taxRate: number, inclusive: boolean): number {
  if (inclusive) return amount - amount / (1 + taxRate / 100);
  return amount * (taxRate / 100);
}

export async function buildSaleSummary(db: PostgresClient, saleId: string) {
  const [sale] = await db.select().from(sales).where(eq(sales.id, saleId)).limit(1);
  if (!sale) return null;

  const [cashier] = await db.select().from(users).where(eq(users.id, sale.cashierId)).limit(1);
  const customer = sale.customerId
    ? (await db.select().from(customers).where(eq(customers.id, sale.customerId)).limit(1))[0]
    : undefined;
  const items = await db.select().from(saleItems).where(eq(saleItems.saleId, saleId));

  const productRows = await Promise.all(
    items.map(async (item) => {
      const [product] = await db.select().from(products).where(eq(products.id, item.productId)).limit(1);
      return {
        saleItemId: item.id,
        productId: item.productId,
        productName: item.productName,
        productSku: item.productSku,
        barcode: product?.barcode ?? '',
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        discountPercent: item.discountPercent,
        taxRate: item.taxRate,
        lineTotal: item.lineTotal,
      };
    }),
  );

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
    items: Array<{ productId: string; quantity: number; discountPercent?: number }>;
    customerId?: string;
    customerName?: string;
    customerPhone?: string;
    paymentMethod: 'cash' | 'card' | 'bank_transfer' | 'wallet';
    amountTendered?: number;
    discountAmount?: number;
    discountReason?: string;
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

  const inclusive = (await getSetting(db, 'tax_inclusive')) === 'true';
  const now = new Date().toISOString();
  const deviceId = (await getSetting(db, 'device_id')) ?? 'cloud';
  const branchId = (await getSetting(db, 'branch_id')) ?? 'main';

  let customerId: string | null = null;
  try {
    customerId = await findOrCreateCustomer(db, input.customerId, input.customerName, input.customerPhone);
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Customer save failed' };
  }

  const saleId = uuid();
  const saleNumber = input.status === 'held' ? `HOLD-${Date.now()}` : await incrementSaleCounter(db);

  let subtotal = 0;
  let taxAmount = 0;
  const lineItems: Array<typeof saleItems.$inferInsert> = [];

  for (const item of input.items) {
    const [product] = await db
      .select()
      .from(products)
      .where(and(eq(products.id, item.productId), eq(products.isDeleted, false)))
      .limit(1);
    if (!product) return { success: false, error: `Product not found: ${item.productId}` };

    const unitPrice = product.salePrice ?? product.retailPrice;
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

  const discountAmount = input.discountAmount ?? 0;
  const totalAmount = inclusive ? subtotal - discountAmount : subtotal - discountAmount + taxAmount;

  if (input.paymentMethod === 'cash' && input.amountTendered != null && input.amountTendered < totalAmount) {
    return { success: false, error: 'Insufficient amount tendered' };
  }

  const changeGiven =
    input.paymentMethod === 'cash' && input.amountTendered
      ? Math.max(0, input.amountTendered - totalAmount)
      : null;

  await db.transaction(async (tx) => {
    await tx.insert(sales).values({
      id: saleId,
      saleNumber,
      cashierId: sessionId,
      customerId,
      subtotal,
      discountAmount,
      discountReason: input.discountReason ?? null,
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

    for (const line of lineItems) {
      await tx.insert(saleItems).values(line);
    }

    if (input.status !== 'held') {
      for (const item of input.items) {
        const [product] = await tx.select().from(products).where(eq(products.id, item.productId)).limit(1);
        if (!product) continue;
        await tx
          .update(products)
          .set({ stockQty: product.stockQty - item.quantity, updatedAt: now })
          .where(eq(products.id, item.productId));

        await tx.insert(inventoryMovements).values({
          id: uuid(),
          productId: item.productId,
          type: 'sale',
          qtyChange: -item.quantity,
          referenceId: saleId,
          notes: `Sale ${saleNumber}`,
          deviceId,
          branchId,
          createdAt: now,
          updatedAt: now,
        });
      }
    }
  });

  if (input.heldSaleId && input.status !== 'held') {
    const [held] = await db.select().from(sales).where(eq(sales.id, input.heldSaleId)).limit(1);
    if (held && held.status === 'held') {
      await db
        .update(sales)
        .set({ status: 'voided', notes: `Converted to ${saleNumber}`, updatedAt: new Date().toISOString() })
        .where(eq(sales.id, input.heldSaleId));
    }
  }

  const summary = await buildSaleSummary(db, saleId);
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

  const summaries = (
    await Promise.all(rows.map((r) => buildSaleSummary(db, r.id)))
  ).filter(Boolean);
  return { success: true as const, data: summaries as NonNullable<Awaited<ReturnType<typeof buildSaleSummary>>>[] };
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
