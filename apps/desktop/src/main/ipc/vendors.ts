import { eq } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import { vendors } from '@mama-babi/db-schema';
import type { ApiResult, Vendor, VendorInput } from '@shared/types';
import { getDb } from '../db';
import { requireRole } from '../session';
import { logAudit } from '../services/audit';
import { getSetting } from '../services/settings';

function mapVendor(row: typeof vendors.$inferSelect): Vendor {
  return {
    id: row.id,
    name: row.name,
    contact: row.contact,
    email: row.email,
    address: row.address,
    paymentTerms: row.paymentTerms,
    preferredPaymentType: (row.preferredPaymentType as Vendor['preferredPaymentType']) ?? null,
    outstandingBalance: row.outstandingBalance ?? 0,
  };
}

export function handleVendorList(): ApiResult<Vendor[]> {
  try {
    requireRole('super_admin', 'manager');
    const db = getDb();
    const rows = db.select().from(vendors).where(eq(vendors.isDeleted, false)).all();
    return { success: true, data: rows.map(mapVendor) };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'List failed' };
  }
}

export function handleVendorCreate(input: VendorInput): ApiResult<Vendor> {
  try {
    requireRole('super_admin', 'manager');
    const db = getDb();
    const now = new Date().toISOString();
    const deviceId = getSetting('device_id') ?? 'local-device';
    const branchId = getSetting('branch_id') ?? 'main';
    const id = uuid();

    db.insert(vendors)
      .values({
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
      })
      .run();

    logAudit('vendors', 'create', id, undefined, { name: input.name });
    const row = db.select().from(vendors).where(eq(vendors.id, id)).get()!;
    return { success: true, data: mapVendor(row) };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Create failed' };
  }
}

export function handleVendorUpdate(id: string, input: Partial<VendorInput>): ApiResult<Vendor> {
  try {
    requireRole('super_admin', 'manager');
    const db = getDb();
    const existing = db.select().from(vendors).where(eq(vendors.id, id)).get();
    if (!existing) return { success: false, error: 'Vendor not found' };

    const now = new Date().toISOString();
    db.update(vendors)
      .set({
        name: input.name ?? existing.name,
        contact: input.contact !== undefined ? input.contact : existing.contact,
        email: input.email !== undefined ? input.email : existing.email,
        address: input.address !== undefined ? input.address : existing.address,
        paymentTerms: input.paymentTerms !== undefined ? input.paymentTerms : existing.paymentTerms,
        updatedAt: now,
      })
      .where(eq(vendors.id, id))
      .run();

    logAudit('vendors', 'update', id);
    const row = db.select().from(vendors).where(eq(vendors.id, id)).get()!;
    return { success: true, data: mapVendor(row) };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Update failed' };
  }
}
