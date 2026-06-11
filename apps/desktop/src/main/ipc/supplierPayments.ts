import { desc, eq } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import { supplierPayments, vendors } from '@mama-babi/db-schema';
import type {
  ApiResult,
  SupplierLedgerEntry,
  SupplierPaymentInput,
  SupplierPaymentListParams,
  SupplierPaymentSummary,
  SupplierPaymentUpdateInput,
} from '@shared/types';
import { getDb } from '../db';
import { requireRole } from '../session';
import { logAudit } from '../services/audit';
import { getSetting } from '../services/settings';
import {
  buildSupplierLedger,
  getVendorOutstandingBalance,
  incrementSupplierPaymentCounter,
  mapSupplierPayment,
  recalculateVendorBalance,
  sumCreditGrnTotal,
} from '../services/supplierCredit';

export function handleSupplierPaymentList(params?: SupplierPaymentListParams): ApiResult<SupplierPaymentSummary[]> {
  try {
    requireRole('super_admin', 'manager');
    const db = getDb();
    const limit = params?.limit ?? 50;
    let rows = db
      .select()
      .from(supplierPayments)
      .where(eq(supplierPayments.isDeleted, false))
      .orderBy(desc(supplierPayments.createdAt))
      .limit(limit * 3)
      .all();

    if (params?.vendorId) {
      rows = rows.filter((r) => r.vendorId === params.vendorId);
    }

    const summaries = rows.slice(0, limit).map((row) => {
      const vendor = db.select().from(vendors).where(eq(vendors.id, row.vendorId)).get();
      return mapSupplierPayment(row, vendor?.name ?? 'Unknown');
    });

    return { success: true, data: summaries };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'List failed' };
  }
}

export function handleSupplierPaymentCreate(input: SupplierPaymentInput): ApiResult<SupplierPaymentSummary> {
  try {
    const session = requireRole('super_admin', 'manager');
    const db = getDb();
    const vendor = db.select().from(vendors).where(eq(vendors.id, input.vendorId)).get();
    if (!vendor) return { success: false, error: 'Supplier not found' };
    if (!input.amount || input.amount <= 0) return { success: false, error: 'Payment amount must be greater than zero' };

    const outstanding = getVendorOutstandingBalance(input.vendorId);
    if (input.amount > outstanding) {
      return { success: false, error: `Payment exceeds outstanding balance (PKR ${outstanding.toFixed(2)})` };
    }

    const now = new Date().toISOString();
    const deviceId = getSetting('device_id') ?? 'local-device';
    const branchId = getSetting('branch_id') ?? 'main';
    const id = uuid();
    const paymentNumber = incrementSupplierPaymentCounter();
    const paymentDate = input.paymentDate ?? now.slice(0, 10);

    db.insert(supplierPayments)
      .values({
        id,
        paymentNumber,
        vendorId: input.vendorId,
        amount: input.amount,
        paymentDate,
        notes: input.notes ?? null,
        balanceAfter: 0,
        processedBy: session.id,
        deviceId,
        branchId,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const updatedBalance = recalculateVendorBalance(input.vendorId, now);
    db.update(supplierPayments)
      .set({ balanceAfter: updatedBalance, updatedAt: now })
      .where(eq(supplierPayments.id, id))
      .run();

    const row = db.select().from(supplierPayments).where(eq(supplierPayments.id, id)).get()!;
    logAudit('supplier_payments', 'create', id, undefined, { paymentNumber, amount: input.amount });
    return { success: true, data: mapSupplierPayment(row, vendor.name) };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Payment failed' };
  }
}

export function handleSupplierPaymentUpdate(id: string, input: SupplierPaymentUpdateInput): ApiResult<SupplierPaymentSummary> {
  try {
    requireRole('super_admin', 'manager');
    const db = getDb();
    const existing = db.select().from(supplierPayments).where(eq(supplierPayments.id, id)).get();
    if (!existing || existing.isDeleted) return { success: false, error: 'Payment not found' };

    const now = new Date().toISOString();
    const amount = input.amount ?? existing.amount;
    if (amount <= 0) return { success: false, error: 'Payment amount must be greater than zero' };

    const otherPayments = sumOtherPayments(existing.vendorId, id);
    const creditTotal = sumCreditGrnTotal(existing.vendorId);
    const maxAllowed = creditTotal - otherPayments;
    if (amount > maxAllowed) {
      return { success: false, error: `Payment exceeds allowable balance (PKR ${maxAllowed.toFixed(2)})` };
    }

    db.update(supplierPayments)
      .set({
        amount,
        paymentDate: input.paymentDate ?? existing.paymentDate,
        notes: input.notes !== undefined ? input.notes || null : existing.notes,
        updatedAt: now,
      })
      .where(eq(supplierPayments.id, id))
      .run();

    const balanceAfter = recalculateVendorBalance(existing.vendorId, now);
    db.update(supplierPayments)
      .set({ balanceAfter, updatedAt: now })
      .where(eq(supplierPayments.id, id))
      .run();

    const vendor = db.select().from(vendors).where(eq(vendors.id, existing.vendorId)).get()!;
    const row = db.select().from(supplierPayments).where(eq(supplierPayments.id, id)).get()!;
    logAudit('supplier_payments', 'update', id);
    return { success: true, data: mapSupplierPayment(row, vendor.name) };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Update failed' };
  }
}

export function handleSupplierPaymentDelete(id: string): ApiResult<void> {
  try {
    requireRole('super_admin', 'manager');
    const db = getDb();
    const existing = db.select().from(supplierPayments).where(eq(supplierPayments.id, id)).get();
    if (!existing || existing.isDeleted) return { success: false, error: 'Payment not found' };

    const now = new Date().toISOString();
    db.update(supplierPayments)
      .set({ isDeleted: true, updatedAt: now })
      .where(eq(supplierPayments.id, id))
      .run();

    recalculateVendorBalance(existing.vendorId, now);
    logAudit('supplier_payments', 'delete', id);
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Delete failed' };
  }
}

export function handleSupplierBalance(vendorId: string): ApiResult<{ outstandingBalance: number }> {
  try {
    requireRole('super_admin', 'manager');
    const db = getDb();
    const vendor = db.select().from(vendors).where(eq(vendors.id, vendorId)).get();
    if (!vendor) return { success: false, error: 'Supplier not found' };
    const outstandingBalance = recalculateVendorBalance(vendorId);
    return { success: true, data: { outstandingBalance } };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Balance lookup failed' };
  }
}

export function handleSupplierLedger(vendorId: string): ApiResult<SupplierLedgerEntry[]> {
  try {
    requireRole('super_admin', 'manager');
    const db = getDb();
    const vendor = db.select().from(vendors).where(eq(vendors.id, vendorId)).get();
    if (!vendor) return { success: false, error: 'Supplier not found' };
    recalculateVendorBalance(vendorId);
    return { success: true, data: buildSupplierLedger(vendorId) };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Ledger failed' };
  }
}

function sumOtherPayments(vendorId: string, excludeId: string): number {
  const db = getDb();
  const rows = db
    .select()
    .from(supplierPayments)
    .where(eq(supplierPayments.vendorId, vendorId))
    .all()
    .filter((r) => !r.isDeleted && r.id !== excludeId);
  return rows.reduce((sum, r) => sum + r.amount, 0);
}
