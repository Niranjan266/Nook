/**
 * Quiet hours as a contract.
 *
 * The distinction that matters: a normal "do not disturb" only protects the
 * person who set it, silently. Here the people you talk to can *see* it before
 * they send, so the norm is social rather than technical. That is why
 * `describe()` exists and why the state is exposed on the user profile.
 */

/** Minutes past local midnight, in the user's own timezone. */
function localMinutes(timezone) {
  const now = new Date();
  if (!timezone) return now.getHours() * 60 + now.getMinutes();
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(now);
    const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
    const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
    return hour * 60 + minute;
  } catch {
    return now.getHours() * 60 + now.getMinutes();
  }
}

/** Windows wrap past midnight, so 22:00–07:00 is "outside [end, start)". */
export function isQuietNow(quietHours) {
  if (!quietHours?.enabled) return false;
  const { start, end, timezone } = quietHours;
  const now = localMinutes(timezone);
  return start <= end ? now >= start && now < end : now >= start || now < end;
}

const pad = (n) => String(n).padStart(2, '0');
export const clock = (minutes) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;

export function describe(quietHours) {
  if (!quietHours?.enabled) return '';
  return `${clock(quietHours.start)}–${clock(quietHours.end)}`;
}

/** What the other person is allowed to know. */
export function publicQuietHours(user) {
  const q = user?.quietHours;
  if (!q?.enabled || !q.visible) return null;
  return {
    window: describe(q),
    start: q.start,
    end: q.end,
    quietNow: isQuietNow(q),
    allowUrgent: q.allowUrgent,
  };
}
