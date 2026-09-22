/**
 * Keep a free Render instance from falling asleep.
 *
 * Render's free plan stops the service after fifteen minutes with no inbound
 * HTTP traffic, and the next request waits for a cold boot: over a hundred
 * seconds was measured against the live API. To someone opening the app that
 * is simply "nothing responds", and the sign-in page cannot even learn whether
 * Google sign-in is offered.
 *
 * The fix is a request to our own PUBLIC address every ten minutes. It leaves
 * the machine and comes back in through Render's proxy, so it counts as the
 * inbound traffic that keeps the instance up. A request to localhost would not.
 *
 * One always-on free service is ~730 hours a month, inside the 750 free hours.
 * Only runs on Render (which sets RENDER=true); KEEP_AWAKE=0 turns it off, and
 * a paid plan, which never sleeps, does not need it.
 */

const EVERY = 10 * 60 * 1000;

export function startKeepAwake() {
  if (!process.env.RENDER || process.env.KEEP_AWAKE === '0') return;

  const base = (process.env.RENDER_EXTERNAL_URL || process.env.PUBLIC_URL || '').replace(/\/+$/, '');
  if (!base) return;

  const ping = () =>
    fetch(`${base}/api/health`, { signal: AbortSignal.timeout(20_000) }).catch(() => {
      /* one missed ping is harmless; the next one is ten minutes away */
    });

  setInterval(ping, EVERY).unref();
  console.log(`  awake     pinging ${base} every 10 min`);
}
