import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useChat } from '@/stores/chat';
import { useAuth } from '@/stores/auth';
import { useUi } from '@/stores/ui';
import { getSocket } from '@/lib/socket';
import { upload, get } from '@/lib/api';
import { popIn, spring } from '@/lib/motion';
import { duration } from '@/lib/format';
import { compressImage } from '@/lib/color';
import { transcribe, canTranscribe } from '@/lib/transcribe';
import SnapCamera from './SnapCamera';
import type { PublicQuietHours } from '@/lib/types';
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
} from '@/components/Icon';

const EMOJI = [
  '😀','😂','🥲','😊','😍','😘','😎','🤔','🙃','😴','🥹','😭','😤','😱','🤯','🤗',
  '👍','👎','👏','🙏','💪','🤝','👋','✌️','❤️','🧡','💚','💙','💜','🔥','✨','🎉',
  '☕','🍕','🌧','🌙','⭐','🚗','🏠','📎',
];

interface Props {
  conversationId: string;
}

export default function Composer({ conversationId }: Props) {
  const { send, replyTo, setReplyTo, editing, setEditing, edit, conversations } = useChat();
  const enterToSend = useAuth((s) => s.me?.settings.enterToSend ?? true);
  const { toast } = useUi();

  const conversation = conversations[conversationId];
  const partner = conversation?.partner;
  const [partnerQuiet, setPartnerQuiet] = useState<PublicQuietHours | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);

  const [text, setText] = useState('');
  const [attachOpen, setAttachOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [snapMode, setSnapMode] = useState(false);
  const [camOpen, setCamOpen] = useState(false);
  const [snapFile, setSnapFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState<{ name: string; pct: number } | null>(null);

  const [recording, setRecording] = useState(false);
  const [recSeconds, setRecSeconds] = useState(0);
  const [levels, setLevels] = useState<number[]>([]);

  const textarea = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const snapPickInput = useRef<HTMLInputElement>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const recTimer = useRef<number>();
  const analyser = useRef<{ ctx: AudioContext; node: AnalyserNode; raf: number } | null>(null);
  const transcriber = useRef<ReturnType<typeof transcribe>>(null);
  const typingSent = useRef(0);
  const [liveTranscript, setLiveTranscript] = useState('');

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
      if (body && body !== editing.body) await edit(editing, body);
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

  /* ── voice notes ──────────────────────────────────────────────────────── */

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';
      const rec = new MediaRecorder(stream, { mimeType: mime });
      chunks.current = [];
      rec.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      rec.start(120);
      recorder.current = rec;
      setRecording(true);
      setRecSeconds(0);
      setLevels([]);

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
      const tick = () => {
        node.getByteTimeDomainData(data);
        let peak = 0;
        for (const v of data) peak = Math.max(peak, Math.abs(v - 128) / 128);
        setLevels((l) => [...l.slice(-45), Math.max(0.08, peak)]);
        analyser.current!.raf = requestAnimationFrame(tick);
      };
      analyser.current = { ctx, node, raf: requestAnimationFrame(tick) };
    } catch {
      toast('Microphone permission was refused.', true);
    }
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
    const wave = levels.slice(-44);

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
      const blob = new Blob(chunks.current, { type: 'audio/webm' });
      setUploading({ name: 'Voice message', pct: 0 });
      try {
        const { media } = await upload(blob, 'voice', (pct) => setUploading({ name: 'Voice message', pct }), 'voice.webm');
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

      {recording ? (
        <div className="composer-row">
          <button className="clay-round" onClick={() => stopRecording(true)} aria-label="Discard recording">
            <IconTrash />
          </button>
          <div className="rec-bar">
            <span className="rec-dot" />
            <span className="tabular small">{duration(recSeconds)}</span>
            {liveTranscript ? (
              <span className="small truncate grow" style={{ opacity: 0.8, fontStyle: 'italic' }}>
                {liveTranscript}
              </span>
            ) : (
              <span className="rec-live-wave">
                {levels.slice(-40).map((v, i) => (
                  <i key={i} style={{ height: `${Math.min(100, v * 130)}%` }} />
                ))}
              </span>
            )}
          </div>
          <button className="composer-send recording" onClick={() => stopRecording(false)} aria-label="Send voice message">
            <IconSend size={21} />
          </button>
        </div>
      ) : (
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
              </motion.div>
            )}

            {emojiOpen && (
              <motion.div
                className="attach-menu"
                style={{ left: 52, width: 300, minWidth: 0 }}
                variants={popIn}
                initial="hidden"
                animate="show"
                exit="exit"
              >
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 2 }}>
                  {EMOJI.map((e) => (
                    <button
                      key={e}
                      style={{ fontSize: 20, padding: 6, borderRadius: 10 }}
                      onClick={() => {
                        setText((t) => t + e);
                        textarea.current?.focus();
                      }}
                    >
                      {e}
                    </button>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="composer-input">
            <textarea
              ref={textarea}
              rows={1}
              className="groove"
              placeholder={editing ? 'Edit your message' : 'Say something'}
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
              className={`clay-round${emojiOpen ? ' on' : ''}`}
              style={{ width: 38, height: 38 }}
              onClick={() => {
                setEmojiOpen((v) => !v);
                setAttachOpen(false);
              }}
              aria-label="Emoji"
            >
              <IconEmoji size={19} />
            </button>
          </div>

          {text.trim() && !editing && (
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
              className="composer-send"
              onClick={startRecording}
              aria-label="Record a voice message"
              title="Hold a thought — record a voice message"
            >
              <IconMic size={21} />
            </button>
          )}
        </div>
      )}

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
    </div>
  );
}
