/**
 * Telling someone a message arrived while the app is open.
 *
 * There was a hole here. The server only sends a *push* notification when the
 * recipient is disconnected — which is right, since a push to a live socket
 * would double up. But the client did nothing at all with an incoming message
 * beyond adding it to the store. So with Nook open in a background tab you
 * were, by both halves' reckoning, "online and therefore already looking" —
 * and nothing told you anything. The one case where you most need a nudge was
 * the one case nobody covered.
 *
 * This fills it: a sound, a browser notification when the tab is not in front,
 * a toast when it is but you are reading a different conversation, and an
 * unread count in the tab title.
 */
import { playSound, type SoundId } from './sounds';

/**
 * A short buzz, for the case a sound cannot cover: a phone on silent, or in a
 * pocket. Two taps rather than one long one — a single long buzz reads as a
 * call, which is a bigger claim on attention than a message deserves.
 *
 * Guarded because Safari and every iOS browser have no Vibration API at all,
 * and calling it there throws. It is also ignored by browsers until the page
 * has been interacted with, which is correct and needs no handling: a page
 * nobody has touched has no business buzzing.
 */
function buzz(wanted?: boolean) {
  if (wanted === false) return;
  try {
    navigator.vibrate?.([60, 45, 60]);
  } catch {
    /* not supported here; the sound and the banner still happen */
  }
}

let unread = 0;
let baseTitle = '';

/** Notifications the app raised itself, so a burst does not stack up. */
const live = new Map<string, Notification>();

export function initTitle() {
  baseTitle = document.title;
}

/**
 * The tab title is the notification people actually notice, because it is
 * visible without switching windows.
 */
function paintTitle() {
  if (!baseTitle) baseTitle = document.title;
  document.title = unread > 0 ? `(${unread}) ${baseTitle}` : baseTitle;
}

export function clearUnread() {
  unread = 0;
  paintTitle();
  for (const n of live.values()) n.close();
  live.clear();
}

export const canNotify = () =>
  typeof Notification !== 'undefined' && Notification.permission === 'granted';

/** Asked for at a moment the person will understand, never on page load. */
export async function askToNotify(): Promise<boolean> {
  if (typeof Notification === 'undefined') return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  return (await Notification.requestPermission()) === 'granted';
}

interface Incoming {
  conversationId: string;
  conversationName: string;
  senderName: string;
  preview: string;
  isActive: boolean;
  muted: boolean;
  sound: SoundId;
  soundOn: boolean;
  /** Whether this person wants the device to buzz. */
  vibrate?: boolean;
  avatarUrl?: string;
  accent?: string;
  onOpen: (conversationId: string) => void;
}

export function messageArrived({
  conversationId,
  conversationName,
  senderName,
  preview,
  isActive,
  muted,
  sound,
  soundOn,
  vibrate,
  avatarUrl,
  accent,
  onOpen,
}: Incoming) {
  // Muting a conversation should mean muting it — including the badge, or the
  // number keeps demanding attention the person explicitly declined to give.
  if (muted) return;

  const hidden = document.visibilityState !== 'visible';

  // Reading the conversation right now counts as having been told.
  if (isActive && !hidden) return;

  unread += 1;
  paintTitle();

  if (soundOn) playSound(sound);
  buzz(vibrate);

  if (hidden && canNotify()) {
    void systemNotification({ conversationId, conversationName, senderName, preview, avatarUrl, soundOn, onOpen });
  } else if (!hidden) {
    // In-app: our own banner, not the browser's, so it wears the app's
    // materials and can be tapped straight through to the conversation.
    banner({ conversationId, conversationName, senderName, preview, avatarUrl, accent, onOpen });
  }
}

/**
 * The Chrome / Android / desktop notification.
 *
 * Raised through the service worker registration rather than
 * `new Notification(...)`. That matters: Android Chrome does not support the
 * constructor at all — it throws — and the registration form is the only one
 * that accepts action buttons, so Reply and Mark read can appear the way they
 * do on WhatsApp. The constructor stays as a fallback for desktop browsers
 * with no active worker.
 */
async function systemNotification({
  conversationId,
  conversationName,
  senderName,
  preview,
  avatarUrl,
  soundOn,
  onOpen,
}: Pick<
  Incoming,
  'conversationId' | 'conversationName' | 'senderName' | 'preview' | 'avatarUrl' | 'soundOn' | 'onOpen'
>) {
  const title = conversationName || senderName;
  const options: NotificationOptions & {
    actions?: { action: string; title: string }[];
    renotify?: boolean;
  } = {
    body: preview,
    // One per conversation: five messages from one person update a single
    // notification rather than stacking five.
    tag: `nook:${conversationId}`,
    renotify: true,
    // Their photo, like every messaging app — far easier to recognise at a
    // glance than the same logo repeated for everyone.
    icon: avatarUrl || '/logo.svg',
    badge: '/logo.svg',
    silent: soundOn, // the in-app sound already played; do not double it
    data: { conversationId },
  };

  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) {
      // `actions` is real and widely supported but missing from the DOM
      // typings for showNotification, which only know the constructor's
      // narrower option set. The cast is the type checker being behind the
      // platform, not a shortcut.
      await reg.showNotification(title, {
        ...options,
        actions: [
          { action: 'reply', title: 'Reply' },
          { action: 'read', title: 'Mark read' },
        ],
      } as NotificationOptions);
      return;
    }
  } catch {
    /* fall through to the constructor */
  }

  try {
    const n = new Notification(title, options);
    n.onclick = () => {
      window.focus();
      onOpen(conversationId);
      n.close();
    };
    live.set(conversationId, n);
  } catch {
    /* Nothing left to try. The title count and the sound still did their job. */
  }
}

/* ── the in-app banner ────────────────────────────────────────────────────
   Registered by the shell so this module stays free of React.
   ────────────────────────────────────────────────────────────────────────── */

type BannerFn = (m: {
  conversationId: string;
  conversationName: string;
  senderName: string;
  preview: string;
  avatarUrl?: string;
  accent?: string;
  onOpen: (id: string) => void;
}) => void;

let banner: BannerFn = () => {};
export const onBanner = (fn: BannerFn) => {
  banner = fn;
};

/** Coming back to the tab clears the count — you have seen it. */
export function watchFocus() {
  const onVisible = () => {
    if (document.visibilityState === 'visible') clearUnread();
  };
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('focus', onVisible);
  return () => {
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('focus', onVisible);
  };
}
