import bcrypt from 'bcryptjs';
import { and, eq } from 'drizzle-orm';
import { users } from '@mama-babi/db-pg';
import type { PostgresClient } from '@mama-babi/db-pg';
import type { ApiResult, JwtUser } from '../types';

const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

export async function loginUser(
  db: PostgresClient,
  username: string,
  password: string,
): Promise<ApiResult<JwtUser>> {
  const [user] = await db
    .select()
    .from(users)
    .where(
      and(
        eq(users.username, username.trim().toLowerCase()),
        eq(users.isActive, true),
        eq(users.isDeleted, false),
      ),
    )
    .limit(1);

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
    await db.update(users).set(updates).where(eq(users.id, user.id));
    return { success: false, error: 'Invalid username or password' };
  }

  await db
    .update(users)
    .set({ failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: now, updatedAt: now })
    .where(eq(users.id, user.id));

  const { getDefaultPermissions } = await import('./permissions');
  const permissions: string[] = user.permissionsJson
    ? (JSON.parse(user.permissionsJson) as string[])
    : getDefaultPermissions(user.role);

  return {
    success: true,
    data: { id: user.id, name: user.name, role: user.role as JwtUser['role'], permissions },
  };
}

export function verifyManagerRole(user: JwtUser): boolean {
  return user.role === 'manager' || user.role === 'super_admin';
}
