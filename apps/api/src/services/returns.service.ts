import { and, desc, eq, gte, lt } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import {
  inventoryMovements,
  products,
  returnItems,
  returns,
  saleItems,
  sales,
} from '@mama-babi/db-pg';
import type { PostgresClient } from '@mama-babi/db-pg';
import { coerceReportDateRange, isoRangeBounds } from '../lib/reportDateRange';
import { getSetting, incrementReturnCounter } from './settings.service';

async function buildReturnSummary(db: PostgresClient, returnId: string) {
  const [ret] = await db.select().from(returns).where(eq(returns.id, returnId)).limit(1);
  if (!ret) return null;

  const [saleRecord] = await db.select().from(sales).where(eq(sales.id, ret.saleId)).limit(1);
  const items = await db.select().from(returnItems).where(eq(returnItems.returnId, returnId));

  const mappedItems = await Promise.all(
    items.map(async (i) => {
      const [saleItem] = await db.select().from(saleItems).where(eq(saleItems.id, i.saleItemId)).limit(1);
      return {
        productName: saleItem?.productName ?? '',
        qtyReturned: i.qtyReturned,
        unitRefund: i.unitRefund,
        restocked: i.restocked,
      };
    }),
  );

  return {
    id: ret.id,
    returnNumber: ret.returnNumber,
    saleId: ret.saleId,
    saleNumber: saleRecord?.saleNumber ?? '',
    reason: ret.reason,
    refundMethod: ret.refundMethod as 'cash' | 'store_credit' | 'loyalty',
    totalRefund: ret.totalRefund,
    status: ret.status,
    processedBy: ret.processedBy,
    createdAt: ret.createdAt,
    items: mappedItems,
  };
}

export async function createReturn(
  db: PostgresClient,
  sessionId: string,
  input: {
    saleNumber: string;
    reason: string;
    refundMethod: 'cash' | 'store_credit' | 'loyalty';
    items: Array<{ saleItemId: string; qtyReturned: number; restocked?: boolean }>;
  },
) {
  const [sale] = await db
    .select()
    .from(sales)
    .where(eq(sales.saleNumber, input.saleNumber))
    .limit(1);
  if (!sale) return { success: false as const, error: 'Sale not found' };
  if (sale.status !== 'completed') return { success: false as const, error: 'Sale cannot be returned' };

  const policyDays = parseInt((await getSetting(db, 'return_policy_days')) ?? '7', 10);
  const daysSince = (Date.now() - new Date(sale.createdAt).getTime()) / (1000 * 60 * 60 * 24);
  if (daysSince > policyDays) {
    return { success: false as const, error: `Return policy expired (${policyDays} days)` };
  }

  const now = new Date().toISOString();
  const deviceId = (await getSetting(db, 'device_id')) ?? 'cloud';
  const branchId = (await getSetting(db, 'branch_id')) ?? 'main';
  const returnId = uuid();
  const returnNumber = await incrementReturnCounter(db);
  let totalRefund = 0;

  try {
    await db.transaction(async (tx) => {
      for (const item of input.items) {
        const [saleItem] = await tx
          .select()
          .from(saleItems)
          .where(eq(saleItems.id, item.saleItemId))
          .limit(1);
        if (!saleItem || saleItem.saleId !== sale.id) continue;
        if (item.qtyReturned > saleItem.quantity) {
          throw new Error(`Cannot return more than purchased for ${saleItem.productName}`);
        }

        const unitRefund = saleItem.lineTotal / saleItem.quantity;
        totalRefund += unitRefund * item.qtyReturned;

        await tx.insert(returnItems).values({
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
        });

        if (item.restocked !== false) {
          const [product] = await tx
            .select()
            .from(products)
            .where(eq(products.id, saleItem.productId))
            .limit(1);
          if (product) {
            await tx
              .update(products)
              .set({ stockQty: product.stockQty + item.qtyReturned, updatedAt: now })
              .where(eq(products.id, saleItem.productId));

            await tx.insert(inventoryMovements).values({
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
            });
          }
        }
      }

      await tx.insert(returns).values({
        id: returnId,
        returnNumber,
        saleId: sale.id,
        reason: input.reason,
        refundMethod: input.refundMethod,
        status: 'completed',
        totalRefund,
        processedBy: sessionId,
        deviceId,
        branchId,
        createdAt: now,
        updatedAt: now,
      });

      await tx
        .update(sales)
        .set({ status: 'returned', updatedAt: now })
        .where(eq(sales.id, sale.id));
    });
  } catch (e) {
    return { success: false as const, error: e instanceof Error ? e.message : 'Return failed' };
  }

  const summary = await buildReturnSummary(db, returnId);
  if (!summary) return { success: false as const, error: 'Failed to load return' };
  return { success: true as const, data: summary };
}

export async function listReturns(
  db: PostgresClient,
  params?: { limit?: number; startDate?: string; endDate?: string },
) {
  const limit = params?.limit ?? 50;
  const conditions = [];

  if (params?.startDate || params?.endDate) {
    const range = coerceReportDateRange({
      startDate: params.startDate,
      endDate: params.endDate,
    });
    const { startInclusive, endExclusive } = isoRangeBounds(range);
    conditions.push(gte(returns.createdAt, startInclusive));
    conditions.push(lt(returns.createdAt, endExclusive));
  }

  const where = conditions.length ? and(...conditions) : undefined;
  const rows = await db
    .select()
    .from(returns)
    .where(where)
    .orderBy(desc(returns.createdAt))
    .limit(limit);

  const summaries = (
    await Promise.all(rows.map((r) => buildReturnSummary(db, r.id)))
  ).filter(Boolean);
  return { success: true as const, data: summaries as NonNullable<Awaited<ReturnType<typeof buildReturnSummary>>>[] };
}
