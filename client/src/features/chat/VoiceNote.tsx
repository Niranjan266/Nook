import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/stores/auth';
import { IconPlay, IconPause } from '@/components/Icon';
import { duration } from '@/lib/format';

interface Props {
  url: string;
  waveform?: number[];
  length?: number;
  transcript?: string;
  messageId: string;
}

const FALLBACK = Array.from({ length: 38 }, (_, i) => 0.35 + Math.abs(Math.sin(i * 1.7)) * 0.6);

/** Where you got to in each voice note, so a long one can be resumed. */
const POSITIONS_KEY = 'nook.voice.positions';
const readPositions = (): Record<string, number> => {
  try {
    return JSON.parse(localStorage.getItem(POSITIONS_KEY) || '{}');
  } catch {
    return {};
  }
};
const savePosition = (id: string, seconds: number) => {
  try {
    const all = readPositions();
    if (seconds < 2) delete all[id];
    else all[id] = seconds;
    localStorage.setItem(POSITIONS_KEY, JSON.stringify(all));
  } catch {
    /* storage full or blocked — resuming is a nicety, not a requirement */
  }
};

export default function VoiceNote({ url, waveform, length = 0, transcript, messageId }: Props) {
  const audio = useRef<HTMLAudioElement>(null);
  const settings = useAuth((s) => s.me?.settings);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [total, setTotal] = useState(length);
  const [speed, setSpeed] = useState(settings?.voiceSpeed ?? 1);
  const [showTranscript, setShowTranscript] = useState(false);

  const bars = waveform?.length ? waveform : FALLBACK;
  const skipSilence = settings?.skipSilence ?? false;

  useEffect(() => {
    const el = audio.current;
    if (!el) return;

    const onTime = () => {
      if (!el.duration) return;
      setProgress(el.currentTime / el.duration);
      savePosition(messageId, el.currentTime);

      /**
       * Skip-silence, done cheaply: the waveform we recorded is a per-slice
       * amplitude, so we already know which parts are quiet. If the current
       * slice is near-silent, jump to the next one that isn't. No decoding,
       * no AudioWorklet, works on a phone.
       */
      if (skipSilence && bars.length > 8) {
        const i = Math.floor((el.currentTime / el.duration) * bars.length);
        if (bars[i] !== undefined && bars[i] < 0.12) {
          let next = i;
          while (next < bars.length && bars[next] < 0.12) next++;
          if (next > i && next < bars.length) {
            el.currentTime = (next / bars.length) * el.duration;
          }
        }
      }
    };

    const onMeta = () => {
      if (Number.isFinite(el.duration)) setTotal(el.duration);
      const saved = readPositions()[messageId];
      if (saved && saved < el.duration - 1) el.currentTime = saved;
    };

    const onEnd = () => {
      setPlaying(false);
      setProgress(0);
      savePosition(messageId, 0);
    };

    el.addEventListener('timeupdate', onTime);
    el.addEventListener('loadedmetadata', onMeta);
    el.addEventListener('ended', onEnd);
    return () => {
      el.removeEventListener('timeupdate', onTime);
      el.removeEventListener('loadedmetadata', onMeta);
      el.removeEventListener('ended', onEnd);
    };
  }, [messageId, skipSilence, bars]);

  useEffect(() => {
    if (audio.current) audio.current.playbackRate = speed;
  }, [speed]);

  const toggle = () => {
    const el = audio.current;
    if (!el) return;
    if (playing) {
      el.pause();
      setPlaying(false);
    } else {
      el.playbackRate = speed;
      el.play().then(() => setPlaying(true)).catch(() => {});
    }
  };

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = audio.current;
    if (!el || !el.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    el.currentTime = ((e.clientX - rect.left) / rect.width) * el.duration;
  };

  const cycleSpeed = () => setSpeed((s) => (s === 1 ? 1.5 : s === 1.5 ? 2 : 1));

  return (
    <div className="stack" style={{ gap: 4 }}>
      <div className="voice">
        <audio ref={audio} src={url} preload="metadata" />
        <button
          className="clay-round"
          style={{ width: 38, height: 38 }}
          onClick={toggle}
          aria-label={playing ? 'Pause voice message' : 'Play voice message'}
        >
          {playing ? <IconPause size={17} /> : <IconPlay size={17} />}
        </button>

        <div
          className="wave"
          onClick={seek}
          role="slider"
          aria-label="Seek"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
          tabIndex={0}
        >
          {bars.map((h, i) => (
            <i
              key={i}
              className={i / bars.length <= progress ? 'played' : ''}
              style={{ height: `${Math.max(12, Math.min(100, h * 100))}%` }}
            />
          ))}
        </div>

        <button
          className="voice-speed"
          onClick={cycleSpeed}
          aria-label={`Playback speed ${speed}x`}
          title="Playback speed"
        >
          {speed}×
        </button>

        <span className="voice-time">{duration(playing || progress ? progress * total : total)}</span>
      </div>

      {/* Transcribed on the sender's device — the audio never went anywhere to
          be read. Makes a voice note searchable and readable in a meeting. */}
      {transcript && (
        <button className="voice-transcript" onClick={() => setShowTranscript((v) => !v)}>
          {showTranscript ? transcript : 'Show transcript'}
        </button>
      )}
    </div>
  );
}
