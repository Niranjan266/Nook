import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * API client for the native app.
 *
 * The important difference from the web client: there are no cookies. A phone
 * app keeps its refresh token in the device keychain (`expo-secure-store`,
 * which is Keychain on iOS and EncryptedSharedPreferences on Android) and sends
 * it explicitly. The server tells the two apart with the `x-nook-client`
 * header and only ever hands the refresh token to native.
 */

const REFRESH_KEY = 'nook.refresh';

/**
 * Where the API is.
 *
 * On a physical phone, `localhost` is the phone itself — not your laptop — so
 * a bare localhost URL always fails with a confusing network error. In dev we
 * derive the LAN address from the Expo packager host, which is the machine
 * running `expo start`. Set EXPO_PUBLIC_API_URL to override.
 */
function resolveApiBase(): string {
  const explicit = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, '');

  const hostUri =
    Constants.expoConfig?.hostUri ||
    (Constants.expoGoConfig as any)?.debuggerHost ||
    (Constants.manifest2 as any)?.extra?.expoGo?.debuggerHost;

  if (hostUri) {
    const host = String(hostUri).split(':')[0];
    if (host && host !== 'localhost' && host !== '127.0.0.1') return `http://${host}:4000`;
  }

  // Android emulators map the host machine to 10.0.2.2.
  return Platform.OS === 'android' ? 'http://10.0.2.2:4000' : 'http://localhost:4000';
}

export const API_BASE = resolveApiBase();
export const apiUrl = (path: string) => `${API_BASE}/api${path}`;

export function mediaUrl(url?: string | null) {
  if (!url) return '';
  if (/^(https?:|data:|file:)/i.test(url)) return url;
  return `${API_BASE}${url.startsWith('/') ? '' : '/'}${url}`;
}

/* ── token handling ──────────────────────────────────────────────────────── */

let accessToken: string | null = null;
let refreshing: Promise<boolean> | null = null;

export const getToken = () => accessToken;
export const setToken = (token: string | null) => {
  accessToken = token;
};

export async function saveRefreshToken(token: string | null) {
  try {
    if (token) await SecureStore.setItemAsync(REFRESH_KEY, token);
    else await SecureStore.deleteItemAsync(REFRESH_KEY);
  } catch {
    /* keychain unavailable — the session just won't survive a restart */
  }
}

export async function loadRefreshToken() {
  try {
    return await SecureStore.getItemAsync(REFRESH_KEY);
  } catch {
    return null;
  }
}

export class ApiError extends Error {
  status: number;
  field?: string;
  constructor(message: string, status: number, field?: string) {
    super(message);
    this.status = status;
    this.field = field;
  }
}

async function refreshSession(): Promise<boolean> {
  if (!refreshing) {
    refreshing = (async () => {
      const stored = await loadRefreshToken();
      if (!stored) return false;
      try {
        const res = await fetch(apiUrl('/auth/refresh'), {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-nook-client': 'native' },
          body: JSON.stringify({ refreshToken: stored }),
        });
        if (!res.ok) {
          await saveRefreshToken(null);
          setToken(null);
          return false;
        }
        const data = await res.json();
        setToken(data.accessToken);
        if (data.refreshToken) await saveRefreshToken(data.refreshToken);
        return true;
      } catch {
        return false;
      } finally {
        refreshing = null;
      }
    })();
  }
  return refreshing;
}

type Options = Omit<RequestInit, 'body'> & { body?: unknown; retry?: boolean };

export async function api<T = any>(path: string, options: Options = {}): Promise<T> {
  const { body, retry = true, headers, ...rest } = options;
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;

  const res = await fetch(apiUrl(path), {
    ...rest,
    headers: {
      'x-nook-client': 'native',
      ...(isForm ? {} : body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      ...headers,
    },
    body: isForm ? (body as FormData) : body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && retry) {
    if (await refreshSession()) return api<T>(path, { ...options, retry: false });
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new ApiError(data.error || `Request failed (${res.status})`, res.status, data.field);
  return data as T;
}

export const get = <T = any,>(p: string) => api<T>(p);
export const post = <T = any,>(p: string, body?: unknown) => api<T>(p, { method: 'POST', body });
export const patch = <T = any,>(p: string, body?: unknown) => api<T>(p, { method: 'PATCH', body });
export const put = <T = any,>(p: string, body?: unknown) => api<T>(p, { method: 'PUT', body });
export const del = <T = any,>(p: string) => api<T>(p, { method: 'DELETE' });

/** Upload a local file URI. RN's FormData takes {uri, name, type}. */
export async function uploadFile(
  uri: string,
  kind: 'message' | 'avatar' | 'wallpaper' | 'voice' = 'message',
  name = 'upload',
  mime = 'application/octet-stream'
) {
  const form = new FormData();
  form.append('file', { uri, name, type: mime } as any);
  form.append('kind', kind);
  return api<{ media: any; provider: string }>('/media', { method: 'POST', body: form });
}

export const bootstrapSession = refreshSession;
