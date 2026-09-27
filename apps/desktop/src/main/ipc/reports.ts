import { and, eq } from 'drizzle-orm';
import {
  categories,
  grnHeaders,
  grnLines,
  products,
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

function completedSalesInRange(params?: ReportDateRange | string) {
  const db = getDb();
  return db
    .select()
    .from(sales)
    .where(and(eq(sales.status, 'completed'), createdAtInLocalRange(sales.createdAt, params)))
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
    const completedSales = completedSalesInRange(params);
    const saleIds = new Set(completedSales.map((s) => s.id));
    if (!saleIds.size) return { success: true, data: [] };

    const byCategory = new Map<string | null, { name: string; total: number; count: number }>();

    for (const item of db.select().from(saleItems).all()) {
      if (!saleIds.has(item.saleId)) continue;
      const product = db.select().from(products).where(eq(products.id, item.productId)).get();
      const catId = product?.categoryId ?? null;
      const cat = catId ? db.select().from(categories).where(eq(categories.id, catId)).get() : null;
      const existing = byCategory.get(catId) ?? { name: cat?.name ?? 'Uncategorized', total: 0, count: 0 };
      existing.total += item.lineTotal;
      existing.count += item.quantity;
      byCategory.set(catId, existing);
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
    const db = getDb();
    const limit = params?.limit ?? 10;
    const completedSales = completedSalesInRange(params);
    const saleIds = new Set(completedSales.map((s) => s.id));

    const byProduct = new Map<string, { name: string; qty: number; revenue: number }>();
    for (const item of db.select().from(saleItems).all()) {
      if (!saleIds.has(item.saleId)) continue;
      const existing = byProduct.get(item.productId) ?? { name: item.productName, qty: 0, revenue: 0 };
      existing.qty += item.quantity;
      existing.revenue += item.lineTotal;
      byProduct.set(item.productId, existing);
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

    const byMethod = new Map<string, { total: number; count: number }>();
    for (const sale of rows) {
      const existing = byMethod.get(sale.paymentMethod) ?? { total: 0, count: 0 };
      existing.total += sale.totalAmount;
      existing.count += 1;
      byMethod.set(sale.paymentMethod, existing);
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
  const lines = db.select().from(grnLines).all();
  for (const line of lines) {
    const header = db.select().from(grnHeaders).where(eq(grnHeaders.id, line.grnId)).get();
    if (!header || header.status !== 'finalized') continue;
    const existing = map.get(line.productId);
    const candidate = header.receivedDate ?? header.createdAt.slice(0, 10);
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

export function handleProfitReport(params?: ReportDateRange): ApiResult<ProfitReport> {
  try {
    requireRole('super_admin', 'manager');
    const db = getDb();
    const completedSales = completedSalesInRange(params);
    const saleIds = new Set(completedSales.map((s) => s.id));
    const returnsTotal = returnsInRange(params).reduce((sum, r) => sum + r.totalRefund, 0);

    // A returned line (negative quantity) comes back to stock undamaged — it must not
    // drag profit into a loss. Only positive-quantity lines count toward revenue and
    // cost; a return's own contribution is 0, not negative, while any other line in
    // the same or a different sale is still counted normally.
    let revenue = 0;
    let estimatedCost = 0;
    for (const item of db.select().from(saleItems).all()) {
      if (!saleIds.has(item.saleId) || item.quantity <= 0) continue;
      const product = db.select().from(products).where(eq(products.id, item.productId)).get();
      revenue += item.lineTotal;
      estimatedCost += item.quantity * (product?.costPrice ?? 0);
    }

    const grossProfit = revenue - estimatedCost;
    return {
      success: true,
      data: {
        revenue,
        estimatedCost,
        grossProfit,
        marginPercent: revenue > 0 ? (grossProfit / revenue) * 100 : 0,
        transactionCount: completedSales.length,
        returnsTotal,
      },
    };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Report failed' };
  }
}
