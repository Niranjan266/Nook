/**
 * The recording row: what the composer turns into while a voice note is
 * being made.
 *
 * WHY THE LEVEL IS A MOTION VALUE AND NOT STATE
 *
 * The microphone is sampled every animation frame. Pushed through React state
 * that re-rendered the whole composer sixty times a second, just to move a few
 * bars. The rings read `level` as a motion value, which Framer applies
 * straight to the DOM, and the waveform takes a slower, throttled copy — so a
 * frame of speech costs a style write, not a render.
 *
 * HOLD, SLIDE, LOCK
 *
 * Holding the mic records; letting go sends. Dragging left past the line
 * cancels, dragging up locks it hands-free. The gesture itself lives in the
 * composer (it has to outlive the button it started on); this only draws it,
 * from `dragX`/`dragY` and the thresholds it is given.
 */
import { AnimatePresence, motion, useReducedMotion, useSpring, useTransform, type MotionValue } from 'framer-motion';
import { IconTrash, IconSend, IconLock, IconMic } from '@/components/Icon';

export const CANCEL_AT = -110;
export const LOCK_AT = -72;

type Mode = 'hold' | 'locked';

/** Why the row is leaving, so the exit can go the right way. */
export type RecEnd = 'send' | 'discard';

interface Props {
  seconds: number;
  levels: number[];
  level: MotionValue<number>;
  mode: Mode;
  dragX: MotionValue<number>;
  dragY: MotionValue<number>;
  transcript: string;
  onDiscard: () => void;
  onSend: () => void;
}

/** 0:07 → ['0', '0', '7'], so each digit can roll on its own. */
const digits = (s: number) => {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`.split('');
};

export const recRowVariants = {
  initial: { opacity: 0 },
  enter: { opacity: 1, transition: { duration: 0.14 } },
  // Discarding drops the whole row toward the bin; sending sweeps it into the
  // send button, which is where the note is going.
  exit: (end: RecEnd) =>
    end === 'discard'
      ? { opacity: 0, x: -24, scale: 0.92, transition: { duration: 0.22, ease: [0.4, 0, 1, 1] } }
      : { opacity: 0, x: 18, scale: 0.96, transition: { duration: 0.2, ease: [0.4, 0, 1, 1] } },
};

export default function RecordingBar({ seconds, levels, level, mode, dragX, dragY, transcript, onDiscard, onSend }: Props) {
  const reduce = useReducedMotion();

  // A little lag makes the rings breathe with the voice instead of flickering.
  const smooth = useSpring(level, { stiffness: 320, damping: 22, mass: 0.6 });
  // Never quite at rest: a faint halo even in silence, so the button reads as
  // listening before the first word.
  const ringA = useTransform(smooth, (v) => 1.1 + Math.min(1, v) * 0.8);
  const ringB = useTransform(smooth, (v) => 1.22 + Math.min(1, v) * 1.5);
  const ringOpacity = useTransform(smooth, (v) => 0.2 + Math.min(1, v) * 0.3);

  // Sliding: the hint follows the finger and fades as it nears the line.
  const hintOpacity = useTransform(dragX, [CANCEL_AT, CANCEL_AT * 0.35, 0], [0.15, 0.7, 1]);
  const binScale = useTransform(dragX, [CANCEL_AT, 0], [1.3, 1]);
  const lockLift = useTransform(dragY, [LOCK_AT, 0], [-16, 0]);
  const lockOpacity = useTransform(dragY, [LOCK_AT, 0], [1, 0.75]);
  const holding = mode === 'hold';

  return (
    <div className="composer-row rec-row">
      {holding ? (
        // While held there is nothing to tap here — the bin is where the
        // finger would slide to, so it grows as the finger gets close.
        <motion.span className="clay-round rec-bin" style={{ scale: binScale }} aria-hidden="true">
          <IconTrash />
        </motion.span>
      ) : (
        <motion.button
          className="clay-round rec-bin"
          onClick={onDiscard}
          aria-label="Discard recording"
          initial={reduce ? false : { scale: 0, rotate: -40 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: 'spring', stiffness: 520, damping: 22 }}
          whileTap={{ scale: 0.9 }}
        >
          <IconTrash />
        </motion.button>
      )}

      <motion.div
        className="rec-bar"
        style={{ originX: 1 }}
        initial={reduce ? false : { scaleX: 0.3, opacity: 0 }}
        animate={{ scaleX: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 380, damping: 32 }}
        role="status"
        aria-live="off"
        aria-label={`Recording, ${seconds} seconds`}
      >
        <span className="rec-dot" />
        <span className="rec-time tabular small" aria-hidden="true">
          {digits(seconds).map((d, i, all) => (
            <span key={`${all.length}-${i}`} className="rec-digit">
              <AnimatePresence initial={false} mode="popLayout">
                <motion.span
                  key={d}
                  initial={reduce ? false : { y: '-90%', opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={reduce ? { opacity: 0 } : { y: '90%', opacity: 0 }}
                  transition={{ duration: 0.22, ease: [0.22, 0.9, 0.3, 1] }}
                >
                  {d}
                </motion.span>
              </AnimatePresence>
            </span>
          ))}
        </span>

        {holding ? (
          // The window clips and fades the hint as it slides, so it passes
          // under the timer instead of over it.
          <span className="rec-slide-window grow">
            <motion.span className="rec-slide small" style={{ x: dragX, opacity: hintOpacity }}>
              <span className="rec-slide-chev" aria-hidden="true">‹</span> Slide to cancel
            </motion.span>
          </span>
        ) : transcript ? (
          <span className="small truncate grow rec-transcript">{transcript}</span>
        ) : (
          <span className="rec-live-wave" aria-hidden="true">
            {levels.slice(-40).map((v, i, arr) => (
              <i
                key={levels.length - arr.length + i}
                className={i === arr.length - 1 ? 'fresh' : undefined}
                style={{ height: `${Math.min(100, Math.max(12, v * 140))}%` }}
              />
            ))}
          </span>
        )}
      </motion.div>

      <div className="rec-action">
        {/* The lock sits above the button while holding: slide up to it. */}
        <AnimatePresence>
          {holding && (
            <motion.span
              className="rec-lock"
              style={{ y: lockLift, opacity: lockOpacity }}
              initial={reduce ? { opacity: 0 } : { opacity: 0, y: 14, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.6, transition: { duration: 0.15 } }}
              aria-hidden="true"
            >
              <IconLock size={15} />
              <span className="rec-lock-arrow">⌃</span>
            </motion.span>
          )}
        </AnimatePresence>

        {!reduce && (
          // Grown with the held button, or the button would cover them.
          <motion.span
            className="rec-rings"
            animate={{ scale: holding ? 1.28 : 1 }}
            transition={{ type: 'spring', stiffness: 460, damping: 24 }}
            aria-hidden="true"
          >
            <motion.span className="rec-ring" style={{ scale: ringB, opacity: ringOpacity }} />
            <motion.span className="rec-ring rec-ring-inner" style={{ scale: ringA }} />
          </motion.span>
        )}

        <motion.button
          className="composer-send recording"
          onClick={holding ? undefined : onSend}
          aria-label={holding ? 'Recording — let go to send' : 'Send voice message'}
          animate={{ scale: holding ? 1.28 : 1 }}
          transition={{ type: 'spring', stiffness: 460, damping: 24 }}
          whileTap={holding ? undefined : { scale: 0.92 }}
        >
          <AnimatePresence initial={false} mode="wait">
            <motion.span
              key={holding ? 'mic' : 'send'}
              className="rec-icon"
              initial={reduce ? false : { rotate: -90, scale: 0.4, opacity: 0 }}
              animate={{ rotate: 0, scale: 1, opacity: 1 }}
              exit={reduce ? { opacity: 0 } : { rotate: 90, scale: 0.4, opacity: 0 }}
              transition={{ duration: 0.18 }}
            >
              {holding ? <IconMic size={21} /> : <IconSend size={21} />}
            </motion.span>
          </AnimatePresence>
        </motion.button>
      </div>
    </div>
  );
}

/**
 * The whole recording, squeezed into the bars a voice note is drawn with.
 * The loudest moment of each slice, scaled so the loudest bar fills its
 * height — quiet notes should still have a shape.
 */
export function waveformOf(peaks: number[], bars = 44): number[] {
  if (!peaks.length) return [];
  const out: number[] = [];
  const per = peaks.length / bars;
  for (let b = 0; b < bars; b++) {
    const from = Math.floor(b * per);
    const to = Math.max(from + 1, Math.floor((b + 1) * per));
    let max = 0;
    for (let i = from; i < to && i < peaks.length; i++) max = Math.max(max, peaks[i]);
    out.push(max);
  }
  const top = Math.max(...out) || 1;
  return out.map((v) => Math.max(0.08, Math.round((v / top) * 100) / 100));
}
