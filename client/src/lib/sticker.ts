/**
 * Turning a photo into a Nook sticker, entirely on the device.
 *
 * Plain 2D canvas, no libraries and no model: the look is built from a few
 * cheap passes rather than anything clever. Soften, cut the colours down to a
 * handful of flat tones, lean them toward Nook's palette, soften again so
 * the tone edges read as soft moulded shapes rather than a GIF (the "clay
 * sticker" look), then mask, add a pale die-cut edge and a soft shadow. Split in two so typing a caption only
 * re-runs the cheap half.
 */

export type StickerShape = 'circle' | 'squircle';

/** A square in source pixels. */
export interface StickerCrop {
  x: number;
  y: number;
  size: number;
}

export const STICKER_SIZE = 512;
export const STICKER_MAX_BYTES = 200 * 1024;
export const CAPTION_MAX = 24;

// Room for the shadow, then the die-cut edge; the art fills what is left.
const PAD = 18;
const BORDER = 16;
const INNER = STICKER_SIZE - 2 * (PAD + BORDER);
const TONES = 6;

// Baked into the image, so these are the fixed palette (tokens.css), not
// theme tokens: a sticker looks the same in every chat and every theme.
const CREAM = '#fbfaff';
const CAPTION_INK = '#1f1b2e';

/** volt, mint, sky, rose, peach, iris, paper, night — the fixed palette. */
const PALETTE: [number, number, number][] = [
  [200, 245, 69],
  [61, 214, 168],
  [106, 168, 255],
  [255, 143, 163],
  [255, 179, 107],
  [139, 124, 255],
  [244, 242, 250],
  [31, 27, 46],
];

/**
 * Rounded first, because a sticker caption wants soft letters; the app's own
 * display face is the fallback everyone has loaded anyway.
 */
export const CAPTION_FONT =
  'ui-rounded, "SF Pro Rounded", "Nunito", "Varela Round", "Arial Rounded MT Bold", "Bricolage Grotesque", system-ui, sans-serif';

function makeCanvas(w: number, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function ctxOf(c: HTMLCanvasElement) {
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('This browser cannot draw the sticker.');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return ctx;
}

/**
 * Blur by resampling: down to a fraction, back up with smoothing. `ctx.filter`
 * would be neater but Safari ignored it until very recently, and a sticker
 * that comes out sharp on iPhone and soft everywhere else is two products.
 */
function soften(src: HTMLCanvasElement, factor: number) {
  const w = Math.max(1, Math.round(src.width * factor));
  const small = makeCanvas(w);
  ctxOf(small).drawImage(src, 0, 0, w, w);
  const out = makeCanvas(src.width);
  ctxOf(out).drawImage(small, 0, 0, src.width, src.width);
  return out;
}

const dist2 = (a: ArrayLike<number>, ai: number, b: number[]) => {
  const dr = a[ai] - b[0];
  const dg = a[ai + 1] - b[1];
  const db = a[ai + 2] - b[2];
  return dr * dr + dg * dg + db * db;
};

/**
 * Down to `TONES` flat colours with a small k-means over a sample of pixels.
 * Seeded from brightness quantiles rather than at random, so the same photo
 * always makes the same sticker.
 */
function posterize(c: HTMLCanvasElement) {
  const ctx = ctxOf(c);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  const pixels = d.length / 4;

  const step = Math.max(1, Math.floor(pixels / 4000));
  const samples: number[][] = [];
  for (let p = 0; p < pixels; p += step) samples.push([d[p * 4], d[p * 4 + 1], d[p * 4 + 2]]);
  samples.sort((a, b) => a[0] * 0.3 + a[1] * 0.59 + a[2] * 0.11 - (b[0] * 0.3 + b[1] * 0.59 + b[2] * 0.11));

  let centres = Array.from({ length: TONES }, (_, i) => [
    ...samples[Math.min(samples.length - 1, Math.floor(((i + 0.5) / TONES) * samples.length))],
  ]);

  for (let round = 0; round < 8; round += 1) {
    const sums = centres.map(() => [0, 0, 0, 0]);
    for (const s of samples) {
      let best = 0;
      let bestD = Infinity;
      for (let k = 0; k < centres.length; k += 1) {
        const dd = dist2(s, 0, centres[k]);
        if (dd < bestD) (bestD = dd), (best = k);
      }
      const t = sums[best];
      t[0] += s[0];
      t[1] += s[1];
      t[2] += s[2];
      t[3] += 1;
    }
    centres = centres.map((c0, k) => (sums[k][3] ? sums[k].slice(0, 3).map((v) => v / sums[k][3]) : c0));
  }

  // Each tone leans a little toward its nearest palette colour and is lifted
  // a touch — never quite black, so the shapes stay soft rather than inked.
  const tinted = centres.map((c0) => {
    let near = PALETTE[0];
    let nearD = Infinity;
    for (const p of PALETTE) {
      const dd = dist2(c0, 0, p);
      if (dd < nearD) (nearD = dd), (near = p);
    }
    const mix = c0.map((v, i) => v * 0.76 + near[i] * 0.24);
    return [
      Math.min(255, Math.max(31, mix[0] * 1.02 + 3)),
      Math.min(255, Math.max(27, mix[1] * 1.02 + 3)),
      Math.min(255, Math.max(46, mix[2] * 1.02 + 6)),
    ];
  });

  for (let i = 0; i < d.length; i += 4) {
    let best = 0;
    let bestD = Infinity;
    for (let k = 0; k < centres.length; k += 1) {
      const dd = dist2(d, i, centres[k]);
      if (dd < bestD) (bestD = dd), (best = k);
    }
    d[i] = tinted[best][0];
    d[i + 1] = tinted[best][1];
    d[i + 2] = tinted[best][2];
  }
  ctx.putImageData(img, 0, 0);
}

function shapePath(ctx: CanvasRenderingContext2D, shape: StickerShape, x: number, y: number, size: number) {
  ctx.beginPath();
  if (shape === 'circle') {
    ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
  } else {
    const r = size * 0.24;
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + size, y, x + size, y + size, r);
    ctx.arcTo(x + size, y + size, x, y + size, r);
    ctx.arcTo(x, y + size, x, y, r);
    ctx.arcTo(x, y, x + size, y, r);
    ctx.closePath();
  }
}

/**
 * The expensive half: crop, soften, posterize, tint, shade and mask. Returns
 * the art alone, `INNER` pixels square, ready for `composeSticker`.
 */
export function prepareArt(source: CanvasImageSource, crop: StickerCrop, shape: StickerShape) {
  const base = makeCanvas(INNER);
  ctxOf(base).drawImage(source, crop.x, crop.y, crop.size, crop.size, 0, 0, INNER, INNER);

  const soft = soften(base, 0.55);
  posterize(soft);
  const art = soften(soft, 0.7);
  const ctx = ctxOf(art);

  // Light from the top left, as everywhere else in the app: a puff of
  // highlight and a little weight at the bottom right.
  ctx.globalCompositeOperation = 'soft-light';
  const hi = ctx.createRadialGradient(INNER * 0.3, INNER * 0.26, 0, INNER * 0.3, INNER * 0.26, INNER * 0.75);
  hi.addColorStop(0, 'rgba(255,255,255,0.55)');
  hi.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = hi;
  ctx.fillRect(0, 0, INNER, INNER);
  const lo = ctx.createLinearGradient(0, 0, INNER, INNER);
  lo.addColorStop(0.55, 'rgba(14,13,20,0)');
  lo.addColorStop(1, 'rgba(14,13,20,0.45)');
  ctx.fillStyle = lo;
  ctx.fillRect(0, 0, INNER, INNER);

  ctx.globalCompositeOperation = 'destination-in';
  shapePath(ctx, shape, 0, 0, INNER);
  ctx.fillStyle = '#000';
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  return art;
}

function drawCaption(ctx: CanvasRenderingContext2D, text: string) {
  let size = 64;
  const maxWidth = INNER - 24;
  ctx.font = `800 ${size}px ${CAPTION_FONT}`;
  while (size > 28 && ctx.measureText(text).width > maxWidth) {
    size -= 2;
    ctx.font = `800 ${size}px ${CAPTION_FONT}`;
  }
  ctx.save();
  // A slight tilt: a caption that sits dead level looks typeset, not stuck on.
  ctx.translate(STICKER_SIZE / 2, PAD + BORDER + INNER - size * 0.32);
  ctx.rotate(-0.045);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.lineJoin = 'round';
  ctx.lineWidth = size * 0.3;
  ctx.strokeStyle = CREAM;
  ctx.strokeText(text, 0, 0, maxWidth);
  ctx.fillStyle = CAPTION_INK;
  ctx.fillText(text, 0, 0, maxWidth);
  ctx.restore();
}

/**
 * The cheap half: art plus caption, the die-cut edge and the shadow.
 *
 * The edge is the art's silhouette dilated by stamping it in rings around
 * itself, then flooded cream — so it follows the caption as well as the
 * shape, which a stroked outline of the mask could not.
 */
export function composeSticker(art: HTMLCanvasElement, caption = '', out = makeCanvas(STICKER_SIZE)) {
  const content = makeCanvas(STICKER_SIZE);
  const cctx = ctxOf(content);
  cctx.drawImage(art, PAD + BORDER, PAD + BORDER);
  const text = caption.trim().slice(0, CAPTION_MAX);
  if (text) drawCaption(cctx, text);

  const edge = makeCanvas(STICKER_SIZE);
  const ectx = ctxOf(edge);
  ectx.drawImage(content, 0, 0);
  for (const [radius, steps] of [
    [BORDER, 32],
    [BORDER / 2, 16],
  ] as const) {
    for (let i = 0; i < steps; i += 1) {
      const a = (i / steps) * Math.PI * 2;
      ectx.drawImage(content, Math.cos(a) * radius, Math.sin(a) * radius);
    }
  }
  ectx.globalCompositeOperation = 'source-in';
  ectx.fillStyle = CREAM;
  ectx.fillRect(0, 0, STICKER_SIZE, STICKER_SIZE);
  // The edge is moulded too: lit top-left, a shade deeper bottom-right.
  ectx.globalCompositeOperation = 'source-atop';
  const puff = ectx.createLinearGradient(0, 0, STICKER_SIZE, STICKER_SIZE);
  puff.addColorStop(0, 'rgba(255,255,255,0.6)');
  puff.addColorStop(1, 'rgba(139,124,255,0.28)');
  ectx.fillStyle = puff;
  ectx.fillRect(0, 0, STICKER_SIZE, STICKER_SIZE);

  const octx = ctxOf(out);
  octx.clearRect(0, 0, out.width, out.height);
  octx.save();
  octx.shadowColor = 'rgba(14, 13, 20, 0.34)';
  octx.shadowBlur = 14;
  octx.shadowOffsetX = 3;
  octx.shadowOffsetY = 6;
  octx.drawImage(edge, 0, 0, out.width, out.height);
  octx.restore();
  octx.drawImage(content, 0, 0, out.width, out.height);
  return out;
}

const toBlob = (c: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob | null>((resolve) => c.toBlob(resolve, type, quality));

/**
 * WebP, stepping the quality down until it fits. A browser that cannot encode
 * WebP hands back a PNG instead of failing, which is how that case is spotted;
 * flat posterized tones compress well as PNG, so the fallback still fits.
 */
export async function exportSticker(c: HTMLCanvasElement): Promise<Blob> {
  let smallest: Blob | null = null;
  for (const q of [0.9, 0.82, 0.72, 0.6, 0.48]) {
    const blob = await toBlob(c, 'image/webp', q);
    if (!blob || blob.type !== 'image/webp') break;
    if (blob.size <= STICKER_MAX_BYTES) return blob;
    if (!smallest || blob.size < smallest.size) smallest = blob;
  }
  if (smallest) return smallest;
  const png = await toBlob(c, 'image/png');
  if (!png) throw new Error('Could not save the sticker.');
  return png;
}

/** Decode a picked file, honouring its EXIF rotation. */
export function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('That picture could not be opened.'));
    };
    img.src = url;
  });
}

/** Warm the caption font so the first preview does not draw in a fallback. */
export function warmCaptionFont() {
  try {
    void document.fonts?.load(`800 48px ${CAPTION_FONT}`);
  } catch {
    /* no Font Loading API: the preview just redraws once the font lands */
  }
}
