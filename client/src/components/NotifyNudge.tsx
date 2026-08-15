import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { enablePush, neverAsked } from '@/lib/push';
import { useUi } from '@/stores/ui';
import { spring } from '@/lib/motion';
import { IconBell, IconClose } from '@/components/Icon';

/**
 * Ask for notification permission once, in a place people will see.
 *
 * The toggle lived in Settings and nothing pointed at it, so almost nobody
 * turned notifications on — which is indistinguishable, from the outside, from
 * notifications being broken. That was the real reason messages arrived
 * silently.
 *
 * Deliberately not a browser prompt on load. A permission dialog that appears
 * before anyone has seen the app is the one people dismiss reflexively, and a
 * dismissal is permanent: `Notification.permission` becomes 'denied' and no
 * amount of asking later will help. So this waits for a conversation to be
 * open — the moment the point of it is obvious — explains itself in a line,
 * and only then triggers the real prompt.
 *
 * "Not now" is remembered so it is asked at most once a week. Turning it down
 * has to mean something, or it becomes the thing people click past.
 */
const SNOOZE_KEY = 'nook.notifyNudge';
const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

export default function NotifyNudge({ show }: { show: boolean }) {
  const { toast } = useUi();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!show || !neverAsked()) return;

    const snoozed = Number(localStorage.getItem(SNOOZE_KEY) || 0);
    if (Date.now() < snoozed) return;

    // A short delay so it does not appear in the same frame as the chat: an
    // element that animates in under the thumb gets tapped by accident.
    const t = window.setTimeout(() => setOpen(true), 2500);
    return () => window.clearTimeout(t);
  }, [show]);

  const snooze = () => {
    localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_MS));
    setOpen(false);
  };

  const allow = async () => {
    setBusy(true);
    try {
      const result = await enablePush();
      setOpen(false);
      toast(
        result === 'on'
          ? 'Notifications on — you will hear new messages'
          : result === 'denied'
            ? 'Your browser blocked notifications. You can change that in site settings.'
            : 'Notifications are not available in this browser.',
        result !== 'on'
      );
      if (result !== 'on') localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_MS));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="notify-nudge clay"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 24 }}
          transition={spring}
          role="dialog"
          aria-label="Turn on notifications"
        >
          <span className="clay-round" style={{ width: 40, height: 40, flex: 'none' }}>
            <IconBell size={18} />
          </span>

          <span className="grow stack" style={{ gap: 2, minWidth: 0 }}>
            <span className="list-row-label">Know when someone writes</span>
            <span className="list-row-sub">
              A notification when Nook is closed or in the background — nothing else.
            </span>
          </span>

          <span className="row" style={{ gap: 6, flex: 'none' }}>
            <button className="clay-btn" onClick={snooze} disabled={busy}>
              Not now
            </button>
            <button className="slab" onClick={allow} disabled={busy}>
              {busy ? 'Asking…' : 'Turn on'}
            </button>
          </span>

          <button className="notify-nudge-x" onClick={snooze} aria-label="Dismiss">
            <IconClose size={15} />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
