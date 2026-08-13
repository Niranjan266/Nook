/**
 * Thin fetch wrapper. Holds the access token in memory, refreshes it once on a
 * 401, and replays the original request. Refresh token lives in an httpOnly
 * cookie, so it never touches JS.
 */

import { apiUrl } from './config';

let accessToken: string | null = null;
let refreshing: Promise<boolean> | null = null;

type Listener = (token: string | null) => void;
const listeners = new Set<Listener>();

export function setToken(token: string | null) {
  accessToken = token;
  listeners.forEach((fn) => fn(token));
}
export const getToken = () => accessToken;
export function onToken(fn: Listener) {
  listeners.add(fn);
  return () => listeners.delete(fn);
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

async function refresh(): Promise<boolean> {
  if (!refreshing) {
    refreshing = fetch(apiUrl('/auth/refresh'), { method: 'POST', credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) {
          setToken(null);
          return false;
        }
        const data = await res.json();
        setToken(data.accessToken);
        return true;
      })
      .catch(() => false)
      .finally(() => {
        refreshing = null;
      });
  }
  return refreshing;
}

type Options = Omit<RequestInit, 'body'> & { body?: unknown; retry?: boolean };

export async function api<T = any>(path: string, options: Options = {}): Promise<T> {
  const { body, retry = true, headers, ...rest } = options;
  const isForm = body instanceof FormData;

  const res = await fetch(apiUrl(path), {
    ...rest,
    credentials: 'include',
    headers: {
      ...(isForm ? {} : body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      ...headers,
    },
    body: isForm ? (body as FormData) : body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && retry) {
    const ok = await refresh();
    if (ok) return api<T>(path, { ...options, retry: false });
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

/** Upload with progress — XHR, because fetch still has no upload progress. */
export function upload(
  file: File | Blob,
  kind: 'message' | 'avatar' | 'wallpaper' | 'voice' = 'message',
  onProgress?: (pct: number) => void,
  filename?: string
): Promise<{ media: any; provider: string }> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('file', file, filename || (file as File).name || 'upload');
    form.append('kind', kind);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', apiUrl('/media'));
    xhr.withCredentials = true;
    if (accessToken) xhr.setRequestHeader('authorization', `Bearer ${accessToken}`);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText || '{}');
        if (xhr.status >= 200 && xhr.status < 300) resolve(data);
        else reject(new ApiError(data.error || 'Upload failed.', xhr.status));
      } catch {
        reject(new ApiError('Upload failed.', xhr.status));
      }
    };
    xhr.onerror = () => reject(new ApiError('Network dropped during upload.', 0));
    xhr.send(form);
  });
}

export const bootstrapSession = refresh;
