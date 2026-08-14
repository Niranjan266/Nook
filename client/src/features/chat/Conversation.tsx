import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useChat } from '@/stores/chat';
import { useUi } from '@/stores/ui';
import { useAuth } from '@/stores/auth';
import { useCall } from '@/stores/call';
import Avatar from '@/components/Avatar';
import MessageBubble from './MessageBubble';
import Composer from './Composer';
import PinBar from './PinBar';
import { MOOD_EMOJI, MOOD_LABEL, daysUntil } from '@/lib/rooms';
import { dayLabel, sameDay, lastSeenLabel } from '@/lib/format';
import { spring } from '@/lib/motion';
import {
  IconBack,
  IconPhone,
  IconVideo,
  IconMore,
  IconDown,
  IconClock,
  IconLock,
  IconCheck,
  IconClose,
  IconClockSmall,
} from '@/components/Icon';
import type { Conversation as Convo } from '@/lib/types';

const GAP_MINUTES = 6;

export default function Conversation({ conversation }: { conversation: Convo }) {
  const { messages, typing, presence, loadMessages, hasMore, markRead, respondWallpaper, removeWallObject } =
    useChat();
  const { openSheet, setShelf, toast } = useUi();
  const me = useAuth((s) => s.me);
  const startCall = useCall((s) => s.start);

  const stream = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [unlocked, setUnlocked] = useState(false);

  const list = messages[conversation.id] || [];

  /**
   * Only ever render a window of the history.
   *
   * A long conversation would otherwise put every message in the DOM at once —
   * ten thousand bubbles, each with a Framer Motion layout subscription. This
   * grows the window as you scroll up, which is the cheap 90% of virtualisation
   * without the measurement machinery a full virtual list needs (and which is
   * awkward here, because bubbles have wildly variable heights).
   */
  const WINDOW_STEP = 60;
  const [windowSize, setWindowSize] = useState(WINDOW_STEP);
  const windowed = list.length > windowSize ? list.slice(-windowSize) : list;

  useEffect(() => setWindowSize(WINDOW_STEP), [conversation.id]);

  const meId = me?.id || '';
  const typers = (typing[conversation.id] || []).filter((id) => id !== meId);
  const partnerPresence = conversation.partner ? presence[conversation.partner.id] : undefined;

  useEffect(() => {
    setUnlocked(false);
  }, [conversation.id]);

  useLayoutEffect(() => {
    const el = stream.current;
    if (!el) return;
    if (atBottom) el.scrollTop = el.scrollHeight;
  }, [list.length, typers.length]);

  useLayoutEffect(() => {
    const el = stream.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [conversation.id]);

  const onScroll = () => {
    const el = stream.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    setAtBottom(distance < 120);

    // Near the top: first widen the window over what we already have, and only
    // then go back to the server for older messages.
    if (el.scrollTop < 240 && windowed.length < list.length) {
      const prevHeight = el.scrollHeight;
      setWindowSize((n) => n + WINDOW_STEP);
      requestAnimationFrame(() => {
        if (stream.current) stream.current.scrollTop += stream.current.scrollHeight - prevHeight;
      });
      return;
    }

    if (el.scrollTop < 80 && hasMore[conversation.id]) {
      const prevHeight = el.scrollHeight;
      loadMessages(conversation.id, { more: true }).then(() => {
        requestAnimationFrame(() => {
          if (stream.current) stream.current.scrollTop = stream.current.scrollHeight - prevHeight;
        });
      });
    }
  };

  const jumpTo = (id: string) => {
    const node = document.getElementById(`m-${id}`);
    if (!node) return toast('That message is further back — scroll up to load it.');
    node.scrollIntoView({ behavior: 'smooth', block: 'center' });
    node.animate(
      [{ filter: 'brightness(1)' }, { filter: 'brightness(1.14)' }, { filter: 'brightness(1)' }],
      { duration: 1100 }
    );
  };

  /**
   * In a direct chat the wallpaper belongs to both people, so choosing one
   * only *proposes* it until the other accepts. That is the right rule — but
   * it meant the person who chose saw absolutely nothing happen: the sheet
   * closed, a toast said "suggested", and the background stayed exactly as it
   * was. Indistinguishable from the feature being broken, which is how it was
   * reported.
   *
   * So the proposer sees their own pending look straight away. The room does
   * not truly change until the other person agrees — the banner below says so
   * — but you can see what you picked.
   */
  const pendingMine =
    conversation.wallpaper.proposal && conversation.wallpaper.proposal.by === meId
      ? conversation.wallpaper.proposal
      : null;

  /**
   * Order of precedence: a wallpaper you chose for yourself beats the room's,
   * which beats a suggestion you have made but the other person has not
   * accepted. Your own choice wins because you made it most deliberately.
   */
  const wp = conversation.myWallpaper
    ? { ...conversation.wallpaper, ...conversation.myWallpaper }
    : pendingMine
      ? { ...conversation.wallpaper, ...pendingMine }
      : conversation.wallpaper;

  /**
   * The room has a time of day. If a schedule is on, the evening look replaces
   * the daytime one — evaluated on the client so it changes without a round
   * trip, and re-checked every minute.
   */
  const [, tick] = useState(0);
  useEffect(() => {
    if (!conversation.wallpaperSchedule?.enabled) return;
    const t = setInterval(() => tick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, [conversation.wallpaperSchedule?.enabled]);

  const activeLook = (() => {
    const s = conversation.wallpaperSchedule;
    // A look you chose for yourself is not on the room's clock. Letting the
    // schedule swap it out at 7pm would look like your choice was ignored.
    if (!s?.enabled || conversation.myWallpaper) return wp;
    const now = new Date().getHours() * 60 + new Date().getMinutes();
    const night =
      s.nightStart <= s.nightEnd
        ? now >= s.nightStart && now < s.nightEnd
        : now >= s.nightStart || now < s.nightEnd;
    const look = night ? s.night : s.day;
    return look && (look.preset || look.url) ? { ...wp, ...look } : wp;
  })();

  const wallpaperStyle: React.CSSProperties = {
    ...(activeLook.url ? { backgroundImage: `url(${activeLook.url})` } : {}),
    ...(activeLook.blur ? { filter: `blur(${activeLook.blur}px)`, transform: 'scale(1.06)' } : {}),
    ['--wp-dim' as any]: activeLook.dim,
  };

  const status = (() => {
    if (typers.length) {
      if (conversation.type === 'group') {
        const names = typers
          .map((id) => conversation.members.find((m) => (m.user as any).id === id))
          .map((m) => (m?.user as any)?.displayName?.split(' ')[0])
          .filter(Boolean);
        return <span className="live">{names.join(', ') || 'Someone'} typing…</span>;
      }
      return <span className="live">typing…</span>;
    }
    if (conversation.type === 'group') return `${conversation.members.length} people`;
    if (partnerPresence?.online) return <span className="live">online</span>;
    if (partnerPresence?.lastSeen) return `last seen ${lastSeenLabel(partnerPresence.lastSeen)}`;
    return conversation.partner ? `@${conversation.partner.username}` : '';
  })();

  /* ── PIN-locked chat gate ─────────────────────────────────────────────── */
  if (conversation.locked && !unlocked) {
    return (
      <section className="surface">
        <div className="empty">
          <span className="clay-round" style={{ width: 74, height: 74 }}>
            <IconLock size={30} />
          </span>
          <h3>This chat is locked</h3>
          <p>You locked this conversation. Unlock it to read what’s inside.</p>
          <button className="slab" onClick={() => setUnlocked(true)}>
            Unlock
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="surface" aria-label={`Conversation with ${conversation.name}`}>
      <header className="chat-head">
        {/* Visibility is CSS-driven so it survives a resize without a re-render. */}
        <button className="clay-round chat-back" onClick={() => setShelf(true)} aria-label="Back to conversations">
          <IconBack />
        </button>

        <button className="row" style={{ gap: 12, flex: 1, minWidth: 0 }} onClick={() => openSheet('chat-info')}>
          <Avatar
            name={conversation.name}
            src={conversation.avatarUrl}
            id={conversation.partner?.id || conversation.id}
            accent={conversation.partner?.accent}
            size={42}
            online={partnerPresence?.online}
            showDot
            square={conversation.type === 'group'}
          />
          <span className="chat-head-id">
            <span className="chat-head-name truncate">{conversation.name}</span>
            <span className="chat-head-status truncate">{status}</span>
          </span>
        </button>

        <div className="chat-head-actions">
          {conversation.disappearAfter > 0 && (
            <span className="clay-round" style={{ width: 38, height: 38, color: 'var(--ochre-deep)' }} title="Disappearing messages are on">
              <IconClock size={18} />
            </span>
          )}
          {conversation.type === 'direct' && conversation.partner && (
            <>
              <button
                className="clay-round"
                onClick={() =>
                  startCall({ conversationId: conversation.id, peer: conversation.partner!, kind: 'audio' })
                }
                aria-label="Voice call"
              >
                <IconPhone />
              </button>
              <button
                className="clay-round"
                onClick={() =>
                  startCall({ conversationId: conversation.id, peer: conversation.partner!, kind: 'video' })
                }
                aria-label="Video call"
              >
                <IconVideo />
              </button>
            </>
          )}
          <button className="clay-round" onClick={() => openSheet('chat-info')} aria-label="Conversation details">
            <IconMore />
          </button>
        </div>
      </header>

      {/* A shared mood, visible only in this room. */}
      {conversation.roomState?.mood && (
        <motion.div
          className="room-mood"
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={spring}
        >
          <span className="emoji">{MOOD_EMOJI[conversation.roomState.mood] || '•'}</span>
          <span className="grow">
            <strong>{MOOD_LABEL[conversation.roomState.mood] || conversation.roomState.mood}</strong>
            {conversation.roomState.note ? ` — ${conversation.roomState.note}` : ''}
          </span>
          <button className="tiny" style={{ fontWeight: 600 }} onClick={() => openSheet('room')}>
            Change
          </button>
        </motion.div>
      )}

      <PinBar conversation={conversation} onJump={jumpTo} />

      <div className="chat-canvas">
        <div
          className={`wallpaper${activeLook.preset ? ` wp-${activeLook.preset}` : activeLook.url ? '' : ' wp-plain'}`}
          style={wallpaperStyle}
          aria-hidden="true"
        />

        {/* Things pinned to the wall itself, so they never scroll away. */}
        {conversation.wallObjects?.length > 0 && (
          <div className="wall">
            {conversation.wallObjects.map((o) => (
              <div key={o.id} className={`wall-object ${o.type}`} style={{ left: `${o.x}%`, top: `${o.y}%` }}>
                {o.type === 'photo' && o.url && <img src={o.url} alt="" />}
                {o.type === 'countdown' && o.date && (
                  <>
                    <div style={{ fontSize: 20, fontWeight: 700 }}>{daysUntil(o.date)}</div>
                    <div className="tiny">{o.text}</div>
                  </>
                )}
                {(o.type === 'note' || o.type === 'link') && <span>{o.text}</span>}
                <button
                  className="remove"
                  onClick={() => removeWallObject(conversation.id, o.id)}
                  aria-label="Take this off the wall"
                >
                  <IconClose size={12} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* someone proposed a wallpaper — accept or keep the current one */}
        <AnimatePresence>
          {wp.proposal && wp.proposal.by !== meId && (
            <motion.div
              className="clay clay-2"
              style={{
                position: 'absolute',
                zIndex: 4,
                top: 12,
                left: '50%',
                translateX: '-50%',
                padding: '10px 12px',
                display: 'flex',
                gap: 12,
                alignItems: 'center',
                maxWidth: 'calc(100% - 32px)',
              }}
              initial={{ opacity: 0, y: -18 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -18 }}
              transition={spring}
            >
              <span
                className={`${wp.proposal.preset ? `wp-${wp.proposal.preset}` : ''}`}
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: 12,
                  flex: 'none',
                  backgroundImage: wp.proposal.url ? `url(${wp.proposal.url})` : undefined,
                  backgroundSize: 'cover',
                  boxShadow: 'var(--clay-in)',
                }}
              />
              <span className="stack" style={{ minWidth: 0 }}>
                <span className="small" style={{ fontWeight: 600 }}>
                  New wallpaper suggested
                </span>
                <span className="tiny muted">It applies to both of you.</span>
              </span>
              <button className="slab slab-sm" onClick={() => respondWallpaper(conversation.id, true)}>
                <IconCheck size={15} /> Use it
              </button>
              <button
                className="clay-round"
                style={{ width: 34, height: 34 }}
                onClick={() => respondWallpaper(conversation.id, false)}
                aria-label="Keep current wallpaper"
              >
                <IconClose size={16} />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Your own pending suggestion. You can already see it — this says why
            the other person still can't, so silence doesn't read as failure. */}
        <AnimatePresence>
          {pendingMine && (
            <motion.div
              className="clay clay-2 wp-pending"
              initial={{ opacity: 0, y: -18 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -18 }}
              transition={spring}
            >
              <IconClockSmall size={15} />
              <span className="tiny">
                Only you can see this until{' '}
                {conversation.partner?.displayName?.split(' ')[0] || 'they'} accepts it.
              </span>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="stream" ref={stream} onScroll={onScroll} role="log" aria-live="polite">
          {hasMore[conversation.id] && (
            <button
              className="clay-btn"
              style={{ alignSelf: 'center', marginBottom: 12 }}
              onClick={() => loadMessages(conversation.id, { more: true })}
            >
              Load earlier messages
            </button>
          )}

          {windowed.length === 0 && (
            <div className="empty" style={{ margin: 'auto' }}>
              <svg className="empty-art" viewBox="0 0 200 200" fill="none" aria-hidden="true">
                <rect x="24" y="30" width="152" height="120" rx="34" fill="var(--clay-surface)" />
                <path d="M74 138V96a26 26 0 0 1 52 0v42Z" fill="var(--accent)" opacity="0.9" />
                <rect x="74" y="132" width="52" height="6" fill="var(--ink)" opacity="0.16" />
                <circle cx="100" cy="168" r="5" fill="var(--clay-edge)" />
                <circle cx="118" cy="168" r="5" fill="var(--clay-edge)" />
                <circle cx="82" cy="168" r="5" fill="var(--clay-edge)" />
              </svg>
              <h3>Nothing here yet</h3>
              <p>
                {conversation.type === 'group'
                  ? 'Say hello and get it going.'
                  : `This is the start of your conversation with ${conversation.name.split(' ')[0]}.`}
              </p>
            </div>
          )}

          <AnimatePresence initial={false}>
            {windowed.map((m, i) => {
              const prev = windowed[i - 1];
              const newDay = !prev || !sameDay(prev.createdAt, m.createdAt);
              const gap =
                !prev ||
                prev.sender.id !== m.sender.id ||
                new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() > GAP_MINUTES * 60000;
              const next = windowed[i + 1];
              const lastOfRun = !next || next.sender.id !== m.sender.id;

              return (
                <div key={m.id} style={{ display: 'contents' }}>
                  {newDay && <div className="day-mark">{dayLabel(m.createdAt)}</div>}
                  <MessageBubble
                    message={m}
                    conversation={conversation}
                    meId={meId}
                    runStart={newDay || gap}
                    showAvatar={lastOfRun}
                    eager={i >= windowed.length - 12}
                    onJumpTo={jumpTo}
                  />
                </div>
              );
            })}
          </AnimatePresence>

          {typers.length > 0 && (
            <motion.div
              className="typing"
              initial={{ opacity: 0, scale: 0.9, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={spring}
              aria-label="typing"
            >
              <i />
              <i />
              <i />
            </motion.div>
          )}
        </div>

        <AnimatePresence>
          {!atBottom && (
            <motion.button
              className="clay-round jump"
              initial={{ opacity: 0, y: 14, scale: 0.85 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 14, scale: 0.85 }}
              transition={spring}
              onClick={() => {
                const el = stream.current;
                if (el) el.scrollTop = el.scrollHeight;
                markRead(conversation.id);
              }}
              aria-label="Jump to latest"
            >
              <IconDown />
              {conversation.unread > 0 && <span className="chip" style={{ position: 'absolute', top: -6, right: -6 }}>{conversation.unread}</span>}
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      <Composer conversationId={conversation.id} />
    </section>
  );
}
