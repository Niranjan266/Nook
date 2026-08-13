import { useState } from 'react';
import { useChat, selectActive } from '@/stores/chat';
import { useUi } from '@/stores/ui';
import { useAuth } from '@/stores/auth';
import Sheet from '@/components/Sheet';
import Avatar from '@/components/Avatar';
import { post, del } from '@/lib/api';
import { disappearLabel, lastSeenLabel } from '@/lib/format';
import { SOUNDS, previewSound } from '@/lib/sounds';
import { exportConversation } from '@/lib/export';
import type { Person } from '@/lib/types';
import {
  IconWall,
  IconDownload,
  IconImage,
  IconWallpaper,
  IconBell,
  IconBellOff,
  IconPin,
  IconArchive,
  IconClock,
  IconLock,
  IconTrash,
  IconBlock,
  IconUsers,
  IconStar,
  IconPlus,
  IconCheck,
} from '@/components/Icon';

const TIMERS = [0, 3600, 86400, 604800, 2592000];

export default function ChatInfoSheet() {
  const { sheet, closeSheet, openSheet, toast } = useUi();
  const conversation = useChat(selectActive);
  const { updatePrefs, setDisappearing, removeMember, setRole, presence, setPace } = useChat();
  const me = useAuth((s) => s.me);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [exporting, setExporting] = useState(false);

  const open = sheet === 'chat-info';
  if (!conversation || !me) return null;

  const isGroup = conversation.type === 'group';
  const partner = conversation.partner;
  const partnerPresence = partner ? presence[partner.id] : undefined;
  const isAdmin = conversation.myRole === 'admin';

  const toggle = (key: 'muted' | 'pinned' | 'archived' | 'locked') =>
    updatePrefs(conversation.id, { [key]: !conversation[key] });

  return (
    <Sheet open={open} onClose={closeSheet} title={isGroup ? 'Group' : 'Contact'}>
      <div className="stack" style={{ alignItems: 'center', gap: 10, padding: '4px 0 8px' }}>
        <Avatar
          name={conversation.name}
          src={conversation.avatarUrl}
          id={partner?.id || conversation.id}
          accent={partner?.accent}
          size={96}
          square={isGroup}
        />
        <h3 style={{ textAlign: 'center' }}>{conversation.name}</h3>
        <p className="small muted" style={{ textAlign: 'center' }}>
          {isGroup
            ? conversation.description || `${conversation.members.length} people`
            : partner
              ? `@${partner.username}`
              : ''}
        </p>
        {!isGroup && partner && (
          <p className="tiny faint">
            {partnerPresence?.online ? 'Online now' : partnerPresence?.lastSeen ? `Last seen ${lastSeenLabel(partnerPresence.lastSeen)}` : ''}
          </p>
        )}
        {!isGroup && partner?.about && <p className="small" style={{ textAlign: 'center' }}>{partner.about}</p>}
      </div>

      <div className="sheet-section">
        <button className="list-row" onClick={() => openSheet('room')}>
          <IconWall size={19} />
          <span className="grow">
            <span className="list-row-label">This room</span>
            <span className="list-row-sub">
              Mood, the wall, time of day, and every wallpaper it has worn
            </span>
          </span>
        </button>

        <button className="list-row" onClick={() => openSheet('media')}>
          <IconImage size={19} />
          <span className="grow">
            <span className="list-row-label">Shared photos, files and voice</span>
            <span className="list-row-sub">Everything sent here, without scrolling back</span>
          </span>
        </button>

        <button className="list-row" onClick={() => openSheet('wallpaper')}>
          <IconWallpaper size={19} />
          <span className="grow">
            <span className="list-row-label">Wallpaper</span>
            <span className="list-row-sub">
              {conversation.wallpaper.url || conversation.wallpaper.preset
                ? isGroup
                  ? 'Set for the group'
                  : 'Shared with both of you'
                : 'None yet'}
            </span>
          </span>
        </button>

        <button className="list-row" onClick={() => toggle('muted')} aria-pressed={conversation.muted}>
          {conversation.muted ? <IconBellOff size={19} /> : <IconBell size={19} />}
          <span className="grow">
            <span className="list-row-label">{conversation.muted ? 'Muted' : 'Notifications on'}</span>
          </span>
          <span className="toggle" aria-checked={!conversation.muted} role="switch" />
        </button>

        <button className="list-row" onClick={() => toggle('pinned')} aria-pressed={conversation.pinned}>
          <IconPin size={19} />
          <span className="grow">
            <span className="list-row-label">Pin to top</span>
          </span>
          <span className="toggle" aria-checked={conversation.pinned} role="switch" />
        </button>

        <button className="list-row" onClick={() => toggle('archived')}>
          <IconArchive size={19} />
          <span className="grow">
            <span className="list-row-label">{conversation.archived ? 'Unarchive' : 'Archive'}</span>
          </span>
        </button>

        <button className="list-row" onClick={() => toggle('locked')} aria-pressed={conversation.locked}>
          <IconLock size={19} />
          <span className="grow">
            <span className="list-row-label">Lock this chat</span>
            <span className="list-row-sub">Hides the contents until you unlock it</span>
          </span>
          <span className="toggle" aria-checked={conversation.locked} role="switch" />
        </button>
      </div>

      {/* ── per-person notification sound ────────────────────────────── */}
      <div className="sheet-section">
        <span className="eyebrow">How this person sounds</span>
        <p className="tiny faint" style={{ paddingLeft: 4 }}>
          You learn who it is without looking at the screen.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6 }}>
          {SOUNDS.map((s) => (
            <button
              key={s.id}
              className={`clay-btn${(conversation.sound || 'default') === s.id ? ' on' : ''}`}
              style={{ justifyContent: 'flex-start', fontSize: 'var(--t-sm)' }}
              onClick={() => {
                previewSound(s.id);
                updatePrefs(conversation.id, { sound: s.id });
              }}
              title={s.description}
            >
              {(conversation.sound || 'default') === s.id ? <IconCheck size={15} /> : <IconBell size={15} />}
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── pace ─────────────────────────────────────────────────────── */}
      <div className="sheet-section">
        <span className="eyebrow">Pace</span>
        <p className="tiny faint" style={{ paddingLeft: 4 }}>
          Slow mode limits each person, not the room — one chatty member can't mute everyone else.
        </p>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {[0, 30, 300, 3600].map((s) => (
            <button
              key={s}
              className={`clay-btn${conversation.slowMode === s ? ' on' : ''}`}
              style={{ padding: '7px 13px', fontSize: 'var(--t-sm)' }}
              onClick={() => setPace(conversation.id, { slowMode: s })}
            >
              {s === 0 ? 'Off' : s < 60 ? `${s}s` : s < 3600 ? `${s / 60} min` : '1 hour'}
            </button>
          ))}
        </div>
      </div>

      <div className="sheet-section">
        <span className="eyebrow">Disappearing messages</span>
        <p className="tiny faint" style={{ paddingLeft: 4 }}>
          New messages delete themselves after this long. Existing ones stay.
        </p>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {TIMERS.map((t) => (
            <button
              key={t}
              className={`clay-btn${conversation.disappearAfter === t ? ' on' : ''}`}
              style={{ padding: '7px 13px', fontSize: 'var(--t-sm)' }}
              onClick={() => setDisappearing(conversation.id, t)}
            >
              {t === 0 ? 'Off' : disappearLabel(t)}
            </button>
          ))}
        </div>
      </div>

      {isGroup && (
        <div className="sheet-section">
          <span className="eyebrow row" style={{ justifyContent: 'space-between' }}>
            <span>{conversation.members.length} people</span>
            {isAdmin && (
              <button className="small" style={{ color: 'var(--accent-deep)', fontWeight: 600 }} onClick={() => openSheet('new-group')}>
                <IconPlus size={14} /> Add
              </button>
            )}
          </span>
          {conversation.members.map((m) => {
            const p = m.user as Person;
            const isMe = p.id === me.id;
            return (
              <div key={p.id} className="list-row">
                <Avatar name={p.displayName || 'Someone'} src={p.avatarUrl} id={p.id} accent={p.accent} size={38} />
                <span className="grow">
                  <span className="list-row-label">{isMe ? 'You' : p.displayName}</span>
                  <span className="list-row-sub">@{p.username}</span>
                </span>
                {m.role === 'admin' && <span className="chip chip-quiet">admin</span>}
                {isAdmin && !isMe && (
                  <>
                    <button
                      className="clay-round"
                      style={{ width: 32, height: 32 }}
                      onClick={() => setRole(conversation.id, p.id, m.role === 'admin' ? 'member' : 'admin')}
                      aria-label={m.role === 'admin' ? 'Remove admin' : 'Make admin'}
                      title={m.role === 'admin' ? 'Remove admin' : 'Make admin'}
                    >
                      <IconStar size={15} />
                    </button>
                    <button
                      className="clay-round"
                      style={{ width: 32, height: 32, color: 'var(--rust)' }}
                      onClick={() => removeMember(conversation.id, p.id)}
                      aria-label={`Remove ${p.displayName}`}
                    >
                      <IconTrash size={15} />
                    </button>
                  </>
                )}
              </div>
            );
          })}
          {conversation.inviteCode && (
            <button
              className="list-row"
              onClick={() => {
                navigator.clipboard?.writeText(`${location.origin}/join/${conversation.inviteCode}`);
                toast('Invite link copied');
              }}
            >
              <IconUsers size={19} />
              <span className="grow">
                <span className="list-row-label">Copy invite link</span>
                <span className="list-row-sub">Anyone with it can join</span>
              </span>
            </button>
          )}
        </div>
      )}

      {/* ── take it with you ─────────────────────────────────────────── */}
      <div className="sheet-section">
        <span className="eyebrow">Take it with you</span>
        <button
          className="list-row"
          disabled={exporting}
          onClick={async () => {
            setExporting(true);
            try {
              await exportConversation(conversation);
              toast('Exported — check your downloads');
            } catch {
              toast('Could not build that export.', true);
            } finally {
              setExporting(false);
            }
          }}
        >
          <IconDownload size={19} />
          <span className="grow">
            <span className="list-row-label">{exporting ? 'Building…' : 'Export this conversation'}</span>
            <span className="list-row-sub">A readable file you keep. Your data genuinely leaves.</span>
          </span>
        </button>

        {conversation.type === 'group' && (
          <button
            className="list-row"
            onClick={async () => {
              try {
                const { link } = await post<{ link: { code: string } }>(
                  `/spaces/conversations/${conversation.id}/guest-link`,
                  { label: 'Guest', expiresInHours: 24 * 7 }
                );
                await navigator.clipboard?.writeText(`${location.origin}/guest/${link.code}`);
                toast('Guest link copied — no account needed, expires in 7 days');
              } catch (e: any) {
                toast(e?.message || 'Could not make a link.', true);
              }
            }}
          >
            <IconUsers size={19} />
            <span className="grow">
              <span className="list-row-label">Invite a guest</span>
              <span className="list-row-sub">One conversation, no account, no install</span>
            </span>
          </button>
        )}
      </div>

      <div className="sheet-section">
        <span className="eyebrow">Careful now</span>
        <button
          className="list-row"
          style={{ color: 'var(--rust)' }}
          onClick={async () => {
            await del(`/conversations/${conversation.id}/messages`);
            toast('Cleared for you only');
            closeSheet();
            location.reload();
          }}
        >
          <IconTrash size={19} />
          <span className="grow">
            <span className="list-row-label">Clear messages</span>
            <span className="list-row-sub">Only on your side</span>
          </span>
        </button>

        {isGroup ? (
          <button
            className="list-row"
            style={{ color: 'var(--rust)' }}
            onClick={() => {
              if (!confirmLeave) return setConfirmLeave(true);
              removeMember(conversation.id, me.id);
              closeSheet();
            }}
          >
            <IconBlock size={19} />
            <span className="grow">
              <span className="list-row-label">{confirmLeave ? 'Tap again to leave' : 'Leave group'}</span>
            </span>
            {confirmLeave && <IconCheck size={17} />}
          </button>
        ) : (
          partner && (
            <button
              className="list-row"
              style={{ color: 'var(--rust)' }}
              onClick={async () => {
                await post(`/users/${partner.id}/block`);
                toast(`${partner.displayName} is blocked`);
                closeSheet();
              }}
            >
              <IconBlock size={19} />
              <span className="grow">
                <span className="list-row-label">Block {partner.displayName.split(' ')[0]}</span>
                <span className="list-row-sub">They can no longer message you</span>
              </span>
            </button>
          )
        )}
      </div>
    </Sheet>
  );
}
