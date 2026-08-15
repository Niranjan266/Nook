/**
 * Pull the dominant colour out of a wallpaper so bubbles and the header can be
 * tinted to match. Runs entirely on canvas, client-side, before upload.
 */

export function dominantColor(src: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const size = 48;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return resolve('');
        ctx.drawImage(img, 0, 0, size, size);
        const { data } = ctx.getImageData(0, 0, size, size);

        // Bucket into a coarse colour cube, ignore near-white/near-black.
        const buckets = new Map<string, { n: number; r: number; g: number; b: number }>();
        for (let i = 0; i < data.length; i += 4) {
          const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
          if (a < 200) continue;
          const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
          if (lum < 26 || lum > 236) continue;
          const key = `${r >> 4}-${g >> 4}-${b >> 4}`;
          const cur = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0 };
          cur.n += 1;
          cur.r += r;
          cur.g += g;
          cur.b += b;
          buckets.set(key, cur);
        }

        type Bucket = { n: number; r: number; g: number; b: number };
        let best: Bucket | undefined;
        for (const v of buckets.values()) {
          if (!best || v.n > best.n) best = v;
        }
        if (!best) return resolve('');

        const winner: Bucket = best;
        const hex = (v: number) => Math.round(v).toString(16).padStart(2, '0');
        resolve(`#${hex(winner.r / winner.n)}${hex(winner.g / winner.n)}${hex(winner.b / winner.n)}`);
      } catch {
        resolve('');
      }
    };
    img.onerror = () => resolve('');
    img.src = src;
  });
}

export function readableOn(hex: string): '#1E1A17' | '#F7F2EA' {
  const h = hex.replace('#', '');
  if (h.length < 6) return '#1E1A17';
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return lum > 0.55 ? '#1E1A17' : '#F7F2EA';
}

/** Crop + downscale a picked image to a sane wallpaper size before upload. */
export function prepareWallpaper(file: File, maxW = 1600): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxW / img.width);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('Canvas unavailable.'));
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => {
          URL.revokeObjectURL(url);
          blob ? resolve(blob) : reject(new Error('Could not process that image.'));
        },
        'image/jpeg',
        0.86
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read that image.'));
    };
    img.src = url;
  });
}

/**
 * Square-crop and shrink a picked photo into a profile picture.
 *
 * Avatars are always drawn in a circle at 32–92px, so uploading a 12 MB
 * portrait sends thousands of times more data than anyone will ever see —
 * on a phone that reads as the feature hanging. Worse, a tall photo gets
 * centre-cropped by CSS at display time, so what you saw when you picked it
 * is not what other people get.
 *
 * Cropping to a centred square here means the upload, the thumbnail and the
 * circle all agree, and 512px is enough for a retina 92px avatar twice over.
 */
export function prepareAvatar(file: File, size = 512): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const edge = Math.min(img.width, img.height);
      const sx = (img.width - edge) / 2;
      const sy = (img.height - edge) / 2;
      const out = Math.min(size, edge);

      const canvas = document.createElement('canvas');
      canvas.width = out;
      canvas.height = out;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        URL.revokeObjectURL(url);
        return reject(new Error('Canvas unavailable.'));
      }
      ctx.drawImage(img, sx, sy, edge, edge, 0, 0, out, out);
      canvas.toBlob(
        (blob) => {
          URL.revokeObjectURL(url);
          blob ? resolve(blob) : reject(new Error('Could not process that image.'));
        },
        'image/jpeg',
        0.88
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read that image.'));
    };
    img.src = url;
  });
}

/**
 * Shrink a photo before it goes anywhere.
 *
 * A modern phone camera produces 8–14 MB files. Sending that to a chat wastes
 * the sender's data, the server's disk and the recipient's patience, and none
 * of it is visible at the size a message bubble actually renders. 1920px at
 * quality 0.82 is indistinguishable in a chat and typically 10–20× smaller.
 *
 * Anything already small, or not a raster image, passes through untouched.
 */
export async function compressImage(file: File, maxEdge = 1920): Promise<File> {
  if (!file.type.startsWith('image/')) return file;
  if (file.type === 'image/gif') return file; // animation would be flattened
  if (file.size < 320 * 1024) return file;

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 1.5 * 1024 * 1024) {
      bitmap.close?.();
      return file;
    }

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.82)
    );
    if (!blob || blob.size >= file.size) return file;

    return new File([blob], file.name.replace(/\.(png|heic|heif|webp|tiff?)$/i, '.jpg'), {
      type: 'image/jpeg',
      lastModified: file.lastModified,
    });
  } catch {
    // Any failure at all: send the original. Never lose the user's file.
    return file;
  }
}

export const WALLPAPER_PRESETS = [
  { id: 'dusk-clay', label: 'Dusk Clay', tint: '#C0603C' },
  { id: 'moss-paper', label: 'Moss Paper', tint: '#57694A' },
  { id: 'ochre-dune', label: 'Ochre Dune', tint: '#CE9535' },
  { id: 'slate-rain', label: 'Slate Rain', tint: '#47606F' },
  { id: 'arch', label: 'Arches', tint: '#C0603C' },
  { id: 'grid', label: 'Graph', tint: '' },
  { id: 'plain', label: 'Plain', tint: '' },
] as const;
