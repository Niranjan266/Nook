/**
 * Room vocabulary.
 *
 * A mood is not a status broadcast to 400 contacts — it's a signal inside one
 * room, visible only to the people in it. That's why the set is small and
 * human: these are the things you'd actually want one person to know.
 */

export const MOODS = [
  { id: '', label: 'Nothing in particular', emoji: '' },
  { id: 'deep-work', label: 'Deep work', emoji: '🪵' },
  { id: 'away', label: 'Away', emoji: '🚶' },
  { id: 'rough-week', label: 'Having a rough week', emoji: '🌧' },
  { id: 'celebrating', label: 'Celebrating', emoji: '🎉' },
  { id: 'travelling', label: 'Travelling', emoji: '🧳' },
  { id: 'resting', label: 'Resting', emoji: '🌙' },
] as const;

export const MOOD_EMOJI: Record<string, string> = Object.fromEntries(
  MOODS.map((m) => [m.id, m.emoji])
);
export const MOOD_LABEL: Record<string, string> = Object.fromEntries(
  MOODS.map((m) => [m.id, m.label])
);

export function daysUntil(iso: string | Date) {
  const target = new Date(iso);
  const start = new Date();
  const days = Math.ceil(
    (new Date(target.getFullYear(), target.getMonth(), target.getDate()).getTime() -
      new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime()) /
      86400_000
  );
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days < 0) return `${Math.abs(days)}d ago`;
  return `${days} days`;
}

/** Minutes past midnight → "22:00", for the quiet-hours and schedule pickers. */
export const toClock = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

export const fromClock = (value: string) => {
  const [h, m] = value.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};

/** Is a given quiet-hours window active right now, in the viewer's own clock? */
export function isQuietNow(start: number, end: number) {
  const now = new Date().getHours() * 60 + new Date().getMinutes();
  return start <= end ? now >= start && now < end : now >= start || now < end;
}
