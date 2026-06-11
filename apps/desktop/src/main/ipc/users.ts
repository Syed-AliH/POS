import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import { users } from '@mama-babi/db-schema';
import type { ApiResult, CreateStaffInput, StaffUser, UpdateStaffInput } from '@shared/types';
import { getDb } from '../db';
import { requireRole } from '../session';
import { logAudit } from '../services/audit';
import { getSetting } from '../services/settings';

function mapUser(row: typeof users.$inferSelect): StaffUser {
  return { id: row.id, name: row.name, username: row.username, role: row.role, isActive: row.isActive };
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

export async function handleStaffCreate(input: CreateStaffInput): Promise<ApiResult<StaffUser>> {
  try {
    requireRole('super_admin');
    if (!input.username?.trim()) return { success: false, error: 'Username is required' };
    if (!input.password || input.password.length < 6) return { success: false, error: 'Password must be at least 6 characters' };

    const db = getDb();
    const existing = db.select().from(users).where(eq(users.username, input.username.trim().toLowerCase())).get();
    if (existing) return { success: false, error: 'Username already exists' };

    const now = new Date().toISOString();
    const deviceId = getSetting('device_id') ?? 'local-device';
    const branchId = getSetting('branch_id') ?? 'main';
    const id = uuid();
    const passwordHash = await bcrypt.hash(input.password, 12);

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
    }).run();

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
    const existing = db.select().from(users).where(eq(users.id, id)).get();
    if (!existing) return { success: false, error: 'User not found' };

    const now = new Date().toISOString();
    const updates: Partial<typeof users.$inferInsert> = {
      name: input.name ?? existing.name,
      role: input.role ?? existing.role,
      isActive: input.isActive ?? existing.isActive,
      updatedAt: now,
    };

    if (input.username) {
      const uname = input.username.trim().toLowerCase();
      const dup = db.select().from(users).where(eq(users.username, uname)).get();
      if (dup && dup.id !== id) return { success: false, error: 'Username already exists' };
      updates.username = uname;
    }

    if (input.password) {
      if (input.password.length < 6) return { success: false, error: 'Password must be at least 6 characters' };
      updates.passwordHash = await bcrypt.hash(input.password, 12);
    }

    db.update(users).set(updates).where(eq(users.id, id)).run();
    logAudit('users', 'update', id);
    return { success: true, data: mapUser(db.select().from(users).where(eq(users.id, id)).get()!) };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Update failed' };
  }
}
