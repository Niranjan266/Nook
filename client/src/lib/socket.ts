import { io, type Socket } from 'socket.io-client';
import { getToken } from './api';
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
  socket = API_BASE
    ? io(API_BASE, {
        auth: { token: getToken() },
        transports: ['websocket', 'polling'],
        withCredentials: true,
        reconnectionDelay: 600,
        reconnectionDelayMax: 6000,
      })
    : io({
        auth: { token: getToken() },
        transports: ['websocket', 'polling'],
        withCredentials: true,
        reconnectionDelay: 600,
        reconnectionDelayMax: 6000,
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
