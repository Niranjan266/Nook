/**
 * The app-wide design switch: anyone may ask which design is on, only the
 * admin may change it, and open apps are told the moment it changes.
 */
import { suite, api, register, adminToken, BASE } from './helpers.mjs';

const t = suite('design switch');
const ORIGIN = BASE.replace(/\/api$/, '');

let r = await api('/design');
t.ok('anyone can ask which design is on', r.status === 200, String(r.status));
t.ok('and it is one of the four', ['midnight-pebble', 'calm', 'midnight', 'pebble'].includes(r.json.design), r.json.design);

const person = await register('dsn');
r = await api('/admin/design', { method: 'PUT', token: person.token, body: { design: 'calm' } });
t.ok('an ordinary account cannot change it', r.status === 401 || r.status === 403, String(r.status));

const admin = await adminToken();
r = await api('/admin/design', { method: 'PUT', token: admin, body: { design: 'stripes' } });
t.ok('an unknown design is refused', r.status === 400, String(r.status));

// An open app hears the switch without reloading.
const { io } = await import('../../client/node_modules/socket.io-client/build/esm/index.js');
const socket = io(ORIGIN, { auth: { token: person.token }, transports: ['websocket'] });
await new Promise((ok) => socket.on('connect', ok));
const heard = new Promise((ok) => socket.on('app:design', (p) => ok(p)));

r = await api('/admin/design', { method: 'PUT', token: admin, body: { design: 'midnight' } });
t.ok('the admin can switch it', r.status === 200 && r.json.design === 'midnight', `${r.status} ${JSON.stringify(r.json)}`);

const event = await Promise.race([heard, new Promise((ok) => setTimeout(() => ok(null), 4000))]);
t.ok('open apps are told at once', event?.design === 'midnight', JSON.stringify(event));

r = await api('/design');
t.ok('and everyone now gets it', r.json.design === 'midnight', r.json.design);

r = await api('/admin/design', { token: admin });
t.ok('the admin panel sees the current design and the choices', r.json.design === 'midnight' && r.json.designs?.length === 4, JSON.stringify(r.json));

// Leave the instance as other suites expect it.
await api('/admin/design', { method: 'PUT', token: admin, body: { design: 'midnight-pebble' } });
socket.close();

process.exit(t.done() ? 1 : 0);
