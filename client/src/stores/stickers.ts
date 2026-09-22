import { create } from 'zustand';
import { get, post, del } from '@/lib/api';
import type { Sticker } from '@/lib/types';

interface StickerState {
  stickers: Sticker[];
  cap: number;
  loaded: boolean;

  load: (force?: boolean) => Promise<void>;
  /** Keep an uploaded sticker file in the tray. */
  add: (media: { url: string; publicId: string; width?: number; height?: number }) => Promise<Sticker>;
  remove: (id: string) => Promise<void>;
  /** Just sent — to the front, so the tray stays recently-used-first. */
  use: (id: string) => void;
}

/**
 * Your sticker tray. Its own small store because the composer, the maker and
 * the tray all change it, and the order has to agree between them without a
 * refetch after every send.
 */
export const useStickers = create<StickerState>((set, store) => ({
  stickers: [],
  cap: 120,
  loaded: false,

  async load(force = false) {
    if (store().loaded && !force) return;
    const r = await get<{ stickers: Sticker[]; cap: number }>('/stickers');
    set({ stickers: r.stickers, cap: r.cap, loaded: true });
  },

  async add(media) {
    const { sticker } = await post<{ sticker: Sticker }>('/stickers', {
      url: media.url,
      publicId: media.publicId,
      width: media.width || 512,
      height: media.height || 512,
    });
    set((s) => ({ stickers: [sticker, ...s.stickers.filter((x) => x.id !== sticker.id)] }));
    return sticker;
  },

  async remove(id) {
    const before = store().stickers;
    set({ stickers: before.filter((s) => s.id !== id) });
    try {
      await del(`/stickers/${id}`);
    } catch (err) {
      // Put it back: a sticker that vanishes and then reappears on the next
      // load reads as the app lying about what it did.
      set({ stickers: before });
      throw err;
    }
  },

  use(id) {
    set((s) => {
      const hit = s.stickers.find((x) => x.id === id);
      return hit ? { stickers: [hit, ...s.stickers.filter((x) => x.id !== id)] } : s;
    });
    // Ordering only; if it fails the tray is merely a little out of date.
    post(`/stickers/${id}/use`).catch(() => {});
  },
}));
