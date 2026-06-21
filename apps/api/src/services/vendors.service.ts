import { eq } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import { vendors } from '@mama-babi/db-pg';
import type { PostgresClient } from '@mama-babi/db-pg';
import { getSetting } from './settings.service';

function mapVendor(row: typeof vendors.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    contact: row.contact,
    email: row.email,
    address: row.address,
    paymentTerms: row.paymentTerms,
    preferredPaymentType: (row.preferredPaymentType as 'cash' | 'credit' | null) ?? null,
    outstandingBalance: row.outstandingBalance ?? 0,
  };
}

export async function listVendors(db: PostgresClient) {
  const rows = await db.select().from(vendors).where(eq(vendors.isDeleted, false));
  return { success: true as const, data: rows.map(mapVendor) };
}

export async function createVendor(
  db: PostgresClient,
  input: { name: string; contact?: string; email?: string; address?: string; paymentTerms?: string },
) {
  const now = new Date().toISOString();
  const deviceId = (await getSetting(db, 'device_id')) ?? 'cloud';
  const branchId = (await getSetting(db, 'branch_id')) ?? 'main';
  const id = uuid();
  await db.insert(vendors).values({
    id,
    name: input.name,
    contact: input.contact ?? null,
    email: input.email ?? null,
    address: input.address ?? null,
    paymentTerms: input.paymentTerms ?? null,
    deviceId,
    branchId,
    createdAt: now,
    updatedAt: now,
  });
  const [row] = await db.select().from(vendors).where(eq(vendors.id, id)).limit(1);
  return { success: true as const, data: mapVendor(row!) };
}

export async function updateVendor(
  db: PostgresClient,
  id: string,
  input: Partial<{ name: string; contact: string; email: string; address: string; paymentTerms: string }>,
) {
  const [existing] = await db.select().from(vendors).where(eq(vendors.id, id)).limit(1);
  if (!existing) return { success: false, error: 'Vendor not found' };
  const now = new Date().toISOString();
  await db
    .update(vendors)
    .set({
      name: input.name ?? existing.name,
      contact: input.contact !== undefined ? input.contact : existing.contact,
      email: input.email !== undefined ? input.email : existing.email,
      address: input.address !== undefined ? input.address : existing.address,
      paymentTerms: input.paymentTerms !== undefined ? input.paymentTerms : existing.paymentTerms,
      updatedAt: now,
    })
    .where(eq(vendors.id, id));
  const [row] = await db.select().from(vendors).where(eq(vendors.id, id)).limit(1);
  return { success: true as const, data: mapVendor(row!) };
}

export async function saveVendorPaymentPreference(
  db: PostgresClient,
  vendorId: string,
  paymentType: 'cash' | 'credit',
) {
  await db
    .update(vendors)
    .set({ preferredPaymentType: paymentType, updatedAt: new Date().toISOString() })
    .where(eq(vendors.id, vendorId));
}

export async function recalculateVendorBalance(db: PostgresClient, vendorId: string, now?: string) {
  const { grnHeaders, supplierPayments } = await import('@mama-babi/db-pg');
  const { and, eq: eqOp } = await import('drizzle-orm');
  const grnRows = await db
    .select()
    .from(grnHeaders)
    .where(and(eqOp(grnHeaders.vendorId, vendorId), eqOp(grnHeaders.status, 'finalized')));
  const creditTotal = grnRows
    .filter((r) => (r.paymentType ?? 'cash') === 'credit')
    .reduce((sum, r) => sum + r.invoiceTotal, 0);
  const paymentRows = await db
    .select()
    .from(supplierPayments)
    .where(and(eqOp(supplierPayments.vendorId, vendorId), eqOp(supplierPayments.isDeleted, false)));
  const paid = paymentRows.reduce((sum, r) => sum + r.amount, 0);
  const balance = Math.max(0, creditTotal - paid);
  await db
    .update(vendors)
    .set({ outstandingBalance: balance, updatedAt: now ?? new Date().toISOString() })
    .where(eq(vendors.id, vendorId));
  return balance;
}
