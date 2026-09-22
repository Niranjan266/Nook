/**
 * ICE servers for calls, with relay credentials from Cloudflare Realtime TURN
 * when it is configured.
 *
 * One credential set is shared by every caller: Cloudflare bills by relayed
 * bytes, not by credential, so minting one per request would only add a
 * network hop to every call setup.
 */
import { env, iceServers as staticIceServers } from '../config/env.js';

const TTL_SECONDS = 24 * 60 * 60;
// Refresh an hour early, so a call that starts just before expiry still has
// credentials that outlive its setup.
const REFRESH_MARGIN_MS = 60 * 60 * 1000;
// After a failure, serve the fallback for a minute rather than asking
// Cloudflare again on every single call attempt.
const RETRY_AFTER_MS = 60 * 1000;
const TIMEOUT_MS = 5000;

// Port 53 is DNS; plenty of networks and some browsers refuse it for anything
// else, and Cloudflare's own docs say to drop it for browser clients.
const onPort53 = (url) => /:53(\?|$)/.test(url);

function withoutPort53(servers) {
  return servers
    .map((s) => {
      const urls = (Array.isArray(s.urls) ? s.urls : [s.urls]).filter((u) => u && !onPort53(u));
      return { ...s, urls };
    })
    .filter((s) => s.urls.length > 0);
}

export function createTurnProvider({
  keyId = env.ice.cloudflare.keyId,
  apiToken = env.ice.cloudflare.apiToken,
  apiBase = env.ice.cloudflare.apiBase,
  fallback = staticIceServers,
  fetchImpl = globalThis.fetch,
  now = Date.now,
  log = (msg) => console.warn(msg),
} = {}) {
  let cached = null; // { servers, refreshAt, expiresAt }
  let inflight = null;
  let retryAt = 0;
  let warned = false;

  async function post(path) {
    return fetchImpl(`${apiBase}/turn/keys/${encodeURIComponent(keyId)}/credentials/${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ ttl: TTL_SECONDS }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  }

  async function mint() {
    let res = await post('generate-ice-servers');
    // Older keys only answer on the original endpoint, which returns one
    // server object rather than a list.
    if (res.status === 404) res = await post('generate');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const body = await res.json();
    const list = Array.isArray(body?.iceServers) ? body.iceServers : body?.iceServers ? [body.iceServers] : [];
    const servers = withoutPort53(list);
    if (!servers.length) throw new Error('no usable ICE servers in response');
    return servers;
  }

  async function refresh() {
    try {
      const servers = await mint();
      const expiresAt = now() + TTL_SECONDS * 1000;
      cached = { servers, refreshAt: expiresAt - REFRESH_MARGIN_MS, expiresAt };
      warned = false;
    } catch (err) {
      retryAt = now() + RETRY_AFTER_MS;
      if (!warned) {
        warned = true;
        log(`  turn      Cloudflare TURN unavailable (${err.message}) — calls fall back to STUN/static TURN`);
      }
    }
  }

  return {
    enabled: Boolean(keyId && apiToken),

    async iceServers() {
      const base = fallback();
      if (!this.enabled) return base;

      const t = now();
      if ((!cached || t >= cached.refreshAt) && t >= retryAt) {
        // Concurrent requests share one fetch instead of each minting.
        inflight ||= refresh().finally(() => {
          inflight = null;
        });
        await inflight;
      }

      // A stale set is still good until its real expiry, which is an hour
      // past refreshAt — better than no relay while Cloudflare is down.
      return cached && now() < cached.expiresAt ? [...base, ...cached.servers] : base;
    },
  };
}

const provider = createTurnProvider();
export const iceServers = () => provider.iceServers();
