/**
 * Link previews, fetched by the server.
 *
 * The server does the fetching so the recipient's device never touches a URL a
 * stranger sent them — no IP leak, no tracking pixel, no drive-by.
 *
 * That makes this endpoint an SSRF surface: without care, someone could send
 * "http://169.254.169.254/latest/meta-data/" and have our server read cloud
 * credentials for them. Everything below exists because of that.
 */
import dns from 'node:dns/promises';
import net from 'node:net';

const CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours
const MAX_BYTES = 512 * 1024; // stop reading after 512 KB of HTML
const TIMEOUT = 6000;
const MAX_REDIRECTS = 3;

/** url -> { at, data } */
const cache = new Map();

const PRIVATE_V4 = [
  [10, 0, 0, 0, 8],
  [127, 0, 0, 0, 8],
  [169, 254, 0, 0, 16],
  [172, 16, 0, 0, 12],
  [192, 168, 0, 0, 16],
  [0, 0, 0, 0, 8],
  [100, 64, 0, 0, 10],
];

function isPrivateV4(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true;
  const asInt = ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
  return PRIVATE_V4.some(([a, b, c, d, bits]) => {
    const base = ((a << 24) >>> 0) + (b << 16) + (c << 8) + d;
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (asInt & mask) === (base & mask);
  });
}

/**
 * An IPv4 address hiding inside an IPv6 one — `::ffff:127.0.0.1`, or the same
 * thing as URL parsing normalises it, `::ffff:7f00:1`. Both reach the IPv4
 * host, so both have to be judged as that host.
 */
function embeddedV4(v) {
  const m = v.match(/^(?:::ffff:|::ffff:0:|::|64:ff9b::)(?:(\d+\.\d+\.\d+\.\d+)|([0-9a-f]{1,4}):([0-9a-f]{1,4}))$/);
  if (!m) return null;
  if (m[1]) return m[1];
  const hi = parseInt(m[2], 16);
  const lo = parseInt(m[3], 16);
  return [hi >> 8, hi & 255, lo >> 8, lo & 255].join('.');
}

const isPrivateV6 = (ip) => {
  const v = ip.toLowerCase().replace(/^\[|\]$/g, '');
  const v4 = embeddedV4(v);
  if (v4) return isPrivateV4(v4);
  return (
    v === '::1' ||
    v === '::' ||
    v.startsWith('fc') ||
    v.startsWith('fd') ||
    /^fe[89ab]/.test(v) || // link-local
    /^fe[c-f]/.test(v) || // old site-local
    v.startsWith('ff') // multicast
  );
};

/** Reject anything that resolves inside our own network. */
async function assertPublic(rawHostname) {
  // URL keeps the brackets on an IPv6 literal; net.isIP does not accept them.
  const hostname = rawHostname.replace(/^\[|\]$/g, '');
  if (net.isIP(hostname)) {
    const priv = net.isIPv4(hostname) ? isPrivateV4(hostname) : isPrivateV6(hostname);
    if (priv) throw new Error('Refusing to fetch a private address.');
    return;
  }
  const records = await dns.lookup(hostname, { all: true });
  if (!records.length) throw new Error('Could not resolve that host.');
  for (const { address, family } of records) {
    if (family === 4 ? isPrivateV4(address) : isPrivateV6(address)) {
      throw new Error('Refusing to fetch a private address.');
    }
  }
}

const decode = (s = '') =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .trim();

function metaTag(html, names) {
  for (const name of names) {
    const rx = new RegExp(
      `<meta[^>]+(?:property|name)\\s*=\\s*["']${name}["'][^>]*>`,
      'i'
    );
    const tag = html.match(rx)?.[0];
    if (!tag) continue;
    const content = tag.match(/content\s*=\s*["']([^"']*)["']/i)?.[1];
    if (content) return decode(content);
  }
  return '';
}

/** Read at most MAX_BYTES so a huge or endless response can't exhaust memory. */
async function readCapped(res) {
  const reader = res.body?.getReader?.();
  if (!reader) return (await res.text()).slice(0, MAX_BYTES);

  const chunks = [];
  let total = 0;
  while (total < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  reader.cancel().catch(() => {});
  return new TextDecoder('utf-8', { fatal: false }).decode(
    chunks.length === 1 ? chunks[0] : Buffer.concat(chunks.map(Buffer.from))
  );
}

export async function fetchPreview(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('That is not a URL.');
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only http and https.');

  const key = url.toString();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.data;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);

  try {
    /**
     * Redirects are followed by hand, checking every hop before it is
     * requested. With `redirect: 'follow'` the check ran on the final URL,
     * after the request to it had already been made — so a public page that
     * redirected to 169.254.169.254 got fetched, and only the *answer* was
     * refused. For SSRF the request is the damage.
     */
    let current = url;
    let res;
    for (let hop = 0; ; hop += 1) {
      if (!['http:', 'https:'].includes(current.protocol)) throw new Error('Only http and https.');
      await assertPublic(current.hostname);
      res = await fetch(current, {
        signal: controller.signal,
        redirect: 'manual',
        headers: {
          // Identify honestly; many sites serve better metadata to known bots.
          'user-agent': 'Mozilla/5.0 (compatible; NookBot/1.0; +https://nook.app/bot)',
          accept: 'text/html,application/xhtml+xml',
        },
      });
      const location = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
      if (!location) break;
      if (hop >= MAX_REDIRECTS) throw new Error('Too many redirects.');
      res.body?.cancel?.().catch(() => {});
      current = new URL(location, current);
    }

    if (!res.ok) throw new Error(`That page returned ${res.status}.`);
    const type = res.headers.get('content-type') || '';
    if (!type.includes('html')) throw new Error('Not a web page.');

    const finalUrl = current.toString();
    const html = await readCapped(res);

    const data = {
      url: finalUrl,
      title:
        metaTag(html, ['og:title', 'twitter:title']) ||
        decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || ''),
      description: metaTag(html, ['og:description', 'twitter:description', 'description']),
      image: metaTag(html, ['og:image:secure_url', 'og:image', 'twitter:image']),
      siteName: metaTag(html, ['og:site_name']) || current.hostname.replace(/^www\./, ''),
    };

    // The page chooses this, and it ends up in an <img src>: web URLs only.
    if (data.image) {
      try {
        const image = new URL(data.image, finalUrl);
        data.image = ['http:', 'https:'].includes(image.protocol) ? image.toString() : '';
      } catch {
        data.image = '';
      }
    }

    data.title = data.title.slice(0, 160);
    data.description = data.description.slice(0, 280);

    if (!data.title && !data.description && !data.image) throw new Error('Nothing to preview.');

    cache.set(key, { at: Date.now(), data });
    if (cache.size > 800) cache.delete(cache.keys().next().value);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

export const firstUrlIn = (text = '') =>
  text.match(/https?:\/\/[^\s<>"']+/i)?.[0]?.replace(/[.,;:!?)\]]+$/, '') || '';
