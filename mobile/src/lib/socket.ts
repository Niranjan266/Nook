import { io, type Socket } from 'socket.io-client';
import { API_BASE, getToken, refreshSession } from './api';

let socket: Socket | null = null;

export function connectSocket(): Socket {
  if (socket?.connected) return socket;
  if (socket) socket.disconnect();

  socket = io(API_BASE, {
    // A function, not a value: socket.io re-reads it on every reconnect, so a
    // refreshed access token is picked up instead of the one from sign-in.
    auth: (cb) => cb({ token: getToken() }),
    // Websocket only on native: the polling fallback burns battery and there's
    // no proxy in front of us that would block an upgrade.
    transports: ['websocket'],
    reconnectionDelay: 800,
    reconnectionDelayMax: 8000,
  });

  // The server refuses a handshake with an expired token and socket.io does
  // not retry that on its own. Refresh, then try again.
  // Once per failure streak, so an account the server keeps refusing can't
  // spin this in a loop.
  const s = socket;
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

export const getSocket = () => socket;

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}

/** Promise wrapper for socket acks, with a timeout so the UI never hangs. */
export function emitAck<T = any>(event: string, payload: any, timeout = 12000): Promise<T> {
  return new Promise((resolve, reject) => {
    const s = socket;
    if (!s?.connected) return reject(new Error('offline'));
    const timer = setTimeout(() => reject(new Error('timeout')), timeout);
    s.emit(event, payload, (res: T) => {
      clearTimeout(timer);
      resolve(res);
    });
  });
}
