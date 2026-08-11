import { create } from 'zustand';
import type { UserSession } from '@shared/types';
import { ensureBridge, getApi } from '../lib/api';

interface AuthState {
  session: UserSession | null;
  loading: boolean;
  initError: string | null;
  loginError: string | null;
  init: () => Promise<void>;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  clearLoginError: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  session: null,
  loading: true,
  initError: null,
  loginError: null,

  init: async () => {
    try {
      await ensureBridge();
      const result = await getApi().auth.getSession();
      set({ session: result.data ?? null, loading: false, initError: null });
    } catch (e) {
      set({
        session: null,
        loading: false,
        initError: e instanceof Error ? e.message : 'Failed to connect to app backend',
      });
    }
  },

  login: async (username, password) => {
    set({ loading: true, loginError: null });
    const result = await getApi().auth.login({ username, password });
    if (result.success && result.data) {
      set({ session: result.data, loading: false, loginError: null });
      return true;
    }
    set({ loading: false, loginError: result.error ?? 'Login failed' });
    return false;
  },

  logout: async () => {
    // Clear the session first: if the logout call hangs or throws (no network in
    // cloud mode), the operator is still returned to a usable login screen rather
    // than being stranded on the till.
    set({ session: null, loginError: null, loading: false });
    try {
      await getApi().auth.logout();
    } catch {
      // The local session is already gone; a failed server call must not block sign-in.
    }
  },

  clearLoginError: () => set({ loginError: null }),
}));
