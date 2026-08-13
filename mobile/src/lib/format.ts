const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const time = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const weekday = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
const dayMonth = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });
const fullDate = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'long', year: 'numeric' });

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

export const clock = (iso: string | Date) => time.format(new Date(iso));

export function stamp(iso: string | Date) {
  const d = new Date(iso);
  const days = Math.round((startOfDay(new Date()) - startOfDay(d)) / DAY);
  if (days === 0) return time.format(d);
  if (days === 1) return 'Yesterday';
  if (days < 7) return weekday.format(d);
  return dayMonth.format(d);
}

export function dayLabel(iso: string | Date) {
  const d = new Date(iso);
  const days = Math.round((startOfDay(new Date()) - startOfDay(d)) / DAY);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return new Intl.DateTimeFormat(undefined, { weekday: 'long' }).format(d);
  return fullDate.format(d);
}

export const sameDay = (a: string | Date, b: string | Date) =>
  startOfDay(new Date(a)) === startOfDay(new Date(b));

export function lastSeenLabel(iso?: string | null) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 2 * MIN) return 'just now';
  if (diff < HOUR) return `${Math.round(diff / MIN)}m ago`;
  if (diff < DAY) return `${Math.round(diff / HOUR)}h ago`;
  const days = Math.round(diff / DAY);
  if (days === 1) return `yesterday at ${time.format(new Date(iso))}`;
  if (days < 7) return `${days} days ago`;
  return dayMonth.format(new Date(iso));
}

export function duration(seconds: number) {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

export function bytes(n = 0) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export const previewOf = (m: {
  type: string;
  body: string;
  media?: { name?: string } | null;
  call?: { kind: string } | null;
  deletedForAll?: boolean;
}) => {
  if (m.deletedForAll) return 'This message was unsent';
  switch (m.type) {
    case 'image':
      return 'Photo';
    case 'video':
      return 'Video';
    case 'voice':
      return 'Voice message';
    case 'audio':
      return 'Audio';
    case 'file':
      return m.media?.name || 'File';
    case 'snap':
      return 'Snap';
    case 'call':
      return m.call?.kind === 'video' ? 'Video call' : 'Voice call';
    default:
      return m.body;
  }
};

export const MOOD_EMOJI: Record<string, string> = {
  'deep-work': '🪵',
  away: '🚶',
  'rough-week': '🌧',
  celebrating: '🎉',
  travelling: '🧳',
  resting: '🌙',
};

export const MOOD_LABEL: Record<string, string> = {
  'deep-work': 'Deep work',
  away: 'Away',
  'rough-week': 'Having a rough week',
  celebrating: 'Celebrating',
  travelling: 'Travelling',
  resting: 'Resting',
};
