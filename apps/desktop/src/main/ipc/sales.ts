import { and, desc, eq, like } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import {
  customers,
  inventoryMovements,
  products,
  saleItems,
  sales,
  users,
} from '@mama-babi/db-schema';
import type { ApiResult, CartItem, CreateSaleInput, ReceiptPreview, SaleListParams, SaleSummary, UpdateSaleInput } from '@shared/types';
import { getDb } from '../db';
import { coerceReportDateRange, localCalendarDate } from '../lib/reportDateRange';
import { requireRole, requireSession } from '../session';
import { logAudit } from '../services/audit';
import { getAllSettings, getSetting, incrementSaleCounter } from '../services/settings';
import { validatePromotionDiscount } from '../services/promotions';
import { calculateLoyaltyForSale, commitLoyaltyUpdate, findOrCreateCustomerForSale } from './customers';
import { handleGiftCardLookup, redeemGiftCard } from './giftCards';
import { normalizePhone } from '../services/phoneValidation';

function getTaxInclusive(): boolean {
  return getSetting('tax_inclusive') === 'true';
}

function calcLineTotal(unitPrice: number, qty: number, discountPercent: number): number {
  const subtotal = unitPrice * qty;
  return subtotal - subtotal * (discountPercent / 100);
}

function calcTax(_amount: number, _taxRate: number, _inclusive: boolean): number {
  return 0;
}

export function buildSaleSummary(saleId: string): SaleSummary | null {
  const db = getDb();
  const sale = db.select().from(sales).where(eq(sales.id, saleId)).get();
  if (!sale) return null;

  const cashier = db.select().from(users).where(eq(users.id, sale.cashierId)).get();
  const customer = sale.customerId
    ? db.select().from(customers).where(eq(customers.id, sale.customerId)).get()
    : null;
  const items = db.select().from(saleItems).where(eq(saleItems.saleId, saleId)).all();
  const productRows = items.map((item) => {
    const product = db.select().from(products).where(eq(products.id, item.productId)).get();
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
    } satisfies CartItem;
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

export function handleSaleCreate(input: CreateSaleInput): ApiResult<SaleSummary> {
  try {
    const session = requireSession();
    if (input.paymentMethod === 'bank_transfer') {
      return { success: false, error: 'Bank transfer is no longer accepted' };
    }
    const db = getDb();
    const now = new Date().toISOString();
    const inclusive = getTaxInclusive();

    if (!input.items.length) return { success: false, error: 'Cart is empty' };

    let customerId: string | null = null;
    try {
      customerId = findOrCreateCustomerForSale(input.customerId, input.customerName, input.customerPhone);
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : 'Customer save failed' };
    }

    const saleId = uuid();
    const saleNumber = input.status === 'held' ? `HOLD-${Date.now()}` : incrementSaleCounter();
    const deviceId = getSetting('device_id') ?? 'local-device';
    const branchId = getSetting('branch_id') ?? 'main';

    let subtotal = 0;
    let taxAmount = 0;
    const lineItems: Array<typeof saleItems.$inferInsert> = [];

    for (const item of input.items) {
      const product = db
        .select()
        .from(products)
        .where(and(eq(products.id, item.productId), eq(products.isDeleted, false)))
        .get();

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

    const promoInput = {
      items: input.items.map((item) => {
        const product = db.select().from(products).where(eq(products.id, item.productId)).get()!;
        const unitPrice = product.salePrice ?? product.retailPrice;
        return {
          productId: item.productId,
          quantity: item.quantity,
          unitPrice,
          categoryId: product.categoryId,
        };
      }),
      subtotal,
    };

    const promoValidation = validatePromotionDiscount(
      promoInput,
      input.discountAmount ?? 0,
      input.promotionIds,
    );
    let discountAmount = promoValidation.discount;
    let discountReason = input.discountReason ?? null;

    if (promoValidation.discount > 0 && !discountReason) {
      discountReason = 'Promotion applied';
    }

    let loyaltyPointsRedeemed = 0;
    let loyaltyPointsEarned = 0;
    let loyaltyDiscount = 0;
    if (customerId && input.status !== 'held') {
      const pointsToRedeem = input.loyaltyPointsRedeemed ?? 0;
      const loyalty = calculateLoyaltyForSale(customerId, subtotal - discountAmount, pointsToRedeem);
      loyaltyDiscount = loyalty.loyaltyDiscount;
      loyaltyPointsRedeemed = pointsToRedeem;
      loyaltyPointsEarned = loyalty.pointsEarned;
      discountAmount += loyaltyDiscount;
      if (loyaltyDiscount > 0) {
        discountReason = discountReason
          ? `${discountReason}; Loyalty (${pointsToRedeem} pts)`
          : `Loyalty (${pointsToRedeem} pts)`;
      }
    }

    const totalAmount = subtotal - discountAmount;

    if (input.paymentMethod === 'wallet' && input.status !== 'held') {
      if (!input.giftCardCode) return { success: false, error: 'Gift card code required' };
      const cardResult = handleGiftCardLookup(input.giftCardCode);
      if (!cardResult.success || !cardResult.data) return { success: false, error: cardResult.error ?? 'Invalid gift card' };
      if (cardResult.data.currentBalance < totalAmount) {
        return { success: false, error: `Gift card balance PKR ${cardResult.data.currentBalance.toFixed(2)} insufficient` };
      }
    }

    const changeGiven =
      input.paymentMethod === 'cash' && input.amountTendered
        ? Math.max(0, input.amountTendered - totalAmount)
        : null;

    db.transaction((tx) => {
      tx.insert(sales).values({
        id: saleId,
        saleNumber,
        cashierId: session.id,
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
      }).run();

      for (const line of lineItems) {
        tx.insert(saleItems).values(line).run();
      }

      if (input.status !== 'held') {
        for (const item of input.items) {
          const product = tx.select().from(products).where(eq(products.id, item.productId)).get()!;
          tx.update(products)
            .set({ stockQty: product.stockQty - item.quantity, updatedAt: now })
            .where(eq(products.id, item.productId))
            .run();

          tx.insert(inventoryMovements).values({
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
          }).run();
        }
      }
    });

    if (customerId && input.status !== 'held') {
      commitLoyaltyUpdate(customerId, totalAmount, loyaltyPointsRedeemed, loyaltyPointsEarned);
    }

    if (input.paymentMethod === 'wallet' && input.giftCardCode && input.status !== 'held') {
      redeemGiftCard(input.giftCardCode, totalAmount);
    }

    if (input.heldSaleId && input.status !== 'held') {
      const held = db.select().from(sales).where(eq(sales.id, input.heldSaleId)).get();
      if (held && held.status === 'held') {
        db.update(sales)
          .set({ status: 'voided', notes: `Converted to ${saleNumber}`, updatedAt: new Date().toISOString() })
          .where(eq(sales.id, input.heldSaleId))
          .run();
      }
    }

    logAudit('sales', input.status === 'held' ? 'hold' : 'create', saleId, undefined, { saleNumber, totalAmount });
    const summary = buildSaleSummary(saleId);
    if (!summary) return { success: false, error: 'Failed to load sale' };
    return { success: true, data: summary };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Sale failed' };
  }
}

export function handleSaleList(params?: SaleListParams): ApiResult<SaleSummary[]> {
  try {
    requireSession();
    const db = getDb();
    const limit = params?.limit ?? 50;
    let rows = db.select().from(sales).orderBy(desc(sales.createdAt)).limit(limit * 5).all();

    if (params?.status) {
      rows = rows.filter((r) => r.status === params.status);
    }
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
    if (params?.search?.trim()) {
      const q = params.search.trim().toLowerCase();
      rows = rows.filter((r) => {
        const summary = buildSaleSummary(r.id);
        return (
          r.saleNumber.toLowerCase().includes(q) ||
          (summary?.cashierName.toLowerCase().includes(q) ?? false) ||
          String(r.totalAmount).includes(q)
        );
      });
    }
    if (params?.customerName?.trim()) {
      const pattern = `%${params.customerName.trim()}%`;
      const matchingCustomers = db
        .select()
        .from(customers)
        .where(and(eq(customers.isDeleted, false), like(customers.name, pattern)))
        .all();
      const ids = new Set(matchingCustomers.map((c) => c.id));
      rows = rows.filter((r) => r.customerId && ids.has(r.customerId));
    }
    if (params?.customerPhone?.trim()) {
      const phoneQuery = normalizePhone(params.customerPhone);
      const allCustomers = db.select().from(customers).where(eq(customers.isDeleted, false)).all();
      const ids = new Set(
        allCustomers
          .filter((c) => c.phone && normalizePhone(c.phone).includes(phoneQuery))
          .map((c) => c.id),
      );
      rows = rows.filter((r) => r.customerId && ids.has(r.customerId));
    }

    const summaries = rows.slice(0, limit).map((r) => buildSaleSummary(r.id)).filter(Boolean) as SaleSummary[];
    return { success: true, data: summaries };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'List failed' };
  }
}

export function handleSaleReceiptPreview(saleId: string): ApiResult<ReceiptPreview> {
  try {
    requireSession();
    const summary = buildSaleSummary(saleId);
    if (!summary) return { success: false, error: 'Sale not found' };

    const settings = getAllSettings();
    return {
      success: true,
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
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Preview failed' };
  }
}

export function handleSaleUpdate(input: UpdateSaleInput): ApiResult<SaleSummary> {
  try {
    requireSession();
    if (!input.items.length) return { success: false, error: 'Sale must have at least one item' };

    const db = getDb();
    const sale = db.select().from(sales).where(eq(sales.id, input.saleId)).get();
    if (!sale) return { success: false, error: 'Sale not found' };
    if (sale.status !== 'completed') {
      return { success: false, error: 'Only completed sales can be updated' };
    }

    let customerId: string | null = sale.customerId;
    try {
      customerId = findOrCreateCustomerForSale(
        input.customerId ?? sale.customerId ?? undefined,
        input.customerName,
        input.customerPhone,
      );
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : 'Customer save failed' };
    }

    const inclusive = getTaxInclusive();
    const now = new Date().toISOString();
    const deviceId = sale.deviceId;
    const branchId = sale.branchId;
    const oldItems = db.select().from(saleItems).where(eq(saleItems.saleId, input.saleId)).all();

    const oldQtyByProduct = new Map<string, number>();
    for (const item of oldItems) {
      oldQtyByProduct.set(item.productId, (oldQtyByProduct.get(item.productId) ?? 0) + item.quantity);
    }

    const mergedInput = new Map<string, { quantity: number; discountPercent: number }>();
    for (const item of input.items) {
      if (item.quantity <= 0) continue;
      const existing = mergedInput.get(item.productId);
      if (existing) {
        existing.quantity += item.quantity;
      } else {
        mergedInput.set(item.productId, {
          quantity: item.quantity,
          discountPercent: item.discountPercent ?? 0,
        });
      }
    }
    if (!mergedInput.size) return { success: false, error: 'Sale must have at least one item' };

    const newQtyByProduct = new Map<string, number>();
    for (const [productId, row] of mergedInput) {
      newQtyByProduct.set(productId, row.quantity);
    }

    const allProductIds = new Set([...oldQtyByProduct.keys(), ...newQtyByProduct.keys()]);
    for (const productId of allProductIds) {
      const oldQty = oldQtyByProduct.get(productId) ?? 0;
      const newQty = newQtyByProduct.get(productId) ?? 0;
      const delta = newQty - oldQty;
      if (delta <= 0) continue;
      const product = db.select().from(products).where(eq(products.id, productId)).get();
      if (!product || product.isDeleted) {
        return { success: false, error: `Product not found: ${productId}` };
      }
    }

    let subtotal = 0;
    let taxAmount = 0;
    const lineItems: Array<typeof saleItems.$inferInsert> = [];

    for (const [productId, row] of mergedInput) {
      const product = db
        .select()
        .from(products)
        .where(and(eq(products.id, productId), eq(products.isDeleted, false)))
        .get();
      if (!product) return { success: false, error: `Product not found: ${productId}` };

      const unitPrice = product.salePrice ?? product.retailPrice;
      const lineTotal = calcLineTotal(unitPrice, row.quantity, row.discountPercent);
      const lineTax = calcTax(lineTotal, product.taxRate, inclusive);
      subtotal += lineTotal;
      taxAmount += lineTax;

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
      sale.subtotal > 0 ? (sale.discountAmount * subtotal) / sale.subtotal : sale.discountAmount;
    const totalAmount = subtotal - discountAmount;
    const amountTendered = input.amountTendered ?? sale.amountTendered;
    const changeGiven =
      sale.paymentMethod === 'cash' && amountTendered != null
        ? Math.max(0, amountTendered - totalAmount)
        : sale.changeGiven;

    db.transaction((tx) => {
      for (const productId of allProductIds) {
        const oldQty = oldQtyByProduct.get(productId) ?? 0;
        const newQty = newQtyByProduct.get(productId) ?? 0;
        const delta = newQty - oldQty;
        if (delta === 0) continue;

        const product = tx.select().from(products).where(eq(products.id, productId)).get()!;
        tx.update(products)
          .set({ stockQty: product.stockQty - delta, updatedAt: now })
          .where(eq(products.id, productId))
          .run();

        tx.insert(inventoryMovements).values({
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
        }).run();
      }

      for (const item of oldItems) {
        tx.delete(saleItems).where(eq(saleItems.id, item.id)).run();
      }

      for (const line of lineItems) {
        tx.insert(saleItems).values(line).run();
      }

      tx.update(sales)
        .set({
          customerId,
          subtotal,
          discountAmount,
          taxAmount,
          totalAmount,
          amountTendered,
          changeGiven,
          updatedAt: now,
        })
        .where(eq(sales.id, input.saleId))
        .run();
    });

    logAudit('sales', 'update', input.saleId, undefined, { saleNumber: sale.saleNumber, totalAmount });
    const summary = buildSaleSummary(input.saleId);
    if (!summary) return { success: false, error: 'Failed to load sale' };
    return { success: true, data: summary };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Update failed' };
  }
}

export function handleSaleGet(id: string): ApiResult<SaleSummary> {
  try {
    requireSession();
    const summary = buildSaleSummary(id);
    if (!summary) return { success: false, error: 'Sale not found' };
    return { success: true, data: summary };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Get failed' };
  }
}

export function handleSaleVoid(id: string): ApiResult<SaleSummary> {
  try {
    requireRole('manager', 'super_admin');

    const db = getDb();
    const sale = db.select().from(sales).where(eq(sales.id, id)).get();
    if (!sale) return { success: false, error: 'Sale not found' };
    if (sale.status === 'voided') return { success: false, error: 'Already voided' };

    const now = new Date().toISOString();
    const items = db.select().from(saleItems).where(eq(saleItems.saleId, id)).all();

    db.transaction((tx) => {
      tx.update(sales).set({ status: 'voided', updatedAt: now }).where(eq(sales.id, id)).run();

      if (sale.status === 'completed') {
        for (const item of items) {
          const product = tx.select().from(products).where(eq(products.id, item.productId)).get()!;
          tx.update(products)
            .set({ stockQty: product.stockQty + item.quantity, updatedAt: now })
            .where(eq(products.id, item.productId))
            .run();

          tx.insert(inventoryMovements).values({
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
          }).run();
        }
      }
    });

    logAudit('sales', 'void', id);
    const summary = buildSaleSummary(id);
    return { success: true, data: summary! };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Void failed' };
  }
}

export function handleSaleResume(heldKey: string): ApiResult<SaleSummary> {
  try {
    requireSession();
    const db = getDb();
    const sale = db.select().from(sales).where(and(eq(sales.heldKey, heldKey), eq(sales.status, 'held'))).get();
    if (!sale) return { success: false, error: 'Held sale not found' };
    const summary = buildSaleSummary(sale.id);
    return { success: true, data: summary! };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Resume failed' };
  }
}

export function handleDiscardHeld(id: string): ApiResult<void> {
  try {
    requireSession();
    const db = getDb();
    const sale = db.select().from(sales).where(eq(sales.id, id)).get();
    if (!sale) return { success: false, error: 'Sale not found' };
    if (sale.status !== 'held') return { success: false, error: 'Only held sales can be discarded' };

    const now = new Date().toISOString();
    db.update(sales).set({ status: 'voided', updatedAt: now }).where(eq(sales.id, id)).run();
    logAudit('sales', 'discard_held', id);
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Discard failed' };
  }
}
