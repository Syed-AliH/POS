import { and, desc, eq, gte, inArray, lt, sql, type SQL } from 'drizzle-orm';
import {
  categories,
  expenses,
  grnHeaders,
  grnLines,
  products,
  returnItems,
  returns,
  saleItems,
  sales,
  shifts,
} from '@mama-babi/db-pg';
import type { PostgresClient } from '@mama-babi/db-pg';
import { coerceReportDateRange, isoRangeBounds } from '../lib/reportDateRange';
import { buildSaleSummary } from './sales.service';
import { countedExpense, getExpenseTotalsByDay } from './expenses.service';

/**
 * Sale statuses every report counts. A sale flips to `returned` as soon as any return
 * is processed against it — even one item out of ten — but the sale still happened.
 * The refund is booked separately, on the return's own date, from the returns table.
 * Filtering on `completed` alone made the whole bill vanish from revenue, profit and
 * the cash count the moment a single item came back.
 */
const REPORTABLE_SALE_STATUSES: Array<'completed' | 'returned'> = ['completed', 'returned'];

function completedSalesDateFilter(params?: { startDate?: string; endDate?: string }) {
  const range = coerceReportDateRange(params);
  const { startInclusive, endExclusive } = isoRangeBounds(range);
  return and(
    inArray(sales.status, REPORTABLE_SALE_STATUSES),
    gte(sales.createdAt, startInclusive),
    lt(sales.createdAt, endExclusive),
  );
}

function returnsDateFilter(params?: { startDate?: string; endDate?: string }) {
  const range = coerceReportDateRange(params);
  const { startInclusive, endExclusive } = isoRangeBounds(range);
  return and(gte(returns.createdAt, startInclusive), lt(returns.createdAt, endExclusive));
}

/** Postgres hands back sums of integers as strings; normalise every aggregate. */
const num = (value: unknown) => Number(value ?? 0);

/**
 * How a bill's total divides across payment methods. A 'split' bill is part cash,
 * part card/online; everything else goes wholly to its one method. Every per-method
 * figure — payment breakdown, EOD cash/card/online, expected cash — goes through
 * this (or paymentTotalsByMethod, its SQL twin), so a split bill's cash never shows
 * up as card or vice versa. Desktop ipc/reports.ts has the same function.
 */
export function paymentShares(sale: {
  paymentMethod: string;
  totalAmount: number;
  splitCashAmount?: number | null;
  splitOtherMethod?: string | null;
}): Array<{ method: string; amount: number }> {
  if (sale.paymentMethod === 'split') {
    const cash = sale.splitCashAmount ?? 0;
    return [
      { method: 'cash', amount: cash },
      { method: sale.splitOtherMethod ?? 'card', amount: sale.totalAmount - cash },
    ];
  }
  return [{ method: sale.paymentMethod, amount: sale.totalAmount }];
}

function shareFor(rows: Parameters<typeof paymentShares>[0][], method: string): number {
  let total = 0;
  for (const row of rows) for (const share of paymentShares(row)) if (share.method === method) total += share.amount;
  return total;
}

/**
 * Takings per payment method, split bills divided between their two methods. `count`
 * is bills that used the method, so a split bill appears under both — the bill count
 * for a period comes from transactionCount, not from summing these.
 */
async function paymentTotalsByMethod(db: PostgresClient, params?: { startDate?: string; endDate?: string }) {
  const filter = completedSalesDateFilter(params);
  const result = await db.execute(sql`
    select method, coalesce(sum(amount), 0) as total, count(*)::int as count
    from (
      select case when ${sales.paymentMethod} = 'split' then 'cash' else ${sales.paymentMethod} end as method,
             case when ${sales.paymentMethod} = 'split' then coalesce(${sales.splitCashAmount}, 0) else ${sales.totalAmount} end as amount
      from ${sales} where ${filter}
      union all
      select coalesce(${sales.splitOtherMethod}, 'card') as method,
             ${sales.totalAmount} - coalesce(${sales.splitCashAmount}, 0) as amount
      from ${sales} where ${sales.paymentMethod} = 'split' and ${filter}
    ) as shares
    group by method
  `);
  const rows = (result as unknown as { rows: Array<{ method: string; total: unknown; count: unknown }> }).rows;
  return rows.map((r) => ({ paymentMethod: r.method, total: num(r.total), count: num(r.count) }));
}

/** Only cash refunds leave the drawer — store credit and loyalty refunds don't. */
function cashRefundTotal(rows: Array<{ refundMethod: string; totalRefund: number }>): number {
  return rows.filter((r) => r.refundMethod === 'cash').reduce((sum, r) => sum + r.totalRefund, 0);
}

/**
 * Net revenue and cost of goods, optionally split by a grouping expression. Every
 * backend computes profit this way (desktop ipc/reports.ts, owner-portal
 * api/_lib/reports.ts) — keep them in step.
 *
 * A return reverses exactly what the sale added, on the date it happens:
 * - a return line on a bill (negative quantity) carries a negative total and a
 *   negative cost, because the unit goes back on the shelf;
 * - a Returns-screen refund takes its refund off revenue, and its cost off cost of
 *   goods only when the item was restocked — a damaged item that is written off
 *   stays a cost, so profit drops by the full refund.
 * So returning an item takes back the margin it earned, not its whole price.
 *
 * Bill-level discounts (manual, promo code, loyalty) live on the sale, not the lines,
 * and come off revenue too. Cost is the product's *current* cost price — it is not
 * stored per sale line.
 */
async function profitByKey(
  db: PostgresClient,
  params: { startDate?: string; endDate?: string } | undefined,
  /** Grouping expressions (e.g. the day); omit both for a single 'all' total. */
  keys?: { sale: SQL<string>; return: SQL<string> },
) {
  // Postgres rejects a constant in GROUP BY, so the ungrouped total skips it entirely.
  const saleKey = keys?.sale ?? sql<string>`'all'`;
  const returnKey = keys?.return ?? sql<string>`'all'`;
  const saleGroup = keys ? [keys.sale] : [];
  const returnGroup = keys ? [keys.return] : [];
  const [saleRows, lineRows, returnRows] = await Promise.all([
    db
      .select({
        key: saleKey,
        txnCount: sql<number>`count(*)::int`,
        discounts: sql<number>`coalesce(sum(${sales.discountAmount}), 0)`,
        billTotals: sql<number>`coalesce(sum(${sales.totalAmount}), 0)`,
      })
      .from(sales)
      .where(completedSalesDateFilter(params))
      .groupBy(...saleGroup),
    db
      .select({
        key: saleKey,
        lineTotal: sql<number>`coalesce(sum(${saleItems.lineTotal}), 0)`,
        cost: sql<number>`coalesce(sum(${saleItems.quantity} * coalesce(${products.costPrice}, 0)), 0)`,
      })
      .from(saleItems)
      .innerJoin(sales, eq(sales.id, saleItems.saleId))
      .leftJoin(products, eq(products.id, saleItems.productId))
      .where(completedSalesDateFilter(params))
      .groupBy(...saleGroup),
    db
      .select({
        key: returnKey,
        refunds: sql<number>`coalesce(sum(${returnItems.qtyReturned} * ${returnItems.unitRefund}), 0)`,
        restockedCost: sql<number>`coalesce(sum(case when ${returnItems.restocked}
          then ${returnItems.qtyReturned} * coalesce(${products.costPrice}, 0) else 0 end), 0)`,
      })
      .from(returnItems)
      .innerJoin(returns, eq(returns.id, returnItems.returnId))
      .leftJoin(products, eq(products.id, returnItems.productId))
      .where(returnsDateFilter(params))
      .groupBy(...returnGroup),
  ]);

  const byKey = new Map<string, { revenue: number; estimatedCost: number; transactionCount: number; totalSales: number }>();
  const entry = (key: string) => {
    const existing = byKey.get(key) ?? { revenue: 0, estimatedCost: 0, transactionCount: 0, totalSales: 0 };
    byKey.set(key, existing);
    return existing;
  };
  for (const r of saleRows) {
    const e = entry(r.key);
    e.transactionCount += num(r.txnCount);
    e.totalSales += num(r.billTotals);
    e.revenue -= num(r.discounts);
  }
  for (const r of lineRows) {
    const e = entry(r.key);
    e.revenue += num(r.lineTotal);
    e.estimatedCost += num(r.cost);
  }
  for (const r of returnRows) {
    const e = entry(r.key);
    e.revenue -= num(r.refunds);
    e.estimatedCost -= num(r.restockedCost);
  }
  return byKey;
}

export async function getOwnerDashboard(
  db: PostgresClient,
  params?: { startDate?: string; endDate?: string },
) {
  const range = coerceReportDateRange(params);
  const [paymentBreakdown, profit] = await Promise.all([
    paymentTotalsByMethod(db, range),
    getProfitReport(db, params),
  ]);

  const totalSales = profit.data.totalSales;
  // Bills, not payment rows — a split bill appears under two methods.
  const transactionCount = profit.data.transactionCount;
  const averageSale = transactionCount > 0 ? totalSales / transactionCount : 0;

  return {
    success: true as const,
    data: {
      startDate: range.startDate,
      endDate: range.endDate,
      totalSales,
      transactionCount,
      averageSale,
      estimatedCost: profit.data.estimatedCost,
      grossProfit: profit.data.grossProfit,
      marginPercent: profit.data.marginPercent,
      returnsTotal: profit.data.returnsTotal,
      paymentBreakdown,
    },
  };
}

export async function listOwnerSales(
  db: PostgresClient,
  params?: { startDate?: string; endDate?: string; limit?: number; search?: string },
) {
  const range = coerceReportDateRange(params);
  const limit = Math.min(params?.limit ?? 100, 500);

  const conditions = [completedSalesDateFilter(range)];
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

/** Units and revenue per product, net of Returns-screen refunds in the same period. */
async function netSalesByProduct(db: PostgresClient, params?: { startDate?: string; endDate?: string }) {
  const [soldRows, returnedRows] = await Promise.all([
    db
      .select({
        productId: saleItems.productId,
        productName: sql<string>`min(${saleItems.productName})`,
        categoryId: sql<string | null>`min(${products.categoryId})`,
        qty: sql<number>`coalesce(sum(${saleItems.quantity}), 0)`,
        revenue: sql<number>`coalesce(sum(${saleItems.lineTotal}), 0)`,
      })
      .from(saleItems)
      .innerJoin(sales, eq(sales.id, saleItems.saleId))
      .leftJoin(products, eq(products.id, saleItems.productId))
      .where(completedSalesDateFilter(params))
      .groupBy(saleItems.productId),
    db
      .select({
        productId: returnItems.productId,
        productName: sql<string | null>`min(${products.name})`,
        categoryId: sql<string | null>`min(${products.categoryId})`,
        qty: sql<number>`coalesce(sum(${returnItems.qtyReturned}), 0)`,
        refunds: sql<number>`coalesce(sum(${returnItems.qtyReturned} * ${returnItems.unitRefund}), 0)`,
      })
      .from(returnItems)
      .innerJoin(returns, eq(returns.id, returnItems.returnId))
      .leftJoin(products, eq(products.id, returnItems.productId))
      .where(returnsDateFilter(params))
      .groupBy(returnItems.productId),
  ]);

  const byProduct = new Map<string, { name: string; categoryId: string | null; qty: number; revenue: number }>();
  for (const r of soldRows) {
    byProduct.set(r.productId, {
      name: r.productName,
      categoryId: r.categoryId ?? null,
      qty: num(r.qty),
      revenue: num(r.revenue),
    });
  }
  for (const r of returnedRows) {
    const existing = byProduct.get(r.productId) ?? {
      name: r.productName ?? 'Unknown',
      categoryId: r.categoryId ?? null,
      qty: 0,
      revenue: 0,
    };
    existing.qty -= num(r.qty);
    existing.revenue -= num(r.refunds);
    byProduct.set(r.productId, existing);
  }
  return byProduct;
}

export async function getTopProducts(
  db: PostgresClient,
  params?: { startDate?: string; endDate?: string; limit?: number },
) {
  const range = coerceReportDateRange(params);
  const limit = Math.min(params?.limit ?? 10, 50);
  // Net of returns, so a product that mostly comes back doesn't rank as a best seller.
  const byProduct = await netSalesByProduct(db, range);

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

export async function getDailySales(
  db: PostgresClient,
  params?: { startDate?: string; endDate?: string },
) {
  const range = coerceReportDateRange(params);
  const [row] = await db
    .select({
      totalSales: sql<number>`coalesce(sum(${sales.totalAmount}), 0)`,
      transactionCount: sql<number>`count(*)::int`,
    })
    .from(sales)
    .where(completedSalesDateFilter(range));
  return {
    success: true as const,
    data: {
      totalSales: num(row?.totalSales),
      transactionCount: num(row?.transactionCount),
    },
  };
}

export async function getSalesByCategory(
  db: PostgresClient,
  params?: { startDate?: string; endDate?: string },
) {
  const range = coerceReportDateRange(params);
  const [byProduct, categoryRows] = await Promise.all([
    netSalesByProduct(db, range),
    db.select({ id: categories.id, name: categories.name }).from(categories),
  ]);
  if (!byProduct.size) return { success: true as const, data: [] };
  const categoryMap = new Map(categoryRows.map((c) => [c.id, c.name]));

  const byCategory = new Map<string | null, { name: string; total: number; count: number }>();
  for (const v of byProduct.values()) {
    const catId = v.categoryId;
    const existing = byCategory.get(catId) ?? {
      name: (catId && categoryMap.get(catId)) || 'Uncategorized',
      total: 0,
      count: 0,
    };
    existing.total += v.revenue;
    existing.count += v.qty;
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
  return { success: true as const, data: await paymentTotalsByMethod(db, range) };
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
  const dayReturns = await db.select().from(returns).where(returnsDateFilter(range));
  // Same counting rule as the Expenses tab and the portal (see countedExpense).
  const dayExpenses = await db
    .select()
    .from(expenses)
    .where(
      and(
        countedExpense(),
        gte(expenses.createdAt, startInclusive),
        lt(expenses.createdAt, endExclusive),
      ),
    );

  // A split bill's cash share is drawer cash; its card/online share is not.
  const cashSales = shareFor(daySales, 'cash');
  const cardSales = shareFor(daySales, 'card');
  const onlineSales = shareFor(daySales, 'online');
  const walletSales = shareFor(daySales, 'wallet');
  const returnsTotal = dayReturns.reduce((sum, r) => sum + r.totalRefund, 0);
  const expensesTotal = dayExpenses.reduce((sum, e) => sum + e.amount, 0);

  const openShifts = await db.select().from(shifts).where(eq(shifts.status, 'open'));
  const openingFloat = openShifts.reduce((sum, s) => sum + s.openingFloat, 0);
  const expectedCash = openingFloat + cashSales - cashRefundTotal(dayReturns);

  return {
    success: true as const,
    data: {
      date: periodLabel,
      totalSales: daySales.reduce((sum, s) => sum + s.totalAmount, 0),
      transactionCount: daySales.length,
      cashSales,
      cardSales,
      onlineSales,
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
  const [byKey, [returnRow]] = await Promise.all([
    profitByKey(db, range),
    db
      .select({ total: sql<number>`coalesce(sum(${returns.totalRefund}), 0)` })
      .from(returns)
      .where(returnsDateFilter(range)),
  ]);
  const totals = byKey.get('all') ?? { revenue: 0, estimatedCost: 0, transactionCount: 0, totalSales: 0 };

  const grossProfit = totals.revenue - totals.estimatedCost;
  return {
    success: true as const,
    data: {
      revenue: totals.revenue,
      estimatedCost: totals.estimatedCost,
      grossProfit,
      marginPercent: totals.revenue > 0 ? (grossProfit / totals.revenue) * 100 : 0,
      transactionCount: totals.transactionCount,
      returnsTotal: num(returnRow?.total),
      // What the bills came to — the "Sales" figure on every screen, desktop and
      // portal alike. `revenue` above is the profit basis (net of returns), a
      // different number; showing it as "Sales" is what made October read
      // Rs 395,479 on the till against Rs 381,738 on the portal.
      totalSales: totals.totalSales,
    },
  };
}

/** Daily sales/profit points for the trend chart. One row per calendar day with sales, returns or expenses. */
export async function getSalesTrend(
  db: PostgresClient,
  params?: { startDate?: string; endDate?: string },
) {
  const range = coerceReportDateRange(params);

  // A sale counts on the day it was rung up; a Returns-screen refund on the day it
  // was processed — so a return-only day shows the margin it took back.
  const [byDay, expensesByDay] = await Promise.all([
    profitByKey(db, range, {
      sale: sql<string>`left(${sales.createdAt}, 10)`,
      return: sql<string>`left(${returns.createdAt}, 10)`,
    }),
    getExpenseTotalsByDay(db, params),
  ]);

  // A day can have cash expenses with no sales at all (shop closed, rent still due) —
  // it still needs a row so the expense shows up on the chart.
  for (const day of expensesByDay.keys()) {
    if (!byDay.has(day)) byDay.set(day, { revenue: 0, estimatedCost: 0, transactionCount: 0, totalSales: 0 });
  }

  const data = [...byDay.entries()]
    .map(([date, v]) => ({
      date,
      // What the day's bills came to — Day Close compares the cashier's count to it.
      totalSales: v.totalSales,
      revenue: v.revenue,
      estimatedCost: v.estimatedCost,
      grossProfit: v.revenue - v.estimatedCost,
      transactionCount: v.transactionCount,
      // Cash paid out that day (approved expenses) — a separate concern from sales
      // profit, tracked side by side rather than folded into it.
      cashExpenses: expensesByDay.get(date) ?? 0,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return { success: true as const, data };
}

type InventoryStockFilter = 'all' | 'negative' | 'zero' | 'low';

async function getLastGrnDateByProduct(db: PostgresClient): Promise<Map<string, string>> {
  const rows = await db
    .select({
      productId: grnLines.productId,
      lastDate: sql<string>`max(coalesce(${grnHeaders.receivedDate}, left(${grnHeaders.createdAt}, 10)))`,
    })
    .from(grnLines)
    .innerJoin(grnHeaders, eq(grnHeaders.id, grnLines.grnId))
    .where(eq(grnHeaders.status, 'finalized'))
    .groupBy(grnLines.productId);
  return new Map(rows.map((r) => [r.productId, r.lastDate]));
}

export async function getInventoryReport(
  db: PostgresClient,
  params?: { search?: string; categoryId?: string; stockFilter?: InventoryStockFilter },
) {
  const [lastGrnDates, categoryRows, allActive] = await Promise.all([
    getLastGrnDateByProduct(db),
    db.select().from(categories).where(eq(categories.isDeleted, false)),
    db
      .select()
      .from(products)
      .where(and(eq(products.isDeleted, false), eq(products.status, 'active'))),
  ]);
  const categoryMap = new Map(categoryRows.map((c) => [c.id, c.name]));

  let rows = allActive;
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
