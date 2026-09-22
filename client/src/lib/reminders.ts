/**
 * The quick picks for "Remind me", worked out on the device.
 *
 * "Tomorrow at 9" means 9 where the person is, and the device is the only
 * thing that reliably knows where that is — so the wall-clock arithmetic
 * happens here, through the local-time Date setters (which step over a DST
 * change correctly), and the server is only ever sent the resulting instant.
 */

export interface QuickPick {
  id: string;
  label: string;
  /** A short "Tue 9:00" hint, so a pick is never a guess about which day. */
  hint: string;
  at: Date;
}

const at = (base: Date, days: number, hours: number, minutes = 0) => {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  d.setHours(hours, minutes, 0, 0);
  return d;
};

const hintFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
export const whenHint = (d: Date) => hintFmt.format(d);

export function quickPicks(now = new Date()): QuickPick[] {
  const picks: QuickPick[] = [];

  const hour = new Date(now.getTime() + 60 * 60_000);
  picks.push({ id: 'hour', label: 'In 1 hour', hint: whenHint(hour), at: hour });

  // Past 7:30 "tonight" is barely later than an hour from now, so it steps aside.
  const tonight = at(now, 0, 20);
  if (tonight.getTime() - now.getTime() > 30 * 60_000) {
    picks.push({ id: 'tonight', label: 'Tonight, 8 PM', hint: whenHint(tonight), at: tonight });
  }

  const tomorrow = at(now, 1, 9);
  picks.push({ id: 'tomorrow', label: 'Tomorrow, 9 AM', hint: whenHint(tomorrow), at: tomorrow });

  // Next week means the start of it — Monday morning — which is what every
  // calendar means too. On a Monday that is a week today, not today.
  const toMonday = ((8 - now.getDay()) % 7) || 7;
  const nextWeek = at(now, toMonday, 9);
  picks.push({ id: 'week', label: 'Next week', hint: whenHint(nextWeek), at: nextWeek });

  return picks;
}

/** `<input type="datetime-local">` speaks local wall time with no zone. */
export function toLocalInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** And back: the browser parses a zone-less datetime as local, which is the point. */
export const fromLocalInput = (value: string) => (value ? new Date(value) : null);

const fullFmt = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});
export const whenFull = (iso: string | Date) => fullFmt.format(new Date(iso));
