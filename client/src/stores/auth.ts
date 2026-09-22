import { create } from 'zustand';
import {
  get as apiGet,
  post,
  patch,
  setToken,
  getToken,
  bootstrapSession,
  lastRefreshFailure,
  ApiError,
} from '@/lib/api';
import { getSocket } from '@/lib/socket';
import type { Me } from '@/lib/types';
import { useChat } from '@/stores/chat';
import { useFriends } from '@/stores/friends';
import { useCall } from '@/stores/call';
import { useUi } from '@/stores/ui';
import { clearUnread } from '@/lib/notify';

/**
 * The signed-in profile, remembered on this device.
 *
 * Boot used to wait on the server before drawing anything: a refresh, then
 * /auth/me, then the conversations. On a host that sleeps that is a minute
 * and more of a pulsing logo. With the profile remembered, the app opens at
 * once on the cached chats and the session is restored behind it. Only the
 * profile — the access token never touches storage.
 */
const ME_KEY = 'nook.me';

function rememberedMe(): Me | null {
  try {
    const raw = localStorage.getItem(ME_KEY);
    return raw ? (JSON.parse(raw) as Me) : null;
  } catch {
    return null;
  }
}

function remember(me: Me | null) {
  try {
    if (me) localStorage.setItem(ME_KEY, JSON.stringify(me));
    else localStorage.removeItem(ME_KEY);
  } catch {
    /* storage blocked — boot simply waits for the server, as it used to */
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface AuthState {
  me: Me | null;
  status: 'loading' | 'out' | 'in';
  /** `handed` is a session passed over by the admin panel; it wins over any cookie. */
  init: (handed?: string | null) => Promise<void>;
  adopt: (user: Me, accessToken: string) => void;
  login: (username: string, password: string) => Promise<void>;
  signup: (input: { username: string; displayName: string; password: string; email?: string }) => Promise<void>;
  logout: () => Promise<void>;
  /** Clear every trace of the session locally, without asking the server. */
  signedOut: () => void;
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

    // Open now on the remembered profile; the session catches up behind it.
    const cached = rememberedMe();
    if (cached) set({ me: cached, status: 'in' });

    /**
     * Keep trying while the server is merely unreachable — a sleeping host
     * answers eventually, and giving up would sign out someone whose session
     * is fine. Only a refusal means signed out. Without a remembered profile
     * the loading screen stays up meanwhile and says what it is waiting for.
     */
    let waited = false;
    for (let delay = 2000; ; delay = Math.min(delay * 2, 20000)) {
      const refreshed = await bootstrapSession();
      if (!refreshed && !getToken()) {
        if (lastRefreshFailure() === 'unreachable') {
          waited = true;
          await sleep(delay);
          continue;
        }
        return get().signedOut();
      }

      try {
        const { user } = await apiGet<{ user: Me }>('/auth/me');
        set({ me: user, status: 'in' });
        break;
      } catch (err) {
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
          setToken(null);
          return get().signedOut();
        }
        waited = true;
        await sleep(delay);
      }
    }

    // Anything that ran before the session was back failed quietly; now that
    // it is, fetch fresh and get the socket dialling with the new token.
    if (waited) {
      useChat.getState().loadConversations().catch(() => {});
      const socket = getSocket();
      if (socket && !socket.connected) socket.connect();
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
    get().signedOut();
  },

  signedOut() {
    remember(null);
    /**
     * Everything user-scoped goes with the session. The stores are module
     * singletons, so without this the next account to sign in on this tab
     * inherited the last one's conversations, requests and open sheet until
     * each happened to be refetched.
     */
    if (useCall.getState().phase !== 'idle') useCall.getState().hangUp();
    useChat.getState().reset();
    useFriends.setState({ incoming: [], outgoing: [], loaded: false });
    useUi.setState({ sheet: null, sheetPayload: null, lightbox: null, wallpaperDraft: null });
    clearUnread();
    (window as any).__nookMeId = undefined;
    set({ me: null, status: 'out' });
  },

  async patchMe(patchBody) {
    const { user } = await patch<{ user: Me }>('/users/me', patchBody);
    set({ me: { ...(get().me as Me), ...user } });
  },

  setMe: (me) => set({ me }),
}));

// Whatever sets `me` — sign-in, Google, a profile edit — the device copy follows.
useAuth.subscribe((state, prev) => {
  if (state.me && state.me !== prev.me) remember(state.me);
});
