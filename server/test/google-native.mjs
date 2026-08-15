/**
 * Where a Google sign-in finishes.
 *
 * This is the bug the Android app hit: the callback always redirected to a web
 * URL, so the browser that ran the flow kept the session and the app was left
 * signed out with nothing to explain it. These check the destination, which is
 * the whole of the fix.
 */
import { suite, BASE } from './helpers.mjs';

const t = suite('google sign-in destination');

const ORIGIN = BASE.replace(/\/api$/, '');

/** Follow one hop only — the redirect target is the thing under test. */
const hop = async (path) => {
  const r = await fetch(ORIGIN + path, { redirect: 'manual' });
  return { status: r.status, location: r.headers.get('location') || '' };
};

/* ── start ─────────────────────────────────────────────────────────────── */

let r = await hop('/api/auth/google/start');
t.ok('start redirects to Google', r.location.startsWith('https://accounts.google.com/'), r.location.slice(0, 80));

const webState = new URL(r.location).searchParams.get('state');
t.ok('and carries a signed state', Boolean(webState && webState.includes('.')), String(webState).slice(0, 40));

r = await hop('/api/auth/google/start?native=1');
const nativeState = new URL(r.location).searchParams.get('state');
t.ok('the app gets its own state', Boolean(nativeState) && nativeState !== webState);

// The flag has to survive the round trip, and it has to be inside the
// signature — a plain query parameter on the way back could be edited into a
// redirect somewhere else, and this URL carries a sign-in code.
const decode = (s) => JSON.parse(Buffer.from(s.split('.')[0], 'base64url').toString());
t.ok('web state is not marked native', decode(webState).m === 0, JSON.stringify(decode(webState)));
t.ok('app state is marked native', decode(nativeState).m === 1, JSON.stringify(decode(nativeState)));
t.ok('the mark is inside the signed half', nativeState.split('.')[0].length > 20);

/* ── callback ──────────────────────────────────────────────────────────── */

// No code, so the callback bails early — which is exactly the path that shows
// where a failure is sent, and it needs no real Google round trip.
r = await hop(`/api/auth/google/callback?state=${encodeURIComponent(webState)}`);
t.ok('a web failure goes to the website', r.location.startsWith('http'), r.location.slice(0, 60));

r = await hop(`/api/auth/google/callback?state=${encodeURIComponent(nativeState)}`);
t.ok('an app failure comes back to the app', r.location.startsWith('nook://auth?'), r.location.slice(0, 60));
t.ok('and says what went wrong', r.location.includes('google_error='), r.location);

// A tampered state must not be trusted to pick the destination.
const forged = nativeState.split('.')[0] + '.' + 'x'.repeat(43);
r = await hop(`/api/auth/google/callback?state=${encodeURIComponent(forged)}`);
t.ok('a forged state is refused, not redirected to a scheme', !r.location.startsWith('nook://'), r.location.slice(0, 60));

// Cancelling in the browser has to come home too, or the app hangs on a
// Custom Tab the person already dismissed.
r = await hop(`/api/auth/google/callback?error=access_denied&state=${encodeURIComponent(nativeState)}`);
t.ok('cancelling returns to the app', r.location.startsWith('nook://auth?'), r.location.slice(0, 60));
t.ok('carrying the reason', r.location.includes('access_denied'), r.location);

process.exit(t.done() ? 1 : 0);
