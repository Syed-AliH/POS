import { and, eq, like, or } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import { customers, loyaltyRules } from '@mama-babi/db-schema';
import type { ApiResult, Customer, CustomerInput, LoyaltyRule, LoyaltyRuleInput } from '@shared/types';
import { getDb } from '../db';
import { requireRole, requireSession } from '../session';
import { logAudit } from '../services/audit';
import { getSetting } from '../services/settings';
import { normalizePhone, validatePhone } from '../services/phoneValidation';

function mapCustomer(row: typeof customers.$inferSelect): Customer {
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

export function handleCustomerSearch(query: string): ApiResult<Customer[]> {
  try {
    requireSession();
    if (!query.trim()) return { success: true, data: [] };

    const db = getDb();
    const pattern = `%${query.trim()}%`;
    const rows = db
      .select()
      .from(customers)
      .where(
        and(
          eq(customers.isDeleted, false),
          or(like(customers.name, pattern), like(customers.phone, pattern), like(customers.email, pattern)),
        ),
      )
      .limit(20)
      .all();

    return { success: true, data: rows.map(mapCustomer) };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Search failed' };
  }
}

export function handleCustomerList(limit = 50): ApiResult<Customer[]> {
  try {
    requireRole('super_admin', 'manager');
    const db = getDb();
    const rows = db
      .select()
      .from(customers)
      .where(eq(customers.isDeleted, false))
      .limit(limit)
      .all();
    return { success: true, data: rows.map(mapCustomer) };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'List failed' };
  }
}

export function handleCustomerGet(id: string): ApiResult<Customer> {
  try {
    requireSession();
    const db = getDb();
    const row = db.select().from(customers).where(eq(customers.id, id)).get();
    if (!row || row.isDeleted) return { success: false, error: 'Customer not found' };
    return { success: true, data: mapCustomer(row) };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Get failed' };
  }
}

export function findOrCreateCustomerForSale(
  customerId?: string,
  customerName?: string,
  customerPhone?: string,
): string | null {
  const db = getDb();

  if (customerId) {
    const row = db
      .select()
      .from(customers)
      .where(and(eq(customers.id, customerId), eq(customers.isDeleted, false)))
      .get();
    if (row) return row.id;
  }

  const name = customerName?.trim() ?? '';
  const phoneRaw = customerPhone?.trim() ?? '';
  let normalizedPhone: string | null = null;
  if (phoneRaw) {
    const phoneCheck = validatePhone(phoneRaw);
    if (phoneCheck.valid) normalizedPhone = normalizePhone(phoneRaw);
  }

  if (!name && !normalizedPhone) return null;

  if (normalizedPhone) {
    const rows = db.select().from(customers).where(eq(customers.isDeleted, false)).all();
    const match = rows.find((c) => c.phone && normalizePhone(c.phone) === normalizedPhone);
    if (match) {
      if (name && name !== match.name) {
        const now = new Date().toISOString();
        db.update(customers).set({ name, updatedAt: now }).where(eq(customers.id, match.id)).run();
      }
      return match.id;
    }
  }

  const effectiveName = name || normalizedPhone || 'Walk-in';
  const now = new Date().toISOString();
  const deviceId = getSetting('device_id') ?? 'local-device';
  const branchId = getSetting('branch_id') ?? 'main';
  const id = uuid();

  try {
    db.insert(customers)
      .values({
        id,
        name: effectiveName,
        phone: normalizedPhone,
        email: null,
        address: null,
        notes: null,
        deviceId,
        branchId,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    logAudit('customers', 'create', id, undefined, { name: effectiveName, source: 'sale' });
    return id;
  } catch {
    if (normalizedPhone) {
      const rows = db.select().from(customers).where(eq(customers.isDeleted, false)).all();
      const match = rows.find((c) => c.phone && normalizePhone(c.phone) === normalizedPhone);
      if (match) return match.id;
    }
    throw new Error('Could not save customer');
  }
}

export function handleCustomerCreate(input: CustomerInput): ApiResult<Customer> {
  try {
    requireSession();
    if (!input.name?.trim()) return { success: false, error: 'Customer name is required' };
    const phoneCheck = validatePhone(input.phone ?? '');
    if (!phoneCheck.valid) return { success: false, error: phoneCheck.error };
    const db = getDb();
    const now = new Date().toISOString();
    const deviceId = getSetting('device_id') ?? 'local-device';
    const branchId = getSetting('branch_id') ?? 'main';
    const id = uuid();

    db.insert(customers)
      .values({
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
      })
      .run();

    logAudit('customers', 'create', id, undefined, { name: input.name });
    const row = db.select().from(customers).where(eq(customers.id, id)).get()!;
    return { success: true, data: mapCustomer(row) };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Create failed' };
  }
}

export function handleCustomerUpdate(id: string, input: Partial<CustomerInput>): ApiResult<Customer> {
  try {
    requireRole('super_admin', 'manager');
    if (input.phone !== undefined) {
      const phoneCheck = validatePhone(input.phone ?? '');
      if (!phoneCheck.valid) return { success: false, error: phoneCheck.error };
    }
    const db = getDb();
    const existing = db.select().from(customers).where(eq(customers.id, id)).get();
    if (!existing || existing.isDeleted) return { success: false, error: 'Customer not found' };

    const now = new Date().toISOString();
    db.update(customers)
      .set({
        name: input.name?.trim() ?? existing.name,
        phone: input.phone !== undefined ? (input.phone ? normalizePhone(input.phone) : null) : existing.phone,
        email: input.email !== undefined ? input.email : existing.email,
        address: input.address !== undefined ? input.address : existing.address,
        notes: input.notes !== undefined ? input.notes : existing.notes,
        loyaltyPoints: input.loyaltyPoints !== undefined
          ? Math.max(0, Math.floor(input.loyaltyPoints))
          : existing.loyaltyPoints,
        updatedAt: now,
      })
      .where(eq(customers.id, id))
      .run();

    logAudit('customers', 'update', id);
    const row = db.select().from(customers).where(eq(customers.id, id)).get()!;
    return { success: true, data: mapCustomer(row) };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Update failed' };
  }
}

function mapLoyaltyRule(row: typeof loyaltyRules.$inferSelect): LoyaltyRule {
  return {
    id: row.id,
    spendThreshold: row.spendThreshold,
    pointsAwarded: row.pointsAwarded,
    redemptionRate: row.redemptionRate,
    isActive: row.isActive,
  };
}

export function handleLoyaltyRules(): ApiResult<LoyaltyRule[]> {
  try {
    requireSession();
    const db = getDb();
    const rows = db.select().from(loyaltyRules).where(eq(loyaltyRules.isActive, true)).all();
    return { success: true, data: rows.map(mapLoyaltyRule) };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Rules failed' };
  }
}

export function handleLoyaltyRuleSave(input: LoyaltyRuleInput): ApiResult<LoyaltyRule> {
  try {
    requireRole('super_admin', 'manager');
    if (input.spendThreshold <= 0) return { success: false, error: 'Sale amount must be greater than zero' };
    if (input.pointsAwarded < 0) return { success: false, error: 'Points must be zero or greater' };
    const redemptionRate = input.redemptionRate ?? 1;
    if (redemptionRate <= 0) return { success: false, error: 'Redemption rate must be greater than zero' };

    const db = getDb();
    const active = db.select().from(loyaltyRules).where(eq(loyaltyRules.isActive, true)).get();
    const now = new Date().toISOString();
    const id = active?.id ?? uuid();
    const deviceId = getSetting('device_id') ?? 'local-device';
    const branchId = getSetting('branch_id') ?? 'main';

    if (active) {
      db.update(loyaltyRules)
        .set({
          spendThreshold: input.spendThreshold,
          pointsAwarded: Math.floor(input.pointsAwarded),
          redemptionRate,
          isActive: true,
          updatedAt: now,
        })
        .where(eq(loyaltyRules.id, id))
        .run();
    } else {
      db.insert(loyaltyRules)
        .values({
          id,
          spendThreshold: input.spendThreshold,
          pointsAwarded: Math.floor(input.pointsAwarded),
          redemptionRate,
          isActive: true,
          deviceId,
          branchId,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    }

    logAudit('customers', 'loyalty_rule_update', id, undefined, input);
    const row = db.select().from(loyaltyRules).where(eq(loyaltyRules.id, id)).get()!;
    return { success: true, data: mapLoyaltyRule(row) };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Update failed' };
  }
}

export function calculateLoyaltyForSale(
  customerId: string,
  saleTotal: number,
  pointsRedeemed: number,
): { pointsEarned: number; loyaltyDiscount: number } {
  const db = getDb();
  const customer = db.select().from(customers).where(eq(customers.id, customerId)).get();
  if (!customer) return { pointsEarned: 0, loyaltyDiscount: 0 };

  const rule = db.select().from(loyaltyRules).where(eq(loyaltyRules.isActive, true)).get();
  const redemptionRate = rule?.redemptionRate ?? 1;
  const loyaltyDiscount = pointsRedeemed * redemptionRate;

  if (pointsRedeemed > customer.loyaltyPoints) {
    throw new Error('Insufficient loyalty points');
  }

  let pointsEarned = 0;
  if (rule && saleTotal >= rule.spendThreshold) {
    pointsEarned = Math.floor(saleTotal / rule.spendThreshold) * rule.pointsAwarded;
  }

  return { pointsEarned, loyaltyDiscount };
}

export function commitLoyaltyUpdate(
  customerId: string,
  saleTotal: number,
  pointsRedeemed: number,
  pointsEarned: number,
): void {
  const db = getDb();
  const customer = db.select().from(customers).where(eq(customers.id, customerId)).get();
  if (!customer) return;

  const now = new Date().toISOString();
  const newTotalSpent = customer.totalSpent + saleTotal;
  db.update(customers)
    .set({
      loyaltyPoints: customer.loyaltyPoints - pointsRedeemed + pointsEarned,
      totalSpent: newTotalSpent,
      visitCount: customer.visitCount + 1,
      segment: newTotalSpent > 5000 ? 'regular' : customer.segment,
      updatedAt: now,
    })
    .where(eq(customers.id, customerId))
    .run();
}
