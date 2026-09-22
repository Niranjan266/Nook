/** When this device last backed up, and whether to nudge. Per account, per device. */

export interface BackupPrefs {
  lastAt?: string;
  lastWhere?: 'file' | 'drive';
  /** The weekly nudge. Off until asked for. */
  remind?: boolean;
  snoozeUntil?: number;
}

const prefsKey = (userId: string) => `nook.backup.${userId}`;

export function readPrefs(userId: string): BackupPrefs {
  try {
    return JSON.parse(localStorage.getItem(prefsKey(userId)) || '{}');
  } catch {
    return {};
  }
}

export function writePrefs(userId: string, patch: Partial<BackupPrefs>): BackupPrefs {
  const next = { ...readPrefs(userId), ...patch };
  try {
    localStorage.setItem(prefsKey(userId), JSON.stringify(next));
  } catch {
    /* private mode: the reminder just forgets */
  }
  window.dispatchEvent(new CustomEvent('nook:backup-prefs'));
  return next;
}

export const WEEK = 7 * 24 * 60 * 60 * 1000;

export function backupDue(prefs: BackupPrefs, now = Date.now()) {
  if (!prefs.remind) return false;
  if (prefs.snoozeUntil && now < prefs.snoozeUntil) return false;
  return !prefs.lastAt || now - new Date(prefs.lastAt).getTime() > WEEK;
}

/** "22 September 2026" — a backup is dated, not "Sun", however recent it is. */
export const longDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
