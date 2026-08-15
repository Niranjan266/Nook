import { create } from 'zustand';
import { get as apiGet, post, patch, setToken, getToken, bootstrapSession } from '@/lib/api';
import type { Me } from '@/lib/types';

interface AuthState {
  me: Me | null;
  status: 'loading' | 'out' | 'in';
  /** `handed` is a session passed over by the admin panel; it wins over any cookie. */
  init: (handed?: string | null) => Promise<void>;
  adopt: (user: Me, accessToken: string) => void;
  login: (username: string, password: string) => Promise<void>;
  signup: (input: { username: string; displayName: string; password: string; email?: string }) => Promise<void>;
  logout: () => Promise<void>;
  patchMe: (patchBody: Partial<Me> | Record<string, unknown>) => Promise<void>;
  setMe: (me: Me) => void;
}

export const useAuth = create<AuthState>((set, get) => ({
  me: null,
  status: 'loading',

  /**
   * Restore a session at boot.
   *
   * `bootstrapSession` trades the refresh cookie for an access token. It can
   * legitimately fail while we are nonetheless signed in: the cookie is
   * cross-site whenever the app and API are on different domains, and Safari
   * and Firefox drop those by default. Treating that failure as "signed out"
   * used to discard an access token we had *just* been handed, which is how a
   * successful sign-in ended on a blank screen.
   *
   * So: if the refresh fails but we are holding a token, ask `/auth/me`
   * anyway. Only when that also fails are we actually signed out.
   */
  async init(handed) {
    /**
     * A token handed over by the admin panel wins outright, and must not go
     * anywhere near `bootstrapSession` first.
     *
     * Refreshing is not harmless here: on failure it calls `setToken(null)`,
     * so the freshly handed token was being wiped before it was ever used and
     * "open this account" signed you out instead. On success it is worse —
     * the token gets replaced by whoever was signed in before, and you land
     * silently in the wrong account.
     */
    if (handed) {
      setToken(handed);
      try {
        const { user } = await apiGet<{ user: Me }>('/auth/me');
        return set({ me: user, status: 'in' });
      } catch {
        // Expired or revoked before it was used. Fall through to the normal
        // path so the person at least gets their own session back.
        setToken(null);
      }
    }

    const refreshed = await bootstrapSession();

    if (!refreshed && !getToken()) return set({ status: 'out', me: null });

    try {
      const { user } = await apiGet<{ user: Me }>('/auth/me');
      set({ me: user, status: 'in' });
    } catch {
      setToken(null);
      set({ status: 'out', me: null });
    }
  },

  /**
   * Take a session the server has just handed us whole — sign-up, sign-in, or
   * the Google handoff exchange all return the user alongside the token.
   * There is nothing to look up, so no round trip and nothing to fail.
   */
  adopt(user, accessToken) {
    setToken(accessToken);
    set({ me: user, status: 'in' });
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
