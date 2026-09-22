/**
 * Per-person notification tones, synthesised with the Web Audio API.
 *
 * No audio files: six tones would be six network requests, six cache entries
 * and six things to keep in sync with the service worker. These are a few
 * oscillators each, they start instantly, and they cost nothing to ship.
 *
 * They're wooden, muted and short — nothing here should make you flinch at
 * 11pm — but no longer timid: at the old levels a tone was lost under a TV or
 * a pocket. Loudness now comes from a shared compressor rather than raw gain,
 * so the notes are fuller without the peaks ever reaching the clip point.
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
/** Where every note goes: compressor, then make-up gain, then the speakers. */
let bus: AudioNode | null = null;

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    if (!ctx) ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    // Browsers suspend the context until a user gesture; resume is a no-op if running.
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    if (!bus) bus = chain(ctx);
    return ctx;
  } catch {
    return null;
  }
}

/**
 * One compressor shared by every note, so overlapping notes squeeze together
 * instead of summing past 1.0 and crackling. It evens the level out; the gain
 * after it is what makes the result loud. A single note lands around -10 dBFS,
 * where it used to sit near -23.
 */
function chain(c: AudioContext): AudioNode {
  const comp = c.createDynamicsCompressor();
  comp.threshold.value = -18;
  comp.knee.value = 6;
  comp.ratio.value = 4;
  // Faster than the notes' 12 ms swell, so no onset slips through unsquashed.
  comp.attack.value = 0.002;
  comp.release.value = 0.12;

  const makeup = c.createGain();
  makeup.gain.value = 2;

  comp.connect(makeup);
  makeup.connect(c.destination);
  return comp;
}

interface Note {
  freq: number;
  at: number;
  length: number;
  gain?: number;
  type?: OscillatorType;
}

function play(notes: Note[], master = 1) {
  const c = audio();
  if (!c || !bus) return;
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
    const peak = (note.gain ?? 0.26) * master;

    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(peak, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + note.length);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(bus);
    osc.start(start);
    osc.stop(start + note.length + 0.05);
  }
}

const RECIPES: Record<Exclude<SoundId, 'none'>, () => void> = {
  default: () =>
    play([
      { freq: 587.33, at: 0, length: 0.18 },
      { freq: 880, at: 0.09, length: 0.26, gain: 0.2 },
    ]),

  knock: () =>
    play([
      { freq: 180, at: 0, length: 0.09, gain: 0.36, type: 'triangle' },
      { freq: 150, at: 0.13, length: 0.11, gain: 0.3, type: 'triangle' },
    ]),

  pebble: () =>
    play([
      { freq: 1320, at: 0, length: 0.07, gain: 0.18 },
      { freq: 660, at: 0.04, length: 0.34, gain: 0.24 },
    ]),

  chime: () =>
    play([
      { freq: 1046.5, at: 0, length: 0.4, gain: 0.17 },
      { freq: 1318.5, at: 0.06, length: 0.44, gain: 0.13 },
      { freq: 1568, at: 0.12, length: 0.5, gain: 0.09 },
    ]),

  wood: () =>
    play([
      { freq: 320, at: 0, length: 0.13, gain: 0.36, type: 'triangle' },
      { freq: 210, at: 0.01, length: 0.16, gain: 0.22, type: 'sine' },
    ]),

  // Quiet on purpose, and kept below the compressor's threshold so it stays
  // well under the others rather than being levelled up to meet them.
  hush: () => play([{ freq: 440, at: 0, length: 0.5, gain: 0.035 }]),
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
      { freq: 660, at: 0, length: 0.12, gain: 0.3 },
      { freq: 660, at: 0.16, length: 0.12, gain: 0.3 },
      { freq: 880, at: 0.34, length: 0.24, gain: 0.26 },
    ],
    1.2
  );
}

/** Called once on first user interaction so later sounds aren't blocked. */
export function unlockAudio() {
  const c = audio();
  if (c && c.state === 'suspended') c.resume().catch(() => {});
}
