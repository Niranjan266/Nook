/**
 * Links that open the app somewhere specific.
 *
 * Three arrive as URLs: `/?c=<id>` from a tapped web notification (sw.js),
 * `/join/<code>` from a group's invite link, and `/guest/<code>` from a guest
 * link. None of them has a route of its own — the app is one page — so they
 * are read once at boot, stripped from the address bar so a reload or a
 * bookmark does not replay them, and acted on once there is a session.
 *
 * The join code goes through sessionStorage rather than a variable: someone
 * signed out has to sign in first, and Google sign-in leaves the page and
 * comes back, which would lose anything held only in memory.
 */
import { post } from './api';
import { useChat } from '@/stores/chat';
import { useUi } from '@/stores/ui';
import type { Conversation } from './types';

const JOIN_KEY = 'nook.pendingJoin';
const OPEN_KEY = 'nook.pendingOpen';

const store = {
  get(key: string) {
    try {
      return sessionStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string | null) {
    try {
      if (value) sessionStorage.setItem(key, value);
      else sessionStorage.removeItem(key);
    } catch {
      /* private mode: the link just will not survive a sign-in round trip */
    }
  },
};

let captured: { guest: string | null } | null = null;

/**
 * Parse and strip the launch URL. Memoised, because StrictMode runs state
 * initialisers twice and the second run would find the URL already cleaned.
 * Only our own parameter is removed — `?g=` belongs to Google sign-in, which
 * FrontDoor reads from the same address bar.
 */
export function captureLaunchLinks(): { guest: string | null } {
  if (captured) return captured;
  const url = new URL(window.location.href);
  const parts = url.pathname.split('/').filter(Boolean);
  let guest: string | null = null;
  let changed = false;

  if (parts.length === 2 && (parts[0] === 'join' || parts[0] === 'guest')) {
    if (parts[0] === 'join') store.set(JOIN_KEY, parts[1]);
    else guest = parts[1];
    url.pathname = '/';
    changed = true;
  }
  const open = url.searchParams.get('c');
  if (open) {
    store.set(OPEN_KEY, open);
    url.searchParams.delete('c');
    changed = true;
  }
  if (changed) window.history.replaceState({}, '', url.pathname + url.search + url.hash);

  captured = { guest };
  return captured;
}

/** Where to land once signed in — e.g. the conversation a guest just joined. */
export const openAfterSignIn = (conversationId: string) => store.set(OPEN_KEY, conversationId);

/** Called once conversations have loaded for the signed-in account. */
export async function openLaunchTarget() {
  const chat = useChat.getState();

  const join = store.get(JOIN_KEY);
  if (join) {
    store.set(JOIN_KEY, null);
    try {
      const { conversation } = await post<{ conversation: Conversation }>(
        `/conversations/join/${encodeURIComponent(join)}`
      );
      chat.onConversation(conversation);
      useChat.getState().setActive(conversation.id);
    } catch (err: any) {
      useUi.getState().toast(err?.message || 'That invite link did not work.', true);
    }
    return;
  }

  const open = store.get(OPEN_KEY);
  if (open) {
    store.set(OPEN_KEY, null);
    if (chat.conversations[open]) chat.setActive(open);
  }
}
