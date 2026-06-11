import type { UserSession } from '@shared/types';

let currentSession: UserSession | null = null;

export function getSession(): UserSession | null {
  return currentSession;
}

export function setSession(session: UserSession | null): void {
  currentSession = session;
}

export function requireSession(): UserSession {
  if (!currentSession) throw new Error('Not authenticated');
  return currentSession;
}

export function requireRole(...roles: UserSession['role'][]): UserSession {
  const session = requireSession();
  if (!roles.includes(session.role)) throw new Error('Insufficient permissions');
  return session;
}
