import bcrypt from 'bcryptjs';
import { and, eq } from 'drizzle-orm';
import { users } from '@mama-babi/db-schema';
import type { ApiResult, UserSession } from '@shared/types';
import { getDefaultPermissions } from '@shared/permissions';
import { getDb } from '../db';
import { getSession, setSession } from '../session';
import { logAudit } from '../services/audit';

const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

function toSession(user: typeof users.$inferSelect): UserSession {
  const row = user as typeof user & { permissionsJson?: string | null };
  const permissions: string[] = row.permissionsJson
    ? (JSON.parse(row.permissionsJson) as string[])
    : getDefaultPermissions(user.role);
  return { id: user.id, name: user.name, role: user.role, permissions };
}

export async function handleLogin(username: string, password: string): Promise<ApiResult<UserSession>> {
  try {
    const db = getDb();
    const user = db
      .select()
      .from(users)
      .where(and(eq(users.username, username.trim().toLowerCase()), eq(users.isActive, true), eq(users.isDeleted, false)))
      .get();

    if (!user) return { success: false, error: 'Invalid username or password' };

    if (user.lockedUntil && new Date(user.lockedUntil) > new Date()) {
      return { success: false, error: 'Account locked. Try again later.' };
    }

    if (!user.passwordHash) {
      return { success: false, error: 'Password not set. Contact administrator.' };
    }

    const match = await bcrypt.compare(password, user.passwordHash);
    const now = new Date().toISOString();

    if (!match) {
      const attempts = (user.failedLoginAttempts ?? 0) + 1;
      const updates: Partial<typeof users.$inferInsert> = {
        failedLoginAttempts: attempts,
        updatedAt: now,
      };
      if (attempts >= MAX_ATTEMPTS) {
        updates.lockedUntil = new Date(Date.now() + LOCK_MINUTES * 60000).toISOString();
        updates.failedLoginAttempts = 0;
      }
      db.update(users).set(updates).where(eq(users.id, user.id)).run();
      return { success: false, error: 'Invalid username or password' };
    }

    db.update(users)
      .set({ failedLoginAttempts: 0, lockedUntil: null, updatedAt: now })
      .where(eq(users.id, user.id))
      .run();
    // Record last login time (best-effort, column may not exist in older schema versions)
    try {
      db.update(users).set({ updatedAt: now } as Partial<typeof users.$inferInsert>).where(eq(users.id, user.id)).run();
    } catch { /* non-critical */ }

    const session = toSession(user);
    setSession(session);
    logAudit('auth', 'login', user.id);
    return { success: true, data: session };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Login failed' };
  }
}

export function handleLogout(): ApiResult<void> {
  const session = getSession();
  if (session) logAudit('auth', 'logout', session.id);
  setSession(null);
  return { success: true };
}

export function handleGetSession(): ApiResult<UserSession | null> {
  return { success: true, data: getSession() };
}

export async function handleVerifyManagerPin(_pin: string): Promise<ApiResult<boolean>> {
  const session = getSession();
  if (!session) return { success: true, data: false };
  return { success: true, data: session.role === 'manager' || session.role === 'super_admin' };
}
