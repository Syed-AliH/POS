import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import { users } from '@mama-babi/db-schema';
import { getDb } from '../db';
import { getSetting } from './settings';

const DEFAULT_USERNAME = 'admin';
const DEFAULT_PASSWORD = 'admin123';

async function hashDefaultPassword(): Promise<string> {
  return bcrypt.hash(DEFAULT_PASSWORD, 12);
}

function insertAdminUser(passwordHash: string): void {
  const db = getDb();
  const now = new Date().toISOString();
  const deviceId = getSetting('device_id') ?? 'local-device';
  const branchId = getSetting('branch_id') ?? 'main';

  db.insert(users).values({
    id: uuid(),
    name: 'Admin',
    username: DEFAULT_USERNAME,
    passwordHash,
    pinHash: '',
    role: 'super_admin',
    deviceId,
    branchId,
    createdAt: now,
    updatedAt: now,
  }).run();

  console.log(`[auth] Created admin user. Login: ${DEFAULT_USERNAME} / ${DEFAULT_PASSWORD}`);
}

/**
 * Ensures at least one username/password account exists (fresh DB or PIN-only legacy DB).
 */
export async function ensureAuthCredentials(): Promise<void> {
  const db = getDb();
  const allUsers = db.select().from(users).where(eq(users.isDeleted, false)).all();

  const adminWithPassword = db
    .select()
    .from(users)
    .where(eq(users.username, DEFAULT_USERNAME))
    .get();

  if (adminWithPassword?.passwordHash && adminWithPassword.isActive) {
    return;
  }

  const passwordHash = await hashDefaultPassword();
  const now = new Date().toISOString();

  if (allUsers.length === 0) {
    insertAdminUser(passwordHash);
    return;
  }

  if (adminWithPassword && !adminWithPassword.passwordHash) {
    db.update(users)
      .set({ passwordHash, failedLoginAttempts: 0, lockedUntil: null, updatedAt: now })
      .where(eq(users.id, adminWithPassword.id))
      .run();
    console.log(`[auth] Set password for existing "${DEFAULT_USERNAME}" user`);
    return;
  }

  const target =
    allUsers.find((u) => u.role === 'super_admin' && u.isActive) ??
    allUsers.find((u) => u.role === 'manager' && u.isActive) ??
    allUsers.find((u) => u.isActive);

  if (!target) {
    insertAdminUser(passwordHash);
    return;
  }

  db.update(users)
    .set({
      username: DEFAULT_USERNAME,
      passwordHash,
      role: target.role === 'cashier' ? 'super_admin' : target.role,
      failedLoginAttempts: 0,
      lockedUntil: null,
      updatedAt: now,
    })
    .where(eq(users.id, target.id))
    .run();

  console.log(`[auth] Password login enabled for "${target.name}". Login: ${DEFAULT_USERNAME} / ${DEFAULT_PASSWORD}`);
}
