import { useEffect, useState } from 'react';
import { useUi } from '@/stores/ui';
import { readPrefs, writePrefs, readArchive, longDate, type BackupPrefs } from '@/lib/backup/backup';
import { driveStatus, connectDrive, disconnectDrive, type DriveStatus } from '@/lib/backup/drive';
import { IconArchive, IconDownload, IconHistory, IconRefresh, IconBell } from '@/components/Icon';

/**
 * Settings → Backup & restore.
 *
 * The weekly reminder is a banner, not a schedule. A web view gets no reliable
 * background time — Android suspends it, a browser tab can be closed — so an
 * "automatic" backup would mostly just not happen, silently. Asking once a week
 * is honest about what the app can actually do.
 */
export default function BackupSection({ userId }: { userId: string }) {
  const { openSheet, toast } = useUi();
  const [prefs, setPrefs] = useState<BackupPrefs>(() => readPrefs(userId));
  const [drive, setDrive] = useState<DriveStatus | null>(null);
  const [archiveAt, setArchiveAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    driveStatus()
      .then(setDrive)
      .catch(() => setDrive(null));
    readArchive(userId).then((a) => setArchiveAt(a?.createdAt || null));
    const sync = () => setPrefs(readPrefs(userId));
    window.addEventListener('nook:backup-prefs', sync);
    return () => window.removeEventListener('nook:backup-prefs', sync);
  }, [userId]);

  const toggleRemind = () => setPrefs(writePrefs(userId, { remind: !prefs.remind, snoozeUntil: 0 }));

  const connect = async () => {
    setBusy(true);
    try {
      await connectDrive();
    } catch (err: any) {
      toast(err?.message || 'Could not reach Google.', true);
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (!window.confirm('Disconnect Google Drive? Backups already there stay in your Drive.')) return;
    setBusy(true);
    try {
      await disconnectDrive();
      setDrive((d) => d && { ...d, connected: false, connectedAt: null });
      toast('Google Drive disconnected');
    } catch (err: any) {
      toast(err?.message || 'Could not disconnect.', true);
    } finally {
      setBusy(false);
    }
  };

  const last = prefs.lastAt
    ? `Last backup ${longDate(prefs.lastAt)}${prefs.lastWhere === 'drive' ? ' · Google Drive' : ' · to a file'}`
    : 'No backup from this device yet';

  return (
    <div className="sheet-section">
      <span className="eyebrow">Backup &amp; restore</span>
      <p className="tiny faint" style={{ margin: 0, paddingLeft: 4, lineHeight: 1.6 }}>
        Your chats already follow your account to a new phone. A backup keeps what doesn't — secret chats, whose keys
        live only on this device — plus a personal archive you can read offline. Sealed with a password only you know.
      </p>

      <button className="list-row" onClick={() => openSheet('backup', { mode: 'backup' })}>
        <IconDownload size={19} />
        <span className="grow">
          <span className="list-row-label">Back up now</span>
          <span className="list-row-sub">{last}</span>
        </span>
      </button>

      <button className="list-row" onClick={() => openSheet('backup', { mode: 'restore' })}>
        <IconRefresh size={19} />
        <span className="grow">
          <span className="list-row-label">Restore from a backup</span>
          <span className="list-row-sub">A .nookbak file{drive?.available ? ' or Google Drive' : ''}</span>
        </span>
      </button>

      {archiveAt && (
        <button className="list-row" onClick={() => openSheet('archive')}>
          <IconArchive size={19} />
          <span className="grow">
            <span className="list-row-label">Open the archive</span>
            <span className="list-row-sub">Read-only snapshot from {longDate(archiveAt)}</span>
          </span>
        </button>
      )}

      {drive?.available && (
        <div className="list-row">
          <IconHistory size={19} />
          <span className="grow">
            <span className="list-row-label">Google Drive</span>
            <span className="list-row-sub">
              {drive.connected
                ? `Connected${drive.connectedAt ? ` since ${longDate(drive.connectedAt)}` : ''} · a hidden Nook folder only`
                : "Backups go to a hidden Nook folder. Nook can't see your other files."}
            </span>
          </span>
          {drive.connected ? (
            <button className="clay-btn" onClick={disconnect} disabled={busy}>
              Disconnect
            </button>
          ) : (
            <button className="clay-btn" onClick={connect} disabled={busy}>
              {busy ? 'Opening…' : 'Connect'}
            </button>
          )}
        </div>
      )}

      <button className="list-row" onClick={toggleRemind}>
        <IconBell size={19} />
        <span className="grow">
          <span className="list-row-label">Weekly reminder</span>
          <span className="list-row-sub">
            A gentle note when a week passes without a backup. Nook can't back up silently in the background, so it
            asks.
          </span>
        </span>
        <span className="toggle" role="switch" aria-checked={Boolean(prefs.remind)} />
      </button>
    </div>
  );
}
