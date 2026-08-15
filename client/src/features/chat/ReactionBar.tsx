import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { spring } from '@/lib/motion';
import EmojiPicker from './EmojiPicker';
import { IconPlus } from '@/components/Icon';

/**
 * The reaction picker.
 *
 * It used to fan six emoji out on an arc from a point fixed at `top: 50%,
 * left: 18%` of the viewport — a position with no relationship to the message
 * being reacted to. On a desktop that read as a flourish. On a phone the arc
 * simply ran off the right edge, and the emoji appeared beside a message three
 * rows above the one you pressed.
 *
 * A row anchored to the message is duller and correct: it appears where you
 * pressed, it fits any screen because it is measured against one, and six
 * targets in a line are easier to hit than six on a curve.
 *
 * Rendered into <body>. The bubble it belongs to is inside a Framer Motion
 * element that carries a transform for swipe-to-reply, and a transform makes
 * an ancestor the containing block for `position: fixed` children — the same
 * trap that collapsed the snap camera into an 80px bar.
 */

const QUICK_KEY = 'nook.reactions.quick';
const DEFAULTS = ['❤️', '😂', '👍', '😮', '😢', '🙏'];

export function readQuick(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(QUICK_KEY) || 'null');
    if (Array.isArray(raw) && raw.length === 6 && raw.every((e) => typeof e === 'string')) return raw;
  } catch {
    /* fall through to the defaults */
  }
  return DEFAULTS;
}

/**
 * Promote an emoji into the row, pushing out the one used longest ago.
 *
 * This is what "replace the existing ones" means in practice: you do not
 * manage a list, you just use an emoji and it earns its place. Picking one
 * that is already there moves it to the front rather than duplicating it.
 */
function promote(emoji: string): string[] {
  const next = [emoji, ...readQuick().filter((e) => e !== emoji)].slice(0, 6);
  try {
    localStorage.setItem(QUICK_KEY, JSON.stringify(next));
  } catch {
    /* private mode; the row just resets next launch */
  }
  return next;
}

interface Props {
  open: boolean;
  /** The message's box on screen, measured when the picker opened. */
  anchor: DOMRect | null;
  /** True when it is your own message, so the row hugs the correct side. */
  mine: boolean;
  onPick: (emoji: string) => void;
  onClose: () => void;
}

const ROW_W = 296;
const ROW_H = 52;

export default function ReactionBar({ open, anchor, mine, onPick, onClose }: Props) {
  const [quick, setQuick] = useState<string[]>(readQuick);
  const [browsing, setBrowsing] = useState(false);
  const row = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) setQuick(readQuick());
    else setBrowsing(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!anchor) return null;

  /**
   * Sit above the message, or below it when there is no room — a picker that
   * opens off the top of the screen is the same bug in the other direction.
   * Clamped horizontally so it never leaves the viewport on a narrow phone,
   * which is exactly what the old arc did.
   */
  const gap = 8;
  const above = anchor.top > ROW_H + gap + 12;
  const top = above ? anchor.top - ROW_H - gap : Math.min(anchor.bottom + gap, window.innerHeight - ROW_H - 12);

  const preferred = mine ? anchor.right - ROW_W : anchor.left;
  const left = Math.max(12, Math.min(preferred, window.innerWidth - ROW_W - 12));

  const choose = (emoji: string) => {
    setQuick(promote(emoji));
    onPick(emoji);
    onClose();
  };

  return createPortal(
    <>
      <AnimatePresence>
        {open && !browsing && (
          <>
            {/* Tapping anywhere else closes it. Below the row, above everything
                else, so a stray tap dismisses rather than acting. */}
            <div
              style={{ position: 'fixed', inset: 0, zIndex: 96 }}
              onClick={onClose}
              aria-hidden="true"
            />

            <motion.div
              ref={row}
              className="react-row clay"
              style={{ top, left, width: ROW_W }}
              initial={{ opacity: 0, scale: 0.9, y: above ? 6 : -6 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.94, y: above ? 4 : -4 }}
              transition={spring}
              role="menu"
              aria-label="React to this message"
            >
              {quick.map((emoji, i) => (
                <motion.button
                  key={`${emoji}-${i}`}
                  className="react-pick"
                  initial={{ scale: 0.4, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ ...spring, delay: i * 0.02 }}
                  onClick={() => choose(emoji)}
                  aria-label={`React ${emoji}`}
                  role="menuitem"
                >
                  {emoji}
                </motion.button>
              ))}

              {/* Any other emoji. Whatever you pick joins the row, so the six
                  become yours over time without a settings screen. */}
              <motion.button
                className="react-pick react-more"
                initial={{ scale: 0.4, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ ...spring, delay: quick.length * 0.02 }}
                onClick={() => setBrowsing(true)}
                aria-label="Choose another emoji"
                role="menuitem"
              >
                <IconPlus size={17} />
              </motion.button>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <EmojiPicker
        open={browsing}
        anchor={{
          left: Math.max(12, left - 40),
          bottom: Math.max(96, window.innerHeight - top + 10),
        }}
        onClose={() => {
          setBrowsing(false);
          onClose();
        }}
        onPick={choose}
      />
    </>,
    document.body
  );
}
