import bcrypt from 'bcryptjs';
import { and, eq } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import { users } from '@mama-babi/db-pg';
import type { PostgresClient } from '@mama-babi/db-pg';
import type { ApiResult } from '../types';
import { getDefaultPermissions } from './permissions';

export interface StaffUser {
  id: string;
  name: string;
  username: string | null;
  email: string | null;
  phone: string | null;
  role: string;
  isActive: boolean;
  permissions: string[];
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
}

export interface CreateUserInput {
  name: string;
  username: string;
  password: string;
  role: string;
  email?: string;
  phone?: string;
  permissions?: string[];
}

export interface UpdateUserInput {
  name?: string;
  email?: string;
  phone?: string;
  role?: string;
  isActive?: boolean;
  permissions?: string[];
}

function mapUser(row: typeof users.$inferSelect): StaffUser {
  return {
    id: row.id,
    name: row.name,
    username: row.username ?? null,
    email: row.email ?? null,
    phone: row.phone ?? null,
    role: row.role,
    isActive: row.isActive,
    permissions: row.permissionsJson ? (JSON.parse(row.permissionsJson) as string[]) : getDefaultPermissions(row.role),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastLoginAt: row.lastLoginAt ?? null,
  };
}

export async function listUsers(db: PostgresClient): Promise<ApiResult<StaffUser[]>> {
  const rows = await db.select().from(users).where(eq(users.isDeleted, false));
  return { success: true, data: rows.map(mapUser) };
}

export async function getUser(db: PostgresClient, id: string): Promise<ApiResult<StaffUser>> {
  const [row] = await db.select().from(users).where(and(eq(users.id, id), eq(users.isDeleted, false))).limit(1);
  if (!row) return { success: false, error: 'User not found' };
  return { success: true, data: mapUser(row) };
}

export async function createUser(
  db: PostgresClient,
  input: CreateUserInput,
  createdBy: string,
): Promise<ApiResult<StaffUser>> {
  if (!input.username?.trim()) return { success: false, error: 'Username is required' };
  if (!input.password || input.password.length < 8) {
    return { success: false, error: 'Password must be at least 8 characters' };
  }

  const uname = input.username.trim().toLowerCase();
  const [existing] = await db.select().from(users).where(eq(users.username, uname)).limit(1);
  if (existing) return { success: false, error: 'Username already exists' };

  const role = input.role ?? 'cashier';
  const permissions = input.permissions ?? getDefaultPermissions(role);
  const now = new Date().toISOString();
  const id = uuid();
  const passwordHash = await bcrypt.hash(input.password, 12);

  await db.insert(users).values({
    id,
    name: input.name.trim(),
    username: uname,
    email: input.email?.trim() || null,
    phone: input.phone?.trim() || null,
    passwordHash,
    role: role as typeof users.$inferInsert['role'],
    isActive: true,
    permissionsJson: JSON.stringify(permissions),
    deviceId: 'cloud',
    branchId: 'main',
    createdAt: now,
    updatedAt: now,
  });

  void createdBy;
  const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return { success: true, data: mapUser(row!) };
}

export async function updateUser(
  db: PostgresClient,
  id: string,
  input: UpdateUserInput,
  requesterId: string,
): Promise<ApiResult<StaffUser>> {
  const [existing] = await db.select().from(users).where(and(eq(users.id, id), eq(users.isDeleted, false))).limit(1);
  if (!existing) return { success: false, error: 'User not found' };

  // Prevent privilege escalation: non-admin cannot give super_admin role
  const updates: Partial<typeof users.$inferInsert> = {
    updatedAt: new Date().toISOString(),
  };

  if (input.name !== undefined) updates.name = input.name.trim();
  if (input.email !== undefined) updates.email = input.email?.trim() || null;
  if (input.phone !== undefined) updates.phone = input.phone?.trim() || null;
  if (input.isActive !== undefined) updates.isActive = input.isActive;
  if (input.role !== undefined) {
    updates.role = input.role as typeof users.$inferInsert['role'];
  }
  if (input.permissions !== undefined) {
    updates.permissionsJson = JSON.stringify(input.permissions);
  }

  void requesterId;
  await db.update(users).set(updates).where(eq(users.id, id));
  const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return { success: true, data: mapUser(row!) };
}

export async function deleteUser(
  db: PostgresClient,
  id: string,
  requesterId: string,
): Promise<ApiResult<void>> {
  if (id === requesterId) return { success: false, error: 'Cannot delete your own account' };

  const [existing] = await db.select().from(users).where(and(eq(users.id, id), eq(users.isDeleted, false))).limit(1);
  if (!existing) return { success: false, error: 'User not found' };

  // Check if this is the last super_admin
  if (existing.role === 'super_admin') {
    const adminCount = await db
      .select()
      .from(users)
      .where(and(eq(users.role, 'super_admin'), eq(users.isActive, true), eq(users.isDeleted, false)));
    if (adminCount.length <= 1) {
      return { success: false, error: 'Cannot delete the last administrator account' };
    }
  }

  await db
    .update(users)
    .set({ isDeleted: true, isActive: false, updatedAt: new Date().toISOString() })
    .where(eq(users.id, id));

  return { success: true, data: undefined };
}

export async function resetPassword(
  db: PostgresClient,
  id: string,
  newPassword: string,
): Promise<ApiResult<void>> {
  if (!newPassword || newPassword.length < 8) {
    return { success: false, error: 'Password must be at least 8 characters' };
  }

  const [existing] = await db.select().from(users).where(and(eq(users.id, id), eq(users.isDeleted, false))).limit(1);
  if (!existing) return { success: false, error: 'User not found' };

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await db.update(users).set({
    passwordHash,
    failedLoginAttempts: 0,
    lockedUntil: null,
    updatedAt: new Date().toISOString(),
  }).where(eq(users.id, id));

  return { success: true, data: undefined };
}

export async function recordLogin(db: PostgresClient, userId: string): Promise<void> {
  try {
    await db.update(users).set({ lastLoginAt: new Date().toISOString() }).where(eq(users.id, userId));
  } catch {
    // Non-critical
  }
}
