import { memo, useRef, useState } from 'react';
import { motion, AnimatePresence, useMotionValue, animate } from 'framer-motion';
import type { Message, Conversation } from '@/lib/types';
import { useChat } from '@/stores/chat';
import { useUi } from '@/stores/ui';
import { useAuth } from '@/stores/auth';
import { get as apiGet } from '@/lib/api';
import Avatar from '@/components/Avatar';
import Blur from '@/components/Blur';
import VoiceNote from './VoiceNote';
import ReactionBar from './ReactionBar';
import { clock, bytes, linkify, duration, accentFor } from '@/lib/format';
import { bubbleIn, spring, popIn } from '@/lib/motion';
import {
  IconTick,
  IconTickDouble,
  IconClockSmall,
  IconReply,
  IconEmoji,
  IconMore,
  IconFile,
  IconPlay,
  IconFire,
  IconForward,
  IconStar,
  IconStarFill,
  IconEdit,
  IconTrash,
  IconWarning,
  IconCallIn,
  IconCallOut,
  IconDownload,
  IconPin,
  IconThread,
  IconDown,
} from '@/components/Icon';


interface Props {
  message: Message;
  conversation: Conversation;
  meId: string;
  runStart: boolean;
  showAvatar: boolean;
  /** Recent media loads immediately; older media stays lazy. */
  eager?: boolean;
  onJumpTo: (id: string) => void;
}

function Ticks({ m, meId, convo }: { m: Message; meId: string; convo: Conversation }) {
  if (m.sender.id !== meId) return null;
  if (m.status === 'pending') return <IconClockSmall size={12} />;
  if (m.status === 'failed') return <IconWarning size={12} />;
  const others = convo.members.length - 1;
  const read = m.readBy.length >= Math.max(1, others);
  const delivered = m.deliveredTo.length > 0;
  return (
    <span className={`ticks${read ? ' read' : ''}`}>
      {delivered || read ? <IconTickDouble size={15} /> : <IconTick size={15} />}
    </span>
  );
}

function MessageBubble({ message: m, conversation, meId, runStart, showAvatar, eager, onJumpTo }: Props) {
  const { react, star, remove, setReplyTo, setEditing, retry, markSnapViewed, pin, unpin, openThread } =
    useChat();
  const { openSheet, setLightbox, toast } = useUi();
  const swipeEnabled = useAuth((s) => s.me?.settings.swipeToReply ?? true);
  const [picker, setPicker] = useState(false);
  /**
   * The message's box on screen, captured at the moment the picker opens.
   * Measured rather than guessed: the old picker used a fixed percentage of
   * the viewport, which is why the emoji appeared beside the wrong message
   * and ran off the edge of a phone.
   */
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);

  const openPicker = () => {
    setAnchorRect(bubbleRef.current?.getBoundingClientRect() || null);
    setPicker(true);
  };
  const [menu, setMenu] = useState(false);
  const [history, setHistory] = useState<{ body: string; at: string; current?: boolean }[] | null>(null);

  const mine = m.sender.id === meId;
  const isPinned = conversation.pins?.some((p) => p.messageId === m.id);

  /* ── swipe to reply ─────────────────────────────────────────────────────
     Drag the bubble toward the centre; past 48px it arms, and releasing sets
     the reply. Resistance grows with distance so it feels like it's attached
     to something rather than sliding on ice.                              */

  const x = useMotionValue(0);
  const [armed, setArmed] = useState(false);
  const dragging = useRef(false);
  const startX = useRef(0);

  const DIRECTION = mine ? -1 : 1; // your own messages drag left, theirs right
  const THRESHOLD = 48;
  const MAX = 78;

  const onPointerDown = (e: React.PointerEvent) => {
    if (!swipeEnabled || e.pointerType === 'mouse') return;
    dragging.current = true;
    startX.current = e.clientX;
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    const raw = (e.clientX - startX.current) * DIRECTION;
    if (raw <= 0) return void x.set(0);
    // Rubber-band: the further you pull, the harder it gets.
    const eased = Math.min(MAX, raw < THRESHOLD ? raw : THRESHOLD + (raw - THRESHOLD) * 0.35);
    x.set(eased * DIRECTION);

    const nowArmed = eased >= THRESHOLD;
    if (nowArmed !== armed) {
      setArmed(nowArmed);
      if (nowArmed && navigator.vibrate) navigator.vibrate(12);
    }
  };

  const endSwipe = () => {
    if (!dragging.current) return;
    dragging.current = false;
    if (armed) setReplyTo(m);
    setArmed(false);
    animate(x, 0, { type: 'spring', stiffness: 520, damping: 34 });
  };

  /* ── system + call rows sit outside the bubble language ───────────────── */

  if (m.type === 'system') {
    return (
      <motion.div className="system-note" variants={bubbleIn} initial="hidden" animate="show">
        {m.body}
      </motion.div>
    );
  }

  if (m.deletedForAll) {
    return (
      <motion.div className={`msg${mine ? ' mine' : ''}`} variants={bubbleIn} initial="hidden" animate="show">
        <div className="bubble" style={{ opacity: 0.7, fontStyle: 'italic' }}>
          <span className="msg-text small">This message was unsent</span>
        </div>
      </motion.div>
    );
  }

  const grouped = m.reactions.reduce<Record<string, string[]>>((acc, r) => {
    (acc[r.emoji] ||= []).push(r.userId);
    return acc;
  }, {});

  const openRadial = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    openPicker();
  };

  /* Reserve the right shape before the file arrives, so nothing jumps. */
  const ratioStyle =
    m.media?.width && m.media?.height
      ? ({ ['--media-ratio' as any]: `${m.media.width} / ${m.media.height}` } as React.CSSProperties)
      : undefined;

  const body = (() => {
    switch (m.type) {
      case 'image':
        return (
          <button
            className="media-frame"
            style={ratioStyle}
            onClick={() => m.media && setLightbox({ messageId: m.id })}
          >
            <Blur hash={m.media?.blurhash} />
            <img
              src={m.media?.thumbUrl || m.media?.url}
              alt={m.body || 'Photo'}
              loading={eager ? 'eager' : 'lazy'}
              decoding="async"
              onLoad={(e) => e.currentTarget.classList.add('loaded')}
              className="fade-in"
            />
          </button>
        );

      case 'video':
        return (
          <button className="media-frame" style={ratioStyle} onClick={() => setLightbox({ messageId: m.id })}>
            {m.media?.thumbUrl ? (
              <img src={m.media.thumbUrl} alt="" loading={eager ? 'eager' : 'lazy'} decoding="async" />
            ) : (
              <video src={m.media?.url} preload="metadata" />
            )}
            <span className="play">
              <span className="clay-round" style={{ width: 52, height: 52 }}>
                <IconPlay size={22} />
              </span>
            </span>
          </button>
        );

      case 'voice':
        return (
          <VoiceNote
            messageId={m.id}
            url={m.media?.url || ''}
            waveform={m.media?.waveform}
            length={m.media?.duration}
            transcript={m.transcript}
          />
        );

      case 'audio':
        return <audio controls src={m.media?.url} style={{ maxWidth: 260 }} />;

      case 'file':
        return (
          <a
            className="file-card"
            href={m.media?.url}
            download={m.media?.name}
            target="_blank"
            rel="noreferrer"
            style={{ color: 'inherit', textDecoration: 'none' }}
          >
            <span className="file-icon">
              <IconFile size={20} />
            </span>
            <span className="grow stack">
              <span className="file-name truncate">{m.media?.name}</span>
              <span className="file-size">{bytes(m.media?.size)}</span>
            </span>
            <IconDownload size={18} style={{ opacity: 0.7 }} />
          </a>
        );

      case 'snap': {
        const burnt = m.viewOnce?.burnt || (!mine && m.viewOnce?.seen);
        return (
          <button
            className={`snap${burnt ? ' burnt' : ''}`}
            disabled={burnt || mine}
            onClick={async () => {
              await markSnapViewed(m.id);
              setLightbox({ messageId: m.id });
            }}
          >
            <span className="snap-seal">
              <IconFire size={20} />
            </span>
            <span className="stack" style={{ textAlign: 'left' }}>
              <span className="snap-label">{burnt ? 'Snap opened' : mine ? 'Snap sent' : 'Tap to open once'}</span>
              <span className="snap-sub">
                {burnt ? 'It is gone now' : mine ? (m.viewOnce?.viewers.length ? 'Opened' : 'Not opened yet') : 'You get one look'}
              </span>
            </span>
          </button>
        );
      }

      case 'call': {
        const missed = m.call?.status === 'missed' || m.call?.status === 'declined';
        return (
          <span className={`call-log${missed ? ' missed' : ''}`}>
            <span className="call-log-icon">{mine ? <IconCallOut size={18} /> : <IconCallIn size={18} />}</span>
            <span className="stack">
              <span style={{ fontWeight: 500, fontSize: 'var(--t-sm)' }}>
                {m.call?.kind === 'video' ? 'Video call' : 'Voice call'}
              </span>
              <span className="tiny" style={{ opacity: 0.75 }}>
                {missed
                  ? m.call?.status === 'declined'
                    ? 'Declined'
                    : 'No answer'
                  : m.call?.duration
                    ? duration(m.call.duration)
                    : 'Ended'}
              </span>
            </span>
          </span>
        );
      }

      default:
        return (
          <span className="msg-text">
            {linkify(m.body).map((part, i) =>
              part.type === 'link' ? (
                <a key={i} href={part.value} target="_blank" rel="noreferrer noopener">
                  {part.value}
                </a>
              ) : (
                <span key={i}>{part.value}</span>
              )
            )}
          </span>
        );
    }
  })();

  const isMediaBubble = ['image', 'video'].includes(m.type);

  return (
    <>
      <motion.div
        className={`msg${mine ? ' mine' : ''}${runStart ? ' run-start' : ''}${
          m.status === 'pending' ? ' pending' : ''
        }${m.status === 'failed' ? ' failed' : ''}`}
        variants={bubbleIn}
        initial="hidden"
        animate="show"
        exit="exit"
        layout="position"
        onContextMenu={openRadial}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endSwipe}
        onPointerCancel={endSwipe}
        style={{ x, touchAction: 'pan-y' }}
        id={`m-${m.id}`}
      >
        {/* The reply arrow revealed by a swipe, behind the bubble. */}
        <span className={`swipe-hint${armed ? ' armed' : ''}`} aria-hidden="true">
          <IconReply size={17} />
        </span>

        {showAvatar && !mine && conversation.type === 'group' ? (
          <span className="msg-avatar">
            <Avatar
              name={m.sender.displayName || '?'}
              src={m.sender.avatarUrl}
              id={m.sender.id}
              accent={m.sender.accent}
              size={30}
            />
          </span>
        ) : conversation.type === 'group' && !mine ? (
          <span style={{ width: 30, flex: 'none' }} />
        ) : null}

        <div ref={bubbleRef} className={`bubble${isMediaBubble ? ' media' : ''}`}>
          {/* Each person keeps their own colour, so a busy group stays readable. */}
          {runStart && !mine && conversation.type === 'group' && (
            <span
              className="msg-sender"
              style={{ color: `var(--${m.sender.accent || accentFor(m.sender.id)}-deep)` }}
            >
              {m.sender.displayName}
            </span>
          )}

          {m.forwarded && (
            <span className="forward-note">
              <IconForward size={13} /> Forwarded
            </span>
          )}

          {m.replyTo?.senderName && (
            <button className="quote" onClick={() => onJumpTo(m.replyTo!.id)}>
              {m.replyTo.thumbUrl && <img src={m.replyTo.thumbUrl} alt="" />}
              <span className="quote-body">
                <span className="quote-name">{m.replyTo.senderName}</span>
                <span className="quote-text">{m.replyTo.body || m.replyTo.type}</span>
              </span>
            </button>
          )}

          {body}

          {isMediaBubble && m.body && <span className="msg-text">{m.body}</span>}

          {/* Link preview — fetched by our server, so this device never touched
              the third-party URL. */}
          {m.linkPreview && (
            <a className="link-card" href={m.linkPreview.url} target="_blank" rel="noreferrer noopener">
              {m.linkPreview.image && (
                <span className="link-card-image">
                  <img src={m.linkPreview.image} alt="" loading="lazy" />
                </span>
              )}
              <span className="link-card-body">
                <span className="link-card-site">{m.linkPreview.siteName}</span>
                {m.linkPreview.title && <span className="link-card-title">{m.linkPreview.title}</span>}
                {m.linkPreview.description && (
                  <span className="link-card-desc">{m.linkPreview.description}</span>
                )}
              </span>
            </a>
          )}

          <span className="msg-meta">
            {isPinned && <IconPin size={11} />}
            {m.editedAt && (
              <button
                className="edited"
                onClick={async (e) => {
                  e.stopPropagation();
                  const { history: h } = await apiGet<{ history: any[] }>(`/messages/${m.id}/history`);
                  setHistory(h);
                }}
                title="See what this said before"
                style={{ font: 'inherit', color: 'inherit', textDecoration: 'underline dotted' }}
              >
                edited
              </button>
            )}
            {m.starred && <IconStarFill size={11} />}
            <time dateTime={m.createdAt}>{clock(m.createdAt)}</time>
            <Ticks m={m} meId={meId} convo={conversation} />
          </span>

          {/* hover tools */}
          <div className="msg-tools" style={{ opacity: menu ? 1 : undefined }}>
            <button onClick={() => setReplyTo(m)} aria-label="Reply" title="Reply">
              <IconReply size={16} />
            </button>
            <button
              onClick={() => openThread(m.id)}
              aria-label="Reply in a thread"
              title="Reply in a thread — keeps the tangent out of the main conversation"
            >
              <IconThread size={16} />
            </button>
            <button onClick={openPicker} aria-label="React" title="React">
              <IconEmoji size={16} />
            </button>
            <button onClick={() => setMenu((v) => !v)} aria-label="More" title="More">
              <IconMore size={16} />
            </button>
          </div>

          <AnimatePresence>
            {menu && (
              <motion.div
                className="attach-menu"
                style={{ bottom: 'auto', top: 'calc(100% + 6px)', right: mine ? 0 : 'auto', left: mine ? 'auto' : 0 }}
                variants={popIn}
                initial="hidden"
                animate="show"
                exit="exit"
                onMouseLeave={() => setMenu(false)}
              >
                <button
                  className="list-row"
                  onClick={() => {
                    star(m);
                    setMenu(false);
                  }}
                >
                  {m.starred ? <IconStarFill size={17} /> : <IconStar size={17} />}
                  <span className="grow">
                    <span className="list-row-label">{m.starred ? 'Unstar' : 'Star'}</span>
                  </span>
                </button>
                <button
                  className="list-row"
                  onClick={() => {
                    (isPinned ? unpin(conversation.id, m.id) : pin(conversation.id, m.id)).catch((e) =>
                      toast(e?.message || 'Could not pin that.', true)
                    );
                    setMenu(false);
                  }}
                >
                  <IconPin size={17} />
                  <span className="grow">
                    <span className="list-row-label">{isPinned ? 'Unpin' : 'Pin to the top'}</span>
                  </span>
                </button>
                <button
                  className="list-row"
                  onClick={() => {
                    openSheet('forward', { messageId: m.id });
                    setMenu(false);
                  }}
                >
                  <IconForward size={17} />
                  <span className="grow">
                    <span className="list-row-label">Forward</span>
                  </span>
                </button>
                {m.type === 'text' && (
                  <button
                    className="list-row"
                    onClick={() => {
                      navigator.clipboard?.writeText(m.body);
                      toast('Copied');
                      setMenu(false);
                    }}
                  >
                    <IconFile size={17} />
                    <span className="grow">
                      <span className="list-row-label">Copy text</span>
                    </span>
                  </button>
                )}
                {mine && m.type === 'text' && Date.now() - new Date(m.createdAt).getTime() < 15 * 60 * 1000 && (
                  <button
                    className="list-row"
                    onClick={() => {
                      setEditing(m);
                      setMenu(false);
                    }}
                  >
                    <IconEdit size={17} />
                    <span className="grow">
                      <span className="list-row-label">Edit</span>
                    </span>
                  </button>
                )}
                <button
                  className="list-row"
                  onClick={() => {
                    remove(m, 'me');
                    setMenu(false);
                  }}
                >
                  <IconTrash size={17} />
                  <span className="grow">
                    <span className="list-row-label">Delete for me</span>
                  </span>
                </button>
                {mine && (
                  <button
                    className="list-row"
                    style={{ color: 'var(--rust)' }}
                    onClick={() => {
                      remove(m, 'everyone');
                      setMenu(false);
                    }}
                  >
                    <IconTrash size={17} />
                    <span className="grow">
                      <span className="list-row-label">Unsend for everyone</span>
                    </span>
                  </button>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>

      {/* A tangent lives here instead of burying the main conversation. */}
      {m.replyCount > 0 && (
        <button
          className={`thread-tag${mine ? ' mine' : ''}`}
          onClick={() => openThread(m.id)}
          style={{ alignSelf: mine ? 'flex-end' : 'flex-start' }}
        >
          <IconThread size={14} />
          {m.replyCount} {m.replyCount === 1 ? 'reply' : 'replies'}
          <IconDown size={13} />
        </button>
      )}

      {/* Edit history — trust through transparency. */}
      <AnimatePresence>
        {history && (
          <>
            <div style={{ position: 'fixed', inset: 0, zIndex: 79 }} onClick={() => setHistory(null)} />
            <motion.div
              className="clay clay-3 edit-history"
              style={{ alignSelf: mine ? 'flex-end' : 'flex-start' }}
              variants={popIn}
              initial="hidden"
              animate="show"
              exit="exit"
            >
              <span className="eyebrow">Edit history</span>
              {history.map((h, i) => (
                <div key={i} className="edit-history-row">
                  <span className={h.current ? '' : 'muted'} style={{ textDecoration: h.current ? '' : 'line-through' }}>
                    {h.body}
                  </span>
                  <time className="tiny faint">{clock(h.at)}</time>
                </div>
              ))}
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {m.status === 'failed' && (
        <button className="msg-retry" style={{ alignSelf: 'flex-end' }} onClick={() => retry(m.clientId!, m.conversationId)}>
          <IconWarning size={13} /> Didn’t send — tap to retry
        </button>
      )}

      {Object.keys(grouped).length > 0 && (
        <div className={`reactions${mine ? ' mine' : ''}`} style={{ alignSelf: mine ? 'flex-end' : 'flex-start' }}>
          {Object.entries(grouped).map(([emoji, users]) => (
            <motion.button
              key={emoji}
              className={`reaction${users.includes(meId) ? ' by-me' : ''}`}
              onClick={() => react(m, emoji)}
              variants={popIn}
              initial="hidden"
              animate="show"
              layout
            >
              <span>{emoji}</span>
              {users.length > 1 && <span className="count">{users.length}</span>}
            </motion.button>
          ))}
        </div>
      )}

      {/*
        The reaction picker. Anchored to this message and rendered into
        <body> — see ReactionBar for why both matter.
      */}
      <ReactionBar
        open={picker}
        anchor={anchorRect}
        mine={mine}
        onPick={(emoji) => react(m, emoji)}
        onClose={() => setPicker(false)}
      />
    </>
  );
}

export default memo(MessageBubble);
