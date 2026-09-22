import { memo, useEffect, useRef, useState } from 'react';
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
  IconClock,
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
  IconBell,
  IconLock,
} from '@/components/Icon';
import RemindPicker from './RemindPicker';
import { safeUrl } from '@/lib/config';
import { PollCard, ListCard } from './PollCard';
import { tap } from '@/lib/native';
import { decryptedUrl } from '@/lib/e2ee/media';

/** Attachments this size or smaller open by themselves; bigger ones wait for a tap. */
const AUTO_OPEN_BYTES = 20 * 1024 * 1024;

/** What a secret message says when this device cannot show what is inside. */
const SECRET_STATE_TEXT: Record<string, string> = {
  elsewhere: 'This secret chat is on another device',
  unkept: 'Sent from this device — no readable copy was kept',
  waiting: 'Waiting for the secure setup to finish…',
  failed: 'This message could not be decrypted',
};


interface Props {
  message: Message;
  conversation: Conversation;
  meId: string;
  runStart: boolean;
  showAvatar: boolean;
  /** Recent media loads immediately; older media stays lazy. */
  eager?: boolean;
  /**
   * Only a message that has just arrived springs in. Everything present when
   * the chat opens (or loads in, or is paged in from above) simply appears —
   * sixty bubbles bouncing at once reads as the app shuffling, not arriving.
   */
  animateIn?: boolean;
  onJumpTo: (id: string) => void;
}

/**
 * What the Edit action may touch. A poll's question can be reworded only until
 * the first vote — after that it would change what people answered — and a
 * list's title any time within the usual window.
 */
const editable = (m: Message) =>
  m.type === 'text' || m.type === 'list' || (m.type === 'poll' && (m.poll?.totalVoters ?? 0) === 0);

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

function MessageBubble({ message: m, conversation, meId, runStart, showAvatar, eager, animateIn, onJumpTo }: Props) {
  /**
   * Actions only, read without subscribing. `useChat()` with no selector
   * subscribed every bubble to the whole store, so each typing blip or
   * presence ping re-rendered the entire visible history — which quietly
   * defeated the memo below. Store actions are stable, so nothing is lost.
   */
  const { react, star, remove, setReplyTo, setEditing, retry, markSnapViewed, saveMessage, pin, unpin, openThread } =
    useChat.getState();
  const { openSheet, setLightbox, toast } = useUi.getState();
  const enter = animateIn ? 'hidden' : false;
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
  const [menu, setMenuOpen] = useState(false);
  /** The menu's second page. Reset on every close so it always opens at the top. */
  const [reminding, setReminding] = useState(false);
  const setMenu = (v: boolean | ((prev: boolean) => boolean)) => {
    setMenuOpen(v);
    setReminding(false);
  };
  // A primitive from the selector, so only the bubble whose bell changed re-renders.
  const reminded = useChat((s) => Boolean(s.remindedIds[m.id]));
  const [history, setHistory] = useState<{ body: string; at: string; current?: boolean }[] | null>(null);

  const mine = m.sender.id === meId;
  const isPinned = conversation.pins?.some((p) => p.messageId === m.id);
  // Things a secret chat cannot do honestly: threads and pins would be plain
  // text on the server, forwards would copy it out, edits would re-send it.
  const secretChat = conversation.type === 'secret';

  /**
   * A secret attachment arrives as a link to ciphertext. It is fetched and
   * opened here, and the store is pointed at the local copy so the lightbox
   * and the voice player see an ordinary blob: URL.
   */
  const secretMedia = m.secret?.state === 'ok' ? m.secret.media : undefined;
  const needsOpen = Boolean(secretMedia && m.media?.url && !m.media.url.startsWith('blob:'));
  const [opening, setOpening] = useState<'idle' | 'busy' | 'error'>('idle');
  const openSecretMedia = () => {
    if (!secretMedia || !m.media?.url || opening === 'busy') return;
    setOpening('busy');
    decryptedUrl(m.media.url, secretMedia.key, secretMedia.iv, secretMedia.mime)
      .then((url) => {
        useChat.getState().setSecretMediaUrl(m.conversationId, m.id, url);
        setOpening('idle');
      })
      .catch(() => setOpening('error'));
  };
  useEffect(() => {
    if (needsOpen && (m.media?.size || 0) <= AUTO_OPEN_BYTES) openSecretMedia();
    // Keyed on the URL: once it is a blob there is nothing left to open.
  }, [needsOpen, m.media?.url]); // eslint-disable-line react-hooks/exhaustive-deps

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
      // A real haptic tick in the app; the web's 12 ms buzz elsewhere.
      if (nowArmed) void tap();
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
      <motion.div className="system-note" variants={bubbleIn} initial={enter} animate="show">
        {m.body}
      </motion.div>
    );
  }

  if (m.deletedForAll) {
    return (
      <motion.div className={`msg${mine ? ' mine' : ''}`} variants={bubbleIn} initial={enter} animate="show">
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
    if (m.secret && m.secret.state !== 'ok') {
      return (
        <span className="msg-text secret-state">
          <IconLock size={13} /> {m.secret.note || SECRET_STATE_TEXT[m.secret.state] || 'Secret message'}
        </span>
      );
    }

    if (needsOpen) {
      const label = m.type === 'image' ? 'photo' : m.type === 'voice' ? 'voice message' : m.type === 'video' ? 'video' : 'file';
      return (
        <button className="secret-media" onClick={openSecretMedia} disabled={opening === 'busy'} style={ratioStyle}>
          <IconLock size={16} />
          <span className="small">
            {opening === 'busy'
              ? `Decrypting ${label}…`
              : opening === 'error'
                ? `Could not open this ${label} — tap to try again`
                : `Encrypted ${label}${m.media?.size ? ` · ${bytes(m.media.size)}` : ''} — tap to open`}
          </span>
        </button>
      );
    }

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
              src={safeUrl(m.media?.thumbUrl || m.media?.url)}
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
              <img src={safeUrl(m.media.thumbUrl)} alt="" loading={eager ? 'eager' : 'lazy'} decoding="async" />
            ) : (
              <video src={safeUrl(m.media?.url)} preload="metadata" />
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
            url={safeUrl(m.media?.url)}
            waveform={m.media?.waveform}
            length={m.media?.duration}
            transcript={m.transcript}
          />
        );

      case 'audio':
        return <audio controls src={safeUrl(m.media?.url)} style={{ maxWidth: 260 }} />;

      case 'file':
        return (
          <a
            className="file-card"
            href={safeUrl(m.media?.url) || undefined}
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
        /**
         * `burnt` is now the server's word for "no looks left", not "has been
         * seen once". The old code computed it here as `!mine && seen`, which
         * meant the bubble disabled itself the moment the first open was
         * recorded — on top of the server destroying the picture at the same
         * instant. Between them, a snap could be opened exactly never.
         */
        const snap = m.viewOnce;
        const burnt = Boolean(snap?.burnt);
        const saved = Boolean(m.saved);
        const left = snap?.opensLeft ?? 0;
        const opened = (snap?.opensUsed ?? 0) > 0;

        const label = burnt
          ? 'Snap opened'
          : mine
            ? 'Snap sent'
            : saved
              ? 'Saved snap'
              : opened
                ? 'Tap to replay'
                : 'Tap to open';

        const sub = burnt
          ? 'It is gone now'
          : mine
            ? snap?.viewers.length
              ? 'Opened'
              : 'Not opened yet'
            : saved
              ? 'Kept — it will not disappear'
              : opened
                ? `${left} ${left === 1 ? 'look' : 'looks'} left`
                : snap?.seconds
                  ? `${snap.seconds}s, and ${left - 1} replays`
                  : 'No time limit';

        return (
          <span className="stack" style={{ gap: 6, alignItems: 'stretch' }}>
            <button
              className={`snap${burnt ? ' burnt' : ''}`}
              disabled={burnt || mine}
              onClick={() => {
                /**
                 * Open first, and spend the look when it closes.
                 *
                 * Recording it up front is what broke this: the last open
                 * makes the server destroy the media and broadcast the change,
                 * which would blank the picture while somebody is still
                 * looking at it. Counting on close also means a look only
                 * costs you something once you have actually had it.
                 */
                setLightbox({ messageId: m.id, onClose: () => markSnapViewed(m.id) });
              }}
            >
              <span className="snap-seal">
                <IconFire size={20} />
              </span>
              <span className="stack" style={{ textAlign: 'left' }}>
                <span className="snap-label">{label}</span>
                <span className="snap-sub">{sub}</span>
              </span>
            </button>

            {/*
              Saving is offered only on a snap the sender left without a
              countdown. A timer is the sender saying how long you get, and a
              Save button that ignored it would make the timer decorative — so
              the server refuses too, and this is only the half you can see.
            */}
            {snap?.canSave && !burnt && (
              <button
                className="snap-keep"
                onClick={async () => {
                  try {
                    await saveMessage(m.id, !saved);
                  } catch (e: any) {
                    toast(e?.message || 'Could not keep that.', true);
                  }
                }}
              >
                <IconStar size={15} />
                {saved ? 'Kept — tap to let it go' : 'Keep this snap'}
              </button>
            )}
          </span>
        );
      }

      case 'sticker':
        // Springs in only when it has just arrived, like the bubble itself;
        // MotionConfig turns the bounce off for reduced-motion users.
        return (
          <motion.button
            className="sticker-frame"
            onClick={() => m.media && setLightbox({ messageId: m.id })}
            initial={animateIn ? { scale: 0.35, rotate: -12, opacity: 0 } : false}
            animate={{ scale: 1, rotate: 0, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 460, damping: 15, mass: 0.8 }}
            aria-label="Sticker — open it larger"
          >
            <img
              src={safeUrl(m.media?.url)}
              alt="Sticker"
              loading={eager ? 'eager' : 'lazy'}
              decoding="async"
              draggable={false}
            />
          </motion.button>
        );

      case 'poll':
        return <PollCard message={m} conversation={conversation} meId={meId} />;

      case 'list':
        return <ListCard message={m} conversation={conversation} meId={meId} />;

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
        initial={enter}
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

        <div
          ref={bubbleRef}
          className={`bubble${isMediaBubble ? ' media' : ''}${m.type === 'sticker' ? ' sticker' : ''}`}
        >
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
              {m.replyTo.thumbUrl && <img src={safeUrl(m.replyTo.thumbUrl)} alt="" />}
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
            <a className="link-card" href={safeUrl(m.linkPreview.url) || undefined} target="_blank" rel="noreferrer noopener">
              {m.linkPreview.image && (
                <span className="link-card-image">
                  <img src={safeUrl(m.linkPreview.image)} alt="" loading="lazy" />
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
            {reminded && (
              <span className="msg-remind" title="You have a reminder on this">
                <IconBell size={11} />
              </span>
            )}
            <time dateTime={m.createdAt}>{clock(m.createdAt)}</time>
            <Ticks m={m} meId={meId} convo={conversation} />
          </span>

          {/* hover tools */}
          <div className="msg-tools" style={{ opacity: menu ? 1 : undefined }}>
            <button onClick={() => setReplyTo(m)} aria-label="Reply" title="Reply">
              <IconReply size={16} />
            </button>
            {!secretChat && (
              <button
                onClick={() => openThread(m.id)}
                aria-label="Reply in a thread"
                title="Reply in a thread — keeps the tangent out of the main conversation"
              >
                <IconThread size={16} />
              </button>
            )}
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
                // Not on the reminder page: a native date picker pulls the
                // pointer out of the menu, and closing then loses the choice.
                onMouseLeave={() => !reminding && setMenu(false)}
              >
                {reminding ? (
                  <RemindPicker messageId={m.id} onBack={() => setReminding(false)} onDone={() => setMenu(false)} />
                ) : (
                <>
                {/* Not on a message still sending: it has no id the server knows yet. */}
                {!m.status && (
                  <button className="list-row" onClick={() => setReminding(true)}>
                    <IconBell size={17} />
                    <span className="grow">
                      <span className="list-row-label">{reminded ? 'Reminder set' : 'Remind me'}</span>
                      <span className="list-row-sub">{reminded ? 'Change or cancel it' : 'Bring this back later'}</span>
                    </span>
                  </button>
                )}
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
                {/*
                  Keep, offered only where it changes something: on a chat with
                  a disappearing timer running. Everywhere else the message was
                  never going anywhere, and a button promising to save it would
                  be answering a question nobody asked.

                  Distinct from Star, which is a bookmark — somewhere to find it
                  again. This is about whether it still exists to be found.
                */}
                {conversation.disappearAfter > 0 && m.type !== 'snap' && (
                  <button
                    className="list-row"
                    onClick={() => {
                      saveMessage(m.id, !m.saved).catch((e) =>
                        toast(e?.message || 'Could not keep that.', true)
                      );
                      setMenu(false);
                    }}
                  >
                    <IconClock size={17} />
                    <span className="grow">
                      <span className="list-row-label">{m.saved ? 'Let it disappear' : 'Keep this'}</span>
                      <span className="list-row-sub">
                        {m.saved ? 'It is being kept past the timer' : 'Stops the timer deleting it'}
                      </span>
                    </span>
                  </button>
                )}

                {!secretChat && (
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
                )}
                {/* Votes and ticks belong to this chat, and a secret message can only
                    be read here; the server refuses a forward of either too. */}
                {!secretChat && m.type !== 'poll' && m.type !== 'list' && (
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
                )}
                {m.type === 'text' && m.body && (
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
                {mine && !secretChat && editable(m) && Date.now() - new Date(m.createdAt).getTime() < 15 * 60 * 1000 && (
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
                </>
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
      {/* Mounted from the first open on (so it can still animate out), not
          once per bubble up front — sixty idle pickers is sixty storage reads. */}
      {anchorRect && (
        <ReactionBar
          open={picker}
          anchor={anchorRect}
          mine={mine}
          onPick={(emoji) => react(m, emoji)}
          onClose={() => setPicker(false)}
        />
      )}
    </>
  );
}

/**
 * A conversation object is replaced whenever anything about the room changes
 * — a new last message, an unread count — which re-rendered every bubble for
 * each arrival. Compare only the handful of room fields a bubble reads.
 */
function sameBubble(a: Props, b: Props) {
  return (
    a.message === b.message &&
    a.meId === b.meId &&
    a.runStart === b.runStart &&
    a.showAvatar === b.showAvatar &&
    a.eager === b.eager &&
    a.animateIn === b.animateIn &&
    a.onJumpTo === b.onJumpTo &&
    a.conversation.id === b.conversation.id &&
    a.conversation.type === b.conversation.type &&
    a.conversation.disappearAfter === b.conversation.disappearAfter &&
    a.conversation.pins === b.conversation.pins &&
    // A list card offers Remove on anyone's item to a group admin.
    a.conversation.myRole === b.conversation.myRole &&
    a.conversation.members.length === b.conversation.members.length
  );
}

export default memo(MessageBubble, sameBubble);
