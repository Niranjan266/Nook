import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/stores/auth';
import { useUi } from '@/stores/ui';
import { useChat } from '@/stores/chat';
import Sheet from '@/components/Sheet';
import { bytes as formatBytes, dayLabel, clock, sameDay, previewOf } from '@/lib/format';
import { safeUrl } from '@/lib/config';
import { passwordStrength } from '@/lib/backup/crypto';
import {
  collectBackup,
  sealToBlob,
  saveToDevice,
  backupFileName,
  openBackupFile,
  restoreBackup,
  checkSameAccount,
  writePrefs,
  longDate,
  readArchive,
  clearArchive,
  type Progress,
  type Archive,
  type ArchivedConversation,
} from '@/lib/backup/backup';
import {
  driveStatus,
  connectDrive,
  listDrive,
  uploadToDrive,
  downloadFromDrive,
  type DriveStatus,
  type DriveFile,
} from '@/lib/backup/drive';
import { IconLock, IconFile, IconCheck, IconWarning, IconArchive, IconBack, IconTrash, IconDownload } from '@/components/Icon';

type Mode = 'backup' | 'restore';
type Step = 'form' | 'working' | 'done';

/** The four-segment meter from the front door, reused so strength looks the same everywhere. */
function Strength({ password }: { password: string }) {
  const { score, hint } = passwordStrength(password);
  return (
    <>
      <div className="strength" aria-hidden="true">
        {[1, 2, 3, 4].map((i) => (
          <i key={i} className={score >= i ? (score <= 1 ? 'warn' : 'on') : ''} />
        ))}
      </div>
      <p className="tiny faint" aria-live="polite">
        {hint}
      </p>
    </>
  );
}

function Bar({ fraction }: { fraction: number | null }) {
  return (
    <div
      className={`backup-bar${fraction == null ? ' indeterminate' : ''}`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={fraction == null ? undefined : Math.round(fraction * 100)}
    >
      <span style={fraction == null ? undefined : { width: `${Math.max(3, Math.round(fraction * 100))}%` }} />
    </div>
  );
}

export default function BackupSheet() {
  const { sheet, sheetPayload, closeSheet, openSheet, toast } = useUi();
  const me = useAuth((s) => s.me);
  const conversations = useChat((s) => s.conversations);
  const order = useChat((s) => s.order);
  const open = sheet === 'backup';
  const mode: Mode = sheetPayload?.mode === 'restore' ? 'restore' : 'backup';

  const [step, setStep] = useState<Step>('form');
  const [drive, setDrive] = useState<DriveStatus | null>(null);
  const [progress, setProgress] = useState<Progress>({ phase: 'chats', label: '', fraction: null });
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ title: string; lines: string[]; archive?: boolean } | null>(null);
  const abort = useRef<AbortController | null>(null);

  // backup
  const [scope, setScope] = useState<'all' | 'choose'>('all');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [dest, setDest] = useState<'file' | 'drive'>('file');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [understood, setUnderstood] = useState(false);

  // restore
  const [source, setSource] = useState<'file' | 'drive'>('file');
  const [file, setFile] = useState<{ name: string; bytes: Uint8Array } | null>(null);
  const [driveFiles, setDriveFiles] = useState<DriveFile[] | null>(null);
  const [driveChoice, setDriveChoice] = useState<string>('');
  const fileInput = useRef<HTMLInputElement>(null);

  // A fresh start every time the sheet opens — a password left sitting in a
  // closed sheet is a password left sitting in memory for no reason.
  useEffect(() => {
    if (!open) return;
    setStep('form');
    setError('');
    setResult(null);
    setPassword('');
    setConfirm('');
    setUnderstood(false);
    setFile(null);
    setDriveChoice('');
    setDriveFiles(null);
    setDest(sheetPayload?.dest === 'drive' ? 'drive' : 'file');
    setSource(sheetPayload?.source === 'drive' ? 'drive' : 'file');
    driveStatus()
      .then(setDrive)
      .catch(() => setDrive({ available: false, connected: false, connectedAt: null }));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open || mode !== 'restore' || source !== 'drive' || !drive?.connected || driveFiles) return;
    listDrive()
      .then(setDriveFiles)
      .catch((err) => {
        setDriveFiles([]);
        setError(err?.message || 'Could not list your Drive backups.');
        if (err?.code === 'DRIVE_DISCONNECTED') setDrive((d) => d && { ...d, connected: false });
      });
  }, [open, mode, source, drive?.connected, driveFiles]);

  // Secret chats are backed up whole with their keys, never picked one by one.
  const chats = useMemo(
    () => order.map((id) => conversations[id]).filter((c) => c && c.type !== 'secret'),
    [order, conversations]
  );

  if (!me) return null;

  const close = () => {
    abort.current?.abort();
    closeSheet();
  };

  const cancel = () => {
    abort.current?.abort();
  };

  const fail = (err: any) => {
    if (err?.name === 'AbortError') {
      setStep('form');
      toast('Cancelled — nothing was saved');
      return;
    }
    if (err?.code === 'DRIVE_DISCONNECTED' || err?.code === 'DRIVE_NOT_CONNECTED')
      setDrive((d) => d && { ...d, connected: false });
    setError(err?.message || 'Something went wrong. Try again.');
    setStep('form');
  };

  /* ── backing up ──────────────────────────────────────────────────────── */

  const canBackUp =
    password.length >= 8 &&
    password === confirm &&
    understood &&
    (scope === 'all' || picked.size > 0) &&
    (dest === 'file' || Boolean(drive?.connected));

  const backUp = async () => {
    setError('');
    setStep('working');
    const controller = new AbortController();
    abort.current = controller;
    try {
      const data = await collectBackup(me, {
        only: scope === 'all' ? null : [...picked],
        signal: controller.signal,
        onProgress: setProgress,
      });
      if (controller.signal.aborted) throw new DOMException('Cancelled', 'AbortError');

      setProgress({ phase: 'sealing', label: 'Sealing it with your password…', fraction: null });
      const blob = await sealToBlob(data, password);
      setPassword('');
      setConfirm('');
      if (controller.signal.aborted) throw new DOMException('Cancelled', 'AbortError');

      const name = backupFileName();
      if (dest === 'drive') {
        setProgress({ phase: 'uploading', label: `Uploading to Google Drive · ${formatBytes(blob.size)}`, fraction: 0 });
        await uploadToDrive(blob, name, {
          signal: controller.signal,
          onProgress: (f) =>
            setProgress({ phase: 'uploading', label: `Uploading to Google Drive · ${formatBytes(blob.size)}`, fraction: f }),
        });
      } else {
        await saveToDevice(blob, name);
      }

      writePrefs(me.id, { lastAt: new Date().toISOString(), lastWhere: dest, snoozeUntil: 0 });
      const messages = Object.values(data.messages).reduce((n, list) => n + list.length, 0);
      setResult({
        title: dest === 'drive' ? 'Backed up to Google Drive' : `Saved ${name}`,
        lines: [
          `${data.conversations.length} chat${data.conversations.length === 1 ? '' : 's'}, ${messages} message${messages === 1 ? '' : 's'} · ${formatBytes(blob.size)}`,
          dest === 'drive'
            ? 'Nook keeps your five newest backups there and removes older ones.'
            : 'Keep it somewhere safe — another device, a cloud folder, a USB stick.',
          ...data.skipped.map((s) => `Not included: ${s.name} — ${s.reason}`),
        ],
      });
      setStep('done');
    } catch (err) {
      fail(err);
    } finally {
      abort.current = null;
    }
  };

  /* ── restoring ───────────────────────────────────────────────────────── */

  const pickFile = async (f: File) => {
    setError('');
    setFile({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
  };

  const canRestore = password.length > 0 && (source === 'file' ? Boolean(file) : Boolean(driveChoice));

  const restore = async () => {
    setError('');
    setStep('working');
    const controller = new AbortController();
    abort.current = controller;
    try {
      let raw: Uint8Array;
      if (source === 'drive') {
        setProgress({ phase: 'downloading', label: 'Fetching the backup from Google Drive…', fraction: null });
        raw = await downloadFromDrive(driveChoice, controller.signal);
      } else {
        raw = file!.bytes;
      }

      setProgress({ phase: 'opening', label: 'Opening it with your password…', fraction: null });
      const data = await openBackupFile(raw, password);
      setPassword('');
      if (controller.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      checkSameAccount(data, me);

      setProgress({ phase: 'restoring', label: 'Putting things back…', fraction: null });
      const outcome = await restoreBackup(data, me);
      setResult({
        title: 'Restored',
        archive: outcome.chats > 0,
        lines: [
          `Backup from ${longDate(data.createdAt)}.`,
          outcome.secretRestored
            ? 'Secret-chat keys and history are back on this device.'
            : 'This backup had no secret chats in it.',
          outcome.chats
            ? `${outcome.chats} chat${outcome.chats === 1 ? '' : 's'} and ${outcome.messages} message${outcome.messages === 1 ? '' : 's'} are in your archive — a read-only snapshot. Nothing was sent to anyone.`
            : 'There were no normal chats in it.',
          ...outcome.skipped.map((s) => `Was not in the backup: ${s.name} — ${s.reason}`),
        ],
      });
      setStep('done');
    } catch (err) {
      fail(err);
    } finally {
      abort.current = null;
    }
  };

  /* ── render ──────────────────────────────────────────────────────────── */

  const driveRow = (purpose: 'backup' | 'restore') =>
    drive?.available ? (
      drive.connected ? null : (
        <button className="clay-btn" onClick={() => connectDrive().catch((e) => setError(e?.message || 'Could not reach Google.'))}>
          Connect Google Drive
        </button>
      )
    ) : (
      <p className="tiny faint">
        Google Drive is not set up on this server{purpose === 'backup' ? ' — save to a file instead.' : '.'}
      </p>
    );

  const title = mode === 'restore' ? 'Restore a backup' : 'Back up';

  return (
    <Sheet open={open} onClose={close} title={title}>
      {step === 'working' && (
        <div className="sheet-section" aria-live="polite">
          <span className="eyebrow">{mode === 'restore' ? 'Restoring' : 'Backing up'}</span>
          <p className="small">
            {progress.label || 'Starting…'}
          </p>
          <Bar fraction={progress.fraction} />
          <p className="tiny faint">
            Keep Nook open until this finishes.
          </p>
          <button className="clay-btn" onClick={cancel}>
            Cancel
          </button>
        </div>
      )}

      {step === 'done' && result && (
        <div className="sheet-section">
          <span className="eyebrow note-ok">
            <IconCheck size={15} /> {result.title}
          </span>
          {result.lines.map((line, i) => (
            <p key={i} className="small">
              {line}
            </p>
          ))}
          <div className="row" style={{ gap: 'var(--s-2)', marginTop: 'var(--s-1)' }}>
            {result.archive && (
              <button className="slab grow" onClick={() => openSheet('archive')}>
                <IconArchive size={16} /> Open the archive
              </button>
            )}
            <button className={result.archive ? 'clay-btn grow' : 'slab grow'} onClick={close}>
              Done
            </button>
          </div>
        </div>
      )}

      {step === 'form' && mode === 'backup' && (
        <>
          <div className="sheet-section">
            <p className="tiny faint">
              Your normal chats already live on your account and follow you to a new phone. A backup keeps what
              doesn't: <strong>secret chats</strong>, whose keys and messages exist only on this device, and a{' '}
              <strong>personal archive</strong> of your chats you can read offline — even after messages disappear or
              the other person deletes them.
            </p>
          </div>

          <div className="sheet-section">
            <span className="eyebrow">Which chats</span>
            <div className="row" style={{ gap: 'var(--s-2)' }}>
              <button className={`clay-btn grow${scope === 'all' ? ' on' : ''}`} onClick={() => setScope('all')}>
                All chats
              </button>
              <button className={`clay-btn grow${scope === 'choose' ? ' on' : ''}`} onClick={() => setScope('choose')}>
                Choose…
              </button>
            </div>
            {scope === 'choose' && (
              <div className="sheet-group backup-picklist">
                {chats.map((c) => {
                  const on = picked.has(c.id);
                  return (
                    <button
                      key={c.id}
                      className="list-row"
                      aria-pressed={on}
                      onClick={() =>
                        setPicked((prev) => {
                          const next = new Set(prev);
                          if (on) next.delete(c.id);
                          else next.add(c.id);
                          return next;
                        })
                      }
                    >
                      <span className="grow">
                        <span className="list-row-label">{c.name}</span>
                        {c.locked && !c.lockOpen && (
                          <span className="list-row-sub">Locked — open it first to include it</span>
                        )}
                      </span>
                      <span className="toggle" role="switch" aria-checked={on} />
                    </button>
                  );
                })}
              </div>
            )}
            <p className="tiny faint">
              Secret chats are always included. Photos and files are kept as links, so they open while the server still
              has them.
            </p>
          </div>

          <div className="sheet-section">
            <span className="eyebrow">Where</span>
            <div className="row" style={{ gap: 'var(--s-2)' }}>
              <button className={`clay-btn grow${dest === 'file' ? ' on' : ''}`} onClick={() => setDest('file')}>
                <IconFile size={16} /> A file
              </button>
              {drive?.available && (
                <button className={`clay-btn grow${dest === 'drive' ? ' on' : ''}`} onClick={() => setDest('drive')}>
                  <IconDownload size={16} /> Google Drive
                </button>
              )}
            </div>
            {dest === 'drive' && drive?.connected && (
              <p className="tiny faint">
                Into a hidden Nook folder in your Drive. Nook can't see any of your other files, and Google only ever
                holds the sealed file — never your password.
              </p>
            )}
            {dest === 'drive' && driveRow('backup')}
          </div>

          <div className="sheet-section">
            <span className="eyebrow">
              <IconLock size={14} /> Backup password
            </span>
            <input
              className="groove"
              type="password"
              aria-label="Backup password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
            />
            <Strength password={password} />
            <input
              className="groove"
              type="password"
              aria-label="Type the password again"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Once more"
            />
            {confirm && confirm !== password && (
              <p className="tiny bad">
                The two passwords don't match.
              </p>
            )}
            <button className="list-row backup-warning" onClick={() => setUnderstood((v) => !v)} aria-pressed={understood}>
              <IconWarning size={20} />
              <span className="grow">
                <span className="list-row-label">If I lose this password, the backup is gone</span>
                <span className="list-row-sub">
                  It never leaves this device, so nobody — not Nook, not Google — can reset it or open the file without it.
                </span>
              </span>
              <span className="toggle" role="switch" aria-checked={understood} />
            </button>
          </div>

          {error && (
            <p className="sheet-note bad" role="alert">
              {error}
            </p>
          )}

          <button className="slab" onClick={backUp} disabled={!canBackUp}>
            {dest === 'drive' ? 'Back up to Google Drive' : 'Back up to a file'}
          </button>
        </>
      )}

      {step === 'form' && mode === 'restore' && (
        <>
          <div className="sheet-section">
            <p className="tiny faint">
              Restoring puts your secret-chat keys and messages back on this device, and opens your normal chats as a{' '}
              <strong>read-only archive</strong>. Nothing is re-sent, and nothing in your live chats changes. A backup
              only restores into the account that made it.
            </p>
          </div>

          <div className="sheet-section">
            <span className="eyebrow">From</span>
            <div className="row" style={{ gap: 'var(--s-2)' }}>
              <button className={`clay-btn grow${source === 'file' ? ' on' : ''}`} onClick={() => setSource('file')}>
                <IconFile size={16} /> A file
              </button>
              {drive?.available && (
                <button className={`clay-btn grow${source === 'drive' ? ' on' : ''}`} onClick={() => setSource('drive')}>
                  <IconDownload size={16} /> Google Drive
                </button>
              )}
            </div>

            {source === 'file' ? (
              <button className="list-row" onClick={() => fileInput.current?.click()}>
                <IconFile size={20} />
                <span className="grow">
                  <span className="list-row-label">{file ? file.name : 'Choose a .nookbak file'}</span>
                  <span className="list-row-sub">{file ? formatBytes(file.bytes.length) : 'From this device'}</span>
                </span>
              </button>
            ) : drive?.connected ? (
              driveFiles == null ? (
                <p className="tiny faint">
                  Looking in your Drive…
                </p>
              ) : driveFiles.length === 0 ? (
                <p className="tiny faint">
                  No backups in your Drive yet.
                </p>
              ) : (
                driveFiles.map((f) => (
                  <button
                    key={f.id}
                    className="list-row"
                    aria-pressed={driveChoice === f.id}
                    onClick={() => setDriveChoice(f.id)}
                  >
                    <IconArchive size={20} />
                    <span className="grow">
                      <span className="list-row-label">
                        {longDate(f.createdTime)} · {clock(f.createdTime)}
                      </span>
                      <span className="list-row-sub">{formatBytes(f.size)}</span>
                    </span>
                    {driveChoice === f.id && <IconCheck size={17} />}
                  </button>
                ))
              )
            ) : (
              driveRow('restore')
            )}
          </div>

          <div className="sheet-section">
            <span className="eyebrow">
              <IconLock size={14} /> Backup password
            </span>
            <input
              className="groove"
              type="password"
              aria-label="Backup password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setError('');
              }}
              onKeyDown={(e) => e.key === 'Enter' && canRestore && restore()}
              placeholder="The password you chose when backing up"
            />
          </div>

          {error && (
            <p className="sheet-note bad" role="alert">
              {error}
            </p>
          )}

          <button className="slab" onClick={restore} disabled={!canRestore}>
            Restore
          </button>

          <input
            ref={fileInput}
            type="file"
            accept=".nookbak,application/octet-stream"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) pickFile(f);
              e.target.value = '';
            }}
          />
        </>
      )}
    </Sheet>
  );
}

/* ── the archive viewer ─────────────────────────────────────────────────── */

/**
 * A snapshot, and it looks like one: no composer, no reactions, no read
 * receipts, and a band across the top saying when it was taken. Nothing here
 * talks to the server except to load a photo that is still hosted there.
 */
export function ArchiveSheet() {
  const { sheet, closeSheet, toast } = useUi();
  const me = useAuth((s) => s.me);
  const open = sheet === 'archive';
  const [archive, setArchive] = useState<Archive | null | undefined>(undefined);
  const [viewing, setViewing] = useState<ArchivedConversation | null>(null);

  useEffect(() => {
    if (!open || !me) return;
    setViewing(null);
    setArchive(undefined);
    readArchive(me.id).then(setArchive);
  }, [open, me?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!me) return null;

  const messages = viewing && archive ? archive.messages[viewing.id] || [] : [];

  const remove = async () => {
    if (!window.confirm('Remove the archive from this device? Your backup file is not affected.')) return;
    await clearArchive(me.id);
    setArchive(null);
    toast('Archive removed from this device');
  };

  return (
    <Sheet
      open={open}
      onClose={closeSheet}
      title={viewing ? viewing.name || 'Archived chat' : 'Archive'}
      headExtra={
        viewing ? (
          <button className="clay-round" onClick={() => setViewing(null)} aria-label="Back to the archive">
            <IconBack />
          </button>
        ) : undefined
      }
    >
      {archive && (
        <div className="archive-band" role="note">
          <IconArchive size={16} />
          <span>
            Backup snapshot from <strong>{longDate(archive.createdAt)}</strong> · read-only
          </span>
        </div>
      )}

      {archive === undefined && <p className="tiny faint">Opening…</p>}

      {archive === null && (
        <div className="sheet-section">
          <p className="small">
            No archive on this device.
          </p>
          <p className="tiny faint">
            Restore a backup from Settings → Backup &amp; restore, and its chats appear here to read offline.
          </p>
        </div>
      )}

      {archive && !viewing && (
        <>
          <div className="sheet-section">
            {archive.conversations.length === 0 && <p className="tiny faint">This backup held no normal chats.</p>}
            {archive.conversations.map((c) => {
              const list = archive.messages[c.id] || [];
              const last = list[list.length - 1];
              return (
                <button key={c.id} className="list-row" onClick={() => setViewing(c)}>
                  <span className="grow" style={{ minWidth: 0 }}>
                    <span className="list-row-label">{c.name || 'Untitled chat'}</span>
                    <span className="list-row-sub" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {c.messageCount} message{c.messageCount === 1 ? '' : 's'}
                      {last ? ` · last ${dayLabel(last.createdAt)}` : ''}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
          <div className="sheet-group">
          <button className="list-row danger" onClick={remove}>
            <IconTrash size={20} />
            <span className="grow">
              <span className="list-row-label">Remove the archive from this device</span>
              <span className="list-row-sub">Signing out removes it too. The backup file brings it back.</span>
            </span>
          </button>
          </div>
        </>
      )}

      {archive && viewing && (
        <div className="archive-thread">
          {messages.length === 0 && <p className="tiny faint">No messages in this chat.</p>}
          {messages.map((m, i) => {
            const mine = m.senderId === me.id;
            const prev = messages[i - 1];
            const media = safeUrl(m.media?.url);
            return (
              <div key={m.id}>
                {(!prev || !sameDay(prev.createdAt, m.createdAt)) && <div className="archive-day">{dayLabel(m.createdAt)}</div>}
                <div className={`archive-msg${mine ? ' mine' : ''}`}>
                  {!mine && viewing.type === 'group' && <div className="archive-who">{m.senderName || 'Someone'}</div>}
                  {m.replyTo?.senderName && (
                    <div className="archive-quote">
                      <b>{m.replyTo.senderName}</b> {m.replyTo.body}
                    </div>
                  )}
                  <div className="archive-body">
                    {m.deletedForAll ? (
                      <em>This message was unsent</em>
                    ) : m.type === 'text' ? (
                      m.body
                    ) : media ? (
                      <a href={media} target="_blank" rel="noreferrer noopener">
                        {previewOf(m)}
                      </a>
                    ) : (
                      <em>{previewOf(m)}</em>
                    )}
                    {m.transcript && <div className="archive-transcript">“{m.transcript}”</div>}
                  </div>
                  <div className="archive-meta">
                    {m.editedAt && 'edited · '}
                    {m.reactions.length > 0 && `${m.reactions.map((r) => r.emoji).join(' ')} · `}
                    {clock(m.createdAt)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Sheet>
  );
}
