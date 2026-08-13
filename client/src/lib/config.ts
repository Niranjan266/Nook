/**
 * Where the API lives.
 *
 * In development this is empty, so every request stays relative and Vite's dev
 * proxy forwards `/api`, `/uploads` and `/socket.io` to localhost:4000.
 *
 * In production the frontend is on Vercel and the API is somewhere that can
 * hold a WebSocket open — Vercel functions cannot, which is why these are two
 * different hosts. `VITE_API_URL` is baked in at build time, so changing it
 * means triggering a redeploy, not just editing a dashboard field.
 */
const raw = (import.meta.env.VITE_API_URL || '').trim();

/** No trailing slash, ever — everything downstream concatenates onto this. */
export const API_BASE = raw.replace(/\/+$/, '');

/** Absolute API URL. `apiUrl('/auth/me')` → `https://api.example.com/api/auth/me` */
export const apiUrl = (path: string) => `${API_BASE}/api${path}`;

/**
 * Media may arrive as an absolute Cloudinary URL or as a server-relative path
 * from the local-disk fallback. The relative form has to be pointed at the API
 * host, or the browser would look for it on the Vercel domain and 404.
 */
export function mediaUrl(url?: string | null) {
  if (!url) return '';
  if (/^(https?:|data:|blob:)/i.test(url)) return url;
  return `${API_BASE}${url.startsWith('/') ? '' : '/'}${url}`;
}

export const isProd = import.meta.env.PROD;
