import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useChat, selectActive } from '@/stores/chat';
import { useAuth } from '@/stores/auth';
import Avatar from '@/components/Avatar';
import { clock, linkify } from '@/lib/format';
import { spring, sheetSlide, bubbleIn } from '@/lib/motion';
import { IconClose, IconSend, IconThread } from '@/components/Icon';

/**
 * A side-thread. One level deep on purpose — nesting turns a conversation into
 * a forum, and the whole point is to keep a tangent *out* of the main room
 * without creating a second place to check.
 */
export default function ThreadPanel() {
  const { openThreadId, threads, messages, activeId, openThread, sendInThread } = useChat();
  const conversation = useChat(selectActive);
  const me = useAuth((s) => s.me);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  const root = activeId
    ? (messages[activeId] || []).find((m) => m.id === openThreadId)
    : undefined;
  const replies = openThreadId ? threads[openThreadId] || [] : [];

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
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={() => openThread(null)}
          />
          <motion.aside
            className="sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Thread"
            {...sheetSlide}
            transition={spring}
          >
            <header className="sheet-head">
              <h2 className="sheet-title row" style={{ gap: 8 }}>
                <IconThread size={19} /> Thread
              </h2>
              <button className="clay-round" onClick={() => openThread(null)} aria-label="Close thread">
                <IconClose />
              </button>
            </header>

            <div className="sheet-body" style={{ gap: 10 }}>
              {/* The message the tangent came off. */}
              {root && (
                <div className="clay" style={{ padding: '11px 14px', boxShadow: 'var(--clay-in)' }}>
                  <div className="row" style={{ gap: 8, marginBottom: 4 }}>
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
                  <p style={{ fontSize: 'var(--t-sm)', lineHeight: 1.5 }}>{root.body || root.type}</p>
                </div>
              )}

              <div className="rule" />

              {replies.length === 0 && (
                <p className="small muted" style={{ textAlign: 'center', padding: '18px 0' }}>
                  No replies yet. Anything you say here stays out of the main conversation.
                </p>
              )}

              {replies.map((m) => {
                const mine = m.sender.id === me?.id;
                return (
                  <motion.div
                    key={m.id}
                    className={`msg${mine ? ' mine' : ''}`}
                    style={{ maxWidth: '92%', position: 'relative' }}
                    variants={bubbleIn}
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
                          size={26}
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

            <div className="sheet-foot">
              <div className="composer-input" style={{ flex: 1 }}>
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
