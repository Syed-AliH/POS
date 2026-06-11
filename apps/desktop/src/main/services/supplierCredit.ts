import { and, desc, eq } from 'drizzle-orm';
import { grnHeaders, supplierPayments, vendors } from '@mama-babi/db-schema';
import type { SupplierLedgerEntry, SupplierPaymentSummary } from '@shared/types';
import { getDb } from '../db';
import { getSetting, setSetting } from './settings';

export type GrnPaymentType = 'cash' | 'credit';

export function incrementSupplierPaymentCounter(): string {
  const year = new Date().getFullYear();
  const key = 'supplier_payment_counter';
  const current = parseInt(getSetting(key) ?? '0', 10) + 1;
  setSetting(key, String(current));
  return `SP-${year}-${String(current).padStart(4, '0')}`;
}

export function sumCreditGrnTotal(vendorId: string): number {
  const db = getDb();
  const rows = db
    .select()
    .from(grnHeaders)
    .where(and(eq(grnHeaders.vendorId, vendorId), eq(grnHeaders.status, 'finalized')))
    .all();
  return rows
    .filter((r) => (r.paymentType ?? 'cash') === 'credit')
    .reduce((sum, r) => sum + r.invoiceTotal, 0);
}

export function sumSupplierPayments(vendorId: string): number {
  const db = getDb();
  const rows = db
    .select()
    .from(supplierPayments)
    .where(and(eq(supplierPayments.vendorId, vendorId), eq(supplierPayments.isDeleted, false)))
    .all();
  return rows.reduce((sum, r) => sum + r.amount, 0);
}

export function recalculateVendorBalance(vendorId: string, now?: string): number {
  const db = getDb();
  const balance = Math.max(0, sumCreditGrnTotal(vendorId) - sumSupplierPayments(vendorId));
  db.update(vendors)
    .set({ outstandingBalance: balance, updatedAt: now ?? new Date().toISOString() })
    .where(eq(vendors.id, vendorId))
    .run();
  return balance;
}

export function recalculateAllVendorBalances(now?: string): void {
  const db = getDb();
  const vendorRows = db.select().from(vendors).where(eq(vendors.isDeleted, false)).all();
  const timestamp = now ?? new Date().toISOString();
  for (const vendor of vendorRows) {
    recalculateVendorBalance(vendor.id, timestamp);
  }
}

export function getVendorOutstandingBalance(vendorId: string): number {
  const db = getDb();
  const vendor = db.select().from(vendors).where(eq(vendors.id, vendorId)).get();
  if (!vendor) return 0;
  return vendor.outstandingBalance ?? recalculateVendorBalance(vendorId);
}

export function saveVendorPaymentPreference(vendorId: string, paymentType: GrnPaymentType): void {
  const db = getDb();
  db.update(vendors)
    .set({ preferredPaymentType: paymentType, updatedAt: new Date().toISOString() })
    .where(eq(vendors.id, vendorId))
    .run();
}

export function buildSupplierLedger(vendorId: string): SupplierLedgerEntry[] {
  const db = getDb();
  const vendor = db.select().from(vendors).where(eq(vendors.id, vendorId)).get();
  if (!vendor) return [];

  type LedgerEvent = SupplierLedgerEntry & { sortKey: string };
  const events: LedgerEvent[] = [];

  const creditGrns = db
    .select()
    .from(grnHeaders)
    .where(and(eq(grnHeaders.vendorId, vendorId), eq(grnHeaders.status, 'finalized')))
    .all()
    .filter((r) => (r.paymentType ?? 'cash') === 'credit');

  for (const grn of creditGrns) {
    events.push({
      id: grn.id,
      createdAt: grn.updatedAt ?? grn.createdAt,
      transactionType: 'credit_grn',
      referenceNumber: grn.grnNumber,
      debitAmount: 0,
      creditAmount: grn.invoiceTotal,
      runningBalance: 0,
      notes: grn.notes,
      sortKey: grn.updatedAt ?? grn.createdAt,
    });
  }

  const payments = db
    .select()
    .from(supplierPayments)
    .where(and(eq(supplierPayments.vendorId, vendorId), eq(supplierPayments.isDeleted, false)))
    .orderBy(desc(supplierPayments.createdAt))
    .all();

  for (const payment of payments) {
    events.push({
      id: payment.id,
      createdAt: payment.createdAt,
      transactionType: 'payment',
      referenceNumber: payment.paymentNumber,
      debitAmount: payment.amount,
      creditAmount: 0,
      runningBalance: 0,
      notes: payment.notes,
      sortKey: payment.createdAt,
    });
  }

  events.sort((a, b) => a.sortKey.localeCompare(b.sortKey));

  let running = 0;
  return events.map(({ sortKey: _sortKey, ...entry }) => {
    running += entry.creditAmount - entry.debitAmount;
    return { ...entry, runningBalance: running };
  });
}

export function mapSupplierPayment(row: typeof supplierPayments.$inferSelect, vendorName: string): SupplierPaymentSummary {
  return {
    id: row.id,
    paymentNumber: row.paymentNumber,
    vendorId: row.vendorId,
    vendorName,
    amount: row.amount,
    paymentDate: row.paymentDate,
    notes: row.notes,
    balanceAfter: row.balanceAfter,
    createdAt: row.createdAt,
  };
}
