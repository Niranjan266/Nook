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

async function call<T>(path: string, options: Omit<RequestInit, 'body'> & { body?: unknown } = {}): Promise<T> {
  const { body, headers, ...rest } = options;

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
    throw new AdminError(`Can't reach the server at ${API_BASE || 'this site'}.`, 0);
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
