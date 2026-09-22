import { useEffect, useRef, type ReactNode } from 'react';
import { motion, AnimatePresence, useDragControls, type PanInfo } from 'framer-motion';
import { IconClose } from './Icon';
import { sheetSlide, sheetUp, dur, ease } from '@/lib/motion';
import { usePhone } from '@/lib/useMediaQuery';

/** Pulled this far down, or flicked this fast, a phone sheet lets go. */
const DISMISS_DISTANCE = 110;
const DISMISS_VELOCITY = 650;

interface Props {
  /**
   * Dim the page behind less than usual.
   *
   * For sheets whose whole job is changing how the page looks — the wallpaper
   * picker — where a normal scrim hides the very thing being decided.
   */
  seeThrough?: boolean;
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  headExtra?: ReactNode;
}

export default function Sheet({ open, onClose, title, children, footer, headExtra, seeThrough }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const phone = usePhone();
  const drag = useDragControls();

  /**
   * On a phone the sheet is a bottom sheet (see shell.css), so it rises from
   * the bottom and can be pulled back down — but only by its head. Dragging
   * from the body would fight the body's own scrolling.
   */
  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.y > DISMISS_DISTANCE || info.velocity.y > DISMISS_VELOCITY) onClose();
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key !== 'Tab' || !ref.current) return;
      const focusable = ref.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    const timer = setTimeout(() => {
      ref.current?.querySelector<HTMLElement>('input, button')?.focus();
    }, 220);
    return () => {
      document.removeEventListener('keydown', onKey);
      clearTimeout(timer);
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className={`sheet-scrim${seeThrough ? " see-through" : ""}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: { duration: dur.base, ease: ease.out } }}
            exit={{ opacity: 0, transition: { duration: dur.fast, ease: ease.in } }}
            onClick={onClose}
          />
          <motion.div
            ref={ref}
            className="sheet"
            role="dialog"
            aria-modal="true"
            aria-label={title}
            // A phone sheet rises on the sheet spring (one small overshoot,
            // absorbed by the padding under it in shell.css); a desk sheet
            // slides in from the side.
            {...(phone ? { variants: sheetUp, initial: 'hidden', animate: 'show', exit: 'exit' } : sheetSlide)}
            drag={phone ? 'y' : false}
            dragListener={false}
            dragControls={drag}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.7 }}
            dragMomentum={false}
            onDragEnd={onDragEnd}
          >
            <header className="sheet-head" onPointerDown={phone ? (e) => drag.start(e) : undefined}>
              <h2 className="sheet-title">{title}</h2>
              {headExtra}
              <button className="clay-round" onClick={onClose} aria-label="Close">
                <IconClose />
              </button>
            </header>
            <div className="sheet-body">{children}</div>
            {footer && <div className="sheet-foot">{footer}</div>}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
