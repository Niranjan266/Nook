import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useChat } from '@/stores/chat';
import { useUi } from '@/stores/ui';
import { previewOf } from '@/lib/format';
import { spring } from '@/lib/motion';
import { IconPin, IconClose } from '@/components/Icon';
import type { Conversation } from '@/lib/types';

/**
 * The pinned bar shows one pin at a time and cycles through them on tap — the
 * pattern that keeps a pin board from turning into a second inbox. The strip on
 * the left shows how many there are and which one you're on.
 */
export default function PinBar({
  conversation,
  onJump,
}: {
  conversation: Conversation;
  onJump: (messageId: string) => void;
}) {
  const unpin = useChat((s) => s.unpin);
  const { toast } = useUi();
  const [index, setIndex] = useState(0);

  const pins = conversation.pins || [];
  if (!pins.length) return null;

  const current = pins[Math.min(index, pins.length - 1)];
  const message = current?.message;

  return (
    <AnimatePresence>
      <motion.div
        className="pin-bar"
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={spring}
      >
        <span className="pin-bar-strip" aria-hidden="true">
          {pins.map((_, i) => (
            <i key={i} className={i === index % pins.length ? 'on' : ''} />
          ))}
        </span>

        <button
          className="pin-bar-body"
          onClick={() => {
            if (current) onJump(current.messageId);
            if (pins.length > 1) setIndex((i) => (i + 1) % pins.length);
          }}
        >
          <span className="pin-bar-label">
            <IconPin size={10} style={{ verticalAlign: -1 }} /> Pinned
            {pins.length > 1 ? ` · ${(index % pins.length) + 1} of ${pins.length}` : ''}
          </span>
          <span className="pin-bar-text truncate">
            {message ? previewOf(message) : 'A message that is no longer here'}
          </span>
        </button>

        <button
          className="clay-round"
          style={{ width: 32, height: 32 }}
          onClick={() =>
            unpin(conversation.id, current.messageId)
              .then(() => toast('Unpinned'))
              .catch(() => toast('Could not unpin that.', true))
          }
          aria-label="Unpin this message"
        >
          <IconClose size={15} />
        </button>
      </motion.div>
    </AnimatePresence>
  );
}
