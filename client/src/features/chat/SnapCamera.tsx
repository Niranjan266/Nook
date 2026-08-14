/**
 * The snap camera.
 *
 * Until now "Snap" opened the OS file picker with `capture="environment"`,
 * which hands you off to the system camera app and gives you back a JPEG. That
 * works, but it is somebody else's camera: no timer choice before the shot, no
 * retake without leaving and coming back, and on desktop it is just a file
 * dialog. This is a real capture surface — live preview, shutter, flip,
 * retake, and the disappear timer chosen before you send.
 *
 * The permission and teardown handling deliberately mirrors `stores/call.ts`,
 * because that code has already been through the awkward cases: a refused
 * prompt, a camera held by another app, and tracks that keep the recording
 * light on if you forget to stop them.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { spring } from '@/lib/motion';
import { IconClose, IconCamera, IconFire, IconWarning } from '@/components/Icon';

/** Seconds the recipient gets. 0 means they close it themselves. */
export const SNAP_TIMERS = [3, 5, 10, 0] as const;
export type SnapTimer = (typeof SNAP_TIMERS)[number];

const timerLabel = (s: SnapTimer) => (s === 0 ? '∞' : `${s}s`);

type Facing = 'user' | 'environment';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Called with the captured still and the chosen timer. */
  onSend: (file: File, seconds: SnapTimer) => void | Promise<void>;
  /** Used when getUserMedia is unavailable or refused. */
  onFallback: () => void;
  /**
   * A picture chosen from the library instead of taken here. Skips straight to
   * the review screen, so a snap from the gallery gets the same timer choice
   * and the same "Send snap" step as one from the camera — the two paths
   * should differ only in where the image came from.
   */
  initialFile?: File | null;
}

export default function SnapCamera({ open, onClose, onSend, onFallback, initialFile }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [facing, setFacing] = useState<Facing>('environment');
  const [seconds, setSeconds] = useState<SnapTimer>(5);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [shot, setShot] = useState<{ url: string; file: File } | null>(null);
  const [sending, setSending] = useState(false);
  /** More than one camera to switch between? Hide the flip button if not. */
  const [canFlip, setCanFlip] = useState(false);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setReady(false);
  }, []);

  /* A picture handed in from the library goes straight to review; the camera
     is never started, so no permission is asked for and no light comes on. */
  useEffect(() => {
    if (!open || !initialFile) return;
    const url = URL.createObjectURL(initialFile);
    setShot({ url, file: initialFile });
    return () => URL.revokeObjectURL(url);
  }, [open, initialFile]);

  /* ── stream lifecycle ─────────────────────────────────────────────────── */

  useEffect(() => {
    if (!open || shot || initialFile) return;
    let cancelled = false;

    (async () => {
      setError('');
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('unsupported');
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 1280 } },
        });

        // The sheet can be closed while the permission prompt is still up.
        // Without this the tracks leak and the camera light stays on.
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        setReady(true);

        try {
          const devices = await navigator.mediaDevices.enumerateDevices();
          if (!cancelled) setCanFlip(devices.filter((d) => d.kind === 'videoinput').length > 1);
        } catch {
          /* label enumeration is a nicety, not a requirement */
        }
      } catch (err: any) {
        if (cancelled) return;
        setError(
          err?.name === 'NotAllowedError'
            ? 'refused'
            : err?.name === 'NotFoundError' || err?.name === 'OverconstrainedError'
              ? 'none'
              : 'busy'
        );
      }
    })();

    return () => {
      cancelled = true;
      stop();
    };
  }, [open, facing, shot, stop]);

  /* Release the camera the moment the sheet closes, and clean up the preview. */
  useEffect(() => {
    if (open) return;
    stop();
    setShot((s) => {
      if (s) URL.revokeObjectURL(s.url);
      return null;
    });
    setSending(false);
  }, [open, stop]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  /* ── capture ──────────────────────────────────────────────────────────── */

  async function capture() {
    const video = videoRef.current;
    if (!video || !ready) return;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // The preview is mirrored for the front camera because that is what people
    // expect of a mirror. The saved image must be mirrored to match, or the
    // photo you get back is not the one you framed.
    if (facing === 'user') {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const blob: Blob | null = await new Promise((done) => canvas.toBlob(done, 'image/jpeg', 0.9));
    if (!blob) return;

    const file = new File([blob], `snap-${Date.now()}.jpg`, { type: 'image/jpeg' });
    stop();
    setShot({ url: URL.createObjectURL(blob), file });
  }

  function retake() {
    // A library picture has no camera to go back to — close instead, and let
    // them pick again, rather than starting a camera they never asked for.
    if (initialFile) return onClose();
    setShot((s) => {
      if (s) URL.revokeObjectURL(s.url);
      return null;
    });
  }

  async function send() {
    if (!shot || sending) return;
    setSending(true);
    try {
      await onSend(shot.file, seconds);
      onClose();
    } finally {
      setSending(false);
    }
  }

  const errorCopy: Record<string, { title: string; body: string }> = {
    refused: {
      title: 'Camera permission was refused',
      body: 'Nook needs camera access to take a snap. Allow it in your browser’s site settings, or pick a photo instead.',
    },
    none: { title: 'No camera found', body: 'This device has no camera Nook can reach. You can send a photo instead.' },
    busy: {
      title: 'The camera is busy',
      body: 'Another app or tab is using it. Close that, then try again — or send a photo instead.',
    },
    unsupported: {
      title: 'Camera not available here',
      body: 'This browser will not give Nook a live camera. Your device camera app still works.',
    },
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="snap-cam"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          role="dialog"
          aria-modal="true"
          aria-label="Take a snap"
        >
          <header className="snap-cam-head">
            <span className="snap-cam-title">
              <IconFire size={16} /> Snap
            </span>
            <button className="clay-round" onClick={onClose} aria-label="Close camera">
              <IconClose />
            </button>
          </header>

          <motion.div className="snap-cam-stage" initial={{ scale: 0.96 }} animate={{ scale: 1 }} transition={spring}>
            {error ? (
              <div className="snap-cam-error">
                <IconWarning size={26} />
                <h3>{errorCopy[error].title}</h3>
                <p>{errorCopy[error].body}</p>
                <button
                  className="slab"
                  onClick={() => {
                    onClose();
                    onFallback();
                  }}
                >
                  Pick a photo instead
                </button>
              </div>
            ) : shot ? (
              <img className="snap-cam-shot" src={shot.url} alt="Your snap, before sending" />
            ) : (
              <>
                <video
                  ref={videoRef}
                  className={`snap-cam-feed${facing === 'user' ? ' mirrored' : ''}`}
                  autoPlay
                  playsInline
                  muted
                />
                {!ready && <p className="snap-cam-waking">Waking the camera…</p>}
              </>
            )}
          </motion.div>

          {!error && (
            <div className="snap-cam-controls">
              <div className="snap-timers" role="group" aria-label="How long they can look">
                {SNAP_TIMERS.map((s) => (
                  <button
                    key={s}
                    className={`snap-timer-pick${seconds === s ? ' on' : ''}`}
                    onClick={() => setSeconds(s)}
                    aria-pressed={seconds === s}
                    aria-label={s === 0 ? 'They close it themselves' : `${s} seconds`}
                  >
                    {timerLabel(s)}
                  </button>
                ))}
              </div>

              <p className="snap-cam-hint">
                {seconds === 0
                  ? 'They close it themselves. Once.'
                  : `They get ${seconds} seconds. Once.`}
              </p>

              {shot ? (
                <div className="snap-cam-row">
                  <button className="slab slab-quiet" onClick={retake} disabled={sending}>
                    {initialFile ? 'Cancel' : 'Retake'}
                  </button>
                  <button className="slab grow" onClick={send} disabled={sending}>
                    {sending ? 'Sending…' : 'Send snap'}
                  </button>
                </div>
              ) : (
                <div className="snap-cam-row">
                  {canFlip ? (
                    <button
                      className="clay-round"
                      onClick={() => setFacing((f) => (f === 'user' ? 'environment' : 'user'))}
                      aria-label="Switch camera"
                      disabled={!ready}
                    >
                      <IconCamera size={18} />
                    </button>
                  ) : (
                    <span className="snap-cam-spacer" aria-hidden="true" />
                  )}

                  <button
                    className="snap-shutter"
                    onClick={capture}
                    disabled={!ready}
                    aria-label="Take the photo"
                  />

                  <span className="snap-cam-spacer" aria-hidden="true" />
                </div>
              )}
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
