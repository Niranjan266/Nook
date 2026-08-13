import { create } from 'zustand';
import { get as apiGet, post, patch, setToken, bootstrapSession } from '@/lib/api';
import type { Me } from '@/lib/types';

interface AuthState {
  me: Me | null;
  status: 'loading' | 'out' | 'in';
  init: () => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  signup: (input: { username: string; displayName: string; password: string; email?: string }) => Promise<void>;
  logout: () => Promise<void>;
  patchMe: (patchBody: Partial<Me> | Record<string, unknown>) => Promise<void>;
  setMe: (me: Me) => void;
}

export const useAuth = create<AuthState>((set, get) => ({
  me: null,
  status: 'loading',

  async init() {
    const ok = await bootstrapSession();
    if (!ok) return set({ status: 'out', me: null });
    try {
      const { user } = await apiGet<{ user: Me }>('/auth/me');
      set({ me: user, status: 'in' });
    } catch {
      set({ status: 'out', me: null });
    }
  },

  async login(username, password) {
    const data = await post<{ user: Me; accessToken: string }>('/auth/login', { username, password });
    setToken(data.accessToken);
    set({ me: data.user, status: 'in' });
  },

  async signup(input) {
    const data = await post<{ user: Me; accessToken: string }>('/auth/signup', input);
    setToken(data.accessToken);
    set({ me: data.user, status: 'in' });
  },

  async logout() {
    try {
      await post('/auth/logout');
    } catch {
      /* going anyway */
    }
    setToken(null);
    set({ me: null, status: 'out' });
  },

  async patchMe(patchBody) {
    const { user } = await patch<{ user: Me }>('/users/me', patchBody);
    set({ me: { ...(get().me as Me), ...user } });
  },

  setMe: (me) => set({ me }),
}));
