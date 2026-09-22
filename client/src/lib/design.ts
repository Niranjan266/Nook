/**
 * Which of Nook's designs is showing.
 *
 * The admin picks one design for everyone in /nookcontrol. It is applied as
 * `data-design` on <html>, and tokens.css swaps colours, type and shape for
 * it, so no component knows which design it is drawing.
 *
 * Three moments apply it: the inline script in index.html paints the last
 * known design before the first frame (no flash of the wrong look), boot asks
 * the server for the current one, and a socket event switches every open app
 * the moment the admin changes it.
 */
import { create } from 'zustand';
import { apiUrl } from './config';

export type DesignId = 'midnight-pebble' | 'calm' | 'midnight' | 'pebble';

export const DESIGNS: { id: DesignId; name: string; tagline: string; fonts: string }[] = [
  {
    id: 'midnight-pebble',
    name: 'Midnight Pebble',
    tagline: 'Dark and bold, soft and rounded',
    fonts: 'family=Fredoka:wght@500;600;700&family=Nunito:wght@400;600;700;800',
  },
  {
    id: 'calm',
    name: 'Calm',
    tagline: 'Quiet, editorial, lots of air',
    fonts: 'family=Instrument+Serif&family=Figtree:wght@400;500;600;700;800',
  },
  {
    id: 'midnight',
    name: 'Midnight',
    tagline: 'Bold, high-contrast, dark first',
    fonts: 'family=Space+Grotesk:wght@400;500;600;700&family=IBM+Plex+Sans:wght@400;500;600;700',
  },
  {
    id: 'pebble',
    name: 'Pebble',
    tagline: 'Soft, rounded, friendly',
    fonts: 'family=Fredoka:wght@500;600;700&family=Nunito:wght@400;600;700;800',
  },
];

export const DEFAULT_DESIGN: DesignId = 'midnight-pebble';
const KEY = 'nook.design';

const isDesign = (v: unknown): v is DesignId => DESIGNS.some((d) => d.id === v);

export const useDesign = create<{ design: DesignId }>(() => ({
  design: (document.documentElement.dataset.design as DesignId) || DEFAULT_DESIGN,
}));

/** Each design's typefaces, fetched the first time it is shown. */
function loadFonts(id: DesignId) {
  const spec = DESIGNS.find((d) => d.id === id)?.fonts;
  if (!spec || document.querySelector(`link[data-design-fonts="${id}"]`)) return;
  // Midnight Pebble's are already linked from index.html.
  if (id === 'midnight-pebble' || id === 'pebble') return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?${spec}&display=swap`;
  link.dataset.designFonts = id;
  document.head.appendChild(link);
}

export function applyDesign(id: unknown) {
  const design = isDesign(id) ? id : DEFAULT_DESIGN;
  loadFonts(design);
  if (document.documentElement.dataset.design !== design) {
    document.documentElement.dataset.design = design;
  }
  useDesign.setState({ design });
  syncChrome();
  try {
    localStorage.setItem(KEY, design);
  } catch {
    /* storage blocked — the server is asked again next launch */
  }
}

/**
 * The browser's address bar and Android's status bar are painted outside the
 * page, so they are told the new background directly.
 */
function syncChrome() {
  requestAnimationFrame(() => {
    const root = document.documentElement;
    const bg = getComputedStyle(root).getPropertyValue('--bg').trim();
    if (!bg) return;
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', bg));
    import('./native').then((n) => n.styleStatusBar(root.dataset.theme === 'dark')).catch(() => {});
  });
}

/** At boot: keep what index.html painted, then ask the server what is current. */
export async function initDesign() {
  applyDesign(document.documentElement.dataset.design);
  try {
    const res = await fetch(apiUrl('/design'), { credentials: 'omit' });
    if (res.ok) applyDesign((await res.json()).design);
  } catch {
    /* offline or waking up — the remembered design stands */
  }
}
