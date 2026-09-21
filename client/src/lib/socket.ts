import { io, type Socket } from 'socket.io-client';
import { getToken, refreshSession } from './api';
import { API_BASE } from './config';

let socket: Socket | null = null;

export function connectSocket(): Socket {
  if (socket?.connected) return socket;
  if (socket) socket.disconnect();

  /**
   * In production the socket connects straight to the API host — it cannot be
   * proxied through Vercel, which has no persistent connections to proxy with.
   * In development API_BASE is empty, so this connects to the Vite origin and
   * the dev proxy forwards it.
   *
   * `withCredentials` matters: the handshake must carry the session cookie for
   * the same-site setup to work.
   */
  const opts = {
    // A function, not a value: it is re-read on every (re)connect attempt. A
    // token captured once here is expired by the first reconnect after
    // fifteen minutes, and the socket would keep presenting it forever.
    auth: (cb: (data: object) => void) => cb({ token: getToken() }),
    transports: ['websocket', 'polling'],
    withCredentials: true,
    reconnectionDelay: 600,
    reconnectionDelayMax: 6000,
  };
  const s = API_BASE ? io(API_BASE, opts) : io(opts);
  socket = s;

  /**
   * A refusal from the auth middleware is final as far as socket.io is
   * concerned — it does not retry those. An expired access token is the
   * common cause and is fixable, so refresh once and dial again. Once per
   * failure streak, so a suspended account cannot spin this in a loop.
   */
  let authRetried = false;
  s.on('connect', () => {
    authRetried = false;
  });
  s.on('connect_error', async (err) => {
    if (s.active || authRetried || !/token/i.test(err?.message || '')) return;
    authRetried = true;
    if ((await refreshSession()) && socket === s) s.connect();
  });

  return socket;
}

export function getSocket(): Socket | null {
  return socket;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}

/** Promise wrapper for socket acks, with a timeout so the UI never hangs. */
export function emitAck<T = any>(event: string, payload: any, timeout = 12000): Promise<T> {
  return new Promise((resolve, reject) => {
    const s = socket;
    if (!s || !s.connected) return reject(new Error('offline'));
    const timer = setTimeout(() => reject(new Error('timeout')), timeout);
    s.emit(event, payload, (res: T) => {
      clearTimeout(timer);
      resolve(res);
    });
  });
}
