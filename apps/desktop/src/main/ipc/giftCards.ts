import { desc, eq } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import { giftCards } from '@mama-babi/db-schema';
import type { ApiResult, GiftCard, IssueGiftCardInput, ReloadGiftCardInput } from '@shared/types';
import { getDb } from '../db';
import { requireRole, requireSession } from '../session';
import { logAudit } from '../services/audit';
import { getSetting } from '../services/settings';

function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'GC-';
  for (let i = 0; i < 10; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function mapCard(row: typeof giftCards.$inferSelect): GiftCard {
  return {
    id: row.id,
    code: row.code,
    initialBalance: row.initialBalance,
    currentBalance: row.currentBalance,
    customerId: row.customerId,
    status: row.status,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
  };
}

export function handleGiftCardList(limit = 50): ApiResult<GiftCard[]> {
  try {
    requireRole('super_admin', 'manager');
    const db = getDb();
    const rows = db.select().from(giftCards).orderBy(desc(giftCards.createdAt)).limit(limit).all();
    return { success: true, data: rows.map(mapCard) };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'List failed' };
  }
}

export function handleGiftCardLookup(code: string): ApiResult<GiftCard> {
  try {
    requireSession();
    const db = getDb();
    const row = db.select().from(giftCards).where(eq(giftCards.code, code.trim().toUpperCase())).get();
    if (!row) return { success: false, error: 'Gift card not found' };
    if (row.status !== 'active') return { success: false, error: 'Gift card is not active' };
    if (row.expiresAt && new Date(row.expiresAt) < new Date()) {
      return { success: false, error: 'Gift card has expired' };
    }
    return { success: true, data: mapCard(row) };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Lookup failed' };
  }
}

export function handleGiftCardIssue(input: IssueGiftCardInput): ApiResult<GiftCard> {
  try {
    requireRole('super_admin', 'manager');
    if (input.initialBalance <= 0) return { success: false, error: 'Balance must be positive' };

    const db = getDb();
    const session = requireSession();
    const now = new Date().toISOString();
    const deviceId = getSetting('device_id') ?? 'local-device';
    const branchId = getSetting('branch_id') ?? 'main';
    const id = uuid();
    let code = generateCode();
    while (db.select().from(giftCards).where(eq(giftCards.code, code)).get()) {
      code = generateCode();
    }

    db.insert(giftCards).values({
      id,
      code,
      initialBalance: input.initialBalance,
      currentBalance: input.initialBalance,
      issuedBy: session.id,
      customerId: input.customerId ?? null,
      status: 'active',
      expiresAt: input.expiresAt ?? null,
      deviceId,
      branchId,
      createdAt: now,
      updatedAt: now,
    }).run();

    logAudit('gift_cards', 'issue', id, undefined, { code, balance: input.initialBalance });
    return { success: true, data: mapCard(db.select().from(giftCards).where(eq(giftCards.id, id)).get()!) };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Issue failed' };
  }
}

export function handleGiftCardReload(input: ReloadGiftCardInput): ApiResult<GiftCard> {
  try {
    requireRole('super_admin', 'manager');
    const db = getDb();
    const row = db.select().from(giftCards).where(eq(giftCards.code, input.code.trim().toUpperCase())).get();
    if (!row) return { success: false, error: 'Gift card not found' };
    if (row.status !== 'active') return { success: false, error: 'Gift card is not active' };

    const now = new Date().toISOString();
    const newBalance = row.currentBalance + input.amount;
    db.update(giftCards)
      .set({ currentBalance: newBalance, updatedAt: now })
      .where(eq(giftCards.id, row.id))
      .run();

    logAudit('gift_cards', 'reload', row.id, { balance: row.currentBalance }, { balance: newBalance });
    return { success: true, data: mapCard(db.select().from(giftCards).where(eq(giftCards.id, row.id)).get()!) };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Reload failed' };
  }
}

export function handleGiftCardDeactivate(id: string): ApiResult<GiftCard> {
  try {
    requireRole('super_admin', 'manager');
    const db = getDb();
    const row = db.select().from(giftCards).where(eq(giftCards.id, id)).get();
    if (!row) return { success: false, error: 'Gift card not found' };
    if (row.status === 'cancelled') return { success: false, error: 'Already deactivated' };

    const now = new Date().toISOString();
    db.update(giftCards)
      .set({ status: 'cancelled', updatedAt: now })
      .where(eq(giftCards.id, id))
      .run();

    logAudit('gift_cards', 'deactivate', id, { status: row.status }, { status: 'cancelled' });
    return { success: true, data: mapCard(db.select().from(giftCards).where(eq(giftCards.id, id)).get()!) };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Deactivate failed' };
  }
}

export function redeemGiftCard(code: string, amount: number): void {
  const db = getDb();
  const row = db.select().from(giftCards).where(eq(giftCards.code, code.trim().toUpperCase())).get();
  if (!row) throw new Error('Gift card not found');
  if (row.status !== 'active') throw new Error('Gift card is not active');
  if (row.currentBalance < amount) throw new Error('Insufficient gift card balance');

  const now = new Date().toISOString();
  const newBalance = row.currentBalance - amount;
  db.update(giftCards)
    .set({
      currentBalance: newBalance,
      status: newBalance <= 0 ? 'depleted' : 'active',
      updatedAt: now,
    })
    .where(eq(giftCards.id, row.id))
    .run();
}
