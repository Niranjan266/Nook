import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence, useMotionValue, animate } from 'framer-motion';
import { useChat } from '@/stores/chat';
import { useFriends } from '@/stores/friends';
import { useAuth } from '@/stores/auth';
import { useUi } from '@/stores/ui';
import { getSocket } from '@/lib/socket';
import { upload, get } from '@/lib/api';
import { popIn, spring } from '@/lib/motion';
import { duration } from '@/lib/format';
import { compressImage } from '@/lib/color';
import { transcribe, canTranscribe } from '@/lib/transcribe';
import { lazyChunk, prefetch, whenIdle } from '@/lib/idle';
import { useStickers } from '@/stores/stickers';
import type { PublicQuietHours, Conversation as Convo, Sticker } from '@/lib/types';
import { encryptFile } from '@/lib/e2ee/media';
import { useSecretPlace } from '@/lib/e2ee/useSecret';
import {
  IconSend,
  IconPlus,
  IconImage,
  IconFile,
  IconCamera,
  IconMic,
  IconClose,
  IconFire,
  IconEmoji,
  IconTrash,
  IconSchedule,
  IconClock,
  IconMoon2,
  IconSun,
  IconLock,
  IconSticker,
  IconPoll,
  IconChecklist,
} from '@/components/Icon';
import PollBuilder, { type BuilderKind, type BuiltPoll, type BuiltList } from './PollBuilder';
import RecordingBar, { waveformOf, recRowVariants, CANCEL_AT, LOCK_AT, type RecEnd } from './RecordingBar';
import { tap } from '@/lib/native';

interface Props {
  conversationId: string;
}

/** Voice-note formats in order of preference; the first the browser can record wins. */
const VOICE_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/ogg;codecs=opus'];

/**
 * The emoji grid and the snap camera are the two heaviest things in the
 * composer and neither is on screen until asked for, so they live in their
 * own chunks — warmed on idle, so the first tap still opens instantly.
 */
const loadEmoji = () => import('./EmojiPicker');
const loadCamera = () => import('./SnapCamera');
const loadTray = () => import('./StickerTray');
const loadMaker = () => import('./StickerMaker');
const EmojiPicker = lazyChunk(loadEmoji);
const SnapCamera = lazyChunk(loadCamera);
const StickerTray = lazyChunk(loadTray);
// The maker is only warmed when the tray opens: most sessions never make one.
const StickerMaker = lazyChunk(loadMaker);

export default function Composer({ conversationId }: Props) {
  // Picked field by field. Destructuring the whole store re-rendered this —
  // the biggest component in the chat — on every typing blip and presence
  // change in any conversation.
  const send = useChat((s) => s.send);
  const replyTo = useChat((s) => s.replyTo);
  const setReplyTo = useChat((s) => s.setReplyTo);
  const editing = useChat((s) => s.editing);
  const setEditing = useChat((s) => s.setEditing);
  const edit = useChat((s) => s.edit);
  const conversation = useChat((s) => s.conversations[conversationId]);
  const enterToSend = useAuth((s) => s.me?.settings.enterToSend ?? true);
  const toast = useUi((s) => s.toast);
  const partner = conversation?.partner;
  const meId = useAuth((s) => s.me?.id || '');
  // In a secret chat every attachment is encrypted before it is uploaded, and
  // snaps and send-later are off: neither has a secret version yet.
  const place = useSecretPlace(conversation, meId);
  const isSecret = place.secret;
  const [partnerQuiet, setPartnerQuiet] = useState<PublicQuietHours | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);

  const [text, setText] = useState('');
  const [attachOpen, setAttachOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [emojiAnchor, setEmojiAnchor] = useState<{ left: number; bottom: number } | null>(null);
  const [snapMode, setSnapMode] = useState(false);
  const [camOpen, setCamOpen] = useState(false);
  const [snapFile, setSnapFile] = useState<File | null>(null);
  const [builder, setBuilder] = useState<BuilderKind | null>(null);
  // Stable, because the sheet re-arms its keyboard handling whenever this changes.
  const closeBuilder = useCallback(() => setBuilder(null), []);
  const [uploading, setUploading] = useState<{ name: string; pct: number } | null>(null);

  // Mounted from the first open onward, so closing still plays the exit.
  const [emojiUsed, setEmojiUsed] = useState(false);
  const [camUsed, setCamUsed] = useState(false);
  if (emojiOpen && !emojiUsed) setEmojiUsed(true);
  if (camOpen && !camUsed) setCamUsed(true);
  useEffect(() => whenIdle(() => prefetch(loadEmoji, loadCamera, loadTray), 4000), []);

  const [trayOpen, setTrayOpen] = useState(false);
  const [trayUsed, setTrayUsed] = useState(false);
  const [trayAnchor, setTrayAnchor] = useState<{ left: number; bottom: number } | null>(null);
  const [makerFile, setMakerFile] = useState<File | null>(null);
  const [makerUsed, setMakerUsed] = useState(false);
  if (trayOpen && !trayUsed) setTrayUsed(true);
  if (makerFile && !makerUsed) setMakerUsed(true);
  useEffect(() => {
    if (trayOpen) prefetch(loadMaker);
  }, [trayOpen]);

  const [recording, setRecording] = useState(false);
  const [recSeconds, setRecSeconds] = useState(0);
  const [levels, setLevels] = useState<number[]>([]);
  /** 'hold' while a finger is on the mic; 'locked' once it is hands-free. */
  const [recMode, setRecMode] = useState<'hold' | 'locked'>('locked');
  /** Why the recording row is leaving, read by its exit animation. */
  const [recEnd, setRecEnd] = useState<RecEnd>('send');
  const level = useMotionValue(0);
  const dragX = useMotionValue(0);
  const dragY = useMotionValue(0);
  /** Every peak of the recording, for the waveform the note is saved with. */
  const peaks = useRef<number[]>([]);

  const textarea = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const snapPickInput = useRef<HTMLInputElement>(null);
  const stickerPickInput = useRef<HTMLInputElement>(null);
  const emojiButton = useRef<HTMLButtonElement>(null);
  const stickerButton = useRef<HTMLButtonElement>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const recTimer = useRef<number>();
  const analyser = useRef<{ ctx: AudioContext; node: AnalyserNode; raf: number } | null>(null);
  const transcriber = useRef<ReturnType<typeof transcribe>>(null);
  const typingSent = useRef(0);
  const [liveTranscript, setLiveTranscript] = useState('');

  /**
   * Leaving the chat mid-recording used to leave the microphone open — the
   * red dot stayed on, the timer and meter kept running against an unmounted
   * component, and the AudioContext leaked. Tear all of it down, sending
   * nothing: a voice note should never go out because someone navigated away.
   */
  useEffect(
    () => () => {
      endGesture.current?.();
      window.clearInterval(recTimer.current);
      if (analyser.current) {
        cancelAnimationFrame(analyser.current.raf);
        analyser.current.ctx.close().catch(() => {});
        analyser.current = null;
      }
      transcriber.current?.cancel();
      transcriber.current = null;
      const rec = recorder.current;
      recorder.current = null;
      if (rec) {
        rec.onstop = null;
        if (rec.state !== 'inactive') rec.stop();
        rec.stream.getTracks().forEach((t) => t.stop());
      }
    },
    []
  );

  useEffect(() => {
    setText(editing ? editing.body : '');
    if (editing) textarea.current?.focus();
  }, [editing]);

  useEffect(() => {
    const el = textarea.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
  }, [text]);

  useEffect(() => {
    setText('');
    setSnapMode(false);
    setScheduleOpen(false);
  }, [conversationId]);

  /**
   * Quiet hours are only a contract if you can see them *before* you send.
   * That's the entire feature — so we fetch the other person's window when the
   * conversation opens, not when the message fails to notify them.
   */
  useEffect(() => {
    if (!partner?.id) return setPartnerQuiet(null);
    get<{ user: { quietHours: PublicQuietHours | null } }>(`/users/${partner.id}`)
      .then((r) => setPartnerQuiet(r.user.quietHours))
      .catch(() => setPartnerQuiet(null));
  }, [partner?.id]);

  const pingTyping = () => {
    const now = Date.now();
    if (now - typingSent.current > 2600) {
      typingSent.current = now;
      getSocket()?.emit('typing:start', { conversationId });
    }
  };

  async function submit(scheduledFor?: string) {
    const body = text.trim();
    if (editing) {
      // A poll that has picked up votes since the edit began is refused by
      // the server; say so instead of letting the rejection vanish.
      try {
        if (body && body !== editing.body) await edit(editing, body);
      } catch (err: any) {
        toast(err?.message || 'Could not save that edit.', true);
        return;
      }
      setEditing(null);
      setText('');
      return;
    }
    if (!body) return;
    setText('');
    getSocket()?.emit('typing:stop', { conversationId });
    try {
      await send({ conversationId, body, replyTo: replyTo?.id || null, scheduledFor });
      if (scheduledFor) toast(`Scheduled for ${new Date(scheduledFor).toLocaleString()}`);
    } catch (err: any) {
      // Slow mode and blocks both land here with a readable reason.
      toast(err?.message || 'Could not send that.', true);
      setText(body);
    }
  }

  /** A finished poll or list from the builder sheet. Replies carry over like text. */
  async function sendBuilt(built: BuiltPoll | BuiltList) {
    try {
      await send({ conversationId, ...built, replyTo: replyTo?.id || null });
    } catch (err: any) {
      toast(err?.message || 'Could not send that.', true);
    }
  }

  /** Send it when they're awake, rather than at 2am. */
  const scheduleFor = (when: Date) => {
    setScheduleOpen(false);
    submit(when.toISOString());
  };

  const nextMorning = () => {
    const d = new Date();
    d.setDate(d.getDate() + (d.getHours() >= 9 ? 1 : 0));
    d.setHours(9, 0, 0, 0);
    return d;
  };

  /** If they're in quiet hours, offer the exact moment they come out of them. */
  const whenTheyWake = () => {
    if (!partnerQuiet) return nextMorning();
    const d = new Date();
    const end = partnerQuiet.end;
    d.setHours(Math.floor(end / 60), end % 60, 0, 0);
    if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
    return d;
  };

  /** The server can't measure a file it just streams to disk — the browser can. */
  function measure(file: File): Promise<{ width?: number; height?: number; duration?: number }> {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const done = (v: any) => {
        URL.revokeObjectURL(url);
        resolve(v);
      };
      if (file.type.startsWith('image/')) {
        const img = new Image();
        img.onload = () => done({ width: img.naturalWidth, height: img.naturalHeight });
        img.onerror = () => done({});
        img.src = url;
      } else if (file.type.startsWith('video/')) {
        const v = document.createElement('video');
        v.preload = 'metadata';
        v.onloadedmetadata = () =>
          done({ width: v.videoWidth, height: v.videoHeight, duration: Math.round(v.duration) });
        v.onerror = () => done({});
        v.src = url;
      } else done({});
    });
  }

  async function sendFile(original: File, asSnap = false, viewSeconds = 10) {
    // A 12 MB phone photo should not travel as 12 MB.
    const file = await compressImage(original);
    const isImage = file.type.startsWith('image/');
    const isVideo = file.type.startsWith('video/');
    const type = asSnap ? 'snap' : isImage ? 'image' : isVideo ? 'video' : file.type.startsWith('audio/') ? 'audio' : 'file';

    setUploading({ name: file.name, pct: 0 });
    try {
      if (isSecret) {
        // Measured before encrypting — afterwards it is just bytes. Only the
        // ciphertext is uploaded, under a name that says nothing.
        const [sealed, dims] = await Promise.all([encryptFile(file), measure(file)]);
        const { media } = await upload(sealed.blob, 'message', (pct) => setUploading({ name: file.name, pct }), 'encrypted.bin');
        await send({
          conversationId,
          type: type === 'snap' ? 'image' : type,
          media: { url: media.url, key: sealed.key, iv: sealed.iv, mime: file.type, name: file.name, size: file.size, ...dims },
          body: '',
          replyTo: replyTo?.id || null,
        });
        return;
      }
      const [{ media }, dims] = await Promise.all([
        upload(file, 'message', (pct) => setUploading({ name: file.name, pct })),
        measure(file),
      ]);
      await send({
        conversationId,
        type,
        media: { ...media, ...dims },
        body: '',
        viewOnce: asSnap,
        ...(asSnap ? { viewSeconds } : {}),
        replyTo: replyTo?.id || null,
      });
    } catch (err: any) {
      toast(err?.message || 'Upload failed.', true);
    } finally {
      setUploading(null);
      setSnapMode(false);
    }
  }

  /**
   * No publicId on purpose: one sticker file backs the tray and every chat it
   * was sent to, and a file id on the message is what unsend deletes.
   */
  async function sendSticker(sticker: Sticker) {
    setTrayOpen(false);
    useStickers.getState().use(sticker.id);
    try {
      await send({
        conversationId,
        type: 'sticker',
        body: '',
        media: {
          url: sticker.url,
          thumbUrl: sticker.url,
          mime: sticker.url.endsWith('.png') ? 'image/png' : 'image/webp',
          width: sticker.width,
          height: sticker.height,
        },
        replyTo: replyTo?.id || null,
      });
    } catch (err: any) {
      toast(err?.message || 'Could not send that sticker.', true);
    }
  }

  const openTray = () => {
    const box = stickerButton.current?.getBoundingClientRect();
    if (box) {
      setTrayAnchor({
        left: Math.min(box.left - 40, window.innerWidth - 388),
        bottom: window.innerHeight - box.top + 10,
      });
    }
    setTrayOpen((v) => !v);
    setEmojiOpen(false);
    setAttachOpen(false);
  };

  /* ── voice notes ──────────────────────────────────────────────────────── */

  async function startRecording(): Promise<boolean> {
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Safari records no webm at all, and asking for it throws — which is
      // why voice notes failed on every iPhone. mp4/AAC is what it does have.
      const mime = VOICE_TYPES.find((t) => MediaRecorder.isTypeSupported?.(t));
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunks.current = [];
      rec.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      rec.start(120);
      recorder.current = rec;
      setRecording(true);
      setRecSeconds(0);
      setLevels([]);
      peaks.current = [];

      recTimer.current = window.setInterval(() => setRecSeconds((s) => s + 1), 1000);

      // Transcribe while recording, on this device. Purely additive: if it
      // isn't available or produces nothing, the voice note is unaffected.
      transcriber.current = transcribe((partial) => setLiveTranscript(partial));

      // live level meter → doubles as the stored waveform
      const ctx = new AudioContext();
      const src = ctx.createMediaStreamSource(stream);
      const node = ctx.createAnalyser();
      node.fftSize = 512;
      src.connect(node);
      const data = new Uint8Array(node.frequencyBinCount);
      let frame = 0;
      const tick = () => {
        node.getByteTimeDomainData(data);
        let peak = 0;
        for (const v of data) peak = Math.max(peak, Math.abs(v - 128) / 128);
        const v = Math.max(0.08, peak);
        // Every frame moves the rings (a style write); every fourth adds a
        // bar (a render). Sixty renders a second was the composer's whole budget.
        level.set(v);
        peaks.current.push(v);
        if (++frame % 4 === 0) setLevels((l) => [...l.slice(-47), v]);
        analyser.current!.raf = requestAnimationFrame(tick);
      };
      analyser.current = { ctx, node, raf: requestAnimationFrame(tick) };
      return true;
    } catch (err: any) {
      // Permission may have been granted and something later failed; either
      // way the mic must not stay open behind a toast saying it was refused.
      stream?.getTracks().forEach((t) => t.stop());
      window.clearInterval(recTimer.current);
      transcriber.current?.cancel();
      transcriber.current = null;
      if (recorder.current?.state === 'recording') recorder.current.stop();
      recorder.current = null;
      setRecording(false);
      toast(
        err?.name === 'NotAllowedError' ? 'Microphone permission was refused.' : 'Could not start recording.',
        true
      );
    }
    return false;
  }

  /**
   * Hold to record, let go to send; slide left to cancel, up to lock.
   *
   * Listened for on the window, not the button: the mic button is replaced by
   * the recording row the moment recording starts, and a listener on the
   * element that was pressed would go with it, leaving the finger nowhere to
   * be let go. A quick tap still means what it always did — start, and keep
   * going hands-free — so nobody who learned the old way is caught out.
   */
  const endGesture = useRef<(() => void) | null>(null);
  /**
   * The gesture's listeners are made at the press and outlive that render.
   * Calling stopRecording from their closure used the press-time state — a
   * timer at 0:00 — so every held note was thrown away as too short. They call
   * the latest one through this instead.
   */
  const stopLatest = useRef<(discard?: boolean) => void>(() => {});
  function onMicDown(e: React.PointerEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    endGesture.current?.();
    const g = { x: e.clientX, y: e.clientY, at: Date.now(), done: false };
    dragX.set(0);
    dragY.set(0);
    setRecMode('hold');
    tap();

    const finish = () => {
      if (g.done) return;
      g.done = true;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', lost);
      endGesture.current = null;
      animate(dragX, 0, { type: 'spring', stiffness: 500, damping: 34 });
      animate(dragY, 0, { type: 'spring', stiffness: 500, damping: 34 });
    };
    const move = (ev: PointerEvent) => {
      if (g.done || !recorder.current) return; // still waiting on the permission prompt
      const dx = Math.min(0, ev.clientX - g.x);
      const dy = Math.min(0, ev.clientY - g.y);
      // One direction at a time: a drag is a cancel or a lock, never both.
      if (Math.abs(dx) >= Math.abs(dy)) {
        dragX.set(dx);
        dragY.set(0);
      } else {
        dragY.set(dy);
        dragX.set(0);
      }
      if (dx < CANCEL_AT) {
        finish();
        tap();
        stopLatest.current(true);
      } else if (dy < LOCK_AT) {
        finish();
        tap();
        setRecMode('locked');
      }
    };
    const up = () => {
      if (g.done) return;
      finish();
      // A tap, or a release before the mic was even granted: hands-free.
      if (Date.now() - g.at < 350 || !recorder.current) setRecMode('locked');
      else stopLatest.current(false);
    };
    // The system took the touch (a call, a scroll): keep what was recorded.
    const lost = () => {
      if (g.done) return;
      finish();
      setRecMode('locked');
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', lost);
    endGesture.current = finish;
    startRecording().then((ok) => {
      if (!ok) finish();
    });
  }

  function stopRecording(discard = false) {
    const rec = recorder.current;
    window.clearInterval(recTimer.current);
    if (analyser.current) {
      cancelAnimationFrame(analyser.current.raf);
      analyser.current.ctx.close().catch(() => {});
      analyser.current = null;
    }
    if (!rec) return setRecording(false);

    const seconds = recSeconds;
    // The whole note, not the last second of it: slicing the live meter kept
    // only its tail, so a minute-long message was drawn from its final breath.
    const wave = waveformOf(peaks.current);
    peaks.current = [];
    setRecEnd(discard ? 'discard' : 'send');
    level.set(0);

    const pendingTranscript = transcriber.current
      ? discard
        ? (transcriber.current.cancel(), Promise.resolve(''))
        : transcriber.current.stop()
      : Promise.resolve('');
    transcriber.current = null;

    rec.onstop = async () => {
      rec.stream.getTracks().forEach((t) => t.stop());
      setRecording(false);
      setLiveTranscript('');
      if (discard || seconds < 1) return;

      const transcript = await pendingTranscript;
      // Label the file with what was actually recorded, not what we hoped for.
      const type = (rec.mimeType || 'audio/webm').split(';')[0];
      const blob = new Blob(chunks.current, { type });
      const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
      setUploading({ name: 'Voice message', pct: 0 });
      try {
        if (isSecret) {
          const sealed = await encryptFile(blob);
          const { media } = await upload(sealed.blob, 'voice', (pct) => setUploading({ name: 'Voice message', pct }), 'encrypted.bin');
          await send({
            conversationId,
            type: 'voice',
            media: { url: media.url, key: sealed.key, iv: sealed.iv, mime: type, size: blob.size, duration: seconds, waveform: wave },
            // Inside the ciphertext with everything else; the server never sees it.
            transcript,
            replyTo: replyTo?.id || null,
          });
          return;
        }
        const { media } = await upload(blob, 'voice', (pct) => setUploading({ name: 'Voice message', pct }), `voice.${ext}`);
        await send({
          conversationId,
          type: 'voice',
          media: { ...media, duration: seconds, waveform: wave },
          transcript,
          replyTo: replyTo?.id || null,
        });
      } catch {
        toast('Could not send that voice message.', true);
      } finally {
        setUploading(null);
      }
    };
    rec.stop();
    recorder.current = null;
  }
  stopLatest.current = stopRecording;

  /**
   * A chat you may not write in yet gets a panel instead of a text box.
   *
   * Showing a working-looking composer that bounces every message would be the
   * cruellest version of this feature: you type, you send, nothing arrives,
   * and the reason is a sentence in a toast. Replacing the input says what is
   * true and — more usefully — puts the one action that changes it right there.
   */
  if (conversation && conversation.canMessage === false) {
    return <LockedComposer conversation={conversation} />;
  }

  /**
   * A secret chat opened on a device it is not bound to. There is nothing this
   * device could encrypt with, so there is no text box pretending otherwise.
   */
  if (isSecret && place.ready && !place.here) {
    return (
      <div className="composer">
        <div className="locked-composer clay secret-elsewhere">
          <span className="clay-round" style={{ width: 38, height: 38, flex: 'none', background: 'var(--clay-sunk)', boxShadow: 'none' }}>
            <IconLock size={17} />
          </span>
          <div className="grow stack" style={{ gap: 2, minWidth: 0 }}>
            <span className="list-row-label">This secret chat is on another device</span>
            <span className="list-row-sub">Its keys never leave that device, so it can only be read and written there.</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="composer">
      {/* The contract, shown before you send rather than after. */}
      <AnimatePresence>
        {partnerQuiet?.quietNow && !editing && (
          <motion.div
            className="quiet-warning"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={spring}
          >
            <IconMoon2 size={18} style={{ flex: 'none' }} />
            <span className="grow small">
              It's quiet hours for {partner?.displayName?.split(' ')[0]} ({partnerQuiet.window}). They
              won't be notified — the message still arrives.
            </span>
            <button className="slab slab-sm slab-quiet" onClick={() => scheduleFor(whenTheyWake())}>
              Send at {String(Math.floor(partnerQuiet.end / 60)).padStart(2, '0')}:
              {String(partnerQuiet.end % 60).padStart(2, '0')}
            </button>
          </motion.div>
        )}

        {conversation?.slowMode > 0 && (
          <motion.div
            className="quiet-warning"
            style={{ background: 'color-mix(in srgb, var(--moss) 16%, var(--clay-surface))' }}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
          >
            <IconClock size={17} style={{ flex: 'none' }} />
            <span className="grow small">
              Slow mode: one message every {conversation.slowMode < 60
                ? `${conversation.slowMode}s`
                : `${Math.round(conversation.slowMode / 60)} min`}{' '}
              per person.
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {(replyTo || editing) && (
          <motion.div
            className="composer-reply"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={spring}
          >
            <span className="grow stack" style={{ minWidth: 0 }}>
              <span className="tiny" style={{ fontWeight: 700, color: 'var(--accent-deep)' }}>
                {editing ? 'Editing' : `Replying to ${replyTo?.sender?.displayName || 'them'}`}
              </span>
              <span className="small truncate muted">{(editing || replyTo)?.body || (editing || replyTo)?.type}</span>
            </span>
            <button
              className="clay-round"
              style={{ width: 32, height: 32 }}
              onClick={() => {
                setReplyTo(null);
                setEditing(null);
              }}
              aria-label="Cancel"
            >
              <IconClose size={16} />
            </button>
          </motion.div>
        )}

        {uploading && (
          <motion.div
            className="composer-reply"
            style={{ borderLeftColor: 'var(--moss)' }}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
          >
            <span className="grow stack">
              <span className="tiny" style={{ fontWeight: 700 }}>
                Uploading {uploading.name}
              </span>
              <span
                className="rule"
                style={{
                  background: `linear-gradient(90deg, var(--moss) ${uploading.pct}%, var(--clay-sunk) ${uploading.pct}%)`,
                }}
              />
            </span>
            <span className="tabular small">{uploading.pct}%</span>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence mode="popLayout" initial={false} custom={recEnd}>
      {recording ? (
        <motion.div key="rec" custom={recEnd} variants={recRowVariants} initial="initial" animate="enter" exit="exit">
          <RecordingBar
            seconds={recSeconds}
            levels={levels}
            level={level}
            mode={recMode}
            dragX={dragX}
            dragY={dragY}
            transcript={liveTranscript}
            onDiscard={() => stopRecording(true)}
            onSend={() => stopRecording(false)}
          />
        </motion.div>
      ) : (
        <motion.div key="type" initial={{ opacity: 0 }} animate={{ opacity: 1, transition: { duration: 0.16 } }} exit={{ opacity: 0, transition: { duration: 0.08 } }}>
        <div className="composer-row" style={{ position: 'relative' }}>
          <button
            className={`clay-round${attachOpen ? ' on' : ''}`}
            onClick={() => {
              setAttachOpen((v) => !v);
              setEmojiOpen(false);
            }}
            aria-label="Attach"
            aria-expanded={attachOpen}
          >
            <motion.span animate={{ rotate: attachOpen ? 45 : 0 }} transition={spring} style={{ display: 'grid' }}>
              <IconPlus />
            </motion.span>
          </button>

          <AnimatePresence>
            {attachOpen && (
              <motion.div className="attach-menu" variants={popIn} initial="hidden" animate="show" exit="exit">
                <button
                  className="list-row"
                  onClick={() => {
                    imageInput.current?.click();
                    setAttachOpen(false);
                  }}
                >
                  <IconImage size={18} />
                  <span className="grow">
                    <span className="list-row-label">Photo or video</span>
                  </span>
                </button>
                {/* Snap can come from the camera or the library. Offering both
                    matters because "take a photo now" is not always possible —
                    a laptop with no webcam, a refused permission, or a picture
                    you already have. */}
                {!isSecret && (
                <>
                <button
                  className="list-row"
                  onClick={() => {
                    setSnapMode(true);
                    setSnapFile(null);
                    setCamOpen(true);
                    setAttachOpen(false);
                  }}
                >
                  <IconFire size={18} />
                  <span className="grow">
                    <span className="list-row-label">Snap — take a photo</span>
                    <span className="list-row-sub">Seen once, then gone</span>
                  </span>
                </button>
                <button
                  className="list-row"
                  onClick={() => {
                    snapPickInput.current?.click();
                    setAttachOpen(false);
                  }}
                >
                  <IconImage size={18} />
                  <span className="grow">
                    <span className="list-row-label">Snap — choose a photo</span>
                    <span className="list-row-sub">From your library, still seen once</span>
                  </span>
                </button>
                </>
                )}
                <button
                  className="list-row"
                  onClick={() => {
                    cameraInput.current?.click();
                    setAttachOpen(false);
                  }}
                >
                  <IconCamera size={18} />
                  <span className="grow">
                    <span className="list-row-label">Camera</span>
                  </span>
                </button>
                <button
                  className="list-row"
                  onClick={() => {
                    fileInput.current?.click();
                    setAttachOpen(false);
                  }}
                >
                  <IconFile size={18} />
                  <span className="grow">
                    <span className="list-row-label">Document</span>
                  </span>
                </button>
                <button
                  className="list-row"
                  onClick={() => {
                    setBuilder('poll');
                    setAttachOpen(false);
                  }}
                >
                  <IconPoll size={18} />
                  <span className="grow">
                    <span className="list-row-label">Poll</span>
                    <span className="list-row-sub">Ask everyone to pick</span>
                  </span>
                </button>
                <button
                  className="list-row"
                  onClick={() => {
                    setBuilder('list');
                    setAttachOpen(false);
                  }}
                >
                  <IconChecklist size={18} />
                  <span className="grow">
                    <span className="list-row-label">Shared list</span>
                    <span className="list-row-sub">Anyone can add and tick things off</span>
                  </span>
                </button>
              </motion.div>
            )}

          </AnimatePresence>

          <div className="composer-input">
            <textarea
              ref={textarea}
              rows={1}
              className="groove"
              placeholder={editing ? 'Edit your message' : isSecret ? 'Secret message' : 'Say something'}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                pingTyping();
              }}
              onBlur={() => getSocket()?.emit('typing:stop', { conversationId })}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && enterToSend) {
                  e.preventDefault();
                  submit();
                }
                if (e.key === 'Escape' && editing) setEditing(null);
              }}
              aria-label="Message"
            />
            <button
              ref={emojiButton}
              className={`clay-round${emojiOpen ? ' on' : ''}`}
              style={{ width: 38, height: 38 }}
              onClick={() => {
                // Measured at open time, not on mount: the composer grows as
                // the textarea does, so a position captured earlier would put
                // the panel in the wrong place after a two-line message.
                const box = emojiButton.current?.getBoundingClientRect();
                if (box) {
                  setEmojiAnchor({
                    left: Math.min(box.left, window.innerWidth - 388),
                    bottom: window.innerHeight - box.top + 10,
                  });
                }
                setEmojiOpen((v) => !v);
                setAttachOpen(false);
                setTrayOpen(false);
              }}
              aria-label="Emoji"
              aria-expanded={emojiOpen}
            >
              <IconEmoji size={19} />
            </button>
            {/* Only while the box is empty: a sticker is sent instead of words,
                and on a 360px phone the textarea needs that width back. */}
            {!text.trim() && !editing && (
              <button
                ref={stickerButton}
                data-sticker-toggle
                className={`clay-round${trayOpen ? ' on' : ''}`}
                style={{ width: 38, height: 38 }}
                onClick={openTray}
                aria-label="Stickers"
                aria-expanded={trayOpen}
              >
                <IconSticker size={19} />
              </button>
            )}
          </div>

          {text.trim() && !editing && !isSecret && (
            <div style={{ position: 'relative' }}>
              <button
                className={`clay-round${scheduleOpen ? ' on' : ''}`}
                onClick={() => setScheduleOpen((v) => !v)}
                aria-label="Send later"
                title="Send later"
              >
                <IconSchedule size={19} />
              </button>
              <AnimatePresence>
                {scheduleOpen && (
                  <motion.div
                    className="attach-menu"
                    style={{ right: 0, left: 'auto' }}
                    variants={popIn}
                    initial="hidden"
                    animate="show"
                    exit="exit"
                  >
                    <span className="eyebrow" style={{ padding: '4px 8px' }}>
                      Send later
                    </span>
                    <button className="list-row" onClick={() => scheduleFor(new Date(Date.now() + 3600_000))}>
                      <IconClock size={17} />
                      <span className="grow">
                        <span className="list-row-label">In an hour</span>
                      </span>
                    </button>
                    <button className="list-row" onClick={() => scheduleFor(nextMorning())}>
                      <IconSun size={17} />
                      <span className="grow">
                        <span className="list-row-label">Tomorrow at 9am</span>
                      </span>
                    </button>
                    {partnerQuiet && (
                      <button className="list-row" onClick={() => scheduleFor(whenTheyWake())}>
                        <IconMoon2 size={17} />
                        <span className="grow">
                          <span className="list-row-label">When they're up</span>
                          <span className="list-row-sub">End of their quiet hours</span>
                        </span>
                      </button>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

          {text.trim() || editing ? (
            <button
              className="composer-send"
              onClick={() => submit()}
              aria-label={editing ? 'Save edit' : 'Send'}
            >
              <IconSend size={21} />
            </button>
          ) : (
            <button
              className="composer-send mic-hold"
              onPointerDown={onMicDown}
              // Keyboard and switch access have no "hold": a click with no
              // pointer behind it starts a hands-free recording.
              onClick={(e) => {
                if (e.detail !== 0) return;
                setRecMode('locked');
                startRecording();
              }}
              onContextMenu={(e) => e.preventDefault()}
              aria-label="Record a voice message"
              title="Hold to record — slide left to cancel, up to lock"
            >
              <IconMic size={21} />
            </button>
          )}
        </div>
        </motion.div>
      )}
      </AnimatePresence>

      <input
        ref={imageInput}
        type="file"
        accept="image/*,video/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) sendFile(f);
          e.target.value = '';
        }}
      />
      <input
        ref={cameraInput}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) sendFile(f, snapMode);
          e.target.value = '';
        }}
      />
      <input
        ref={fileInput}
        type="file"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) sendFile(f);
          e.target.value = '';
        }}
      />

      <input
        ref={snapPickInput}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) {
            // Straight into the same review screen the camera uses, so the
            // timer choice and the send step are identical either way.
            setSnapFile(f);
            setSnapMode(true);
            setCamOpen(true);
          }
          e.target.value = '';
        }}
      />

      {emojiUsed && (
        <Suspense fallback={null}>
      <EmojiPicker
        open={emojiOpen}
        anchor={emojiAnchor}
        onClose={() => setEmojiOpen(false)}
        onPick={(e) => {
          setText((t) => t + e);
          // Deliberately stays open: choosing emoji is nearly always plural,
          // and a picker that closes after one turns "🎉🎉🎉" into three trips.
          textarea.current?.focus();
        }}
      />
        </Suspense>
      )}

      <input
        ref={stickerPickInput}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) setMakerFile(f);
          e.target.value = '';
        }}
      />

      {trayUsed && (
        <Suspense fallback={null}>
          <StickerTray
            open={trayOpen}
            anchor={trayAnchor}
            onClose={() => setTrayOpen(false)}
            onPick={sendSticker}
            onMake={() => {
              setTrayOpen(false);
              stickerPickInput.current?.click();
            }}
          />
        </Suspense>
      )}

      {makerUsed && (
        <Suspense fallback={null}>
          <StickerMaker
            open={Boolean(makerFile)}
            file={makerFile}
            onClose={() => setMakerFile(null)}
            onSaved={(sticker, andSend) => {
              if (andSend) sendSticker(sticker);
              else toast('Sticker saved');
            }}
          />
        </Suspense>
      )}

      <PollBuilder kind={builder} onClose={closeBuilder} onSend={sendBuilt} />

      {camUsed && (
        <Suspense fallback={null}>
      <SnapCamera
        open={camOpen}
        initialFile={snapFile}
        onClose={() => {
          setCamOpen(false);
          setSnapMode(false);
          setSnapFile(null);
        }}
        onSend={(file, seconds) => sendFile(file, true, seconds)}
        // Where a live camera isn't available — permission refused, no device,
        // a browser that won't hand one over — fall back to the OS capture
        // that Snap used before. Better a photo than a dead end.
        onFallback={() => {
          setSnapMode(true);
          cameraInput.current?.click();
        }}
      />
        </Suspense>
      )}
    </div>
  );
}

/**
 * What you see in a direct chat before the other person has agreed to talk.
 *
 * Four states, and each one gets the single action that moves it along:
 * they asked you (accept or decline), you asked them (wait, or take it back),
 * nobody has asked (ask), or they turned you down — which, deliberately, looks
 * identical to still waiting. Telling someone they were declined invites a
 * second attempt or an argument, and gives an unwanted stranger a signal.
 */
function LockedComposer({ conversation }: { conversation: Convo }) {
  const partner = conversation.partner;
  const toast = useUi((s) => s.toast);
  const { incoming, outgoing, send, accept, decline, cancel } = useFriends();
  const [busy, setBusy] = useState(false);

  if (!partner) return null;

  const theyAsked = incoming.some((r) => r.user.id === partner.id);
  const youAsked = outgoing.some((r) => r.user.id === partner.id);
  const firstName = partner.displayName?.split(' ')[0] || 'they';

  const run = async (fn: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    try {
      await fn();
      if (done) toast(done);
    } catch (e: any) {
      toast(e?.message || 'That did not work.', true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="composer">
      <div className="locked-composer clay">
        <span className="clay-round" style={{ width: 38, height: 38, flex: 'none', background: 'var(--clay-sunk)', boxShadow: 'none' }}>
          <IconLock size={17} />
        </span>

        <div className="grow stack" style={{ gap: 2, minWidth: 0 }}>
          <span className="list-row-label">
            {theyAsked
              ? `${firstName} wants to chat`
              : youAsked
                ? `Waiting for ${firstName}`
                : `You're not connected yet`}
          </span>
          <span className="list-row-sub">
            {theyAsked
              ? 'Accept and you can both start writing.'
              : youAsked
                ? 'They can accept whenever they see it.'
                : `Send a request — ${firstName} decides.`}
          </span>
        </div>

        <div className="row" style={{ gap: 6, flex: 'none' }}>
          {theyAsked ? (
            <>
              <button
                className="clay-btn"
                disabled={busy}
                onClick={() => run(() => decline(partner.id), 'Declined')}
              >
                Decline
              </button>
              <button
                className="slab"
                disabled={busy}
                onClick={() => run(() => accept(partner.id), `You and ${firstName} can chat now`)}
              >
                Accept
              </button>
            </>
          ) : youAsked ? (
            <button
              className="clay-btn"
              disabled={busy}
              onClick={() => run(() => cancel(partner.id), 'Request taken back')}
            >
              Cancel request
            </button>
          ) : (
            <button
              className="slab"
              disabled={busy}
              onClick={() => run(() => send(partner.id), 'Request sent')}
            >
              Add friend
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
