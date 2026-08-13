import { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useUi } from '@/stores/ui';
import { useChat } from '@/stores/chat';
import { post } from '@/lib/api';
import { clock } from '@/lib/format';
import { IconClose, IconDownload, IconWarning } from '@/components/Icon';
import { spring } from '@/lib/motion';

export default function Lightbox() {
  const { lightbox, setLightbox } = useUi();
  const { messages, activeId } = useChat();

  const message = lightbox
    ? (messages[activeId || ''] || []).find((m) => m.id === lightbox.messageId)
    : null;

  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setLightbox(null);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [lightbox, setLightbox]);

  /* Courtesy screenshot hint for snaps — the web genuinely cannot block one. */
  useEffect(() => {
    if (!message?.viewOnce?.enabled) return;
    const onBlur = () => post(`/messages/${message.id}/screenshot-hint`).catch(() => {});
    window.addEventListener('blur', onBlur, { once: true });
    return () => window.removeEventListener('blur', onBlur);
  }, [message?.id]);

  const isSnap = Boolean(message?.viewOnce?.enabled);

  /**
   * The sender chose this when they took the shot. `0` means they chose no
   * countdown at all, so the viewer closes it themselves — which is why this
   * is a `??` and not a `||`: zero is a real answer, not a missing one.
   * Older snaps sent before the timer existed have no value and get the 10
   * seconds that used to be hardcoded here.
   */
  const snapSeconds = message?.viewOnce?.seconds ?? 10;
  const counts = isSnap && snapSeconds > 0;

  return (
    <AnimatePresence>
      {message && message.media && (
        <motion.div
          className={isSnap ? 'snap-view' : 'lightbox'}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          role="dialog"
          aria-modal="true"
          aria-label={isSnap ? 'Snap' : 'Media'}
        >
          {counts && (
            <motion.div
              className="snap-timer"
              initial={{ scaleX: 1 }}
              animate={{ scaleX: 0 }}
              transition={{ duration: snapSeconds, ease: 'linear' }}
              onAnimationComplete={() => setLightbox(null)}
            />
          )}

          <header className="lightbox-head">
            <span className="grow stack" style={{ gap: 0 }}>
              <span style={{ fontWeight: 600 }}>{message.sender.displayName || 'Someone'}</span>
              <span className="tiny" style={{ opacity: 0.7 }}>
                {clock(message.createdAt)}
              </span>
            </span>
            {!isSnap && (
              <a
                className="clay-round"
                href={message.media.url}
                download={message.media.name || 'nook-media'}
                target="_blank"
                rel="noreferrer"
                aria-label="Download"
              >
                <IconDownload />
              </a>
            )}
            <button className="clay-round" onClick={() => setLightbox(null)} aria-label="Close">
              <IconClose />
            </button>
          </header>

          <motion.div
            className="lightbox-stage"
            initial={{ scale: 0.94, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={spring}
          >
            {message.media.mime?.startsWith('video/') ? (
              <video src={message.media.url} controls autoPlay playsInline />
            ) : (
              <img src={message.media.url} alt={message.body || ''} />
            )}
          </motion.div>

          {isSnap ? (
            <p className="hint">
              <IconWarning size={14} style={{ verticalAlign: -2 }} />{' '}
              {counts
                ? `This closes in ${snapSeconds} seconds and cannot be reopened.`
                : 'Close this when you’re done — it cannot be reopened.'}{' '}
              Nook can’t stop a screenshot — the sender just gets told one may have happened.
            </p>
          ) : (
            message.body && (
              <p className="hint" style={{ padding: 'var(--s-4)', textAlign: 'center', color: '#F7F2EA' }}>
                {message.body}
              </p>
            )
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
