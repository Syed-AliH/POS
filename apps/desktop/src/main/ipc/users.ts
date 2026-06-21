import bcrypt from 'bcryptjs';
import { and, eq } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import { users } from '@mama-babi/db-schema';
import type {
  ApiResult,
  CreateStaffInput,
  ResetPasswordInput,
  StaffUser,
  UpdateStaffInput,
} from '@shared/types';
import { getDefaultPermissions } from '@shared/permissions';
import { getDb } from '../db';
import { requireRole } from '../session';
import { logAudit } from '../services/audit';
import { getSetting } from '../services/settings';

function mapUser(row: typeof users.$inferSelect): StaffUser {
  return {
    id: row.id,
    name: row.name,
    username: row.username ?? null,
    email: (row as Record<string, unknown>).email as string | null ?? null,
    phone: (row as Record<string, unknown>).phone as string | null ?? null,
    role: row.role,
    isActive: row.isActive,
    permissions: (() => {
      const pj = (row as Record<string, unknown>).permissionsJson as string | null;
      return pj ? (JSON.parse(pj) as string[]) : getDefaultPermissions(row.role);
    })(),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastLoginAt: (row as Record<string, unknown>).lastLoginAt as string | null ?? null,
  };
}

export function handleStaffList(): ApiResult<StaffUser[]> {
  try {
    requireRole('super_admin');
    const db = getDb();
    const rows = db.select().from(users).where(eq(users.isDeleted, false)).all();
    return { success: true, data: rows.map(mapUser) };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'List failed' };
  }
}

export function handleStaffGet(id: string): ApiResult<StaffUser> {
  try {
    requireRole('super_admin');
    const db = getDb();
    const row = db.select().from(users).where(and(eq(users.id, id), eq(users.isDeleted, false))).get();
    if (!row) return { success: false, error: 'User not found' };
    return { success: true, data: mapUser(row) };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Get failed' };
  }
}

export async function handleStaffCreate(input: CreateStaffInput): Promise<ApiResult<StaffUser>> {
  try {
    requireRole('super_admin');
    if (!input.username?.trim()) return { success: false, error: 'Username is required' };
    if (!input.password || input.password.length < 8) {
      return { success: false, error: 'Password must be at least 8 characters' };
    }

    const db = getDb();
    const existing = db.select().from(users).where(eq(users.username, input.username.trim().toLowerCase())).get();
    if (existing) return { success: false, error: 'Username already exists' };

    const now = new Date().toISOString();
    const deviceId = getSetting('device_id') ?? 'local-device';
    const branchId = getSetting('branch_id') ?? 'main';
    const id = uuid();
    const passwordHash = await bcrypt.hash(input.password, 12);
    const permissions = input.permissions ?? getDefaultPermissions(input.role);

    db.insert(users).values({
      id,
      name: input.name,
      username: input.username.trim().toLowerCase(),
      passwordHash,
      role: input.role,
      deviceId,
      branchId,
      createdAt: now,
      updatedAt: now,
      // Extra fields handled as dynamic properties for SQLite compatibility
      ...(input.email ? { email: input.email.trim() } : {}),
      ...(input.phone ? { phone: input.phone.trim() } : {}),
      permissionsJson: JSON.stringify(permissions),
    } as Parameters<typeof db.insert<typeof users>>[0] extends { values: (v: infer V) => unknown } ? V : never).run();

    logAudit('users', 'create', id, undefined, { name: input.name, role: input.role, username: input.username });
    return { success: true, data: mapUser(db.select().from(users).where(eq(users.id, id)).get()!) };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Create failed' };
  }
}

export async function handleStaffUpdate(id: string, input: UpdateStaffInput): Promise<ApiResult<StaffUser>> {
  try {
    requireRole('super_admin');
    const db = getDb();
    const existing = db.select().from(users).where(and(eq(users.id, id), eq(users.isDeleted, false))).get();
    if (!existing) return { success: false, error: 'User not found' };

    const now = new Date().toISOString();
    const updates: Record<string, unknown> = {
      name: input.name ?? existing.name,
      role: input.role ?? existing.role,
      isActive: input.isActive ?? existing.isActive,
      updatedAt: now,
    };

    if (input.email !== undefined) updates['email'] = input.email?.trim() || null;
    if (input.phone !== undefined) updates['phone'] = input.phone?.trim() || null;
    if (input.permissions !== undefined) updates['permissionsJson'] = JSON.stringify(input.permissions);

    if (input.username) {
      const uname = input.username.trim().toLowerCase();
      const dup = db.select().from(users).where(eq(users.username, uname)).get();
      if (dup && dup.id !== id) return { success: false, error: 'Username already exists' };
      updates['username'] = uname;
    }

    if (input.password) {
      if (input.password.length < 8) return { success: false, error: 'Password must be at least 8 characters' };
      updates['passwordHash'] = await bcrypt.hash(input.password, 12);
    }

    db.update(users).set(updates as Partial<typeof users.$inferInsert>).where(eq(users.id, id)).run();
    logAudit('users', 'update', id);
    return { success: true, data: mapUser(db.select().from(users).where(eq(users.id, id)).get()!) };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Update failed' };
  }
}

export async function handleStaffDelete(id: string): Promise<ApiResult<void>> {
  try {
    requireRole('super_admin');
    const db = getDb();

    const existing = db.select().from(users).where(and(eq(users.id, id), eq(users.isDeleted, false))).get();
    if (!existing) return { success: false, error: 'User not found' };

    if (existing.role === 'super_admin') {
      const admins = db.select().from(users)
        .where(and(eq(users.role, 'super_admin'), eq(users.isActive, true), eq(users.isDeleted, false)))
        .all();
      if (admins.length <= 1) {
        return { success: false, error: 'Cannot delete the last administrator account' };
      }
    }

    db.update(users).set({ isDeleted: true, isActive: false, updatedAt: new Date().toISOString() })
      .where(eq(users.id, id)).run();
    logAudit('users', 'delete', id);
    return { success: true, data: undefined };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Delete failed' };
  }
}

export async function handleStaffResetPassword(id: string, input: ResetPasswordInput): Promise<ApiResult<void>> {
  try {
    requireRole('super_admin');
    if (!input.password || input.password.length < 8) {
      return { success: false, error: 'Password must be at least 8 characters' };
    }

    const db = getDb();
    const existing = db.select().from(users).where(and(eq(users.id, id), eq(users.isDeleted, false))).get();
    if (!existing) return { success: false, error: 'User not found' };

    const passwordHash = await bcrypt.hash(input.password, 12);
    db.update(users).set({
      passwordHash,
      failedLoginAttempts: 0,
      lockedUntil: null,
      updatedAt: new Date().toISOString(),
    }).where(eq(users.id, id)).run();
    logAudit('users', 'reset_password', id);
    return { success: true, data: undefined };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Reset failed' };
  }
}
