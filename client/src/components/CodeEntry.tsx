import { useEffect, useRef, useState } from 'react';

/**
 * One component for both kinds of code, because the server treats them the
 * same: a PIN is its digits, a pattern is the dots it joins ("0,3,6,7"). The
 * caller asks for a kind and gets a string back, and nothing downstream — the
 * sheet, the gate, the API — has to care which was used.
 */
export type LockKind = 'pin' | 'pattern';

interface Props {
  kind: LockKind;
  /** Shown above the pad. */
  title?: string;
  hint?: string;
  error?: string;
  busy?: boolean;
  /** Fires as soon as the code is complete — a PIN at 4-6 digits, a pattern on release. */
  onSubmit: (code: string) => void;
  onCancel?: () => void;
  /** Ask for it twice, to catch a typo before it locks you out. */
  confirm?: boolean;
}

const PIN_MIN = 4;
const PIN_MAX = 6;

export default function CodeEntry({
  kind,
  title,
  hint,
  error,
  busy,
  onSubmit,
  onCancel,
  confirm = false,
}: Props) {
  const [first, setFirst] = useState('');
  const [stage, setStage] = useState<'enter' | 'again'>('enter');
  const [local, setLocal] = useState('');

  useEffect(() => {
    // A new error means the attempt failed; clear the pad so the next try
    // starts from nothing rather than from a half-deleted wrong code.
    if (error) {
      setLocal('');
      setStage('enter');
      setFirst('');
    }
  }, [error]);

  const finish = (code: string) => {
    if (confirm && stage === 'enter') {
      setFirst(code);
      setStage('again');
      setLocal('');
      return;
    }
    if (confirm && stage === 'again' && code !== first) {
      setMismatch(true);
      setStage('enter');
      setFirst('');
      setLocal('');
      return;
    }
    setMismatch(false);
    onSubmit(code);
  };

  const [mismatch, setMismatch] = useState(false);

  const heading =
    title || (confirm ? (stage === 'enter' ? 'Choose a code' : 'Enter it again') : 'Enter your code');

  return (
    <div className="code-entry stack" style={{ alignItems: 'center', gap: 14 }}>
      <div className="stack" style={{ alignItems: 'center', gap: 4 }}>
        <h3 style={{ margin: 0 }}>{heading}</h3>
        {(mismatch || error || hint) && (
          <p className={`small ${mismatch || error ? 'bad' : 'muted'}`} style={{ margin: 0, textAlign: 'center' }}>
            {mismatch ? 'Those did not match. Start again.' : error || hint}
          </p>
        )}
      </div>

      {kind === 'pin' ? (
        <PinPad value={local} onChange={setLocal} onDone={finish} busy={busy} />
      ) : (
        <PatternPad onDone={finish} busy={busy} key={`${stage}-${error}-${mismatch}`} />
      )}

      {onCancel && (
        <button className="clay-btn" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      )}
    </div>
  );
}

/* ── PIN ──────────────────────────────────────────────────────────────────── */

function PinPad({
  value,
  onChange,
  onDone,
  busy,
}: {
  value: string;
  onChange: (v: string) => void;
  onDone: (code: string) => void;
  busy?: boolean;
}) {
  const press = (d: string) => {
    if (busy || value.length >= PIN_MAX) return;
    onChange(value + d);
  };

  /**
   * A physical keyboard is the fastest way in on a laptop, and the on-screen
   * pad is the only way in on a phone. Both, rather than choosing.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (busy) return;
      if (/^[0-9]$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') onChange(value.slice(0, -1));
      else if (e.key === 'Enter' && value.length >= PIN_MIN) onDone(value);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="stack" style={{ alignItems: 'center', gap: 16 }}>
      <div className="pin-dots" aria-hidden>
        {Array.from({ length: PIN_MAX }).map((_, i) => (
          <span key={i} className={`pin-dot${i < value.length ? ' on' : ''}`} />
        ))}
      </div>
      <span className="sr-only" aria-live="polite">
        {value.length} of up to {PIN_MAX} digits entered
      </span>

      <div className="pin-pad">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <button key={d} className="clay-btn pin-key" onClick={() => press(d)} disabled={busy}>
            {d}
          </button>
        ))}
        <button
          className="clay-btn pin-key"
          onClick={() => onChange(value.slice(0, -1))}
          disabled={busy || !value}
          aria-label="Delete"
        >
          ⌫
        </button>
        <button className="clay-btn pin-key" onClick={() => press('0')} disabled={busy}>
          0
        </button>
        <button
          className="slab pin-key"
          onClick={() => onDone(value)}
          disabled={busy || value.length < PIN_MIN}
          aria-label="Confirm"
        >
          ✓
        </button>
      </div>
    </div>
  );
}

/* ── pattern ──────────────────────────────────────────────────────────────── */

const GRID = 3;
const CELL = 74;
const SIZE = CELL * GRID;
const centre = (i: number) => ({
  x: (i % GRID) * CELL + CELL / 2,
  y: Math.floor(i / GRID) * CELL + CELL / 2,
});

function PatternPad({ onDone, busy }: { onDone: (code: string) => void; busy?: boolean }) {
  const [path, setPath] = useState<number[]>([]);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const drawing = useRef(false);
  const box = useRef<HTMLDivElement>(null);

  const dotAt = (clientX: number, clientY: number) => {
    const rect = box.current?.getBoundingClientRect();
    if (!rect) return -1;
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    for (let i = 0; i < GRID * GRID; i += 1) {
      const c = centre(i);
      // A generous radius: fingers are imprecise and a pattern that keeps
      // missing dots is read as broken rather than as fussy.
      if ((x - c.x) ** 2 + (y - c.y) ** 2 < 26 ** 2) return i;
    }
    return -1;
  };

  const move = (clientX: number, clientY: number) => {
    if (!drawing.current) return;
    const rect = box.current?.getBoundingClientRect();
    if (rect) setCursor({ x: clientX - rect.left, y: clientY - rect.top });
    const i = dotAt(clientX, clientY);
    if (i >= 0 && !path.includes(i)) setPath((p) => [...p, i]);
  };

  const end = () => {
    if (!drawing.current) return;
    drawing.current = false;
    setCursor(null);
    if (path.length >= 4) onDone(path.join(','));
    else setPath([]);
  };

  const lines = path.slice(1).map((dot, i) => ({ from: centre(path[i]), to: centre(dot) }));
  const tail = cursor && path.length ? { from: centre(path[path.length - 1]), to: cursor } : null;

  return (
    <div
      ref={box}
      className="pattern-pad"
      style={{ width: SIZE, height: SIZE, touchAction: 'none', opacity: busy ? 0.5 : 1 }}
      onPointerDown={(e) => {
        if (busy) return;
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        drawing.current = true;
        setPath([]);
        move(e.clientX, e.clientY);
      }}
      onPointerMove={(e) => move(e.clientX, e.clientY)}
      onPointerUp={end}
      onPointerLeave={end}
      role="application"
      aria-label="Draw your pattern"
    >
      <svg width={SIZE} height={SIZE} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        {[...lines, ...(tail ? [tail] : [])].map((l, i) => (
          <line
            key={i}
            x1={l.from.x}
            y1={l.from.y}
            x2={l.to.x}
            y2={l.to.y}
            stroke="var(--accent)"
            strokeWidth={5}
            strokeLinecap="round"
            opacity={0.85}
          />
        ))}
      </svg>

      {Array.from({ length: GRID * GRID }).map((_, i) => {
        const c = centre(i);
        const on = path.includes(i);
        return (
          <span
            key={i}
            className={`pattern-dot${on ? ' on' : ''}`}
            style={{ left: c.x, top: c.y }}
            aria-hidden
          />
        );
      })}
    </div>
  );
}
