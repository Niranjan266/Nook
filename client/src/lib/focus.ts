import { getSocket } from './socket';

/**
 * Tell the server which conversation is actually on screen.
 *
 * The server used to skip a push for anyone holding a socket, which is why
 * messages arrived silently: a backgrounded tab, a locked phone and a sleeping
 * laptop all still count as connected. Being connected is not being present.
 *
 * Two rules make this safe to depend on. It reports *nothing* the moment the
 * window is hidden, so a phone in a pocket is never mistaken for someone
 * reading. And it repeats while the chat stays open, so a tab that freezes or
 * crashes stops claiming attention it no longer has — the server expires the
 * claim on its own rather than silencing that chat forever.
 */
const HEARTBEAT_MS = 25_000;

let current: string | null = null;
let timer: number | undefined;

function push(conversationId: string | null) {
  getSocket()?.emit('focus:conversation', { conversationId });
}

function beat() {
  window.clearInterval(timer);
  if (!current) return;
  timer = window.setInterval(() => {
    if (document.visibilityState === 'visible') push(current);
  }, HEARTBEAT_MS);
}

/** Called when the open conversation changes, or the window is hidden/shown. */
export function watchConversation(conversationId: string | null) {
  const visible = document.visibilityState === 'visible';
  const next = visible ? conversationId : null;
  if (next === current) return;
  current = next;
  push(current);
  beat();
}

/** Re-assert on reconnect: the server keeps this in memory and loses it. */
export function resendFocus() {
  if (current && document.visibilityState === 'visible') push(current);
}

let bound = false;

export function bindFocusReporting(getActiveId: () => string | null) {
  if (bound) return;
  bound = true;

  const sync = () => watchConversation(getActiveId());

  document.addEventListener('visibilitychange', sync);
  window.addEventListener('blur', () => watchConversation(null));
  window.addEventListener('focus', sync);
  window.addEventListener('pagehide', () => watchConversation(null));
}
