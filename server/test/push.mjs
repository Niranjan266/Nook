/**
 * The two push transports.
 *
 * Web Push and FCM reach different devices and neither substitutes for the
 * other — Web Push does not exist inside an Android WebView, FCM cannot reach
 * a desktop browser. These check the routing and the honesty of the reporting,
 * not the third-party services themselves.
 */
import { suite, api, register } from './helpers.mjs';
import { fcmReady, fcmMissing, buildMessage } from '../src/services/fcm.js';

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

/* ── notification channels ────────────────────────────────────────────
   Android freezes a channel's sound once made, so the louder ones are new
   ids that only 1.0.8+ APKs create. Naming one an old APK lacks drops the
   custom sound, so the server must only use them when the device says so. */

const old = 'o'.repeat(140);
const fresh = 'n'.repeat(140);
await api('/push/device', { method: 'POST', token: a.token, body: { token: old } });
r = await api('/push/device', { method: 'POST', token: a.token, body: { token: fresh, channels: 2 } });
t.ok('a device can say it has the v2 channels', r.status === 201, `${r.status} ${JSON.stringify(r.json)}`);

r = await api('/push/device', { method: 'POST', token: a.token, body: { token: 'q'.repeat(140), channels: 0 } });
t.ok('a nonsense channel version is refused', r.status === 400, `${r.status}`);

const mine = await devicesFor(a.id);
const oldRow = mine.find((d) => d.token === old);
const freshRow = mine.find((d) => d.token === fresh);
t.ok('an old APK that says nothing is stored as v1', oldRow?.channels === 1, JSON.stringify(oldRow));
t.ok('and a new one as v2', freshRow?.channels === 2, JSON.stringify(freshRow));

const channelOf = (device, urgent) =>
  buildMessage('tok', { title: 'x', urgent }, device).message.android.notification;
t.ok('v1 devices keep the old message channel', channelOf(oldRow, false).channel_id === 'messages');
t.ok('v1 devices keep the old call channel', channelOf(oldRow, true).channel_id === 'calls');
t.ok('and are not told about sounds they lack', channelOf(oldRow, false).sound === undefined);
t.ok('v2 devices get the louder message channel', channelOf(freshRow, false).channel_id === 'messages_v2');
t.ok('v2 devices get the louder call channel', channelOf(freshRow, true).channel_id === 'calls_v2');
t.ok('with the matching sound for pre-Oreo phones', channelOf(freshRow, false).sound === 'nook_message_v2'
     && channelOf(freshRow, true).sound === 'nook_call_v2');
t.ok('and the Nook buzz', channelOf(freshRow, false).vibrate_timings?.join(',') === '0.000s,0.080s,0.070s,0.080s,0.070s,0.220s',
     JSON.stringify(channelOf(freshRow, false).vibrate_timings));
t.ok('a device with no channel info is treated as v1', buildMessage('tok', {}).message.android.notification.channel_id === 'messages');

// Re-registering from an old APK after a downgrade must step back down.
await api('/push/device', { method: 'POST', token: a.token, body: { token: fresh } });
t.ok('re-registering without channels resets to v1',
     (await devicesFor(a.id)).find((d) => d.token === fresh)?.channels === 1);

/* ── sending with nothing configured ──────────────────────────────────── */

const test = await api('/push/test', { method: 'POST', token: a.token });
t.ok('a test send answers rather than throwing', test.status === 200, `${test.status}`);
// Nobody in a test has a real subscription of either kind, and reporting a
// success would be the lie that hides a broken setup.
t.ok('and honestly reports nothing was delivered', test.json.sent === 0, JSON.stringify(test.json));

process.exit(t.done() ? 1 : 0);
