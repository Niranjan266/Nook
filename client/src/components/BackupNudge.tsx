import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useUi } from '@/stores/ui';
import { toastDrop } from '@/lib/motion';
import { readPrefs, writePrefs, backupDue } from '@/lib/backup/prefs';
import { bindDriveReturn, driveErrorText, DRIVE_RETURN_KEY } from '@/lib/backup/drive';
import { IconArchive, IconClose } from '@/components/Icon';

const SNOOZE_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * Two small jobs that both need to live outside any sheet.
 *
 * The weekly reminder, for people who asked for one: a banner, never a silent
 * background job, because a web view cannot promise to run one. "Later" means
 * three days, so it stays a nudge and not a nag.
 *
 * And the end of connecting Google Drive, which arrives as `?drive=` on the web
 * or `nook://backup` in the app — after the page, or the app, has been away.
 */
export default function BackupNudge({ userId }: { userId: string }) {
  const toast = useUi((s) => s.toast);
  const openSheet = useUi((s) => s.openSheet);
  const sheet = useUi((s) => s.sheet);
  const [due, setDue] = useState(false);

  useEffect(
    () =>
      bindDriveReturn((ok, reason) => {
        let wanted = false;
        try {
          wanted = sessionStorage.getItem(DRIVE_RETURN_KEY) === '1';
          sessionStorage.removeItem(DRIVE_RETURN_KEY);
        } catch {
          /* private mode */
        }
        toast(ok ? 'Google Drive connected' : driveErrorText(reason), !ok);
        // Straight back to what they were doing, with Drive already picked.
        if (ok && wanted) openSheet('backup', { mode: 'backup', dest: 'drive' });
      }),
    [userId] // eslint-disable-line react-hooks/exhaustive-deps
  );

  useEffect(() => {
    const check = () => setDue(backupDue(readPrefs(userId)));
    // Not in the first seconds: the app has enough to say when it opens.
    const t = window.setTimeout(check, 6000);
    window.addEventListener('nook:backup-prefs', check);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('nook:backup-prefs', check);
    };
  }, [userId]);

  const later = () => {
    writePrefs(userId, { snoozeUntil: Date.now() + SNOOZE_MS });
    setDue(false);
  };

  const now = () => {
    setDue(false);
    openSheet('backup', { mode: 'backup' });
  };

  const last = readPrefs(userId).lastAt;

  return (
    <AnimatePresence>
      {due && !sheet && (
        <motion.div
          className="notify-nudge backup-nudge"
          variants={toastDrop}
          initial="hidden"
          animate="show"
          exit="exit"
          role="dialog"
          aria-label="Back up your chats"
        >
          <span className="notify-nudge-icon">
            <IconArchive size={18} />
          </span>
          <span className="grow stack" style={{ gap: 2, minWidth: 0 }}>
            <span className="list-row-label">{last ? 'A week since your last backup' : 'Time for a first backup?'}</span>
            <span className="list-row-sub">It keeps your secret chats safe if this phone is lost. A minute, tops.</span>
          </span>
          <span className="row" style={{ gap: 6, flex: 'none' }}>
            <button className="clay-btn" onClick={later}>
              Later
            </button>
            <button className="slab" onClick={now}>
              Back up
            </button>
          </span>
          <button className="notify-nudge-x" onClick={later} aria-label="Dismiss">
            <IconClose size={16} />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
