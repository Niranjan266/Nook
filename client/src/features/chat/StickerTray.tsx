/**
 * Your stickers, next to the emoji button.
 *
 * Same shell as the emoji picker — portalled, anchored to its button, closed
 * by a tap outside — so the two feel like siblings. Tapping a sticker sends
 * it; a long press (or right click, or Delete on the keyboard) arms a delete
 * on just that one, because a tray you tap to send is the last place a
 * one-tap delete belongs.
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { popFrom, spring } from '@/lib/motion';
import { safeUrl } from '@/lib/config';
import { useStickers } from '@/stores/stickers';
import { useUi } from '@/stores/ui';
import type { Sticker } from '@/lib/types';
import { IconClose, IconPlus, IconTrash } from '@/components/Icon';

interface Props {
  open: boolean;
  onClose: () => void;
  onPick: (sticker: Sticker) => void;
  onMake: () => void;
  anchor?: { left: number; bottom: number } | null;
}

const LONG_PRESS_MS = 480;

export default function StickerTray({ open, onClose, onPick, onMake, anchor }: Props) {
  const { stickers, loaded, cap, load, remove } = useStickers();
  const toast = useUi((s) => s.toast);
  const [armed, setArmed] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const pressTimer = useRef<number>();
  // Set when a long press fires, so the click that ends it does not also send.
  const longPressed = useRef(false);

  useEffect(() => {
    if (!open) return;
    setArmed(null);
    setFailed(false);
    load().catch(() => setFailed(true));
  }, [open, load]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      armed ? setArmed(null) : onClose();
    };
    const onDown = (e: PointerEvent) => {
      const target = e.target as Element;
      // The toggle button closes it itself; closing here too would let its
      // click reopen the tray straight away.
      if (target.closest?.('[data-sticker-toggle]')) return;
      if (panel.current && !panel.current.contains(target)) onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [open, onClose, armed]);

  const startPress = (id: string) => {
    longPressed.current = false;
    window.clearTimeout(pressTimer.current);
    pressTimer.current = window.setTimeout(() => {
      longPressed.current = true;
      setArmed(id);
      navigator.vibrate?.(12);
    }, LONG_PRESS_MS);
  };
  const cancelPress = () => window.clearTimeout(pressTimer.current);

  const deleteOne = async (id: string) => {
    setArmed(null);
    try {
      await remove(id);
      toast('Sticker deleted');
    } catch (e: any) {
      toast(e?.message || 'Could not delete that sticker.', true);
    }
  };

  const full = stickers.length >= cap;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          ref={panel}
          className="emoji-pop sticker-tray"
          style={anchor ? { left: Math.max(12, anchor.left), bottom: anchor.bottom } : { left: 12, bottom: 96 }}
          // Grows out of the button that opened it, just below-left.
          variants={popFrom('bottom left')}
          initial="hidden"
          animate="show"
          exit="exit"
          role="dialog"
          aria-label="Your stickers"
        >
          <div className="emoji-pop-search">
            <span className="grow sticker-tray-title">Stickers</span>
            <span className="tiny muted tabular">
              {stickers.length}/{cap}
            </span>
            <button onClick={onClose} aria-label="Close" className="emoji-pop-close">
              <IconClose size={15} />
            </button>
          </div>

          <div className="emoji-pop-grid" onPointerDown={(e) => e.target === e.currentTarget && setArmed(null)}>
            {failed && <p className="small muted emoji-pop-empty">Could not load your stickers. Check your connection.</p>}
            <div className="sticker-grid" role="list">
              <button
                className="sticker-cell sticker-make"
                onClick={() =>
                  full ? toast(`You have ${cap} stickers — delete one to make room.`, true) : onMake()
                }
                role="listitem"
              >
                <IconPlus size={20} />
                <span>Make a sticker</span>
              </button>

              {stickers.map((s) => (
                <div key={s.id} className={`sticker-cell${armed === s.id ? ' armed' : ''}`} role="listitem">
                  <button
                    className="sticker-cell-send"
                    onPointerDown={() => startPress(s.id)}
                    onPointerUp={cancelPress}
                    onPointerLeave={cancelPress}
                    onPointerCancel={cancelPress}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      cancelPress();
                      setArmed(s.id);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Delete' || e.key === 'Backspace') {
                        e.preventDefault();
                        setArmed(s.id);
                      }
                    }}
                    onClick={() => {
                      if (longPressed.current) return void (longPressed.current = false);
                      if (armed) return setArmed(null);
                      onPick(s);
                    }}
                    aria-label="Send sticker. Long press or press Delete to remove it."
                  >
                    <img src={safeUrl(s.url)} alt="" loading="lazy" decoding="async" draggable={false} />
                  </button>
                  <AnimatePresence>
                    {armed === s.id && (
                      <motion.button
                        className="sticker-delete"
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.8 }}
                        transition={spring}
                        onClick={() => deleteOne(s.id)}
                        autoFocus
                        aria-label="Delete this sticker"
                      >
                        <IconTrash size={15} /> Delete
                      </motion.button>
                    )}
                  </AnimatePresence>
                </div>
              ))}
            </div>

            {loaded && stickers.length === 0 && !failed && (
              <p className="small muted emoji-pop-empty">
                Turn any photo into a clay sticker — a face, a pet, a plate of something good.
              </p>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
