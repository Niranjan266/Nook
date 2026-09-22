import { initials, accentFor } from '@/lib/format';
import { safeUrl } from '@/lib/config';

/*
 * Keyed by the stored accent ids; the colours are the fixed Midnight Pebble
 * hues (the same in both modes), all light enough to carry night-ink initials.
 */
const TONE: Record<string, string> = {
  terracotta: 'var(--volt)',
  moss: 'var(--mint)',
  ochre: 'var(--peach)',
  'clay-blue': 'var(--sky)',
  rust: 'var(--rose)',
};

interface Props {
  name: string;
  src?: string;
  id?: string;
  accent?: string;
  size?: number;
  online?: boolean;
  showDot?: boolean;
  square?: boolean;
}

export default function Avatar({
  name,
  src,
  id,
  accent,
  size = 44,
  online,
  showDot = false,
  square = false,
}: Props) {
  const tone = TONE[accent || accentFor(id || name)] || TONE.terracotta;
  // Every tone is a light hue, so the initials are always night-ink.
  const fg = 'var(--night)';
  // Every avatar in the app comes through here, so this is the one place to
  // resolve relative uploads and refuse unsafe schemes.
  const url = safeUrl(src);

  return (
    <span
      className="avatar"
      style={{
        width: size,
        height: size,
        fontSize: Math.max(11, size * 0.36),
        borderRadius: square ? Math.max(10, size * 0.28) : undefined,
      }}
    >
      {url ? (
        <img src={url} alt="" style={square ? { borderRadius: Math.max(10, size * 0.28) } : undefined} />
      ) : (
        <span
          className="initials"
          style={{
            background: tone,
            color: fg,
            borderRadius: square ? Math.max(10, size * 0.28) : undefined,
          }}
        >
          {initials(name)}
        </span>
      )}
      {showDot && online && <i className="dot" aria-label="online" />}
    </span>
  );
}
