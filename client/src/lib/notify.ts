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
  onOpen: (conversationId: string) => void;
  toast: (text: string) => void;
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
  onOpen,
  toast,
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

  if (hidden && canNotify()) {
    try {
      const n = new Notification(conversationName || senderName, {
        body: preview,
        // One notification per conversation: five messages from one person
        // should update a single notification, not produce five.
        tag: `nook:${conversationId}`,
        icon: '/logo.svg',
        badge: '/logo.svg',
        silent: soundOn, // the sound already played; don't play the OS one too
      });
      n.onclick = () => {
        window.focus();
        onOpen(conversationId);
        n.close();
      };
      live.set(conversationId, n);
    } catch {
      /* Some browsers refuse constructed Notifications outside a service
         worker. The title and sound still did their job. */
    }
  } else if (!hidden) {
    toast(`${senderName}: ${preview}`);
  }
}

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
