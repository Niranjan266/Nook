/**
 * Per-person notification tones, synthesised with the Web Audio API.
 *
 * No audio files: six tones would be six network requests, six cache entries
 * and six things to keep in sync with the service worker. These are a few
 * oscillators each, they start instantly, and they cost nothing to ship.
 *
 * They're deliberately soft — wooden, muted, short. Nothing here should make
 * you flinch at 11pm.
 */

export type SoundId = 'default' | 'knock' | 'pebble' | 'chime' | 'wood' | 'hush' | 'none';

export const SOUNDS: { id: SoundId; label: string; description: string }[] = [
  { id: 'default', label: 'Nook', description: 'Two soft notes, rising' },
  { id: 'knock', label: 'Knock', description: 'Someone at the door' },
  { id: 'pebble', label: 'Pebble', description: 'A drop into water' },
  { id: 'chime', label: 'Chime', description: 'Clear and bright' },
  { id: 'wood', label: 'Wood', description: 'A dull, warm tap' },
  { id: 'hush', label: 'Hush', description: 'Barely there' },
  { id: 'none', label: 'Silent', description: 'No sound at all' },
];

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    if (!ctx) ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    // Browsers suspend the context until a user gesture; resume is a no-op if running.
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  } catch {
    return null;
  }
}

interface Note {
  freq: number;
  at: number;
  length: number;
  gain?: number;
  type?: OscillatorType;
}

function play(notes: Note[], master = 0.5) {
  const c = audio();
  if (!c) return;
  const now = c.currentTime;

  for (const note of notes) {
    const osc = c.createOscillator();
    const gain = c.createGain();
    // A gentle low-pass takes the glassy edge off a raw oscillator.
    const filter = c.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 2400;

    osc.type = note.type || 'sine';
    osc.frequency.value = note.freq;

    const start = now + note.at;
    const peak = (note.gain ?? 0.14) * master;

    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(peak, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + note.length);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(c.destination);
    osc.start(start);
    osc.stop(start + note.length + 0.05);
  }
}

const RECIPES: Record<Exclude<SoundId, 'none'>, () => void> = {
  default: () =>
    play([
      { freq: 587.33, at: 0, length: 0.18 },
      { freq: 880, at: 0.09, length: 0.26, gain: 0.11 },
    ]),

  knock: () =>
    play([
      { freq: 180, at: 0, length: 0.09, gain: 0.2, type: 'triangle' },
      { freq: 150, at: 0.13, length: 0.11, gain: 0.16, type: 'triangle' },
    ]),

  pebble: () =>
    play([
      { freq: 1320, at: 0, length: 0.07, gain: 0.1 },
      { freq: 660, at: 0.04, length: 0.34, gain: 0.13 },
    ]),

  chime: () =>
    play([
      { freq: 1046.5, at: 0, length: 0.4, gain: 0.09 },
      { freq: 1318.5, at: 0.06, length: 0.44, gain: 0.07 },
      { freq: 1568, at: 0.12, length: 0.5, gain: 0.05 },
    ]),

  wood: () =>
    play([
      { freq: 320, at: 0, length: 0.13, gain: 0.2, type: 'triangle' },
      { freq: 210, at: 0.01, length: 0.16, gain: 0.12, type: 'sine' },
    ]),

  hush: () => play([{ freq: 440, at: 0, length: 0.5, gain: 0.045 }]),
};

/** Play a tone. Silent ids and unknown ids are a no-op, never an error. */
export function playSound(id: SoundId = 'default') {
  if (id === 'none') return;
  RECIPES[id as Exclude<SoundId, 'none'>]?.();
}

/** Slightly louder for previewing in settings, so you can actually judge it. */
export function previewSound(id: SoundId) {
  if (id === 'none') return;
  const recipe = RECIPES[id as Exclude<SoundId, 'none'>];
  if (recipe) recipe();
}

/** A distinct, more insistent pattern — only used for a nudge. */
export function playNudge() {
  play(
    [
      { freq: 660, at: 0, length: 0.12, gain: 0.16 },
      { freq: 660, at: 0.16, length: 0.12, gain: 0.16 },
      { freq: 880, at: 0.34, length: 0.24, gain: 0.14 },
    ],
    0.8
  );
}

/** Called once on first user interaction so later sounds aren't blocked. */
export function unlockAudio() {
  const c = audio();
  if (c && c.state === 'suspended') c.resume().catch(() => {});
}
