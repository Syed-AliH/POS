import { and, desc, eq, gte, inArray, lt, lte, sql } from 'drizzle-orm';
import { categories, customers, expenses, grnHeaders, grnLines, labelTemplates, products, returns, saleItems, sales, shifts, users, vendors } from '@mama-babi/db-pg';
import type { PostgresClient } from '@mama-babi/db-pg';
import { coerceReportDateRange, isoRangeBounds } from '../lib/reportDateRange';
import { getSetting } from './settings.service';

function completedSalesDateFilter(params?: { startDate?: string; endDate?: string }) {
  const range = coerceReportDateRange(params);
  const { startInclusive, endExclusive } = isoRangeBounds(range);
  return and(
    eq(sales.status, 'completed'),
    gte(sales.createdAt, startInclusive),
    lt(sales.createdAt, endExclusive),
  );
}

export async function getOwnerDashboard(
  db: PostgresClient,
  params?: { startDate?: string; endDate?: string },
) {
  const range = coerceReportDateRange(params);
  const rows = await db
    .select({
      totalAmount: sales.totalAmount,
      paymentMethod: sales.paymentMethod,
    })
    .from(sales)
    .where(completedSalesDateFilter(range));

  const totalSales = rows.reduce((sum, r) => sum + r.totalAmount, 0);
  const transactionCount = rows.length;
  const averageSale = transactionCount > 0 ? totalSales / transactionCount : 0;

  const byPayment = new Map<string, { total: number; count: number }>();
  for (const row of rows) {
    const existing = byPayment.get(row.paymentMethod) ?? { total: 0, count: 0 };
    existing.total += row.totalAmount;
    existing.count += 1;
    byPayment.set(row.paymentMethod, existing);
  }

  const profit = (await getProfitReport(db, params)).data;

  return {
    success: true as const,
    data: {
      startDate: range.startDate,
      endDate: range.endDate,
      totalSales,
      transactionCount,
      averageSale,
      estimatedCost: profit.estimatedCost,
      grossProfit: profit.grossProfit,
      marginPercent: profit.marginPercent,
      returnsTotal: profit.returnsTotal,
      paymentBreakdown: [...byPayment.entries()].map(([paymentMethod, v]) => ({
        paymentMethod,
        total: v.total,
        count: v.count,
      })),
    },
  };
}

export async function listOwnerSales(
  db: PostgresClient,
  params?: { startDate?: string; endDate?: string; limit?: number; search?: string },
) {
  const range = coerceReportDateRange(params);
  const limit = Math.min(params?.limit ?? 100, 500);
  const { startInclusive, endExclusive } = isoRangeBounds(range);

  const conditions = [
    eq(sales.status, 'completed'),
    gte(sales.createdAt, startInclusive),
    lt(sales.createdAt, endExclusive),
  ];
  if (params?.search?.trim()) {
    conditions.push(sql`lower(${sales.saleNumber}) like ${`%${params.search.trim().toLowerCase()}%`}`);
  }

  const rows = await db
    .select()
    .from(sales)
    .where(and(...conditions))
    .orderBy(desc(sales.createdAt))
    .limit(limit);
  if (!rows.length) return { success: true as const, data: [] };

  // buildSaleSummary costs four round trips per sale — 100 sales meant ~500 queries.
  // Names, line items and product costs are fetched once for the whole page instead.
  const saleIds = rows.map((r) => r.id);
  const cashierIds = [...new Set(rows.map((r) => r.cashierId).filter(Boolean))];
  const customerIds = [...new Set(rows.map((r) => r.customerId).filter((id): id is string => Boolean(id)))];

  const [cashierRows, customerRows, itemRows] = await Promise.all([
    cashierIds.length
      ? db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, cashierIds))
      : Promise.resolve([] as Array<{ id: string; name: string }>),
    customerIds.length
      ? db
          .select({ id: customers.id, name: customers.name, phone: customers.phone })
          .from(customers)
          .where(inArray(customers.id, customerIds))
      : Promise.resolve([] as Array<{ id: string; name: string; phone: string | null }>),
    db
      .select({
        saleId: saleItems.saleId,
        saleItemId: saleItems.id,
        productId: saleItems.productId,
        productName: saleItems.productName,
        productSku: saleItems.productSku,
        quantity: saleItems.quantity,
        unitPrice: saleItems.unitPrice,
        discountPercent: saleItems.discountPercent,
        taxRate: saleItems.taxRate,
        lineTotal: saleItems.lineTotal,
        // Cost isn't stored per line, so we report the product's current cost price —
        // same basis as the estimated-cost figure on the owner dashboard.
        barcode: products.barcode,
        costPrice: products.costPrice,
      })
      .from(saleItems)
      .leftJoin(products, eq(products.id, saleItems.productId))
      .where(inArray(saleItems.saleId, saleIds)),
  ]);

  const cashierById = new Map(cashierRows.map((r) => [r.id, r.name]));
  const customerById = new Map(customerRows.map((r) => [r.id, r]));
  const itemsBySaleId = new Map<string, typeof itemRows>();
  for (const item of itemRows) {
    const list = itemsBySaleId.get(item.saleId);
    if (list) list.push(item);
    else itemsBySaleId.set(item.saleId, [item]);
  }

  const data = rows.map((sale) => {
    const customer = sale.customerId ? customerById.get(sale.customerId) : undefined;
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
      items: (itemsBySaleId.get(sale.id) ?? []).map((item) => {
        const unitCost = item.costPrice ?? 0;
        return {
          saleItemId: item.saleItemId,
          productId: item.productId,
          productName: item.productName,
          productSku: item.productSku,
          barcode: item.barcode ?? '',
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          unitCost,
          lineCost: unitCost * item.quantity,
          discountPercent: item.discountPercent,
          taxRate: item.taxRate,
          lineTotal: item.lineTotal,
        };
      }),
    };
  });

  return { success: true as const, data };
}

export async function getTopProducts(
  db: PostgresClient,
  params?: { startDate?: string; endDate?: string; limit?: number },
) {
  const range = coerceReportDateRange(params);
  const { startInclusive, endExclusive } = isoRangeBounds(range);
  const limit = Math.min(params?.limit ?? 10, 50);

  // Grouped and trimmed in the database — this used to read every sale_items row in
  // the table and filter it in memory.
  const rows = await db.execute<{
    product_id: string;
    product_name: string;
    quantity_sold: string | number;
    revenue: string | number;
  }>(sql`
    select si.product_id,
           min(si.product_name) as product_name,
           coalesce(sum(si.quantity), 0) as quantity_sold,
           coalesce(sum(si.line_total), 0) as revenue
    from sale_items si
    inner join sales s on s.id = si.sale_id
    where s.status = 'completed'
      and s.created_at >= ${startInclusive}
      and s.created_at < ${endExclusive}
    group by si.product_id
    order by revenue desc
    limit ${limit}
  `);

  const data = rows.rows.map((r) => ({
    productId: r.product_id,
    productName: r.product_name,
    quantitySold: Number(r.quantity_sold),
    revenue: Number(r.revenue),
  }));

  return { success: true as const, data };
}

/**
 * Catalogue lookup for the owner portal: name, SKU or barcode in, cost and selling
 * price out. One query, capped, so it stays quick over a phone connection.
 */
export async function searchOwnerProducts(
  db: PostgresClient,
  params?: { search?: string; limit?: number },
) {
  const limit = Math.min(Math.max(params?.limit ?? 50, 1), 200);
  const search = params?.search?.trim().toLowerCase();

  const conditions = [eq(products.isDeleted, false)];
  if (search) {
    const like = `%${search}%`;
    conditions.push(
      sql`(lower(${products.name}) like ${like} or lower(${products.sku}) like ${like} or lower(${products.barcode}) like ${like})`,
    );
  }

  const rows = await db
    .select({
      id: products.id,
      name: products.name,
      sku: products.sku,
      barcode: products.barcode,
      costPrice: products.costPrice,
      retailPrice: products.retailPrice,
      salePrice: products.salePrice,
      stockQty: products.stockQty,
      status: products.status,
      categoryName: categories.name,
    })
    .from(products)
    .leftJoin(categories, eq(categories.id, products.categoryId))
    .where(and(...conditions))
    // Exact SKU/barcode hits first so scanning or typing a full code lands on top.
    .orderBy(
      search
        ? sql`case when lower(${products.sku}) = ${search} or lower(${products.barcode}) = ${search} then 0
                   when lower(${products.name}) like ${search + '%'} then 1
                   else 2 end`
        : sql`0`,
      products.name,
    )
    .limit(limit);

  const data = rows.map((r) => {
    const costPrice = r.costPrice ?? 0;
    const retailPrice = r.retailPrice ?? 0;
    const salePrice = r.salePrice ?? null;
    const sellingPrice = salePrice ?? retailPrice;
    const profit = sellingPrice - costPrice;
    return {
      id: r.id,
      name: r.name,
      sku: r.sku,
      barcode: r.barcode,
      categoryName: r.categoryName ?? null,
      costPrice,
      retailPrice,
      salePrice,
      sellingPrice,
      stockQty: r.stockQty,
      status: r.status,
      profit,
      marginPercent: sellingPrice > 0 ? (profit / sellingPrice) * 100 : 0,
    };
  });

  return { success: true as const, data };
}

export async function getDailySales(
  db: PostgresClient,
  params?: { startDate?: string; endDate?: string },
) {
  const range = coerceReportDateRange(params);
  const rows = await db.select().from(sales).where(completedSalesDateFilter(range));
  return {
    success: true as const,
    data: {
      totalSales: rows.reduce((sum, r) => sum + r.totalAmount, 0),
      transactionCount: rows.length,
    },
  };
}

export async function getSalesByCategory(
  db: PostgresClient,
  params?: { startDate?: string; endDate?: string },
) {
  const range = coerceReportDateRange(params);
  const completed = await db.select({ id: sales.id }).from(sales).where(completedSalesDateFilter(range));
  const saleIds = new Set(completed.map((s) => s.id));
  if (!saleIds.size) return { success: true as const, data: [] };

  const productRows = await db.select().from(products);
  const productMap = new Map(productRows.map((p) => [p.id, p]));
  const categoryRows = await db.select().from(categories);
  const categoryMap = new Map(categoryRows.map((c) => [c.id, c.name]));

  const items = await db.select().from(saleItems);
  const byCategory = new Map<string | null, { name: string; total: number; count: number }>();
  for (const item of items) {
    if (!saleIds.has(item.saleId)) continue;
    const product = productMap.get(item.productId);
    const catId = product?.categoryId ?? null;
    const name = catId ? categoryMap.get(catId) ?? 'Uncategorized' : 'Uncategorized';
    const existing = byCategory.get(catId) ?? { name, total: 0, count: 0 };
    existing.total += item.lineTotal;
    existing.count += item.quantity;
    byCategory.set(catId, existing);
  }

  return {
    success: true as const,
    data: [...byCategory.entries()].map(([categoryId, v]) => ({
      categoryId,
      categoryName: v.name,
      totalSales: v.total,
      itemCount: v.count,
    })),
  };
}

export async function getPaymentBreakdown(
  db: PostgresClient,
  params?: { startDate?: string; endDate?: string },
) {
  const range = coerceReportDateRange(params);
  const rows = await db.select().from(sales).where(completedSalesDateFilter(range));
  const byMethod = new Map<string, { total: number; count: number }>();
  for (const sale of rows) {
    const existing = byMethod.get(sale.paymentMethod) ?? { total: 0, count: 0 };
    existing.total += sale.totalAmount;
    existing.count += 1;
    byMethod.set(sale.paymentMethod, existing);
  }
  return {
    success: true as const,
    data: [...byMethod.entries()].map(([paymentMethod, v]) => ({
      paymentMethod,
      total: v.total,
      count: v.count,
    })),
  };
}

export async function getInventoryValuation(db: PostgresClient) {
  const rows = await db
    .select()
    .from(products)
    .where(and(eq(products.isDeleted, false), eq(products.status, 'active')));

  let totalUnits = 0;
  let totalCostValue = 0;
  let totalRetailValue = 0;
  const negativeStockItems: Array<{ id: string; name: string; sku: string; stockQty: number }> = [];
  for (const p of rows) {
    totalUnits += p.stockQty;
    totalCostValue += p.stockQty * p.costPrice;
    totalRetailValue += p.stockQty * (p.salePrice ?? p.retailPrice);
    if (p.stockQty < 0) {
      negativeStockItems.push({ id: p.id, name: p.name, sku: p.sku, stockQty: p.stockQty });
    }
  }
  negativeStockItems.sort((a, b) => a.stockQty - b.stockQty);

  return {
    success: true as const,
    data: {
      totalUnits,
      totalCostValue,
      totalRetailValue,
      productCount: rows.length,
      negativeStockCount: negativeStockItems.length,
      negativeStockItems,
    },
  };
}

export async function getEodReport(
  db: PostgresClient,
  params?: { startDate?: string; endDate?: string },
) {
  const range = coerceReportDateRange(params);
  const periodLabel = range.startDate === range.endDate ? range.startDate : `${range.startDate} → ${range.endDate}`;
  const { startInclusive, endExclusive } = isoRangeBounds(range);

  const daySales = await db.select().from(sales).where(completedSalesDateFilter(range));
  const dayReturns = await db
    .select()
    .from(returns)
    .where(and(gte(returns.createdAt, startInclusive), lt(returns.createdAt, endExclusive)));
  const dayExpenses = await db
    .select()
    .from(expenses)
    .where(
      and(
        eq(expenses.status, 'approved'),
        gte(expenses.createdAt, startInclusive),
        lt(expenses.createdAt, endExclusive),
      ),
    );

  const cashSales = daySales.filter((s) => s.paymentMethod === 'cash').reduce((sum, s) => sum + s.totalAmount, 0);
  const cardSales = daySales.filter((s) => s.paymentMethod === 'card').reduce((sum, s) => sum + s.totalAmount, 0);
  const walletSales = daySales.filter((s) => s.paymentMethod === 'wallet').reduce((sum, s) => sum + s.totalAmount, 0);
  const returnsTotal = dayReturns.reduce((sum, r) => sum + r.totalRefund, 0);
  const expensesTotal = dayExpenses.reduce((sum, e) => sum + e.amount, 0);

  const openShifts = await db.select().from(shifts).where(eq(shifts.status, 'open'));
  const openingFloat = openShifts.reduce((sum, s) => sum + s.openingFloat, 0);
  const expectedCash = openingFloat + cashSales - returnsTotal;

  return {
    success: true as const,
    data: {
      date: periodLabel,
      totalSales: daySales.reduce((sum, s) => sum + s.totalAmount, 0),
      transactionCount: daySales.length,
      cashSales,
      cardSales,
      walletSales,
      returnsTotal,
      expensesTotal,
      openingFloat,
      expectedCash,
      netClosing: expectedCash - expensesTotal,
    },
  };
}

export async function getProfitReport(
  db: PostgresClient,
  params?: { startDate?: string; endDate?: string },
) {
  const range = coerceReportDateRange(params);
  const { startInclusive, endExclusive } = isoRangeBounds(range);

  const completedSales = await db
    .select()
    .from(sales)
    .where(
      and(
        eq(sales.status, 'completed'),
        gte(sales.createdAt, startInclusive),
        lt(sales.createdAt, endExclusive),
      ),
    );

  const saleIds = new Set(completedSales.map((s) => s.id));
  const revenue = completedSales.reduce((sum, s) => sum + s.totalAmount, 0);

  const returnRows = await db
    .select()
    .from(returns)
    .where(and(gte(returns.createdAt, startInclusive), lt(returns.createdAt, endExclusive)));
  const returnsTotal = returnRows.reduce((sum, r) => sum + r.totalRefund, 0);

  const items = await db.select().from(saleItems);
  let estimatedCost = 0;
  for (const item of items) {
    if (!saleIds.has(item.saleId)) continue;
    const [product] = await db.select().from(products).where(eq(products.id, item.productId)).limit(1);
    estimatedCost += item.quantity * (product?.costPrice ?? 0);
  }

  const grossProfit = revenue - estimatedCost;
  return {
    success: true as const,
    data: {
      revenue,
      estimatedCost,
      grossProfit,
      marginPercent: revenue > 0 ? (grossProfit / revenue) * 100 : 0,
      transactionCount: completedSales.length,
      returnsTotal,
    },
  };
}

type InventoryStockFilter = 'all' | 'negative' | 'zero' | 'low';

async function getLastGrnDateByProduct(db: PostgresClient): Promise<Map<string, string>> {
  const lines = await db.select().from(grnLines);
  const headers = await db.select().from(grnHeaders);
  const headerMap = new Map(headers.map((h) => [h.id, h]));
  const map = new Map<string, string>();

  for (const line of lines) {
    const header = headerMap.get(line.grnId);
    if (!header || header.status !== 'finalized') continue;
    const candidate = header.receivedDate ?? header.createdAt.slice(0, 10);
    const existing = map.get(line.productId);
    if (!existing || candidate > existing) {
      map.set(line.productId, candidate);
    }
  }
  return map;
}

export async function getInventoryReport(
  db: PostgresClient,
  params?: { search?: string; categoryId?: string; stockFilter?: InventoryStockFilter },
) {
  const lastGrnDates = await getLastGrnDateByProduct(db);
  const categoryRows = await db.select().from(categories).where(eq(categories.isDeleted, false));
  const categoryMap = new Map(categoryRows.map((c) => [c.id, c.name]));

  let rows = await db
    .select()
    .from(products)
    .where(and(eq(products.isDeleted, false), eq(products.status, 'active')));

  const search = params?.search?.trim().toLowerCase();
  if (search) {
    rows = rows.filter(
      (p) =>
        p.name.toLowerCase().includes(search) ||
        p.sku.toLowerCase().includes(search) ||
        p.barcode.toLowerCase().includes(search),
    );
  }

  if (params?.categoryId) {
    rows = rows.filter((p) => p.categoryId === params.categoryId);
  }

  const stockFilter = params?.stockFilter ?? 'all';
  if (stockFilter === 'negative') rows = rows.filter((p) => p.stockQty < 0);
  else if (stockFilter === 'zero') rows = rows.filter((p) => p.stockQty === 0);
  else if (stockFilter === 'low') {
    rows = rows.filter((p) => p.stockQty > 0 && p.stockQty <= p.reorderLevel);
  }

  const reportRows = rows
    .map((p) => ({
      id: p.id,
      productName: p.name,
      barcode: p.barcode,
      sku: p.sku,
      categoryId: p.categoryId,
      categoryName: p.categoryId ? categoryMap.get(p.categoryId) ?? 'Uncategorized' : 'Uncategorized',
      stockQty: p.stockQty,
      reorderLevel: p.reorderLevel,
      costPrice: p.costPrice,
      retailPrice: p.salePrice ?? p.retailPrice,
      inventoryValue: p.stockQty * p.costPrice,
      lastGrnDate: lastGrnDates.get(p.id) ?? null,
      updatedAt: p.updatedAt,
    }))
    .sort((a, b) => a.productName.localeCompare(b.productName));

  const allActive = await db
    .select()
    .from(products)
    .where(and(eq(products.isDeleted, false), eq(products.status, 'active')));

  return {
    success: true as const,
    data: {
      rows: reportRows,
      totalProducts: reportRows.length,
      totalUnits: reportRows.reduce((sum, r) => sum + r.stockQty, 0),
      totalInventoryValue: reportRows.reduce((sum, r) => sum + r.inventoryValue, 0),
      negativeCount: allActive.filter((p) => p.stockQty < 0).length,
      zeroCount: allActive.filter((p) => p.stockQty === 0).length,
      lowCount: allActive.filter((p) => p.stockQty > 0 && p.stockQty <= p.reorderLevel).length,
    },
  };
}

/**
 * GRN list for the owner portal — headers with vendor and line totals only. The full
 * `listGrns` maps every line of every GRN; this stays at three queries for the page.
 */
export async function listOwnerGrns(
  db: PostgresClient,
  params?: { search?: string; startDate?: string; endDate?: string; limit?: number },
) {
  const limit = Math.min(Math.max(params?.limit ?? 50, 1), 200);
  const search = params?.search?.trim().toLowerCase();

  const conditions = [eq(grnHeaders.isDeleted, false)];
  if (params?.startDate) conditions.push(gte(grnHeaders.receivedDate, params.startDate));
  if (params?.endDate) conditions.push(lte(grnHeaders.receivedDate, params.endDate));
  if (search) {
    const like = `%${search}%`;
    conditions.push(
      sql`(lower(${grnHeaders.grnNumber}) like ${like} or lower(coalesce(${grnHeaders.invoiceNumber}, '')) like ${like})`,
    );
  }

  const headers = await db
    .select({
      id: grnHeaders.id,
      grnNumber: grnHeaders.grnNumber,
      vendorId: grnHeaders.vendorId,
      vendorName: vendors.name,
      invoiceNumber: grnHeaders.invoiceNumber,
      invoiceTotal: grnHeaders.invoiceTotal,
      receivedDate: grnHeaders.receivedDate,
      status: grnHeaders.status,
      paymentType: grnHeaders.paymentType,
      createdAt: grnHeaders.createdAt,
    })
    .from(grnHeaders)
    .leftJoin(vendors, eq(vendors.id, grnHeaders.vendorId))
    .where(and(...conditions))
    .orderBy(desc(grnHeaders.createdAt))
    .limit(limit);

  if (!headers.length) return { success: true as const, data: [] };

  const totals = await db
    .select({
      grnId: grnLines.grnId,
      lineCount: sql<number>`count(*)::int`,
      totalQty: sql<number>`coalesce(sum(${grnLines.qty}), 0)::int`,
      linesTotal: sql<number>`coalesce(sum(${grnLines.lineTotal}), 0)`,
    })
    .from(grnLines)
    .where(inArray(grnLines.grnId, headers.map((h) => h.id)))
    .groupBy(grnLines.grnId);

  const totalsById = new Map(totals.map((t) => [t.grnId, t]));

  return {
    success: true as const,
    data: headers.map((h) => {
      const t = totalsById.get(h.id);
      return {
        id: h.id,
        grnNumber: h.grnNumber,
        vendorId: h.vendorId,
        vendorName: h.vendorName ?? 'Unknown',
        invoiceNumber: h.invoiceNumber,
        invoiceTotal: h.invoiceTotal,
        receivedDate: h.receivedDate,
        status: h.status,
        paymentType: h.paymentType,
        createdAt: h.createdAt,
        lineCount: Number(t?.lineCount ?? 0),
        totalQty: Number(t?.totalQty ?? 0),
        linesTotal: Number(t?.linesTotal ?? 0),
      };
    }),
  };
}

/** One GRN with the per-line product details a label needs (barcode and selling price). */
export async function getOwnerGrn(db: PostgresClient, id: string) {
  const [header] = await db
    .select({
      id: grnHeaders.id,
      grnNumber: grnHeaders.grnNumber,
      vendorId: grnHeaders.vendorId,
      vendorName: vendors.name,
      invoiceNumber: grnHeaders.invoiceNumber,
      invoiceTotal: grnHeaders.invoiceTotal,
      receivedDate: grnHeaders.receivedDate,
      status: grnHeaders.status,
      paymentType: grnHeaders.paymentType,
      notes: grnHeaders.notes,
      createdAt: grnHeaders.createdAt,
    })
    .from(grnHeaders)
    .leftJoin(vendors, eq(vendors.id, grnHeaders.vendorId))
    .where(eq(grnHeaders.id, id))
    .limit(1);

  if (!header) return { success: false as const, error: 'GRN not found' };

  const lines = await db
    .select({
      id: grnLines.id,
      productId: grnLines.productId,
      qty: grnLines.qty,
      unitCost: grnLines.unitCost,
      unitRetail: grnLines.unitRetail,
      lineTotal: grnLines.lineTotal,
      productName: products.name,
      productSku: products.sku,
      barcode: products.barcode,
      retailPrice: products.retailPrice,
      salePrice: products.salePrice,
    })
    .from(grnLines)
    .leftJoin(products, eq(products.id, grnLines.productId))
    .where(eq(grnLines.grnId, id));

  return {
    success: true as const,
    data: {
      ...header,
      vendorName: header.vendorName ?? 'Unknown',
      linesTotal: lines.reduce((sum, l) => sum + l.lineTotal, 0),
      items: lines.map((l) => {
        // Label price follows the till: sale price when set, else retail, else the
        // retail figure captured on the GRN line.
        const sellingPrice = l.salePrice ?? l.retailPrice ?? l.unitRetail ?? 0;
        return {
          id: l.id,
          productId: l.productId,
          productName: l.productName ?? 'Unknown product',
          productSku: l.productSku ?? '',
          barcode: l.barcode ?? '',
          qty: l.qty,
          unitCost: l.unitCost,
          unitRetail: l.unitRetail,
          sellingPrice,
          lineTotal: l.lineTotal,
        };
      }),
    },
  };
}

/** Label templates as stored — the browser normalises the JSON with @mama-babi/printer. */
export async function listOwnerLabelTemplates(db: PostgresClient) {
  const [rows, storeNameSetting] = await Promise.all([
    db
      .select({
        id: labelTemplates.id,
        name: labelTemplates.name,
        widthMm: labelTemplates.widthMm,
        heightMm: labelTemplates.heightMm,
        layoutJson: labelTemplates.layoutJson,
        rollConfigJson: labelTemplates.rollConfigJson,
        isDefault: labelTemplates.isDefault,
      })
      .from(labelTemplates)
      .where(eq(labelTemplates.isDeleted, false)),
    getSetting(db, 'store_name'),
  ]);

  return {
    success: true as const,
    data: {
      storeName: storeNameSetting ?? 'Store',
      templates: rows,
    },
  };
}
