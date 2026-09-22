/**
 * Which of Nook's designs everyone sees.
 *
 * One app-wide choice, made in /nookcontrol and stored in app_meta. Every
 * client asks for it at boot — the sign-in screen included, so the question
 * needs no account — and connected clients are told the moment it changes,
 * so a switch reaches open apps without anyone reloading.
 *
 * Read on every page load by every visitor, so it is cached in memory and the
 * database is only asked once per process (and again on each change).
 */
import { getMeta, setMeta } from '../db/admin.js';
import { getIo } from '../sockets/hub.js';

export const DESIGNS = ['midnight-pebble', 'calm', 'midnight', 'pebble'];
export const DEFAULT_DESIGN = 'midnight-pebble';
const KEY = 'design';

let cached = null;

export async function currentDesign() {
  if (cached) return cached;
  const stored = await getMeta(KEY).catch(() => '');
  cached = DESIGNS.includes(stored) ? stored : DEFAULT_DESIGN;
  return cached;
}

export async function setDesign(design) {
  if (!DESIGNS.includes(design)) throw new Error(`Unknown design: ${design}`);
  await setMeta(KEY, design);
  cached = design;
  // Every open app, signed in or not, switches without a reload.
  getIo()?.emit('app:design', { design });
  return design;
}
