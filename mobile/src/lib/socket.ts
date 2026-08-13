import { io, type Socket } from 'socket.io-client';
import { API_BASE, getToken } from './api';

let socket: Socket | null = null;

export function connectSocket(): Socket {
  if (socket?.connected) return socket;
  if (socket) socket.disconnect();

  socket = io(API_BASE, {
    auth: { token: getToken() },
    // Websocket only on native: the polling fallback burns battery and there's
    // no proxy in front of us that would block an upgrade.
    transports: ['websocket'],
    reconnectionDelay: 800,
    reconnectionDelayMax: 8000,
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
