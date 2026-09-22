import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useChat, selectActive } from '@/stores/chat';
import { useAuth } from '@/stores/auth';
import Avatar from '@/components/Avatar';
import { clock, linkify } from '@/lib/format';
import { sheetSlide, sheetSlideUp, bubbleSend, bubbleReceive } from '@/lib/motion';
import { usePhone } from '@/lib/useMediaQuery';
import { IconClose, IconSend, IconThread } from '@/components/Icon';

/**
 * A side-thread. One level deep on purpose — nesting turns a conversation into
 * a forum, and the whole point is to keep a tangent *out* of the main room
 * without creating a second place to check.
 */
const NO_REPLIES: never[] = [];

export default function ThreadPanel() {
  // Narrow reads: this is mounted all the time, so a whole-store read made it
  // re-render on every event in every conversation, open or not.
  const openThreadId = useChat((s) => s.openThreadId);
  const replies = useChat((s) => (s.openThreadId ? s.threads[s.openThreadId] : undefined)) || NO_REPLIES;
  const root = useChat((s) =>
    s.activeId && s.openThreadId
      ? (s.messages[s.activeId] || []).find((m) => m.id === s.openThreadId)
      : undefined
  );
  const { openThread, sendInThread } = useChat.getState();
  const phone = usePhone();
  const conversation = useChat(selectActive);
  const me = useAuth((s) => s.me);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);


  useEffect(() => {
    if (openThreadId) setText('');
  }, [openThreadId]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth' });
  }, [replies.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && openThread(null);
    if (openThreadId) document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [openThreadId, openThread]);

  const submit = async () => {
    if (!text.trim() || !openThreadId) return;
    setBusy(true);
    try {
      await sendInThread(openThreadId, text);
      setText('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AnimatePresence>
      {openThreadId && (
        <>
          <motion.div
            className="sheet-scrim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: { duration: 0.2 } }}
            exit={{ opacity: 0, transition: { duration: 0.16 } }}
            onClick={() => openThread(null)}
          />
          <motion.aside
            className="sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Thread"
            {...(phone ? sheetSlideUp : sheetSlide)}
          >
            <header className="sheet-head">
              <h2 className="sheet-title row" style={{ gap: 8 }}>
                <IconThread size={19} /> Thread
              </h2>
              <button className="clay-round" onClick={() => openThread(null)} aria-label="Close thread">
                <IconClose />
              </button>
            </header>

            <div className="sheet-body thread-body">
              {/* The message the tangent came off. */}
              {root && (
                <div className="thread-root">
                  <div className="thread-root-head">
                    <Avatar
                      name={root.sender.displayName || '?'}
                      src={root.sender.avatarUrl}
                      id={root.sender.id}
                      accent={root.sender.accent}
                      size={24}
                    />
                    <span className="small" style={{ fontWeight: 600 }}>
                      {root.sender.id === me?.id ? 'You' : root.sender.displayName}
                    </span>
                    <span className="grow" />
                    <time className="tiny faint">{clock(root.createdAt)}</time>
                  </div>
                  <p className="thread-root-body">{root.body || root.type}</p>
                </div>
              )}

              <div className="rule" />

              {replies.length === 0 && (
                <p className="small muted thread-empty">
                  No replies yet. Anything you say here stays out of the main conversation.
                </p>
              )}

              {replies.map((m) => {
                const mine = m.sender.id === me?.id;
                return (
                  <motion.div
                    key={m.id}
                    className={`msg run-start${mine ? ' mine' : ''}`}
                    style={{ maxWidth: '92%' }}
                    variants={mine ? bubbleSend : bubbleReceive}
                    initial="hidden"
                    animate="show"
                  >
                    {!mine && (
                      <span className="msg-avatar">
                        <Avatar
                          name={m.sender.displayName || '?'}
                          src={m.sender.avatarUrl}
                          id={m.sender.id}
                          accent={m.sender.accent}
                          size={28}
                        />
                      </span>
                    )}
                    <div className="bubble">
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
                      <span className="msg-meta">
                        <time dateTime={m.createdAt}>{clock(m.createdAt)}</time>
                      </span>
                    </div>
                  </motion.div>
                );
              })}
              <div ref={bottom} />
            </div>

            <div className="sheet-foot thread-foot">
              <div className="composer-input">
                <textarea
                  rows={1}
                  className="groove"
                  placeholder="Reply in this thread"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      submit();
                    }
                  }}
                  aria-label="Thread reply"
                />
              </div>
              <button
                className="composer-send"
                onClick={submit}
                disabled={!text.trim() || busy}
                aria-label="Send reply"
              >
                <IconSend size={20} />
              </button>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
