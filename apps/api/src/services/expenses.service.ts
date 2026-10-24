import { and, desc, eq, gte, inArray, lt, ne } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import { expenseCategories, expenses, users } from '@mama-babi/db-pg';
import type { PostgresClient } from '@mama-babi/db-pg';
import { coerceReportDateRange, isoRangeBounds } from '../lib/reportDateRange';

/** The EOD form has no category picker — its lines land here by default. */
const DEFAULT_CATEGORY_NAME = 'Miscellaneous';

type SessionUser = { id: string; name: string; role: string };

/**
 * The one rule for which expenses count toward a day's total — on the Expenses tab,
 * in EOD, in reports and on the owner portal alike (desktop ipc/expenses.ts and
 * owner-portal api/_lib/expenses.ts use the same rule). Approval is a manager's
 * sign-off, not a condition for the cash having left the drawer, so a cashier's
 * pending expense counts the moment it is entered; only a deleted or rejected one
 * doesn't. Counting approved-only made the till and the portal disagree until
 * someone approved.
 */
export function countedExpense() {
  return and(eq(expenses.isDeleted, false), ne(expenses.status, 'rejected'));
}

function expenseDateFilter(params?: { startDate?: string; endDate?: string }) {
  const range = coerceReportDateRange(params);
  const { startInclusive, endExclusive } = isoRangeBounds(range);
  return and(gte(expenses.createdAt, startInclusive), lt(expenses.createdAt, endExclusive));
}

export async function findOrCreateDefaultCategory(db: PostgresClient): Promise<string> {
  const [existing] = await db
    .select({ id: expenseCategories.id })
    .from(expenseCategories)
    .where(and(eq(expenseCategories.name, DEFAULT_CATEGORY_NAME), eq(expenseCategories.isDeleted, false)))
    .limit(1);
  if (existing) return existing.id;

  const id = uuid();
  const now = new Date().toISOString();
  await db.insert(expenseCategories).values({
    id,
    name: DEFAULT_CATEGORY_NAME,
    description: 'Other expenses',
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

export async function listExpenseCategories(db: PostgresClient) {
  let rows = await db.select().from(expenseCategories).where(eq(expenseCategories.isDeleted, false));
  // A fresh database has no categories, and the Expenses tab can't add one without it.
  if (!rows.length) {
    await findOrCreateDefaultCategory(db);
    rows = await db.select().from(expenseCategories).where(eq(expenseCategories.isDeleted, false));
  }
  return {
    success: true as const,
    data: rows.map((r) => ({ id: r.id, name: r.name, description: r.description })),
  };
}

/** Desktop ExpenseSummary shape, with category and payer names joined in. */
async function summarizeExpenses(db: PostgresClient, rows: Array<typeof expenses.$inferSelect>) {
  if (!rows.length) return [];
  const categoryIds = [...new Set(rows.map((r) => r.categoryId))];
  const userIds = [...new Set(rows.map((r) => r.paidBy))];
  const [categoryRows, userRows] = await Promise.all([
    db.select({ id: expenseCategories.id, name: expenseCategories.name }).from(expenseCategories).where(inArray(expenseCategories.id, categoryIds)),
    db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, userIds)),
  ]);
  const categoryById = new Map(categoryRows.map((c) => [c.id, c.name]));
  const userById = new Map(userRows.map((u) => [u.id, u.name]));
  return rows.map((r) => ({
    id: r.id,
    categoryId: r.categoryId,
    categoryName: categoryById.get(r.categoryId) ?? 'Unknown',
    amount: r.amount,
    paidBy: r.paidBy,
    paidByName: userById.get(r.paidBy) ?? 'Unknown',
    notes: r.notes,
    status: r.status,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));
}

async function loadExpense(db: PostgresClient, id: string) {
  const [row] = await db.select().from(expenses).where(eq(expenses.id, id)).limit(1);
  return row && !row.isDeleted ? row : null;
}

/**
 * Who may change an expense: managers any; a cashier only their own, and only on the
 * day it was entered — yesterday's books are a manager's to correct.
 */
function canModify(user: SessionUser, row: typeof expenses.$inferSelect): string | null {
  if (user.role !== 'cashier') return null;
  if (row.paidBy !== user.id) return 'Only a manager can change another person’s expense';
  if (row.createdAt.slice(0, 10) !== new Date().toISOString().slice(0, 10)) {
    return 'Only a manager can change an expense from an earlier day';
  }
  return null;
}

/**
 * When an expense happened. The owner portal may date an expense a day or two back;
 * today (or nothing) means "now", an earlier day is stored at midday UTC so it lands
 * inside that calendar day in every report. Same rule as the portal's
 * api/_lib/expenses.ts expenseTimestamp.
 */
export function expenseTimestamp(expenseDate: string | undefined, now = new Date()): string | { error: string } {
  const nowIso = now.toISOString();
  if (!expenseDate || expenseDate === nowIso.slice(0, 10)) return nowIso;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expenseDate) || Number.isNaN(Date.parse(`${expenseDate}T12:00:00Z`))) {
    return { error: 'Invalid expense date' };
  }
  const days = (Date.parse(`${expenseDate}T12:00:00Z`) - now.getTime()) / 86_400_000;
  if (days > 1) return { error: 'An expense can’t be dated in the future' };
  if (days < -366) return { error: 'An expense can’t be dated more than a year back' };
  return `${expenseDate}T12:00:00.000Z`;
}

export async function listExpenses(
  db: PostgresClient,
  params?: { startDate?: string; endDate?: string; status?: string; categoryId?: string; limit?: number },
) {
  const conditions = [expenseDateFilter(params), eq(expenses.isDeleted, false)];
  if (params?.status) conditions.push(eq(expenses.status, params.status));
  if (params?.categoryId) conditions.push(eq(expenses.categoryId, params.categoryId));
  const rows = await db
    .select()
    .from(expenses)
    .where(and(...conditions))
    .orderBy(desc(expenses.createdAt))
    .limit(Math.min(params?.limit ?? 200, 1000));
  return { success: true as const, data: await summarizeExpenses(db, rows) };
}

export async function createExpense(
  db: PostgresClient,
  user: SessionUser,
  input: { categoryId: string; amount: number; notes?: string; expenseDate?: string },
) {
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    return { success: false as const, error: 'Amount must be positive' };
  }
  const when = expenseTimestamp(input.expenseDate);
  if (typeof when !== 'string') return { success: false as const, error: when.error };
  const [category] = await db
    .select()
    .from(expenseCategories)
    .where(eq(expenseCategories.id, input.categoryId))
    .limit(1);
  if (!category) return { success: false as const, error: 'Category not found' };

  const now = new Date().toISOString();
  const id = uuid();
  // A cashier's expense waits for a manager's sign-off; a manager's is approved as
  // entered — same rule as handleExpenseCreate on the desktop. Both count either way.
  const approved = user.role !== 'cashier';
  await db.insert(expenses).values({
    id,
    categoryId: input.categoryId,
    amount: input.amount,
    paidBy: user.id,
    notes: input.notes?.trim() || null,
    status: approved ? 'approved' : 'pending',
    approvedBy: approved ? user.id : null,
    createdAt: when,
    updatedAt: now,
  });

  const row = await loadExpense(db, id);
  const [summary] = await summarizeExpenses(db, row ? [row] : []);
  return { success: true as const, data: summary! };
}

export async function updateExpense(
  db: PostgresClient,
  user: SessionUser,
  id: string,
  input: { categoryId?: string; amount?: number; notes?: string | null; expenseDate?: string },
) {
  const row = await loadExpense(db, id);
  if (!row) return { success: false as const, error: 'Expense not found' };
  const denied = canModify(user, row);
  if (denied) return { success: false as const, error: denied };
  if (input.amount !== undefined && (!Number.isFinite(input.amount) || input.amount <= 0)) {
    return { success: false as const, error: 'Amount must be positive' };
  }
  if (input.categoryId) {
    const [category] = await db.select().from(expenseCategories).where(eq(expenseCategories.id, input.categoryId)).limit(1);
    if (!category) return { success: false as const, error: 'Category not found' };
  }

  const patch: Partial<typeof expenses.$inferInsert> = { updatedAt: new Date().toISOString() };
  if (input.categoryId) patch.categoryId = input.categoryId;
  if (input.amount !== undefined) patch.amount = input.amount;
  if (input.notes !== undefined) patch.notes = input.notes?.trim() || null;
  if (input.expenseDate) {
    const when = expenseTimestamp(input.expenseDate);
    if (typeof when !== 'string') return { success: false as const, error: when.error };
    patch.createdAt = when;
  }
  // A cashier changing an approved expense sends it back for sign-off.
  if (user.role === 'cashier' && row.status === 'approved') {
    patch.status = 'pending';
    patch.approvedBy = null;
  }
  await db.update(expenses).set(patch).where(eq(expenses.id, id));

  const updated = await loadExpense(db, id);
  const [summary] = await summarizeExpenses(db, updated ? [updated] : []);
  return { success: true as const, data: summary! };
}

/** Soft delete — the row stays for the audit trail but stops counting anywhere. */
export async function deleteExpense(db: PostgresClient, user: SessionUser, id: string) {
  const row = await loadExpense(db, id);
  if (!row) return { success: false as const, error: 'Expense not found' };
  const denied = canModify(user, row);
  if (denied) return { success: false as const, error: denied };
  await db
    .update(expenses)
    .set({ isDeleted: true, updatedAt: new Date().toISOString() })
    .where(eq(expenses.id, id));
  return { success: true as const, data: undefined };
}

export async function approveExpense(db: PostgresClient, user: SessionUser, id: string) {
  const row = await loadExpense(db, id);
  if (!row) return { success: false as const, error: 'Expense not found' };
  await db
    .update(expenses)
    .set({ status: 'approved', approvedBy: user.id, updatedAt: new Date().toISOString() })
    .where(eq(expenses.id, id));
  const updated = await loadExpense(db, id);
  const [summary] = await summarizeExpenses(db, updated ? [updated] : []);
  return { success: true as const, data: summary! };
}

export async function listOwnerExpenses(
  db: PostgresClient,
  params?: { startDate?: string; endDate?: string; limit?: number },
) {
  const limit = Math.min(params?.limit ?? 100, 500);
  const rows = await db
    .select()
    .from(expenses)
    .where(and(countedExpense(), expenseDateFilter(params)))
    .orderBy(desc(expenses.createdAt))
    .limit(limit);

  const summaries = await summarizeExpenses(db, rows);
  return {
    success: true as const,
    data: summaries.map((r) => ({
      id: r.id,
      amount: r.amount,
      categoryId: r.categoryId,
      categoryName: r.categoryName,
      notes: r.notes,
      paidByName: r.paidByName,
      status: r.status,
      createdAt: r.createdAt,
    })),
  };
}

/** Counted-expense total per calendar day, for the Trends chart and EOD. */
export async function getExpenseTotalsByDay(
  db: PostgresClient,
  params?: { startDate?: string; endDate?: string },
) {
  const rows = await db
    .select({ createdAt: expenses.createdAt, amount: expenses.amount })
    .from(expenses)
    .where(and(countedExpense(), expenseDateFilter(params)));

  const byDay = new Map<string, number>();
  for (const r of rows) {
    const day = r.createdAt.slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + r.amount);
  }
  return byDay;
}
