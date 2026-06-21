import type { UserSession } from '@shared/types';

let authToken: string | null = null;
let cloudSession: UserSession | null = null;

export function getCloudSession(): UserSession | null {
  return cloudSession;
}

export function getAuthToken(): string | null {
  return authToken;
}

export function setCloudSession(session: UserSession | null, token?: string | null) {
  cloudSession = session;
  if (token !== undefined) authToken = token;
  if (!session) authToken = null;
}
