/**
 * The sticker maker: frame a photo, see it in clay, keep it.
 *
 * Two steps on purpose. Framing wants the real photo moving under your finger
 * at full frame rate; the clay pass takes a noticeable moment on a slow phone,
 * so it runs once when you are done framing rather than on every drag.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { spring } from '@/lib/motion';
import { upload } from '@/lib/api';
import { useStickers } from '@/stores/stickers';
import type { Sticker } from '@/lib/types';
import {
  CAPTION_MAX,
  STICKER_SIZE,
  composeSticker,
  exportSticker,
  loadImage,
  prepareArt,
  warmCaptionFont,
  type StickerShape,
} from '@/lib/sticker';
import { IconClose, IconSticker, IconWarning } from '@/components/Icon';

interface Props {
  open: boolean;
  file: File | null;
  onClose: () => void;
  /** `send` is true when they chose "Save & send". */
  onSaved: (sticker: Sticker, send: boolean) => void;
}

/** The mask covers this share of the stage, leaving a margin to see what is being cut away. */
const MASK = 0.84;
const MAX_ZOOM = 5;

export default function StickerMaker({ open, file, onClose, onSaved }: Props) {
  const add = useStickers((s) => s.add);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [error, setError] = useState('');
  const [step, setStep] = useState<'crop' | 'finish'>('crop');
  const [shape, setShape] = useState<StickerShape>('circle');
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState<'' | 'shaping' | 'saving'>('');
  const [pct, setPct] = useState(0);

  const stageRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState(300);
  const previewRef = useRef<HTMLCanvasElement | null>(null);
  const art = useRef<HTMLCanvasElement | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());

  /* ── a fresh start for each picture ───────────────────────────────────── */

  useEffect(() => {
    if (!open || !file) return;
    let cancelled = false;
    setImg(null);
    setError('');
    setStep('crop');
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    setCaption('');
    setBusy('');
    art.current = null;
    warmCaptionFont();
    loadImage(file)
      .then((i) => !cancelled && setImg(i))
      .catch((e) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [open, file]);

  // The stage is as wide as the sheet allows, so it is measured, not assumed.
  useEffect(() => {
    const el = stageRef.current;
    if (!el || step !== 'crop') return;
    const ro = new ResizeObserver(([e]) => setStage(e.contentRect.width || 300));
    ro.observe(el);
    return () => ro.disconnect();
  }, [open, step, img]);

  /* ── framing geometry ─────────────────────────────────────────────────── */

  const mask = stage * MASK;
  const scale = img ? (mask / Math.min(img.naturalWidth, img.naturalHeight)) * zoom : 1;
  const dispW = img ? img.naturalWidth * scale : 0;
  const dispH = img ? img.naturalHeight * scale : 0;

  // Clamped on read, so zooming out can never leave a gap inside the mask.
  const clampOffset = useCallback(
    (o: { x: number; y: number }) => ({
      x: Math.max(-(dispW - mask) / 2, Math.min((dispW - mask) / 2, o.x)),
      y: Math.max(-(dispH - mask) / 2, Math.min((dispH - mask) / 2, o.y)),
    }),
    [dispW, dispH, mask]
  );
  const off = clampOffset(offset);

  const crop = useMemo(
    () => ({
      x: (dispW / 2 - off.x - mask / 2) / scale,
      y: (dispH / 2 - off.y - mask / 2) / scale,
      size: mask / scale,
    }),
    [dispW, dispH, off.x, off.y, mask, scale]
  );

  const zoomBy = useCallback((factor: number) => setZoom((z) => Math.min(MAX_ZOOM, Math.max(1, z * factor))), []);

  // Wheel needs a non-passive listener to stop the page scrolling underneath.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomBy(Math.exp(-e.deltaY * 0.0015));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomBy, step, img]);

  const onPointerDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const all = [...pointers.current.values()];
    if (all.length === 2) {
      // Pinch: the change in finger spread is the change in zoom.
      const other = all.find((p) => p !== prev)!;
      const before = Math.hypot(prev.x - other.x, prev.y - other.y);
      const after = Math.hypot(e.clientX - other.x, e.clientY - other.y);
      if (before > 0) zoomBy(after / before);
    } else {
      setOffset({ x: off.x + (e.clientX - prev.x), y: off.y + (e.clientY - prev.y) });
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const nudge: Record<string, [number, number]> = {
      ArrowLeft: [10, 0],
      ArrowRight: [-10, 0],
      ArrowUp: [0, 10],
      ArrowDown: [0, -10],
    };
    if (nudge[e.key]) {
      e.preventDefault();
      setOffset({ x: off.x + nudge[e.key][0], y: off.y + nudge[e.key][1] });
    } else if (e.key === '+' || e.key === '=') zoomBy(1.1);
    else if (e.key === '-') zoomBy(1 / 1.1);
  };

  /* ── the clay pass ────────────────────────────────────────────────────── */

  const toFinish = () => {
    if (!img) return;
    setBusy('shaping');
    // A frame to paint "Shaping…" before the main thread goes quiet for it.
    window.setTimeout(() => {
      try {
        art.current = prepareArt(img, crop, shape);
        setStep('finish');
      } catch (e: any) {
        setError(e?.message || 'Could not make that sticker.');
      } finally {
        setBusy('');
      }
    }, 30);
  };

  // Caption changes only redo the cheap half, and not on every keystroke.
  useEffect(() => {
    if (step !== 'finish' || !art.current || !previewRef.current) return;
    const t = window.setTimeout(() => composeSticker(art.current!, caption, previewRef.current!), 90);
    return () => window.clearTimeout(t);
  }, [step, caption]);

  const save = async (send: boolean) => {
    if (!art.current) return;
    setBusy('saving');
    setPct(0);
    try {
      const canvas = composeSticker(art.current, caption);
      const blob = await exportSticker(canvas);
      const ext = blob.type === 'image/webp' ? 'webp' : 'png';
      const { media } = await upload(blob, 'sticker', setPct, `sticker.${ext}`);
      const sticker = await add({ ...media, width: STICKER_SIZE, height: STICKER_SIZE });
      onSaved(sticker, send);
      onClose();
    } catch (e: any) {
      setError(e?.message || 'Could not save that sticker.');
    } finally {
      setBusy('');
    }
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, busy, onClose]);

  // Portalled for the same reason as the snap camera: `.composer` sets
  // backdrop-filter, which would trap a fixed overlay inside it.
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="sticker-maker-scrim"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onPointerDown={(e) => e.target === e.currentTarget && !busy && onClose()}
        >
          <motion.div
            className="sticker-maker"
            role="dialog"
            aria-modal="true"
            aria-label="Make a sticker"
            initial={{ y: 24, scale: 0.97 }}
            animate={{ y: 0, scale: 1 }}
            exit={{ y: 16, scale: 0.98, opacity: 0 }}
            transition={spring}
          >
            <header className="sticker-maker-head">
              <span className="sticker-maker-title">
                <IconSticker size={17} /> {step === 'crop' ? 'Frame your sticker' : 'Your clay sticker'}
              </span>
              <button className="clay-round" onClick={onClose} disabled={!!busy} aria-label="Close">
                <IconClose size={17} />
              </button>
            </header>

            {error ? (
              <div className="sticker-maker-error">
                <IconWarning size={22} />
                <p>{error}</p>
                <button className="slab" onClick={onClose}>
                  Close
                </button>
              </div>
            ) : step === 'crop' ? (
              <>
                <div
                  ref={stageRef}
                  className={`sticker-stage ${shape}`}
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerCancel={onPointerUp}
                  onKeyDown={onKeyDown}
                  tabIndex={0}
                  role="application"
                  aria-label="Drag to move the photo, pinch or scroll to zoom. Arrow keys move it, plus and minus zoom."
                >
                  {img ? (
                    <img
                      src={img.src}
                      alt=""
                      draggable={false}
                      style={{
                        width: dispW,
                        height: dispH,
                        transform: `translate(calc(-50% + ${off.x}px), calc(-50% + ${off.y}px))`,
                      }}
                    />
                  ) : (
                    <p className="sticker-stage-wait">Opening the photo…</p>
                  )}
                  <span className="sticker-mask" style={{ width: mask, height: mask }} aria-hidden="true" />
                </div>

                <div className="sticker-maker-controls">
                  <div className="sticker-shapes" role="radiogroup" aria-label="Shape">
                    {(['circle', 'squircle'] as const).map((s) => (
                      <button
                        key={s}
                        role="radio"
                        aria-checked={shape === s}
                        className={`sticker-shape-pick${shape === s ? ' on' : ''}`}
                        onClick={() => setShape(s)}
                      >
                        <span className={`sticker-shape-swatch ${s}`} aria-hidden="true" />
                        {s === 'circle' ? 'Circle' : 'Rounded'}
                      </button>
                    ))}
                  </div>
                  <label className="sticker-zoom">
                    <span className="tiny muted">Zoom</span>
                    <input
                      type="range"
                      min={1}
                      max={MAX_ZOOM}
                      step={0.01}
                      value={zoom}
                      onChange={(e) => setZoom(Number(e.target.value))}
                      aria-label="Zoom"
                    />
                  </label>
                  <button className="slab" onClick={toFinish} disabled={!img || !!busy}>
                    {busy === 'shaping' ? 'Shaping the clay…' : 'Next'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="sticker-preview">
                  <canvas
                    ref={(el) => {
                      previewRef.current = el;
                      // Draw straight away on mount; the effect handles changes.
                      if (el && art.current && !el.dataset.drawn) {
                        el.dataset.drawn = '1';
                        composeSticker(art.current, caption, el);
                      }
                    }}
                    width={STICKER_SIZE}
                    height={STICKER_SIZE}
                    role="img"
                    aria-label={caption ? `Sticker preview, captioned “${caption}”` : 'Sticker preview'}
                  />
                </div>

                <div className="sticker-maker-controls">
                  <input
                    className="groove sticker-caption"
                    value={caption}
                    maxLength={CAPTION_MAX}
                    onChange={(e) => setCaption(e.target.value)}
                    placeholder="Add a caption (optional)"
                    aria-label="Caption"
                  />
                  {busy === 'saving' && (
                    <span className="upload-track" aria-hidden="true">
                      <i style={{ transform: `scaleX(${pct / 100})` }} />
                    </span>
                  )}
                  <div className="sticker-maker-row">
                    <button className="slab slab-quiet" onClick={() => setStep('crop')} disabled={!!busy}>
                      Back
                    </button>
                    <button className="clay-btn grow" onClick={() => save(false)} disabled={!!busy}>
                      {busy === 'saving' ? 'Saving…' : 'Save'}
                    </button>
                    <button className="slab grow" onClick={() => save(true)} disabled={!!busy}>
                      Save &amp; send
                    </button>
                  </div>
                </div>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
