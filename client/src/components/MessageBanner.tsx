/**
 * The in-app arrival banner — what WhatsApp and Instagram show when a message
 * lands while you are already looking at the app.
 *
 * It comes down from the top rather than up from the bottom, for two reasons.
 * The bottom of a chat screen is where the composer, the send button and the
 * keyboard live, so a banner there covers the controls and invites mis-taps.
 * And on a phone the top edge is where every other notification in the
 * operating system appears — putting it anywhere else makes it read as part
 * of the page instead of as an interruption.
 */
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { spring } from '@/lib/motion';
import Avatar from '@/components/Avatar';
import { IconClose } from '@/components/Icon';

export interface BannerMessage {
  id: string;
  conversationId: string;
  title: string;
  body: string;
  avatarUrl?: string;
  accent?: string;
  onOpen: () => void;
}

/** How long it sits there before leaving of its own accord. */
const DWELL = 5200;

export default function MessageBanner({
  message,
  onDismiss,
}: {
  message: BannerMessage | null;
  onDismiss: () => void;
}) {
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!message || dragging) return;
    const t = setTimeout(onDismiss, DWELL);
    return () => clearTimeout(t);
    // Re-armed per message, so a second arrival restarts the clock rather than
    // inheriting whatever was left of the first one's.
  }, [message?.id, dragging, onDismiss]);

  return (
    <AnimatePresence>
      {message && (
        <motion.div
          key={message.id}
          className="msg-banner"
          initial={{ y: -90, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -90, opacity: 0 }}
          transition={spring}
          // Flick it up to dismiss — the gesture people already have for this.
          drag="y"
          dragConstraints={{ top: 0, bottom: 0 }}
          dragElastic={{ top: 0.5, bottom: 0 }}
          onDragStart={() => setDragging(true)}
          onDragEnd={(_, info) => {
            setDragging(false);
            if (info.offset.y < -28) onDismiss();
          }}
          role="alert"
          aria-live="polite"
        >
          <button
            className="msg-banner-open"
            onClick={() => {
              message.onOpen();
              onDismiss();
            }}
          >
            <Avatar
              name={message.title}
              src={message.avatarUrl}
              id={message.conversationId}
              accent={message.accent as any}
              size={38}
            />
            <span className="stack" style={{ gap: 1, minWidth: 0 }}>
              <span className="msg-banner-title">{message.title}</span>
              <span className="msg-banner-body">{message.body}</span>
            </span>
          </button>

          <button
            className="msg-banner-x"
            onClick={onDismiss}
            aria-label="Dismiss"
          >
            <IconClose size={15} />
          </button>

          {/* A quiet countdown, so the banner leaving is expected rather than
              something that happened while you were reading it. */}
          {!dragging && (
            <motion.span
              className="msg-banner-timer"
              key={`${message.id}-timer`}
              initial={{ scaleX: 1 }}
              animate={{ scaleX: 0 }}
              transition={{ duration: DWELL / 1000, ease: 'linear' }}
            />
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
