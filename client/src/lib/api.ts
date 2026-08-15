/**
 * Thin fetch wrapper. Holds the access token in memory, refreshes it once on a
 * 401, and replays the original request. Refresh token lives in an httpOnly
 * cookie, so it never touches JS.
 */

import { apiUrl, API_BASE } from './config';

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
  /** True when the request never reached the server at all. */
  offline: boolean;
  constructor(message: string, status: number, field?: string, offline = false) {
    super(message);
    this.status = status;
    this.field = field;
    this.offline = offline;
  }
}

/**
 * `fetch` rejects with a bare `TypeError: Failed to fetch` for every
 * transport-level failure — DNS miss, refused connection, bad certificate,
 * CORS rejection, offline. The browser deliberately gives JS no detail, to
 * avoid turning fetch into a port scanner.
 *
 * Left unhandled that TypeError escapes as "not an ApiError", and every caller
 * falls through to its generic catch — which is how a completely unreachable
 * API ends up reported to the user as "Something went wrong. Try again." That
 * message sends people to check their password when the server isn't there.
 */
function transportError(): ApiError {
  const where = API_BASE || 'this site';
  return new ApiError(
    navigator.onLine
      ? `Can't reach the server at ${where}. It may be starting up, or offline.`
      : "You're offline. Check your connection and try again.",
    0,
    undefined,
    true
  );
}

/**
 * A misconfigured API URL usually points at something that answers — a static
 * host, a proxy, a parked domain — and returns HTML. `JSON.parse` then throws
 * a SyntaxError about "<", which tells the user nothing. Report what actually
 * happened instead.
 */
function parseBody(text: string, status: number, contentType: string | null) {
  if (!text) return {};
  const looksJson = (contentType || '').includes('json') || /^\s*[[{]/.test(text);
  if (!looksJson) {
    throw new ApiError(
      `The server at ${API_BASE || 'this site'} returned a page instead of data ` +
        `(HTTP ${status}). VITE_API_URL is probably pointing at the wrong host.`,
      status
    );
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError(`The server sent a malformed response (HTTP ${status}).`, status);
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

  let res: Response;
  try {
    res = await fetch(apiUrl(path), {
      ...rest,
      credentials: 'include',
      headers: {
        ...(isForm ? {} : body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
        ...headers,
      },
      body: isForm ? (body as FormData) : body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw transportError();
  }

  if (res.status === 401 && retry) {
    const ok = await refresh();
    if (ok) return api<T>(path, { ...options, retry: false });
  }

  if (res.status === 204) return undefined as T;

  const data = parseBody(await res.text(), res.status, res.headers.get('content-type'));

  if (!res.ok) throw new ApiError(data.error || `Request failed (${res.status})`, res.status, data.field);
  return data as T;
}

export const get = <T = any,>(p: string) => api<T>(p);
export const post = <T = any,>(p: string, body?: unknown) => api<T>(p, { method: 'POST', body });
export const patch = <T = any,>(p: string, body?: unknown) => api<T>(p, { method: 'PATCH', body });
export const put = <T = any,>(p: string, body?: unknown) => api<T>(p, { method: 'PUT', body });
/**
 * DELETE with an optional body. Unusual, but removing a chat lock has to carry
 * the code — a delete that needs no proof is not a lock — and inventing a
 * POST /unlock purely to dodge the convention would be worse.
 */
export const del = <T = any,>(p: string, body?: unknown) =>
  api<T>(p, { method: 'DELETE', ...(body === undefined ? {} : { body }) });

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
