import { useEffect, useState } from 'react';
import { useChat, selectActive } from '@/stores/chat';
import { useUi } from '@/stores/ui';
import { useAuth } from '@/stores/auth';
import Sheet from '@/components/Sheet';
import Avatar from '@/components/Avatar';
import { post, put, del } from '@/lib/api';
import { disappearLabel, lastSeenLabel } from '@/lib/format';
import { SOUNDS, previewSound } from '@/lib/sounds';
import { exportConversation } from '@/lib/export';
import CodeEntry from '@/components/CodeEntry';
import type { Person, Conversation as Convo } from '@/lib/types';
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
  IconTag,
  IconUsers,
  IconStar,
  IconPlus,
  IconCheck,
  IconRefresh,
} from '@/components/Icon';

const TIMERS = [0, 3600, 86400, 604800, 2592000];

export default function ChatInfoSheet() {
  const { sheet, closeSheet, openSheet, toast } = useUi();
  const conversation = useChat(selectActive);
  const { updatePrefs, setDisappearing, removeMember, setRole, presence, setPace, loadConversations } =
    useChat();
  const me = useAuth((s) => s.me);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [nickDraft, setNickDraft] = useState('');
  const [savingNick, setSavingNick] = useState(false);
  const [lockStep, setLockStep] = useState<LockStep>(null);

  const open = sheet === 'chat-info';
  if (!conversation || !me) return null;

  const isGroup = conversation.type === 'group';
  const partner = conversation.partner;
  const partnerPresence = partner ? presence[partner.id] : undefined;
  const isAdmin = conversation.myRole === 'admin';

  const toggle = (key: 'muted' | 'pinned' | 'archived' | 'locked') =>
    updatePrefs(conversation.id, { [key]: !conversation[key] });

  /**
   * The nickname lives on the server and is applied when anything is
   * serialised, so the honest way to refresh the UI is to re-fetch rather than
   * patch a name into a dozen cached places and hope none were missed.
   */
  const saveNickname = async () => {
    if (!partner) return;
    const next = nickDraft.trim();
    setSavingNick(true);
    try {
      if (next) await put(`/users/${partner.id}/nickname`, { nickname: next });
      else await del(`/users/${partner.id}/nickname`);

      await loadConversations();
      setRenaming(false);
      toast(next ? `You’ll see them as ${next}` : 'Back to their real name');
    } catch (err: any) {
      toast(err?.message || 'Could not save that nickname.', true);
    } finally {
      setSavingNick(false);
    }
  };

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
              ? `@${partner.username}${partner.nookId ? ` · ${partner.nookId}` : ''}`
              : ''}
        </p>
        {/* When you've renamed someone, say so plainly and show who they
            actually are. Otherwise a nickname set months ago becomes a small
            mystery, and nothing else in the app would tell you. */}
        {!isGroup && partner?.nickname && (
          <p className="tiny faint" style={{ textAlign: 'center' }}>
            You call them {partner.nickname} · they’re {partner.realName}
          </p>
        )}
        {!isGroup && partner && (
          <p className="tiny faint">
            {partnerPresence?.online ? 'Online now' : partnerPresence?.lastSeen ? `Last seen ${lastSeenLabel(partnerPresence.lastSeen)}` : ''}
          </p>
        )}
        {!isGroup && partner?.about && <p className="small" style={{ textAlign: 'center' }}>{partner.about}</p>}
      </div>

      {!isGroup && partner && (
        <div className="sheet-section">
          <span className="eyebrow">What you call them</span>
          {renaming ? (
            <>
              <input
                className="groove"
                aria-label="Nickname"
                value={nickDraft}
                onChange={(e) => setNickDraft(e.target.value)}
                placeholder={partner.realName || partner.displayName}
                maxLength={40}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveNickname();
                  if (e.key === 'Escape') setRenaming(false);
                }}
              />
              <p className="tiny faint" style={{ margin: '4px 0 6px' }}>
                Only you see this. {partner.realName || partner.displayName} is never told, and nobody
                in a shared group sees it either. Leave it empty to go back to their real name.
              </p>
              <div className="row" style={{ gap: 6 }}>
                <button className="clay-btn grow" onClick={() => setRenaming(false)}>
                  Cancel
                </button>
                <button className="slab grow" onClick={saveNickname} disabled={savingNick}>
                  {savingNick ? 'Saving…' : 'Save'}
                </button>
              </div>
            </>
          ) : (
            <button
              className="list-row"
              onClick={() => {
                setNickDraft(partner.nickname || '');
                setRenaming(true);
              }}
            >
              <IconTag size={19} />
              <span className="grow">
                <span className="list-row-label">
                  {partner.nickname ? `Rename — currently “${partner.nickname}”` : 'Give them a nickname'}
                </span>
                <span className="list-row-sub">Just for you, everywhere you see them</span>
              </span>
            </button>
          )}
        </div>
      )}

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

        {/*
          Not a toggle any more. A lock has a code, so turning it on is a small
          conversation — choose PIN or pattern, enter it twice — and turning it
          off has to ask for the code, or it is not a lock.
        */}
        <button className="list-row" onClick={() => setLockStep(conversation.locked ? 'remove' : 'choose')}>
          <IconLock size={19} />
          <span className="grow">
            <span className="list-row-label">{conversation.locked ? 'Chat lock is on' : 'Lock this chat'}</span>
            <span className="list-row-sub">
              {conversation.locked
                ? `Opens with your ${conversation.lockKind === 'pattern' ? 'pattern' : 'PIN'} — tap to change or remove`
                : 'A PIN or pattern, just for this chat'}
            </span>
          </span>
          {conversation.locked && <span className="chip">On</span>}
        </button>

        {conversation.locked && (
          <button className="list-row" onClick={() => setLockStep('change')}>
            <IconRefresh size={19} />
            <span className="grow">
              <span className="list-row-label">Change the code</span>
              <span className="list-row-sub">You will need the current one first</span>
            </span>
          </button>
        )}
      </div>

      <LockFlow
        conversation={conversation}
        step={lockStep}
        onDone={() => setLockStep(null)}
      />

      {/* ── custom notification, for this person only ─────────────────── */}
      <div className="sheet-section">
        <span className="eyebrow">Custom notification</span>
        <p className="tiny faint" style={{ paddingLeft: 4, marginBottom: 8 }}>
          Just for {isGroup ? 'this group' : conversation.name.split(' ')[0]}. Anything left on
          “Default” follows your setting in Settings → Notifications, so changing that later still
          reaches this chat.
        </p>

        {/*
          Three states rather than a switch. A per-chat toggle would have to
          start somewhere, and whichever way it started would silently pin this
          chat to whatever the global setting happened to be that day — so
          "Default" is a real, visible choice.
        */}
        <TriChoice
          label="Vibrate"
          hint="A buzz when a message arrives"
          value={conversation.notifyVibrate ?? -1}
          onChange={(v) => updatePrefs(conversation.id, { notifyVibrate: v })}
        />
        <TriChoice
          label="Show the message"
          hint="Off means the alert says who wrote, not what"
          value={conversation.notifyPreview ?? -1}
          onChange={(v) => updatePrefs(conversation.id, { notifyPreview: v })}
        />
      </div>

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

/* ── chat lock setup ──────────────────────────────────────────────────────── */

type LockStep = null | 'choose' | 'set-pin' | 'set-pattern' | 'change' | 'change-new' | 'remove';

/**
 * Turning a lock on, changing it, or taking it off.
 *
 * Shown over the info sheet rather than as another sheet, because it is a
 * short detour that returns you to where you were — and because a sheet on top
 * of a sheet is one gesture away from closing both.
 *
 * The new code is always asked for twice. A chat lock is the one setting where
 * a typo is not recoverable: nobody can reset it for you, and the messages
 * behind it are the ones you cared enough about to lock.
 */
function LockFlow({
  conversation,
  step,
  onDone,
}: {
  conversation: Convo;
  step: LockStep;
  onDone: () => void;
}) {
  const { setLock, removeLock } = useChat();
  const { toast } = useUi();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [current, setCurrent] = useState('');
  const [stage, setStage] = useState<LockStep>(step);
  const [switched, setSwitched] = useState(false);

  useEffect(() => {
    setStage(step);
    setError('');
    setCurrent('');
    setSwitched(false);
  }, [step]);

  if (!stage) return null;

  const close = () => {
    setStage(null);
    onDone();
  };

  const existing = conversation.lockKind === 'pattern' ? 'pattern' : 'pin';

  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      toast(done);
      close();
    } catch (e: any) {
      setError(e?.message || 'That did not work.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="lock-flow clay">
      {stage === 'choose' && (
        <div className="stack" style={{ gap: 12 }}>
          <div className="stack" style={{ gap: 2 }}>
            <h3 style={{ margin: 0 }}>Lock this chat</h3>
            <p className="small muted" style={{ margin: 0 }}>
              Only you. The other person is not told, and their copy stays open.
            </p>
          </div>
          <div className="seg" role="group" aria-label="Lock type">
            <button className="seg-item" onClick={() => setStage('set-pin')}>
              PIN
            </button>
            <button className="seg-item" onClick={() => setStage('set-pattern')}>
              Pattern
            </button>
          </div>
          <p className="tiny faint" style={{ margin: 0 }}>
            Nobody can reset this for you — not even from the admin page. Choose something you will
            remember.
          </p>
          <button className="clay-btn" onClick={close}>
            Cancel
          </button>
        </div>
      )}

      {(stage === 'set-pin' || stage === 'set-pattern') && (
        <CodeEntry
          kind={stage === 'set-pin' ? 'pin' : 'pattern'}
          confirm
          error={error}
          busy={busy}
          hint={stage === 'set-pin' ? '4 to 6 digits.' : 'Join at least four dots.'}
          onCancel={close}
          onSubmit={(code) =>
            run(
              () => setLock(conversation.id, stage === 'set-pin' ? 'pin' : 'pattern', code),
              'Chat locked'
            )
          }
        />
      )}

      {stage === 'change' && (
        <CodeEntry
          kind={existing}
          title="Current code"
          hint="Enter the code you use now."
          error={error}
          busy={busy}
          onCancel={close}
          onSubmit={(code) => {
            setCurrent(code);
            setError('');
            setStage('change-new');
          }}
        />
      )}

      {stage === 'change-new' && (
        <div className="stack" style={{ gap: 12 }}>
          <div className="seg" role="group" aria-label="New lock type">
            <button
              className={`seg-item${existing === 'pin' ? ' on' : ''}`}
              onClick={() => setStage('change-new')}
            >
              Keep {existing === 'pin' ? 'PIN' : 'pattern'}
            </button>
            <button
              className="seg-item"
              onClick={() => {
                // Switching kind mid-change is allowed: the old code has
                // already been proved, which is the only thing that mattered.
                setSwitched((v) => !v);
              }}
            >
              Use a {existing === 'pin' ? 'pattern' : 'PIN'}
            </button>
          </div>
          <CodeEntry
            kind={switched ? (existing === 'pin' ? 'pattern' : 'pin') : existing}
            confirm
            title="New code"
            error={error}
            busy={busy}
            onCancel={close}
            onSubmit={(code) =>
              run(
                () =>
                  setLock(
                    conversation.id,
                    switched ? (existing === 'pin' ? 'pattern' : 'pin') : existing,
                    code,
                    current
                  ),
                'Code changed'
              )
            }
          />
        </div>
      )}

      {stage === 'remove' && (
        <CodeEntry
          kind={existing}
          title="Remove the lock"
          hint="Enter your code to take it off."
          error={error}
          busy={busy}
          onCancel={close}
          onSubmit={(code) => run(() => removeLock(conversation.id, code), 'Lock removed')}
        />
      )}
    </div>
  );
}


/**
 * Default / On / Off.
 *
 * The middle state is the point: "Default" has to be selectable, not merely
 * the absence of a choice, or a per-chat setting quietly freezes at whatever
 * the global was when it was written and stops following it afterwards.
 */
function TriChoice({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  onChange: (v: number) => void;
}) {
  const options: { v: number; text: string }[] = [
    { v: -1, text: 'Default' },
    { v: 1, text: 'On' },
    { v: 0, text: 'Off' },
  ];

  return (
    <div className="stack" style={{ gap: 6, marginBottom: 12 }}>
      <span className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
        <span className="list-row-label">{label}</span>
      </span>
      <div className="seg" role="group" aria-label={label}>
        {options.map((o) => (
          <button
            key={o.v}
            className={`seg-item${value === o.v ? ' on' : ''}`}
            onClick={() => onChange(o.v)}
            aria-pressed={value === o.v}
          >
            {o.text}
          </button>
        ))}
      </div>
      <span className="tiny faint">{hint}</span>
    </div>
  );
}
