/**
 * Google Drive, from the app's side.
 *
 * Only ever an already-sealed blob goes up and comes down; the password and
 * the plaintext stay on this device. The server brokers the Drive calls
 * because only it can hold the refresh token (see server routes/backup.js).
 */
import { get, del, getToken, refreshSession, ApiError } from '../api';
import { apiUrl } from '../config';
import { isNativeApp } from '../native';

export interface DriveStatus {
  available: boolean;
  connected: boolean;
  connectedAt: string | null;
}

export interface DriveFile {
  id: string;
  name: string;
  size: number;
  createdTime: string;
}

export const driveStatus = () => get<DriveStatus>('/backup/drive/status');
export const listDrive = async () => (await get<{ files: DriveFile[] }>('/backup/drive/list')).files;
export const disconnectDrive = () => del('/backup/drive/link');

/** Set before leaving for Google, so the Settings sheet can reopen on return. */
export const DRIVE_RETURN_KEY = 'nook.driveReturn';

/**
 * Off to Google's consent screen. The endpoint needs a session, which a plain
 * navigation cannot carry, so the URL is fetched first and then opened — in a
 * Custom Tab inside the app (Google refuses web views), or by navigating the
 * page on the web.
 */
export async function connectDrive() {
  const native = isNativeApp();
  const { url } = await get<{ url: string }>(`/backup/drive/connect?json=1${native ? '&native=1' : ''}`);
  try {
    sessionStorage.setItem(DRIVE_RETURN_KEY, '1');
  } catch {
    /* only costs reopening the sheet */
  }
  if (native) {
    try {
      const { Browser } = await import('@capacitor/browser');
      await Browser.open({ url, presentationStyle: 'popover' });
      return;
    } catch {
      /* no Custom Tab — Capacitor sends the off-origin navigation to the browser */
    }
  }
  window.location.href = url;
}

async function readError(status: number, text: string) {
  try {
    const data = JSON.parse(text);
    return Object.assign(new ApiError(data.error || `Request failed (${status})`, status), { code: data.code });
  } catch {
    return new ApiError(`Request failed (${status})`, status);
  }
}

/** XHR rather than fetch, for upload progress. One token refresh, like api(). */
export function uploadToDrive(
  blob: Blob,
  name: string,
  { onProgress, signal }: { onProgress?: (fraction: number) => void; signal?: AbortSignal } = {},
  retry = true
): Promise<DriveFile> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', apiUrl('/backup/drive/upload'));
    xhr.withCredentials = true;
    const token = getToken();
    if (token) xhr.setRequestHeader('authorization', `Bearer ${token}`);
    xhr.setRequestHeader('content-type', 'application/octet-stream');
    xhr.setRequestHeader('x-backup-name', name);

    const abort = () => xhr.abort();
    signal?.addEventListener('abort', abort, { once: true });

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total);
    };
    xhr.onload = async () => {
      signal?.removeEventListener('abort', abort);
      if (xhr.status === 401 && retry) {
        if (await refreshSession()) return uploadToDrive(blob, name, { onProgress, signal }, false).then(resolve, reject);
        return reject(new ApiError('Your session expired. Sign in again.', 401));
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          return resolve(JSON.parse(xhr.responseText).file);
        } catch {
          /* fall through */
        }
      }
      reject(await readError(xhr.status, xhr.responseText));
    };
    xhr.onerror = () => reject(new ApiError('The connection dropped during the upload.', 0, undefined, true));
    xhr.onabort = () => reject(new DOMException('Cancelled', 'AbortError'));
    xhr.send(blob);
  });
}

export async function downloadFromDrive(id: string, signal?: AbortSignal, retry = true): Promise<Uint8Array> {
  const token = getToken();
  let res: Response;
  try {
    res = await fetch(apiUrl(`/backup/drive/${encodeURIComponent(id)}`), {
      credentials: 'include',
      headers: token ? { authorization: `Bearer ${token}` } : {},
      signal,
    });
  } catch (err: any) {
    if (err?.name === 'AbortError') throw err;
    throw new ApiError("Can't reach the server to fetch the backup.", 0, undefined, true);
  }
  if (res.status === 401 && retry && (await refreshSession())) return downloadFromDrive(id, signal, false);
  if (!res.ok) throw await readError(res.status, await res.text());
  return new Uint8Array(await res.arrayBuffer());
}

/** The launch intent never changes for the life of the process; read it once. */
let launchChecked = false;

/**
 * The end of the consent round trip, however it arrives: `?drive=` on the
 * website, or `nook://backup?drive=` handed to the Android app. Each result is
 * reported once and then removed, so a reload does not replay it.
 */
export function bindDriveReturn(onResult: (ok: boolean, reason?: string) => void): () => void {
  const report = (query: URLSearchParams) => {
    const ok = query.get('drive') === 'connected';
    const failed = query.get('drive_error');
    if (ok) onResult(true);
    else if (failed) onResult(false, failed);
    return ok || Boolean(failed);
  };

  const url = new URL(window.location.href);
  if (report(url.searchParams)) {
    url.searchParams.delete('drive');
    url.searchParams.delete('drive_error');
    window.history.replaceState({}, '', url.pathname + url.search + url.hash);
  }

  if (!isNativeApp()) return () => {};

  let removed = false;
  let remove: (() => void) | null = null;
  (async () => {
    try {
      const { App } = await import('@capacitor/app');
      const handle = async (link?: string | null) => {
        if (!link?.startsWith('nook://backup')) return;
        try {
          const { Browser } = await import('@capacitor/browser');
          await Browser.close();
        } catch {
          /* already closed */
        }
        report(new URLSearchParams(link.split('?')[1] || ''));
      };
      const listener = await App.addListener('appUrlOpen', ({ url: link }) => handle(link));
      remove = () => listener.remove();
      if (removed) return remove();
      // Android may kill the app while the person is in the browser; then the
      // link launches it instead of resuming it, and only this sees it.
      if (!launchChecked) {
        launchChecked = true;
        await handle((await App.getLaunchUrl())?.url);
      }
    } catch {
      /* not native */
    }
  })();

  return () => {
    removed = true;
    remove?.();
  };
}

/** Words for the reasons the server can send back. */
export function driveErrorText(reason?: string) {
  switch (reason) {
    case 'access_denied':
      return 'Google Drive was not connected — the request was cancelled.';
    case 'scope_denied':
      return 'Nook needs permission for its own Drive folder to store backups. Try again and leave that box ticked.';
    case 'bad_state':
      return 'That Drive link had expired. Try connecting again.';
    case 'unconfigured':
      return 'Google Drive backups are not set up on this server.';
    default:
      return 'Google Drive could not be connected. Try again.';
  }
}
