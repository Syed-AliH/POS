import { and, eq, ilike, or } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import { customers, loyaltyRules } from '@mama-babi/db-pg';
import type { PostgresClient } from '@mama-babi/db-pg';
import { getSetting } from './settings.service';

function normalizePhone(phone: string): string {
  return phone.replace(/[\s\-()]/g, '');
}

function validatePhone(phone: string): { valid: boolean; error?: string } {
  if (!phone?.trim()) return { valid: true };
  const normalized = normalizePhone(phone);
  if (!/^(\+92|0)?3[0-9]{9}$/.test(normalized) && !/^\+?[0-9]{10,15}$/.test(normalized)) {
    return { valid: false, error: 'Invalid phone (use 03XX-XXXXXXX or +92 format)' };
  }
  return { valid: true };
}

function mapCustomer(row: typeof customers.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    address: row.address,
    notes: row.notes,
    loyaltyPoints: row.loyaltyPoints,
    totalSpent: row.totalSpent,
    visitCount: row.visitCount,
    segment: row.segment,
  };
}

export async function searchCustomers(db: PostgresClient, query: string) {
  const q = query.trim();
  if (!q) return { success: true as const, data: [] };
  const pattern = `%${q}%`;
  const rows = await db
    .select()
    .from(customers)
    .where(
      and(
        eq(customers.isDeleted, false),
        or(ilike(customers.name, pattern), ilike(customers.phone, pattern), ilike(customers.email, pattern)),
      ),
    )
    .limit(20);
  return { success: true as const, data: rows.map(mapCustomer) };
}

export async function listCustomers(db: PostgresClient, limit = 50) {
  const rows = await db
    .select()
    .from(customers)
    .where(eq(customers.isDeleted, false))
    .limit(limit);
  return { success: true as const, data: rows.map(mapCustomer) };
}

export async function getCustomer(db: PostgresClient, id: string) {
  const [row] = await db
    .select()
    .from(customers)
    .where(and(eq(customers.id, id), eq(customers.isDeleted, false)))
    .limit(1);
  if (!row) return { success: false as const, error: 'Customer not found' };
  return { success: true as const, data: mapCustomer(row) };
}

export async function createCustomer(
  db: PostgresClient,
  input: {
    name: string;
    phone?: string;
    email?: string;
    address?: string;
    notes?: string;
    loyaltyPoints?: number;
  },
) {
  if (!input.name?.trim()) return { success: false as const, error: 'Customer name is required' };
  const phoneCheck = validatePhone(input.phone ?? '');
  if (!phoneCheck.valid) return { success: false as const, error: phoneCheck.error };

  const now = new Date().toISOString();
  const deviceId = (await getSetting(db, 'device_id')) ?? 'cloud';
  const branchId = (await getSetting(db, 'branch_id')) ?? 'main';
  const id = uuid();

  await db.insert(customers).values({
    id,
    name: input.name.trim(),
    phone: input.phone ? normalizePhone(input.phone) : null,
    email: input.email ?? null,
    address: input.address ?? null,
    notes: input.notes ?? null,
    loyaltyPoints: Math.max(0, Math.floor(input.loyaltyPoints ?? 0)),
    deviceId,
    branchId,
    createdAt: now,
    updatedAt: now,
  });

  const [row] = await db.select().from(customers).where(eq(customers.id, id)).limit(1);
  return { success: true as const, data: mapCustomer(row!) };
}

export async function updateCustomer(
  db: PostgresClient,
  id: string,
  input: Partial<{
    name: string;
    phone: string;
    email: string;
    address: string;
    notes: string;
    loyaltyPoints: number;
  }>,
) {
  if (input.phone !== undefined) {
    const phoneCheck = validatePhone(input.phone ?? '');
    if (!phoneCheck.valid) return { success: false as const, error: phoneCheck.error };
  }

  const [existing] = await db
    .select()
    .from(customers)
    .where(and(eq(customers.id, id), eq(customers.isDeleted, false)))
    .limit(1);
  if (!existing) return { success: false as const, error: 'Customer not found' };

  const now = new Date().toISOString();
  await db
    .update(customers)
    .set({
      name: input.name?.trim() ?? existing.name,
      phone: input.phone !== undefined ? (input.phone ? normalizePhone(input.phone) : null) : existing.phone,
      email: input.email !== undefined ? input.email : existing.email,
      address: input.address !== undefined ? input.address : existing.address,
      notes: input.notes !== undefined ? input.notes : existing.notes,
      loyaltyPoints:
        input.loyaltyPoints !== undefined
          ? Math.max(0, Math.floor(input.loyaltyPoints))
          : existing.loyaltyPoints,
      updatedAt: now,
    })
    .where(eq(customers.id, id));

  const [row] = await db.select().from(customers).where(eq(customers.id, id)).limit(1);
  return { success: true as const, data: mapCustomer(row!) };
}

export async function saveLoyaltyRule(
  db: PostgresClient,
  input: { spendThreshold: number; pointsAwarded: number; redemptionRate?: number },
) {
  if (input.spendThreshold <= 0) return { success: false as const, error: 'Sale amount must be greater than zero' };
  if (input.pointsAwarded < 0) return { success: false as const, error: 'Points must be zero or greater' };
  const redemptionRate = input.redemptionRate ?? 1;
  if (redemptionRate <= 0) return { success: false as const, error: 'Redemption rate must be greater than zero' };

  const [active] = await db.select().from(loyaltyRules).where(eq(loyaltyRules.isActive, true)).limit(1);
  const now = new Date().toISOString();
  const id = active?.id ?? uuid();
  const deviceId = (await getSetting(db, 'device_id')) ?? 'cloud';
  const branchId = (await getSetting(db, 'branch_id')) ?? 'main';

  if (active) {
    await db
      .update(loyaltyRules)
      .set({
        spendThreshold: input.spendThreshold,
        pointsAwarded: Math.floor(input.pointsAwarded),
        redemptionRate,
        isActive: true,
        updatedAt: now,
      })
      .where(eq(loyaltyRules.id, id));
  } else {
    await db.insert(loyaltyRules).values({
      id,
      spendThreshold: input.spendThreshold,
      pointsAwarded: Math.floor(input.pointsAwarded),
      redemptionRate,
      isActive: true,
      deviceId,
      branchId,
      createdAt: now,
      updatedAt: now,
    });
  }

  const [row] = await db.select().from(loyaltyRules).where(eq(loyaltyRules.id, id)).limit(1);
  return {
    success: true as const,
    data: {
      id: row!.id,
      spendThreshold: row!.spendThreshold,
      pointsAwarded: row!.pointsAwarded,
      redemptionRate: row!.redemptionRate,
      isActive: row!.isActive,
    },
  };
}

export async function listLoyaltyRules(db: PostgresClient) {
  const rows = await db.select().from(loyaltyRules).where(eq(loyaltyRules.isActive, true));
  return {
    success: true as const,
    data: rows.map((r) => ({
      id: r.id,
      spendThreshold: r.spendThreshold,
      pointsAwarded: r.pointsAwarded,
      redemptionRate: r.redemptionRate,
      isActive: r.isActive,
    })),
  };
}
