/**
 * The admin panel's own API client.
 *
 * Deliberately separate from lib/api.ts. That one holds a *user* session and
 * refreshes it from a cookie; this one holds a short-lived admin token and
 * must never accidentally send a user token to an admin route or the reverse.
 * Two small clients are clearer than one with a mode flag.
 *
 * The token lives in sessionStorage: it dies with the tab, which is the right
 * lifetime for an administrative tool, and it survives a refresh, which
 * in-memory would not. It expires server-side after two hours regardless.
 */
import { API_BASE } from './config';

const KEY = 'nook.admin.token';

export const adminToken = () => sessionStorage.getItem(KEY) || '';
export const setAdminToken = (token: string | null) =>
  token ? sessionStorage.setItem(KEY, token) : sessionStorage.removeItem(KEY);

export class AdminError extends Error {
  status: number;
  expired: boolean;
  constructor(message: string, status: number, expired = false) {
    super(message);
    this.status = status;
    this.expired = expired;
  }
}

async function call<T>(
  path: string,
  options: Omit<RequestInit, 'body'> & { body?: unknown; retries?: number } = {}
): Promise<T> {
  const { body, headers, retries = 0, ...rest } = options;

  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/admin${path}`, {
      ...rest,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(adminToken() ? { authorization: `Bearer ${adminToken()}` } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    /**
     * The API runs on a free instance that sleeps after fifteen idle minutes,
     * and the first request afterwards can take the best part of a minute
     * while the container starts. The browser gives up long before that, so
     * opening this page cold used to fail outright.
     *
     * Retried only where the caller asked for it — and callers only ask on
     * reads. Retrying a POST after a transport failure is not safe: the
     * request may have reached the server and been processed, and we would
     * have no way to know.
     */
    if (retries > 0) {
      await new Promise((r) => setTimeout(r, 2500));
      return call<T>(path, { ...options, retries: retries - 1 });
    }
    throw new AdminError(
      `Can't reach the server at ${API_BASE || 'this site'}. It may be starting up — wait a moment and try again.`,
      0
    );
  }

  const text = await res.text();
  const data = text && /^\s*[[{]/.test(text) ? JSON.parse(text) : {};

  if (!res.ok) {
    const expired = data.code === 'ADMIN_EXPIRED';
    // Clear a dead token rather than letting every later call fail the same
    // way — the panel can then show the sign-in form instead of a wall of
    // identical errors.
    if (expired) setAdminToken(null);
    throw new AdminError(data.error || `Request failed (${res.status})`, res.status, expired);
  }
  return data as T;
}

export const adminGet = <T,>(path: string) => call<T>(path);

/**
 * Wake a sleeping instance before the user has finished typing a password, so
 * signing in does not fail on a cold start. Safe to retry — it is a GET, and
 * it is the same request the panel needs anyway.
 */
export const adminWake = () => call<{ passwordSignIn: boolean; googleSignIn: boolean }>('/config', { retries: 20 });
export const adminPost = <T,>(path: string, body?: unknown) => call<T>(path, { method: 'POST', body });
export const adminPatch = <T,>(path: string, body?: unknown) => call<T>(path, { method: 'PATCH', body });
export const adminDelete = <T,>(path: string) => call<T>(path, { method: 'DELETE' });

/* ── shapes ───────────────────────────────────────────────────────────────── */

export interface AdminUser {
  id: string;
  username: string;
  nookId: string;
  displayName: string;
  email: string;
  emailVerified: boolean;
  avatarUrl: string;
  accent: string;
  online: boolean;
  lastSeen: number;
  createdAt: number;
  suspended: boolean;
  passwordless: boolean;
  viaGoogle: boolean;
  messageCount: number;
  conversationCount: number;
  mediaCount: number;
}

export interface AdminStats {
  users: number;
  activeToday: number;
  newThisWeek: number;
  suspended: number;
  conversations: number;
  groups: number;
  messages: number;
  messagesToday: number;
  withMedia: number;
}
