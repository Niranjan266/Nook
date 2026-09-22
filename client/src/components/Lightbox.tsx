import { useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useUi } from '@/stores/ui';
import { useChat } from '@/stores/chat';
import { post } from '@/lib/api';
import { clock } from '@/lib/format';
import { IconClose, IconDownload, IconWarning } from '@/components/Icon';
import { spring, ease } from '@/lib/motion';
import { safeUrl } from '@/lib/config';

export default function Lightbox() {
  const lightbox = useUi((s) => s.lightbox);
  const setLightbox = useUi((s) => s.setLightbox);
  // Just the one message: a whole-store read re-rendered this on every
  // typing blip even while closed.
  const message = useChat((s) =>
    lightbox ? (s.messages[s.activeId || ''] || []).find((m) => m.id === lightbox.messageId) : null
  );

  /**
   * Where the picture was on screen, so it can grow out of its bubble and
   * shrink back into it rather than appearing from nowhere. Measured once per
   * open; if the bubble is not in view it simply zooms from the centre.
   */
  const origin = useMemo(() => {
    const el =
      lightbox &&
      document.querySelector(`#m-${CSS.escape(lightbox.messageId)} :is(.media-frame, .sticker-frame)`);
    const r = el?.getBoundingClientRect();
    if (!r || r.bottom < 0 || r.top > window.innerHeight) return { x: 0, y: 0, scale: 0.94 };
    return {
      x: r.left + r.width / 2 - window.innerWidth / 2,
      y: r.top + r.height / 2 - window.innerHeight / 2,
      scale: Math.min(0.9, Math.max(0.2, r.width / (window.innerWidth * 0.8))),
    };
  }, [lightbox?.messageId]); // eslint-disable-line react-hooks/exhaustive-deps

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
          animate={{ opacity: 1, transition: { duration: 0.2, ease: ease.out } }}
          exit={{ opacity: 0, transition: { duration: 0.2, ease: ease.in } }}
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
              <span style={{ fontWeight: 700 }}>{message.sender.displayName || 'Someone'}</span>
              <span className="lightbox-sub">{clock(message.createdAt)}</span>
            </span>
            {!isSnap && (
              <a
                className="clay-round"
                href={safeUrl(message.media.url) || undefined}
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
            initial={{ ...origin, opacity: 0 }}
            animate={{ x: 0, y: 0, scale: 1, opacity: 1, transition: spring }}
            exit={{ ...origin, opacity: 0, transition: { duration: 0.2, ease: ease.in } }}
          >
            {message.media.mime?.startsWith('video/') ? (
              <video src={safeUrl(message.media.url)} controls autoPlay playsInline />
            ) : (
              <img src={safeUrl(message.media.url)} alt={message.body || ''} />
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
              <p className="lightbox-caption">
                {message.body}
              </p>
            )
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
