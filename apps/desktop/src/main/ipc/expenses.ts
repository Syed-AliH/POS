import { and, desc, eq } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import { expenseCategories, expenses, shifts, users } from '@mama-babi/db-schema';
import type {
  ApiResult,
  CreateExpenseInput,
  ExpenseCategory,
  ExpenseListParams,
  ExpenseSummary,
  UpdateExpenseInput,
  UserSession,
} from '@shared/types';
import { getDb } from '../db';
import { coerceReportDateRange, localCalendarDate } from '../lib/reportDateRange';
import { requireRole, requireSession } from '../session';
import { logAudit } from '../services/audit';
import { getSetting } from '../services/settings';

// Offline-mode copy of apps/api expenses.service.ts — in the bundled (cloud) setup the
// IPC channels are forwarded there by withCloud and these never run. Keep the rules
// (who may edit, what counts) in step with it.

/** Counts toward a day's total: not deleted, not rejected — see countedExpense in apps/api. */
export function isCountedExpense(row: { isDeleted: boolean; status: string }): boolean {
  return !row.isDeleted && row.status !== 'rejected';
}

export function handleExpenseCategories(): ApiResult<ExpenseCategory[]> {
  try {
    requireSession();
    const db = getDb();
    const rows = db.select().from(expenseCategories).where(eq(expenseCategories.isDeleted, false)).all();
    return {
      success: true,
      data: rows.map((r) => ({ id: r.id, name: r.name, description: r.description })),
    };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Categories failed' };
  }
}

function mapExpense(row: typeof expenses.$inferSelect): ExpenseSummary {
  const db = getDb();
  const cat = db.select().from(expenseCategories).where(eq(expenseCategories.id, row.categoryId)).get();
  const payer = db.select().from(users).where(eq(users.id, row.paidBy)).get();
  return {
    id: row.id,
    categoryId: row.categoryId,
    categoryName: cat?.name ?? 'Unknown',
    amount: row.amount,
    paidBy: row.paidBy,
    paidByName: payer?.name ?? 'Unknown',
    notes: row.notes,
    status: row.status,
    createdAt: row.createdAt,
  };
}

function loadExpense(id: string) {
  const row = getDb().select().from(expenses).where(eq(expenses.id, id)).get();
  return row && !row.isDeleted ? row : null;
}

/** Managers change any expense; a cashier only their own, on the day it was entered. */
function canModify(session: UserSession, row: typeof expenses.$inferSelect): string | null {
  if (session.role !== 'cashier') return null;
  if (row.paidBy !== session.id) return 'Only a manager can change another person’s expense';
  if (localCalendarDate(new Date(row.createdAt)) !== localCalendarDate()) {
    return 'Only a manager can change an expense from an earlier day';
  }
  return null;
}

export function handleExpenseCreate(input: CreateExpenseInput): ApiResult<ExpenseSummary> {
  try {
    const session = requireSession();
    if (!(input.amount > 0)) return { success: false, error: 'Amount must be positive' };

    const db = getDb();
    const cat = db.select().from(expenseCategories).where(eq(expenseCategories.id, input.categoryId)).get();
    if (!cat) return { success: false, error: 'Category not found' };

    const now = new Date().toISOString();
    const deviceId = getSetting('device_id') ?? 'local-device';
    const branchId = getSetting('branch_id') ?? 'main';
    const id = uuid();
    const openShift = db
      .select()
      .from(shifts)
      .where(and(eq(shifts.cashierId, session.id), eq(shifts.status, 'open')))
      .get();

    db.insert(expenses).values({
      id,
      categoryId: input.categoryId,
      amount: input.amount,
      paidBy: session.id,
      notes: input.notes?.trim() || null,
      shiftId: openShift?.id ?? null,
      status: session.role === 'cashier' ? 'pending' : 'approved',
      approvedBy: session.role === 'cashier' ? null : session.id,
      deviceId,
      branchId,
      createdAt: now,
      updatedAt: now,
    }).run();

    logAudit('expenses', 'create', id, undefined, { amount: input.amount });
    return { success: true, data: mapExpense(loadExpense(id)!) };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Create failed' };
  }
}

export function handleExpenseList(params?: ExpenseListParams | number): ApiResult<ExpenseSummary[]> {
  try {
    // Cashiers record the day's expenses and EOD reads them back, so listing is open
    // to every signed-in role; approving stays manager-only.
    requireSession();
    const db = getDb();
    const opts = typeof params === 'number' ? { limit: params } : params ?? {};
    const limit = opts.limit ?? 200;
    const { startDate, endDate } = coerceReportDateRange({ startDate: opts.startDate, endDate: opts.endDate });

    const rows = db
      .select()
      .from(expenses)
      .where(eq(expenses.isDeleted, false))
      .orderBy(desc(expenses.createdAt))
      .all()
      .filter((r) => {
        if (opts.categoryId && r.categoryId !== opts.categoryId) return false;
        if (opts.status && r.status !== opts.status) return false;
        const day = localCalendarDate(new Date(r.createdAt));
        return day >= startDate && day <= endDate;
      });

    return { success: true, data: rows.slice(0, limit).map(mapExpense) };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'List failed' };
  }
}

export function handleExpenseUpdate(id: string, input: UpdateExpenseInput): ApiResult<ExpenseSummary> {
  try {
    const session = requireSession();
    const row = loadExpense(id);
    if (!row) return { success: false, error: 'Expense not found' };
    const denied = canModify(session, row);
    if (denied) return { success: false, error: denied };
    if (input.amount !== undefined && !(input.amount > 0)) return { success: false, error: 'Amount must be positive' };

    const db = getDb();
    if (input.categoryId && !db.select().from(expenseCategories).where(eq(expenseCategories.id, input.categoryId)).get()) {
      return { success: false, error: 'Category not found' };
    }

    const patch: Partial<typeof expenses.$inferInsert> = { updatedAt: new Date().toISOString() };
    if (input.categoryId) patch.categoryId = input.categoryId;
    if (input.amount !== undefined) patch.amount = input.amount;
    if (input.notes !== undefined) patch.notes = input.notes?.trim() || null;
    // A cashier changing an approved expense sends it back for sign-off.
    if (session.role === 'cashier' && row.status === 'approved') {
      patch.status = 'pending';
      patch.approvedBy = null;
    }
    db.update(expenses).set(patch).where(eq(expenses.id, id)).run();

    logAudit('expenses', 'update', id, { amount: row.amount, notes: row.notes }, { amount: input.amount, notes: input.notes });
    return { success: true, data: mapExpense(loadExpense(id)!) };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Update failed' };
  }
}

/** Soft delete — the row stays for the audit trail but stops counting anywhere. */
export function handleExpenseDelete(id: string): ApiResult<void> {
  try {
    const session = requireSession();
    const row = loadExpense(id);
    if (!row) return { success: false, error: 'Expense not found' };
    const denied = canModify(session, row);
    if (denied) return { success: false, error: denied };

    getDb()
      .update(expenses)
      .set({ isDeleted: true, updatedAt: new Date().toISOString() })
      .where(eq(expenses.id, id))
      .run();
    logAudit('expenses', 'delete', id, { amount: row.amount });
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Delete failed' };
  }
}

export function handleExpenseApprove(id: string): ApiResult<ExpenseSummary> {
  try {
    const session = requireRole('super_admin', 'manager');
    const db = getDb();
    const row = loadExpense(id);
    if (!row) return { success: false, error: 'Expense not found' };

    const now = new Date().toISOString();
    db.update(expenses)
      .set({ status: 'approved', approvedBy: session.id, updatedAt: now })
      .where(eq(expenses.id, id))
      .run();

    logAudit('expenses', 'approve', id);
    return { success: true, data: mapExpense(loadExpense(id)!) };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Approve failed' };
  }
}
