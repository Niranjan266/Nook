import { Suspense, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { popFrom, reactionPop, springs, dur } from '@/lib/motion';
import { lazyChunk } from '@/lib/idle';
import { IconPlus } from '@/components/Icon';

/**
 * The message popup: a pill of quick reactions above the message and, when
 * asked for, a menu card beside it — over a scrim with the message itself
 * left lit.
 *
 * It used to fan six emoji out on an arc from a point fixed at `top: 50%,
 * left: 18%` of the viewport — a position with no relationship to the message
 * being reacted to. On a phone the arc ran off the right edge, and the emoji
 * appeared beside a message three rows above the one you pressed. Everything
 * here is measured against the message instead, so it opens where you
 * pressed, and grows out of the corner nearest it.
 *
 * Rendered into <body>. The bubble it belongs to is inside a Framer Motion
 * element that carries a transform for swipe-to-reply, and a transform makes
 * an ancestor the containing block for `position: fixed` children — the same
 * trap that collapsed the snap camera into an 80px bar.
 */

// The full grid is its own chunk (the composer warms it on idle); most
// reactions never leave the quick row.
const EmojiPicker = lazyChunk(() => import('./EmojiPicker'));

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
  /** The actions card; omitted when only reacting. */
  menu?: ReactNode;
}

/**
 * Seven 40px targets — six emoji and the plus — in one pill: 7 x 40 + 6 x 2
 * gaps + 4px padding each side = 300, which clears a 360px phone with the
 * 12px margins to spare.
 */
const CELL = 40;
const GAP = 2;
const PAD = 4;
const ROW_W = CELL * 7 + GAP * 6 + PAD * 2;
const ROW_H = CELL + PAD * 2;
const MENU_W = 240;
const EDGE = 12;
const SPACE = 8;

export default function ReactionBar({ open, anchor, mine, onPick, onClose, menu }: Props) {
  const [quick, setQuick] = useState<string[]>(readQuick);
  const [browsing, setBrowsing] = useState(false);
  const [browsed, setBrowsed] = useState(false);
  if (browsing && !browsed) setBrowsed(true);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuH, setMenuH] = useState(0);

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

  // The menu's real height (it changes when the reminder page opens), so the
  // placement below never guesses. Scale does not affect offsetHeight.
  useLayoutEffect(() => {
    const h = menuRef.current?.offsetHeight || 0;
    if (h && h !== menuH) setMenuH(h);
  });

  if (!anchor) return null;

  /**
   * Pill above the message and menu below it when there is room for both;
   * otherwise both on whichever side fits; otherwise the menu pinned to the
   * bottom of the screen. Clamped horizontally so nothing leaves a narrow
   * phone, which is exactly what the old arc did.
   */
  const vh = window.innerHeight;
  const vw = window.innerWidth;
  const mh = menu ? menuH || 300 : 0;
  const roomAbove = anchor.top - EDGE;
  const roomBelow = vh - anchor.bottom - EDGE;

  let pillTop: number;
  let menuTop = 0;
  if (!menu) {
    pillTop = roomAbove >= ROW_H + SPACE ? anchor.top - SPACE - ROW_H : Math.min(anchor.bottom + SPACE, vh - ROW_H - EDGE);
  } else if (roomAbove >= ROW_H + SPACE && roomBelow >= mh + SPACE) {
    pillTop = anchor.top - SPACE - ROW_H;
    menuTop = anchor.bottom + SPACE;
  } else if (roomAbove >= ROW_H + mh + SPACE * 2) {
    pillTop = anchor.top - SPACE - ROW_H;
    menuTop = pillTop - SPACE - mh;
  } else if (roomBelow >= ROW_H + mh + SPACE * 2) {
    pillTop = anchor.bottom + SPACE;
    menuTop = pillTop + ROW_H + SPACE;
  } else {
    // Nowhere fits both: the menu rests on the bottom edge (over the page,
    // which the scrim has already stepped back), the pill stays by the
    // message as long as the menu leaves it room.
    menuTop = Math.max(EDGE, vh - EDGE - mh);
    const byMessage = roomAbove >= ROW_H + SPACE ? anchor.top - SPACE - ROW_H : EDGE;
    pillTop = Math.max(EDGE, Math.min(byMessage, menuTop - SPACE - ROW_H));
  }
  const pillAbove = pillTop < anchor.top;
  const side = mine ? 'right' : 'left';

  const clampX = (x: number, w: number) => Math.max(EDGE, Math.min(x, vw - w - EDGE));
  const pillLeft = clampX(mine ? anchor.right - ROW_W : anchor.left, ROW_W);
  const menuLeft = clampX(mine ? anchor.right - MENU_W : anchor.left, MENU_W);

  // The lit hole over the message, kept on screen for a very tall bubble.
  const spot = {
    top: Math.max(0, anchor.top),
    left: anchor.left,
    width: anchor.width,
    height: Math.max(0, Math.min(vh, anchor.bottom) - Math.max(0, anchor.top)),
  };

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
            {/* Tapping anywhere else closes it. Below the popup, above
                everything else, so a stray tap dismisses rather than acts. */}
            <motion.div
              key="scrim"
              className="msg-scrim"
              onClick={onClose}
              onContextMenu={(e) => {
                e.preventDefault();
                onClose();
              }}
              aria-hidden="true"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, transition: { duration: dur.base } }}
              exit={{ opacity: 0, transition: { duration: dur.fast } }}
            >
              <span className="msg-spot" style={spot} />
            </motion.div>

            <motion.div
              key="row"
              className="react-row"
              style={{ top: pillTop, left: pillLeft, width: ROW_W, height: ROW_H }}
              variants={popFrom(`${pillAbove ? 'bottom' : 'top'} ${side}`)}
              initial="hidden"
              animate="show"
              exit="exit"
              role="menu"
              aria-label="React to this message"
            >
              {quick.map((emoji, i) => (
                <motion.button
                  key={`${emoji}-${i}`}
                  className="react-pick"
                  // Each lands in turn, a beat apart, from the message's side.
                  initial={{ opacity: 0, scale: 0.3 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ ...springs.pop, delay: 0.02 + (mine ? 6 - i : i) * 0.025 }}
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
                initial={{ opacity: 0, scale: 0.3 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ ...springs.pop, delay: 0.02 + (mine ? 0 : 6) * 0.025 }}
                onClick={() => setBrowsing(true)}
                aria-label="Choose another emoji"
                role="menuitem"
              >
                <IconPlus size={18} />
              </motion.button>
            </motion.div>

            {menu && (
              <motion.div
                key="menu"
                ref={menuRef}
                className="msg-menu floating"
                style={{ top: menuTop, left: menuLeft }}
                variants={popFrom(`${menuTop > anchor.top ? 'top' : 'bottom'} ${side}`)}
                initial="hidden"
                animate="show"
                exit="exit"
                role="menu"
                aria-label="Message actions"
              >
                {menu}
              </motion.div>
            )}
          </>
        )}
      </AnimatePresence>

      {browsed && (
        <Suspense fallback={null}>
          <EmojiPicker
            open={browsing}
            anchor={{
              left: Math.max(EDGE, pillLeft - 40),
              bottom: Math.max(96, vh - pillTop + 10),
            }}
            onClose={() => {
              setBrowsing(false);
              onClose();
            }}
            onPick={choose}
          />
        </Suspense>
      )}
    </>,
    document.body
  );
}
