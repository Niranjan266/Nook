import { motion } from 'framer-motion';
import { springs } from '@/lib/motion';
import { useDesign, type DesignId } from '@/lib/design';

/*
 * The Nook mark: two pebbles leaning together — two people, one nook.
 *
 * Inline rather than <img src="/logo.svg"> so it paints with the first frame
 * (no request, no pop-in) and so the pebbles can animate. The geometry is
 * public/logo.svg's; tools/android-icons.py has the same numbers for every
 * raster copy, so change all three together.
 *
 * The brand colours are fixed, not theme tokens: the mark is the same object
 * in light and dark, the way an app icon is.
 */

const NIGHT = '#0E0D14';
const IRIS = '#8B7CFF';
const VOLT = '#C8F545';
const PEBBLE_IRIS = '#5443D6';
const PEACH = '#FFB36B';
const EMBER = '#C4421D';
const MID_NIGHT = '#0D0E11';

interface Props {
  size?: number;
  /** On its night tile (the app icon). Off: the bare pebbles, eyes in the page colour. */
  tile?: boolean;
  /** The pebbles arrive one after the other — for first-run moments, not chrome. */
  animate?: boolean;
  /** Accessible name. Omit when a visible "Nook" sits next to it. */
  title?: string;
  className?: string;
  style?: React.CSSProperties;
  /** Draw a particular design's mark rather than the one that is live (previews). */
  design?: DesignId;
}

/**
 * Each of the admin's designs has its own mark (see lib/design.ts): the
 * doorway for Calm, the N-shaped bubble for Midnight, the pebbles for Pebble
 * and Midnight Pebble — whose pebbles differ only in colour.
 */
export default function Logo(props: Props) {
  const live = useDesign((s) => s.design);
  const design = props.design ?? live;
  if (design === 'calm') return <ArchMark {...props} />;
  if (design === 'midnight') return <BubbleMark {...props} />;
  return <PebbleMark {...props} front={design === 'pebble' ? PEBBLE_IRIS : IRIS} back={design === 'pebble' ? PEACH : VOLT} />;
}

function Frame({ size = 40, title, className, style, children }: Props & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 48 48"
      width={size}
      height={size}
      className={className}
      style={style}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      {title && <title>{title}</title>}
      {children}
    </svg>
  );
}

const popIn = (animate: boolean | undefined, delay: number) =>
  animate
    ? { initial: { scale: 0, opacity: 0 }, animate: { scale: 1, opacity: 1 }, transition: { ...springs.pop, delay } }
    : {};

/** Calm: a doorway — the nook — drawn in white on an ember tile. */
function ArchMark(props: Props) {
  const { tile = true, animate } = props;
  const stroke = tile ? '#FFFFFF' : EMBER;
  return (
    <Frame {...props}>
      {tile && <motion.rect width="48" height="48" rx="14" fill={EMBER} {...popIn(animate, 0)} />}
      <motion.path
        d="M15 36V22a9 9 0 0118 0v14"
        fill="none"
        stroke={stroke}
        strokeWidth={4}
        strokeLinecap="round"
        initial={animate ? { pathLength: 0 } : false}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.6, delay: 0.15, ease: [0.2, 0.9, 0.3, 1] }}
      />
      <motion.circle cx="24" cy="29" r="2.4" fill={stroke} {...popIn(animate, 0.6)} />
    </Frame>
  );
}

/** Midnight: a speech bubble whose tail and counter make an N. */
function BubbleMark(props: Props) {
  const { tile = true, animate } = props;
  return (
    <Frame {...props}>
      {tile && <rect width="48" height="48" rx="12" fill={MID_NIGHT} />}
      <g transform={tile ? 'translate(24 24) scale(0.8) translate(-24 -25)' : undefined}>
        <motion.path
          d="M8 8h32a4 4 0 014 4v20a4 4 0 01-4 4H20l-9 7v-7H8a4 4 0 01-4-4V12a4 4 0 014-4z"
          fill={VOLT}
          {...popIn(animate, 0.05)}
        />
        <motion.path
          d="M16 29V15l16 14V15"
          fill="none"
          stroke={MID_NIGHT}
          strokeWidth={4}
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={animate ? { pathLength: 0 } : false}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.5, delay: 0.3 }}
        />
      </g>
    </Frame>
  );
}

function PebbleMark({ front, back, ...props }: Props & { front: string; back: string }) {
  const { tile = true, animate } = props;
  const eye = tile ? NIGHT : 'var(--bg)';
  // On the tile the pair is shrunk to leave a margin; bare, it fills the box.
  const pair = tile ? 'translate(24 24) scale(0.82) translate(-24 -25)' : 'translate(24 24) translate(-24 -25)';

  // Each pebble grows from its own middle (Framer's default for SVG), the
  // front one first and then the other leaning in beside it, rather than the
  // pair simply appearing.
  const pop = (delay: number) =>
    animate
      ? {
          initial: { scale: 0, opacity: 0 },
          animate: { scale: 1, opacity: 1 },
          transition: { ...springs.pop, delay },
        }
      : {};

  return (
    <Frame {...props}>
      {tile && <rect width="48" height="48" rx="13" fill={NIGHT} />}
      <g transform={pair}>
        <motion.ellipse cx="31" cy="22" rx="11" ry="13" fill={back} fillOpacity={0.92} {...pop(0.25)} />
        <motion.ellipse cx="19" cy="26" rx="13" ry="15" fill={front} {...pop(0.1)} />
        <motion.g {...pop(0.45)}>
          <circle cx="16" cy="25" r="2" fill={eye} />
          <circle cx="22" cy="25" r="2" fill={eye} />
        </motion.g>
      </g>
    </Frame>
  );
}
