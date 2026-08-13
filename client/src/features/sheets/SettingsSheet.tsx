import { useRef, useState } from 'react';
import { useAuth } from '@/stores/auth';
import { useUi } from '@/stores/ui';
import Sheet from '@/components/Sheet';
import Avatar from '@/components/Avatar';
import { upload, post, put, patch, get } from '@/lib/api';
import { enablePush, disablePush, pushState } from '@/lib/push';
import { toClock, fromClock, isQuietNow } from '@/lib/rooms';
import type { QuietHours } from '@/lib/types';
import {
  IconSun,
  IconMoon,
  IconMoon2,
  IconSettings,
  IconStar,
  IconBell,
  IconLogOut,
  IconCamera,
  IconCheck,
  IconLock,
  IconUser,
  IconReply,
  IconFile,
  IconMic,
  IconCopy,
  IconRefresh,
  IconFolder,
  IconSchedule,
} from '@/components/Icon';

const ACCENTS = [
  { id: 'terracotta', label: 'Terracotta', hex: '#C0603C' },
  { id: 'moss', label: 'Moss', hex: '#57694A' },
  { id: 'ochre', label: 'Ochre', hex: '#CE9535' },
  { id: 'clay-blue', label: 'Slate', hex: '#47606F' },
  { id: 'rust', label: 'Rust', hex: '#A33F2F' },
] as const;

export default function SettingsSheet() {
  const { sheet, closeSheet, openSheet, toast, theme, setTheme, accent, setAccent } = useUi();
  const { me, patchMe, logout, setMe } = useAuth();
  const fileInput = useRef<HTMLInputElement>(null);
  const [push, setPush] = useState(pushState());
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState(me?.displayName || '');
  const [about, setAbout] = useState(me?.about || '');
  const [copied, setCopied] = useState(false);
  const [rolling, setRolling] = useState(false);
  const [editingHandle, setEditingHandle] = useState(false);
  const [handle, setHandle] = useState(me?.username || '');
  const [handleNote, setHandleNote] = useState('');

  const open = sheet === 'settings';
  if (!me) return null;

  const quiet: QuietHours = me.quietHours || {
    enabled: false,
    start: 22 * 60,
    end: 7 * 60,
    timezone: '',
    allowUrgent: true,
    visible: true,
  };

  const saveQuiet = async (patch: Partial<QuietHours>) => {
    const next = { ...quiet, ...patch };
    setMe({ ...me, quietHours: next });
    try {
      await put('/users/me/quiet-hours', {
        enabled: next.enabled,
        start: next.start,
        end: next.end,
        visible: next.visible,
        allowUrgent: next.allowUrgent,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
    } catch {
      toast('Could not save quiet hours.', true);
    }
  };

  const copyNookId = async () => {
    if (!me.nookId) return;
    try {
      await navigator.clipboard.writeText(me.nookId);
    } catch {
      // Clipboard access needs a secure context and, in some browsers, a
      // permission the user may have denied. Selecting the text is a fair
      // consolation prize; failing silently is not.
      toast('Could not copy — select the code and copy it manually.', true);
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const saveUsername = async () => {
    const next = handle.trim().toLowerCase();
    if (!next || next === me.username) {
      setEditingHandle(false);
      return;
    }
    setRolling(true);
    try {
      const r = await patch<{ username: string }>('/users/me/username', { username: next });
      setMe({ ...me, username: r.username });
      setEditingHandle(false);
      setHandleNote('');
      toast(`You're @${r.username} now`);
    } catch (err: any) {
      setHandleNote(err?.message || 'Could not change your username.');
    } finally {
      setRolling(false);
    }
  };

  /** Live availability, so nobody types a whole name to be told it's taken. */
  const checkHandle = async (value: string) => {
    setHandle(value);
    const v = value.trim().toLowerCase();
    if (!v || v === me.username) return setHandleNote('');
    try {
      const r = await get<{ available: boolean; reason: string }>(
        `/users/username-available/${encodeURIComponent(v)}`
      );
      setHandleNote(r.available ? '✓ Available' : r.reason);
    } catch {
      setHandleNote('');
    }
  };

  const saveProfile = async () => {
    await patchMe({ displayName: name.trim() || me.displayName, about });
    setEditingName(false);
    toast('Saved');
  };

  const changeAvatar = async (file: File) => {
    try {
      const { media } = await upload(file, 'avatar');
      await patchMe({ avatarUrl: media.url });
      toast('New picture');
    } catch {
      toast('Could not upload that.', true);
    }
  };

  const togglePush = async () => {
    if (push === 'on') {
      await disablePush();
      setPush('off');
      toast('Notifications off');
    } else {
      const result = await enablePush();
      setPush(result);
      toast(
        result === 'on'
          ? 'Notifications on'
          : result === 'denied'
            ? 'Your browser blocked notifications.'
            : 'Notifications are not available here.',
        result !== 'on'
      );
    }
  };

  return (
    <Sheet open={open} onClose={closeSheet} title="You">
      <div className="stack" style={{ alignItems: 'center', gap: 10 }}>
        <button style={{ position: 'relative' }} onClick={() => fileInput.current?.click()} aria-label="Change picture">
          <Avatar name={me.displayName} src={me.avatarUrl} id={me.id} accent={accent} size={92} />
          <span
            className="clay-round"
            style={{ width: 32, height: 32, position: 'absolute', right: -2, bottom: -2 }}
          >
            <IconCamera size={16} />
          </span>
        </button>

        {editingName ? (
          <div className="stack" style={{ gap: 8, width: '100%' }}>
            <input className="groove" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} aria-label="Display name" />
            <input className="groove" value={about} onChange={(e) => setAbout(e.target.value)} maxLength={140} aria-label="About" placeholder="Somewhere quiet." />
            <div className="row" style={{ gap: 8 }}>
              <button className="clay-btn grow" onClick={() => setEditingName(false)}>
                Cancel
              </button>
              <button className="slab grow" onClick={saveProfile}>
                Save
              </button>
            </div>
          </div>
        ) : (
          <button className="stack" style={{ alignItems: 'center', gap: 2 }} onClick={() => setEditingName(true)}>
            <h3>{me.displayName}</h3>
            <span className="small muted">
              @{me.username}
              {me.nookId ? ` · ${me.nookId}` : ''}
            </span>
            <span className="tiny faint">{me.about || 'Add something about you'}</span>
          </button>
        )}
      </div>

      <div className="sheet-section">
        <span className="eyebrow">Your Nook ID</span>
        <p className="tiny faint" style={{ marginBottom: 6 }}>
          This is yours permanently and cannot be changed. Share it and people can always find you —
          even after you change your username.
        </p>
        <div className="row" style={{ gap: 6 }}>
          <code className="nook-id grow">{me.nookId || '—'}</code>
          <button className="clay-btn" onClick={copyNookId} aria-label="Copy your Nook ID">
            {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>

      <div className="sheet-section">
        <span className="eyebrow">Username</span>
        {editingHandle ? (
          <>
            <input
              className="groove"
              aria-label="Username"
              value={handle}
              onChange={(e) => checkHandle(e.target.value)}
              maxLength={20}
              autoCapitalize="none"
              spellCheck={false}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveUsername();
                if (e.key === 'Escape') setEditingHandle(false);
              }}
            />
            {handleNote && (
              <p className="tiny" style={{ margin: '4px 0 0', color: handleNote.startsWith('✓') ? 'var(--moss)' : 'var(--rust)' }}>
                {handleNote}
              </p>
            )}
            <p className="tiny faint" style={{ margin: '4px 0 6px' }}>
              3–20 characters: letters, numbers, dots and underscores. Your old username becomes free
              for anyone else to take, so tell people your Nook ID if you want to stay findable.
            </p>
            <div className="row" style={{ gap: 6 }}>
              <button className="clay-btn grow" onClick={() => setEditingHandle(false)}>
                Cancel
              </button>
              <button
                className="slab grow"
                onClick={saveUsername}
                disabled={rolling || handleNote.startsWith('Someone') || handleNote.startsWith('Letters')}
              >
                {rolling ? 'Saving…' : 'Save'}
              </button>
            </div>
          </>
        ) : (
          <button
            className="list-row"
            onClick={() => {
              setHandle(me.username);
              setHandleNote('');
              setEditingHandle(true);
            }}
          >
            <IconUser size={19} />
            <span className="grow">
              <span className="list-row-label">@{me.username}</span>
              <span className="list-row-sub">Change your username</span>
            </span>
          </button>
        )}
      </div>

      <div className="sheet-section">
        <span className="eyebrow">Look</span>
        <div className="row" style={{ gap: 6 }}>
          {(['light', 'dark', 'system'] as const).map((t) => (
            <button
              key={t}
              className={`clay-btn grow${theme === t ? ' on' : ''}`}
              onClick={() => {
                setTheme(t);
                patchMe({ settings: { ...me.settings, theme: t } }).catch(() => {});
              }}
              style={{ textTransform: 'capitalize' }}
            >
              {t === 'light' ? <IconSun size={16} /> : t === 'dark' ? <IconMoon size={16} /> : <IconSettings size={16} />}
              {t}
            </button>
          ))}
        </div>

        <div className="row" style={{ gap: 8, marginTop: 6 }}>
          {ACCENTS.map((a) => (
            <button
              key={a.id}
              onClick={() => {
                setAccent(a.id);
                patchMe({ accent: a.id }).catch(() => {});
              }}
              aria-label={a.label}
              aria-pressed={accent === a.id}
              style={{
                width: 38,
                height: 38,
                borderRadius: 12,
                background: a.hex,
                boxShadow: accent === a.id ? '0 0 0 3px var(--ink)' : 'var(--clay-1)',
                display: 'grid',
                placeItems: 'center',
                color: '#fff',
              }}
            >
              {accent === a.id && <IconCheck size={16} />}
            </button>
          ))}
        </div>
      </div>

      <div className="sheet-section">
        <span className="eyebrow">Privacy</span>

        <button
          className="list-row"
          onClick={() => patchMe({ privacy: { ...me.privacy, readReceipts: !me.privacy.readReceipts } })}
        >
          <IconCheck size={19} />
          <span className="grow">
            <span className="list-row-label">Send read receipts</span>
            <span className="list-row-sub">Turn off and you stop seeing theirs too</span>
          </span>
          <span className="toggle" role="switch" aria-checked={me.privacy.readReceipts} />
        </button>

        <div className="list-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
          <span className="list-row-label">Who sees your last seen</span>
          <div className="row" style={{ gap: 6 }}>
            {(['everyone', 'contacts', 'nobody'] as const).map((v) => (
              <button
                key={v}
                className={`clay-btn grow${me.privacy.lastSeen === v ? ' on' : ''}`}
                style={{ padding: '7px 11px', fontSize: 'var(--t-sm)', textTransform: 'capitalize' }}
                onClick={() => patchMe({ privacy: { ...me.privacy, lastSeen: v } })}
              >
                {v}
              </button>
            ))}
          </div>
        </div>

        <button className="list-row" onClick={togglePush}>
          <IconBell size={19} />
          <span className="grow">
            <span className="list-row-label">Push notifications</span>
            <span className="list-row-sub">
              {push === 'on' ? 'On for this device' : push === 'denied' ? 'Blocked by your browser' : 'Off'}
            </span>
          </span>
          <span className="toggle" role="switch" aria-checked={push === 'on'} />
        </button>
      </div>

      {/* ── quiet hours: a contract, not a personal mute ──────────────── */}
      <div className="sheet-section">
        <span className="eyebrow row" style={{ gap: 8 }}>
          <IconMoon2 size={15} /> Quiet hours
        </span>
        <p className="tiny faint" style={{ paddingLeft: 4, lineHeight: 1.6 }}>
          Not a do-not-disturb that only protects you. The people you talk to see this window
          <strong> before they send</strong>, so the norm is social rather than technical.
        </p>

        <button
          className="list-row"
          onClick={() => saveQuiet({ enabled: !quiet.enabled })}
          aria-pressed={quiet.enabled}
        >
          <IconMoon2 size={19} />
          <span className="grow">
            <span className="list-row-label">
              {quiet.enabled ? `Quiet ${toClock(quiet.start)}–${toClock(quiet.end)}` : 'Off'}
            </span>
            <span className="list-row-sub">
              {quiet.enabled && isQuietNow(quiet.start, quiet.end)
                ? 'Quiet right now'
                : 'Nothing will notify you inside the window'}
            </span>
          </span>
          <span className="toggle" role="switch" aria-checked={quiet.enabled} />
        </button>

        {quiet.enabled && (
          <>
            <div className="row" style={{ gap: 8 }}>
              <label className="field grow">
                <span className="field-label">From</span>
                <input
                  className="groove"
                  type="time"
                  value={toClock(quiet.start)}
                  onChange={(e) => saveQuiet({ start: fromClock(e.target.value) })}
                />
              </label>
              <label className="field grow">
                <span className="field-label">Until</span>
                <input
                  className="groove"
                  type="time"
                  value={toClock(quiet.end)}
                  onChange={(e) => saveQuiet({ end: fromClock(e.target.value) })}
                />
              </label>
            </div>

            <button className="list-row" onClick={() => saveQuiet({ visible: !quiet.visible })}>
              <IconUser size={19} />
              <span className="grow">
                <span className="list-row-label">Let people see the window</span>
                <span className="list-row-sub">
                  Turn this off and it becomes an ordinary silent mute
                </span>
              </span>
              <span className="toggle" role="switch" aria-checked={quiet.visible} />
            </button>
          </>
        )}
      </div>

      <div className="sheet-section">
        <span className="eyebrow">How it behaves</span>

        <button
          className="list-row"
          onClick={() => patchMe({ settings: { ...me.settings, badgeCount: !me.settings.badgeCount } })}
        >
          <IconBell size={19} />
          <span className="grow">
            <span className="list-row-label">Unread count on the app icon</span>
            <span className="list-row-sub">Off by default — a number that only goes up is a slot machine</span>
          </span>
          <span className="toggle" role="switch" aria-checked={me.settings.badgeCount} />
        </button>

        <button
          className="list-row"
          onClick={() => patchMe({ settings: { ...me.settings, swipeToReply: !me.settings.swipeToReply } })}
        >
          <IconReply size={19} />
          <span className="grow">
            <span className="list-row-label">Swipe a message to reply</span>
          </span>
          <span className="toggle" role="switch" aria-checked={me.settings.swipeToReply} />
        </button>

        <button
          className="list-row"
          onClick={() => patchMe({ settings: { ...me.settings, linkPreviews: !me.settings.linkPreviews } })}
        >
          <IconFile size={19} />
          <span className="grow">
            <span className="list-row-label">Show link previews</span>
            <span className="list-row-sub">Fetched by our server, so your device never touches the link</span>
          </span>
          <span className="toggle" role="switch" aria-checked={me.settings.linkPreviews} />
        </button>

        <button
          className="list-row"
          onClick={() => patchMe({ settings: { ...me.settings, skipSilence: !me.settings.skipSilence } })}
        >
          <IconMic size={19} />
          <span className="grow">
            <span className="list-row-label">Skip silence in voice notes</span>
            <span className="list-row-sub">A four-minute ramble in about ninety seconds</span>
          </span>
          <span className="toggle" role="switch" aria-checked={me.settings.skipSilence} />
        </button>

        <div className="list-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
          <span className="list-row-label">Voice note speed</span>
          <div className="row" style={{ gap: 6 }}>
            {[1, 1.5, 2].map((v) => (
              <button
                key={v}
                className={`clay-btn grow${me.settings.voiceSpeed === v ? ' on' : ''}`}
                style={{ padding: '7px 11px', fontSize: 'var(--t-sm)' }}
                onClick={() => patchMe({ settings: { ...me.settings, voiceSpeed: v } })}
              >
                {v}×
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="sheet-section">
        <span className="eyebrow">Elsewhere</span>
        <button className="list-row" onClick={() => openSheet('folders')}>
          <IconFolder size={19} />
          <span className="grow">
            <span className="list-row-label">Folders</span>
            <span className="list-row-sub">Private to you — nobody learns which drawer they're in</span>
          </span>
        </button>
        <button className="list-row" onClick={() => openSheet('scheduled')}>
          <IconSchedule size={19} />
          <span className="grow">
            <span className="list-row-label">Scheduled messages</span>
          </span>
        </button>
        <button className="list-row" onClick={() => openSheet('starred')}>
          <IconStar size={19} />
          <span className="grow">
            <span className="list-row-label">Starred messages</span>
          </span>
        </button>
        <button
          className="list-row"
          onClick={() => patchMe({ settings: { ...me.settings, enterToSend: !me.settings.enterToSend } })}
        >
          <IconSettings size={19} />
          <span className="grow">
            <span className="list-row-label">Enter sends the message</span>
            <span className="list-row-sub">Off means Enter makes a new line</span>
          </span>
          <span className="toggle" role="switch" aria-checked={me.settings.enterToSend} />
        </button>
      </div>

      <div className="sheet-section">
        <span className="eyebrow">Honest note</span>
        <p className="tiny faint" style={{ paddingLeft: 4, lineHeight: 1.65 }}>
          Nook has no feeds, no ads and no tracking, and your messages are encrypted in transit. They are
          <strong> not</strong> end-to-end encrypted — the server can read them. If that matters for what you
          talk about, use something with E2E encryption.
        </p>
      </div>

      <button className="list-row" style={{ color: 'var(--rust)' }} onClick={() => logout()}>
        <IconLogOut size={19} />
        <span className="grow">
          <span className="list-row-label">Sign out</span>
        </span>
      </button>

      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) changeAvatar(f);
          e.target.value = '';
        }}
      />
    </Sheet>
  );
}
