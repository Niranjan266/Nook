/**
 * The two push transports.
 *
 * Web Push and FCM reach different devices and neither substitutes for the
 * other — Web Push does not exist inside an Android WebView, FCM cannot reach
 * a desktop browser. These check the routing and the honesty of the reporting,
 * not the third-party services themselves.
 */
import { suite, api, register } from './helpers.mjs';
import { fcmReady, fcmMissing } from '../src/services/fcm.js';

const t = suite('push transports');

const a = await register('pusha');

const caps = await api('/push/capabilities', { token: a.token });
t.ok('the server reports what it can deliver', caps.status === 200, `${caps.status}`);
t.ok('web push is configured', caps.json.web === true, JSON.stringify(caps.json));
// Nothing is set in the test environment, and saying so is the point: the app
// can tell the user "not set up on this server" instead of registering into a
// void and looking broken.
t.ok('native push reports itself off when unconfigured', caps.json.native === false, JSON.stringify(caps.json));
t.ok('and fcmReady agrees', fcmReady() === false);
t.ok('naming what is missing, without values', fcmMissing().includes('FCM_SERVICE_ACCOUNT'), JSON.stringify(fcmMissing()));

/* ── device registration ──────────────────────────────────────────────── */

let r = await api('/push/device', { method: 'POST', token: a.token, body: { token: 'x'.repeat(140) } });
t.ok('a device token is accepted', r.status === 201, `${r.status} ${JSON.stringify(r.json)}`);

r = await api('/push/device', { method: 'POST', token: a.token, body: { token: 'short' } });
t.ok('an implausible token is refused', r.status === 400, `${r.status}`);

r = await api('/push/device', { method: 'POST', body: { token: 'y'.repeat(140) } });
t.ok('registering a device needs a session', r.status === 401, `${r.status}`);

// Re-registering the same token must move it, not duplicate it — Android
// reissues a registration to whichever install asked last, so on a shared
// phone the newer owner has to replace the older one.
const b = await register('pushb');
const shared = 'z'.repeat(140);
await api('/push/device', { method: 'POST', token: a.token, body: { token: shared } });
r = await api('/push/device', { method: 'POST', token: b.token, body: { token: shared } });
t.ok('the same phone can move to another account', r.status === 201, `${r.status}`);

const { devicesFor } = await import('../src/db/misc.js');
const aDevices = await devicesFor(a.id);
const bDevices = await devicesFor(b.id);
t.ok('and only the newer owner keeps it', !aDevices.some((d) => d.token === shared) && bDevices.some((d) => d.token === shared),
     `a=${aDevices.length} b=${bDevices.length}`);

r = await api('/push/device', { method: 'DELETE', token: b.token, body: { token: shared } });
t.ok('a device can be removed on sign-out', r.status === 200, `${r.status}`);

/* ── sending with nothing configured ──────────────────────────────────── */

const test = await api('/push/test', { method: 'POST', token: a.token });
t.ok('a test send answers rather than throwing', test.status === 200, `${test.status}`);
// Nobody in a test has a real subscription of either kind, and reporting a
// success would be the lie that hides a broken setup.
t.ok('and honestly reports nothing was delivered', test.json.sent === 0, JSON.stringify(test.json));

process.exit(t.done() ? 1 : 0);
