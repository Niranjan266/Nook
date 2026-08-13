import { useEffect, useRef, useState } from 'react';
import { decode } from 'blurhash';

/**
 * Renders a BlurHash to a canvas behind an image.
 *
 * The hash travels inside the message itself (~30 characters), so the shape and
 * colour of a photo are on screen the instant the message arrives — before a
 * single byte of the actual image has been requested. On a slow connection this
 * is the difference between a chat and a wall of grey rectangles.
 */
export default function Blur({ hash, className }: { hash?: string; className?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [ok, setOk] = useState(false);

  useEffect(() => {
    if (!hash || !canvas.current) return;
    try {
      // 32px is plenty — it's blurred and stretched anyway.
      const pixels = decode(hash, 32, 32);
      const ctx = canvas.current.getContext('2d');
      if (!ctx) return;
      const data = ctx.createImageData(32, 32);
      data.data.set(pixels);
      ctx.putImageData(data, 0, 0);
      setOk(true);
    } catch {
      setOk(false);
    }
  }, [hash]);

  if (!hash) return null;

  return (
    <canvas
      ref={canvas}
      width={32}
      height={32}
      aria-hidden="true"
      className={className}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        opacity: ok ? 1 : 0,
        transition: 'opacity 200ms ease',
      }}
    />
  );
}
