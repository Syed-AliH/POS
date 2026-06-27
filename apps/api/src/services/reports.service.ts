import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';
import { categories, grnHeaders, grnLines, products, returns, saleItems, sales } from '@mama-babi/db-pg';
import type { PostgresClient } from '@mama-babi/db-pg';
import { coerceReportDateRange, isoRangeBounds } from '../lib/reportDateRange';
import { buildSaleSummary } from './sales.service';

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
  const summaries = (
    await Promise.all(rows.map((r) => buildSaleSummary(db, r.id)))
  ).filter(Boolean);

  return {
    success: true as const,
    data: summaries as NonNullable<Awaited<ReturnType<typeof buildSaleSummary>>>[],
  };
}

export async function getTopProducts(
  db: PostgresClient,
  params?: { startDate?: string; endDate?: string; limit?: number },
) {
  const range = coerceReportDateRange(params);
  const limit = Math.min(params?.limit ?? 10, 50);
  const completed = await db
    .select({ id: sales.id })
    .from(sales)
    .where(completedSalesDateFilter(range));
  const saleIds = new Set(completed.map((s) => s.id));
  if (!saleIds.size) return { success: true as const, data: [] };

  const items = await db.select().from(saleItems);
  const byProduct = new Map<string, { name: string; qty: number; revenue: number }>();

  for (const item of items) {
    if (!saleIds.has(item.saleId)) continue;
    const existing = byProduct.get(item.productId) ?? {
      name: item.productName,
      qty: 0,
      revenue: 0,
    };
    existing.qty += item.quantity;
    existing.revenue += item.lineTotal;
    byProduct.set(item.productId, existing);
  }

  const data = [...byProduct.entries()]
    .map(([productId, v]) => ({
      productId,
      productName: v.name,
      quantitySold: v.qty,
      revenue: v.revenue,
    }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, limit);

  return { success: true as const, data };
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
