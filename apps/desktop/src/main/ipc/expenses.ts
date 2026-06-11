import { and, desc, eq, gte, lte } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import { expenseCategories, expenses, shifts, users } from '@mama-babi/db-schema';
import type { ApiResult, CreateExpenseInput, ExpenseCategory, ExpenseListParams, ExpenseSummary } from '@shared/types';
import { getDb } from '../db';
import { coerceReportDateRange, localCalendarDate } from '../lib/reportDateRange';
import { requireRole, requireSession } from '../session';
import { logAudit } from '../services/audit';
import { getSetting } from '../services/settings';

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

export function handleExpenseCreate(input: CreateExpenseInput): ApiResult<ExpenseSummary> {
  try {
    const session = requireSession();
    if (input.amount <= 0) return { success: false, error: 'Amount must be positive' };

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
      notes: input.notes ?? null,
      shiftId: openShift?.id ?? null,
      status: session.role === 'cashier' ? 'pending' : 'approved',
      approvedBy: session.role === 'cashier' ? null : session.id,
      deviceId,
      branchId,
      createdAt: now,
      updatedAt: now,
    }).run();

    logAudit('expenses', 'create', id, undefined, { amount: input.amount });
    return { success: true, data: mapExpense(db.select().from(expenses).where(eq(expenses.id, id)).get()!) };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Create failed' };
  }
}

export function handleExpenseList(params?: ExpenseListParams | number): ApiResult<ExpenseSummary[]> {
  try {
    requireRole('super_admin', 'manager');
    const db = getDb();
    const opts = typeof params === 'number' ? { limit: params } : params ?? {};
    const limit = opts.limit ?? 50;
    let rows = db.select().from(expenses).orderBy(desc(expenses.createdAt)).limit(limit * 5).all();

    if (opts.categoryId) rows = rows.filter((r) => r.categoryId === opts.categoryId);
    if (opts.status) rows = rows.filter((r) => r.status === opts.status);
    if (opts.startDate || opts.endDate) {
      const { startDate, endDate } = coerceReportDateRange({
        startDate: opts.startDate,
        endDate: opts.endDate,
      });
      rows = rows.filter((r) => {
        const day = localCalendarDate(new Date(r.createdAt));
        return day >= startDate && day <= endDate;
      });
    }

    return { success: true, data: rows.slice(0, limit).map(mapExpense) };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'List failed' };
  }
}

export function handleExpenseApprove(id: string): ApiResult<ExpenseSummary> {
  try {
    const session = requireRole('super_admin', 'manager');
    const db = getDb();
    const row = db.select().from(expenses).where(eq(expenses.id, id)).get();
    if (!row) return { success: false, error: 'Expense not found' };

    const now = new Date().toISOString();
    db.update(expenses)
      .set({ status: 'approved', approvedBy: session.id, updatedAt: now })
      .where(eq(expenses.id, id))
      .run();

    logAudit('expenses', 'approve', id);
    return { success: true, data: mapExpense(db.select().from(expenses).where(eq(expenses.id, id)).get()!) };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Approve failed' };
  }
}
