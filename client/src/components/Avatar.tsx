import { initials, accentFor } from '@/lib/format';

const TONE: Record<string, string> = {
  terracotta: 'var(--terracotta)',
  moss: 'var(--moss)',
  ochre: 'var(--ochre)',
  'clay-blue': 'var(--clay-blue)',
  rust: 'var(--rust)',
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
  const fg = accent === 'ochre' ? '#241D10' : '#FDF8F2';

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
      {src ? (
        <img src={src} alt="" style={square ? { borderRadius: Math.max(10, size * 0.28) } : undefined} />
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
