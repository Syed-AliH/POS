import { desc, eq } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import {
  inventoryMovements,
  products,
  returnItems,
  returns,
  saleItems,
  sales,
  settings,
} from '@mama-babi/db-schema';
import type { ApiResult, CreateReturnInput, ReturnListParams, ReturnSummary, SaleSummary } from '@shared/types';
import { getDb } from '../db';
import { requireSession } from '../session';
import { logAudit } from '../services/audit';
import { getSetting } from '../services/settings';
import { coerceReportDateRange, localCalendarDate } from '../lib/reportDateRange';
import { buildSaleSummary } from './sales';

function buildReturnSummary(returnId: string): ReturnSummary | null {
  const db = getDb();
  const ret = db.select().from(returns).where(eq(returns.id, returnId)).get();
  if (!ret) return null;

  const saleRecord = db.select().from(sales).where(eq(sales.id, ret.saleId)).get();
  const items = db.select().from(returnItems).where(eq(returnItems.returnId, returnId)).all();

  return {
    id: ret.id,
    returnNumber: ret.returnNumber,
    saleId: ret.saleId,
    saleNumber: saleRecord?.saleNumber ?? '',
    reason: ret.reason,
    refundMethod: ret.refundMethod,
    totalRefund: ret.totalRefund,
    status: ret.status,
    processedBy: ret.processedBy,
    createdAt: ret.createdAt,
    items: items.map((i) => {
      const saleItem = db.select().from(saleItems).where(eq(saleItems.id, i.saleItemId)).get();
      return {
        productName: saleItem?.productName ?? '',
        qtyReturned: i.qtyReturned,
        unitRefund: i.unitRefund,
        restocked: i.restocked,
      };
    }),
  };
}

function incrementReturnCounter(): string {
  const db = getDb();
  const year = new Date().getFullYear();
  const key = 'return_counter';
  const current = parseInt(getSetting(key) ?? '0', 10) + 1;
  const now = new Date().toISOString();
  db.update(settings).set({ value: String(current), updatedAt: now }).where(eq(settings.key, key)).run();
  return `RT-${year}-${String(current).padStart(6, '0')}`;
}

export function handleReturnCreate(input: CreateReturnInput): ApiResult<ReturnSummary> {
  try {
    const session = requireSession();
    const db = getDb();
    const now = new Date().toISOString();
    const deviceId = getSetting('device_id') ?? 'local-device';
    const branchId = getSetting('branch_id') ?? 'main';

    const sale = db.select().from(sales).where(eq(sales.saleNumber, input.saleNumber)).get();
    if (!sale) return { success: false, error: 'Sale not found' };
    if (sale.status !== 'completed') return { success: false, error: 'Sale cannot be returned' };

    const policyDays = parseInt(getSetting('return_policy_days') ?? '7', 10);
    const daysSince = (Date.now() - new Date(sale.createdAt).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSince > policyDays) {
      return { success: false, error: `Return policy expired (${policyDays} days)` };
    }

    const returnId = uuid();
    const returnNumber = incrementReturnCounter();
    let totalRefund = 0;

    db.transaction((tx) => {
      for (const item of input.items) {
        const saleItem = tx.select().from(saleItems).where(eq(saleItems.id, item.saleItemId)).get();
        if (!saleItem || saleItem.saleId !== sale.id) continue;
        if (item.qtyReturned > saleItem.quantity) {
          throw new Error(`Cannot return more than purchased for ${saleItem.productName}`);
        }

        const unitRefund = saleItem.lineTotal / saleItem.quantity;
        totalRefund += unitRefund * item.qtyReturned;

        tx.insert(returnItems).values({
          id: uuid(),
          returnId,
          saleItemId: item.saleItemId,
          productId: saleItem.productId,
          qtyReturned: item.qtyReturned,
          restocked: item.restocked !== false,
          unitRefund,
          deviceId,
          branchId,
          createdAt: now,
          updatedAt: now,
        }).run();

        if (item.restocked !== false) {
          const product = tx.select().from(products).where(eq(products.id, saleItem.productId)).get()!;
          tx.update(products)
            .set({ stockQty: product.stockQty + item.qtyReturned, updatedAt: now })
            .where(eq(products.id, saleItem.productId))
            .run();

          tx.insert(inventoryMovements).values({
            id: uuid(),
            productId: saleItem.productId,
            type: 'return',
            qtyChange: item.qtyReturned,
            referenceId: returnId,
            notes: `Return ${returnNumber}`,
            deviceId,
            branchId,
            createdAt: now,
            updatedAt: now,
          }).run();
        }
      }

      tx.insert(returns).values({
        id: returnId,
        returnNumber,
        saleId: sale.id,
        reason: input.reason,
        refundMethod: input.refundMethod,
        status: 'completed',
        totalRefund,
        processedBy: session.id,
        deviceId,
        branchId,
        createdAt: now,
        updatedAt: now,
      }).run();

      tx.update(sales).set({ status: 'returned', updatedAt: now }).where(eq(sales.id, sale.id)).run();
    });

    logAudit('returns', 'create', returnId, undefined, { returnNumber, totalRefund });
    const summary = buildReturnSummary(returnId);
    if (!summary) return { success: false, error: 'Failed to load return' };
    return { success: true, data: summary };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Return failed' };
  }
}

export function handleReturnList(params?: ReturnListParams): ApiResult<ReturnSummary[]> {
  try {
    requireSession();
    const db = getDb();
    const limit = params?.limit ?? 50;
    let rows = db.select().from(returns).orderBy(desc(returns.createdAt)).limit(limit * 5).all();

    if (params?.startDate || params?.endDate) {
      const { startDate, endDate } = coerceReportDateRange({
        startDate: params.startDate,
        endDate: params.endDate,
      });
      rows = rows.filter((r) => {
        const day = localCalendarDate(new Date(r.createdAt));
        return day >= startDate && day <= endDate;
      });
    }

    rows = rows.slice(0, limit);
    return { success: true, data: rows.map((r) => buildReturnSummary(r.id)).filter(Boolean) as ReturnSummary[] };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'List failed' };
  }
}

export function handleSaleLookupForReturn(saleNumber: string): ApiResult<SaleSummary> {
  try {
    requireSession();
    const db = getDb();
    const sale = db.select().from(sales).where(eq(sales.saleNumber, saleNumber)).get();
    if (!sale) return { success: false, error: 'Sale not found' };
    const summary = buildSaleSummary(sale.id);
    if (!summary) return { success: false, error: 'Sale not found' };
    return { success: true, data: summary };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Lookup failed' };
  }
}
