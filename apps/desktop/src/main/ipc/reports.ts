import { and, eq, inArray } from 'drizzle-orm';
import {
  categories,
  grnHeaders,
  grnLines,
  products,
  returnItems,
  returns,
  saleItems,
  sales,
} from '@mama-babi/db-schema';
import type {
  ApiResult,
  InventoryReportParams,
  InventoryReportRow,
  InventoryReportSummary,
  InventoryValuation,
  PaymentBreakdownRow,
  ProfitReport,
  ReportDateRange,
  SalesByCategoryRow,
  TopProductRow,
} from '@shared/types';
import { getDb } from '../db';
import { createdAtInLocalRange } from '../lib/reportDateRange';
import { requireRole } from '../session';

/**
 * Sale statuses every report counts. A sale flips to `returned` as soon as any return
 * is processed against it — even one item out of ten — but the sale still happened.
 * The refund is booked separately, on the return's own date, from the returns table.
 * Filtering on `completed` alone made the whole bill vanish from revenue, profit and
 * the cash count the moment a single item came back.
 */
export const REPORTABLE_SALE_STATUSES = ['completed', 'returned'] as const;

/**
 * How a bill's total divides across payment methods: a 'split' bill is part cash,
 * part card/online; anything else goes wholly to its one method. Every per-method
 * figure (payment breakdown, EOD, shift cash) goes through this — same as
 * paymentShares in apps/api reports.service.ts.
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

export function shareFor(rows: Parameters<typeof paymentShares>[0][], method: string): number {
  let total = 0;
  for (const row of rows) for (const share of paymentShares(row)) if (share.method === method) total += share.amount;
  return total;
}

export function reportableSalesFilter() {
  return inArray(sales.status, [...REPORTABLE_SALE_STATUSES]);
}

function completedSalesInRange(params?: ReportDateRange | string) {
  const db = getDb();
  return db
    .select()
    .from(sales)
    .where(and(reportableSalesFilter(), createdAtInLocalRange(sales.createdAt, params)))
    .all();
}

/** Sale lines in the period, with the product's current cost and category. */
function saleLinesInRange(params?: ReportDateRange | string) {
  const db = getDb();
  return db
    .select({
      productId: saleItems.productId,
      productName: saleItems.productName,
      quantity: saleItems.quantity,
      lineTotal: saleItems.lineTotal,
      costPrice: products.costPrice,
      categoryId: products.categoryId,
    })
    .from(saleItems)
    .innerJoin(sales, eq(sales.id, saleItems.saleId))
    .leftJoin(products, eq(products.id, saleItems.productId))
    .where(and(reportableSalesFilter(), createdAtInLocalRange(sales.createdAt, params)))
    .all();
}

/** Items handed back through the Returns screen in the period (booked on the return date). */
function returnedLinesInRange(params?: ReportDateRange | string) {
  const db = getDb();
  return db
    .select({
      productId: returnItems.productId,
      productName: products.name,
      qtyReturned: returnItems.qtyReturned,
      unitRefund: returnItems.unitRefund,
      restocked: returnItems.restocked,
      costPrice: products.costPrice,
      categoryId: products.categoryId,
    })
    .from(returnItems)
    .innerJoin(returns, eq(returns.id, returnItems.returnId))
    .leftJoin(products, eq(products.id, returnItems.productId))
    .where(createdAtInLocalRange(returns.createdAt, params))
    .all();
}

function returnsInRange(params?: ReportDateRange | string) {
  const db = getDb();
  return db
    .select()
    .from(returns)
    .where(createdAtInLocalRange(returns.createdAt, params))
    .all();
}

export function handleDailySales(params?: ReportDateRange | string): ApiResult<{ totalSales: number; transactionCount: number }> {
  try {
    requireRole('super_admin', 'manager');
    const rows = completedSalesInRange(params);
    return {
      success: true,
      data: { totalSales: rows.reduce((sum, r) => sum + r.totalAmount, 0), transactionCount: rows.length },
    };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Report failed' };
  }
}

export function handleSalesByCategory(params?: ReportDateRange): ApiResult<SalesByCategoryRow[]> {
  try {
    requireRole('super_admin', 'manager');
    const db = getDb();
    const categoryMap = new Map(db.select().from(categories).all().map((c) => [c.id, c.name]));
    const byCategory = new Map<string | null, { name: string; total: number; count: number }>();
    const bucket = (catId: string | null) => {
      const existing = byCategory.get(catId) ?? {
        name: (catId && categoryMap.get(catId)) || 'Uncategorized',
        total: 0,
        count: 0,
      };
      byCategory.set(catId, existing);
      return existing;
    };

    // Signed: a return line on a bill already carries a negative quantity and total.
    for (const line of saleLinesInRange(params)) {
      const row = bucket(line.categoryId ?? null);
      row.total += line.lineTotal;
      row.count += line.quantity;
    }
    for (const line of returnedLinesInRange(params)) {
      const row = bucket(line.categoryId ?? null);
      row.total -= line.qtyReturned * line.unitRefund;
      row.count -= line.qtyReturned;
    }

    return {
      success: true,
      data: [...byCategory.entries()].map(([categoryId, v]) => ({
        categoryId,
        categoryName: v.name,
        totalSales: v.total,
        itemCount: v.count,
      })),
    };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Report failed' };
  }
}

export function handleTopProducts(params?: ReportDateRange & { limit?: number }): ApiResult<TopProductRow[]> {
  try {
    requireRole('super_admin', 'manager');
    const limit = params?.limit ?? 10;

    // Net of returns, so a product that mostly comes back doesn't rank as a best seller.
    const byProduct = new Map<string, { name: string; qty: number; revenue: number }>();
    for (const line of saleLinesInRange(params)) {
      const existing = byProduct.get(line.productId) ?? { name: line.productName, qty: 0, revenue: 0 };
      existing.qty += line.quantity;
      existing.revenue += line.lineTotal;
      byProduct.set(line.productId, existing);
    }
    for (const line of returnedLinesInRange(params)) {
      const existing = byProduct.get(line.productId) ?? { name: line.productName ?? 'Unknown', qty: 0, revenue: 0 };
      existing.qty -= line.qtyReturned;
      existing.revenue -= line.qtyReturned * line.unitRefund;
      byProduct.set(line.productId, existing);
    }

    const rows = [...byProduct.entries()]
      .map(([productId, v]) => ({
        productId,
        productName: v.name,
        quantitySold: v.qty,
        revenue: v.revenue,
      }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, limit);

    return { success: true, data: rows };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Report failed' };
  }
}

export function handlePaymentBreakdown(params?: ReportDateRange): ApiResult<PaymentBreakdownRow[]> {
  try {
    requireRole('super_admin', 'manager');
    const rows = completedSalesInRange(params);

    // A split bill adds its cash share to cash and the rest to card/online, and
    // counts as a bill under both.
    const byMethod = new Map<string, { total: number; count: number }>();
    for (const sale of rows) {
      for (const share of paymentShares(sale)) {
        const existing = byMethod.get(share.method) ?? { total: 0, count: 0 };
        existing.total += share.amount;
        existing.count += 1;
        byMethod.set(share.method, existing);
      }
    }

    return {
      success: true,
      data: [...byMethod.entries()].map(([paymentMethod, v]) => ({
        paymentMethod,
        total: v.total,
        count: v.count,
      })),
    };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Report failed' };
  }
}

export function handleInventoryValuation(): ApiResult<InventoryValuation> {
  try {
    requireRole('super_admin', 'manager');
    const db = getDb();
    const rows = db
      .select()
      .from(products)
      .where(and(eq(products.isDeleted, false), eq(products.status, 'active')))
      .all();

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
      success: true,
      data: {
        totalUnits,
        totalCostValue,
        totalRetailValue,
        productCount: rows.length,
        negativeStockCount: negativeStockItems.length,
        negativeStockItems,
      },
    };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Report failed' };
  }
}

function getLastGrnDateByProduct(): Map<string, string> {
  const db = getDb();
  const map = new Map<string, string>();
  const lines = db
    .select({
      productId: grnLines.productId,
      receivedDate: grnHeaders.receivedDate,
      createdAt: grnHeaders.createdAt,
    })
    .from(grnLines)
    .innerJoin(grnHeaders, eq(grnHeaders.id, grnLines.grnId))
    .where(eq(grnHeaders.status, 'finalized'))
    .all();
  for (const line of lines) {
    const existing = map.get(line.productId);
    const candidate = line.receivedDate ?? line.createdAt.slice(0, 10);
    if (!existing || candidate > existing) {
      map.set(line.productId, candidate);
    }
  }
  return map;
}

export function handleInventoryReport(params?: InventoryReportParams): ApiResult<InventoryReportSummary> {
  try {
    requireRole('super_admin', 'manager');
    const db = getDb();
    const lastGrnDates = getLastGrnDateByProduct();
    const categoryRows = db.select().from(categories).all();
    const categoryMap = new Map(categoryRows.map((c) => [c.id, c.name]));

    let rows = db
      .select()
      .from(products)
      .where(and(eq(products.isDeleted, false), eq(products.status, 'active')))
      .all();

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
    else if (stockFilter === 'low') rows = rows.filter((p) => p.stockQty > 0 && p.stockQty <= p.reorderLevel);

    const reportRows: InventoryReportRow[] = rows.map((p) => ({
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
    }));

    reportRows.sort((a, b) => a.productName.localeCompare(b.productName));

    const allActive = db
      .select()
      .from(products)
      .where(and(eq(products.isDeleted, false), eq(products.status, 'active')))
      .all();

    return {
      success: true,
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
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Inventory report failed' };
  }
}

/**
 * Net revenue and cost of goods for a period. Every backend computes profit this way
 * (cloud reports.service.ts, owner-portal api/_lib/reports.ts) — keep them in step.
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
function profitTotalsInRange(params?: ReportDateRange) {
  const saleRows = completedSalesInRange(params);
  let revenue = -saleRows.reduce((sum, s) => sum + s.discountAmount, 0);
  let estimatedCost = 0;
  for (const line of saleLinesInRange(params)) {
    revenue += line.lineTotal;
    estimatedCost += line.quantity * (line.costPrice ?? 0);
  }
  for (const line of returnedLinesInRange(params)) {
    revenue -= line.qtyReturned * line.unitRefund;
    if (line.restocked) estimatedCost -= line.qtyReturned * (line.costPrice ?? 0);
  }
  return {
    revenue,
    estimatedCost,
    transactionCount: saleRows.length,
    totalSales: saleRows.reduce((sum, s) => sum + s.totalAmount, 0),
  };
}

export function handleProfitReport(params?: ReportDateRange): ApiResult<ProfitReport> {
  try {
    requireRole('super_admin', 'manager');
    const { revenue, estimatedCost, transactionCount, totalSales } = profitTotalsInRange(params);
    const returnsTotal = returnsInRange(params).reduce((sum, r) => sum + r.totalRefund, 0);
    const grossProfit = revenue - estimatedCost;
    return {
      success: true,
      data: {
        revenue,
        estimatedCost,
        grossProfit,
        marginPercent: revenue > 0 ? (grossProfit / revenue) * 100 : 0,
        transactionCount,
        returnsTotal,
        totalSales,
      },
    };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Report failed' };
  }
}
