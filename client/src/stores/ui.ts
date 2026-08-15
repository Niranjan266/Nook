import { create } from 'zustand';
import { styleStatusBar } from '@/lib/native';

type Theme = 'light' | 'dark' | 'system';
type Accent = 'terracotta' | 'moss' | 'ochre' | 'clay-blue' | 'rust';

export type SheetKind =
  | null
  | 'profile'
  | 'chat-info'
  | 'wallpaper'
  | 'settings'
  | 'new-chat'
  | 'new-group'
  | 'search'
  | 'starred'
  | 'calls'
  | 'forward'
  | 'contacts'
  | 'requests'
  | 'room'
  | 'folders'
  | 'scheduled'
  | 'media';

interface Toast {
  id: number;
  text: string;
  bad?: boolean;
}

interface UiState {
  theme: Theme;
  accent: Accent;
  shelfOpen: boolean;
  sheet: SheetKind;
  sheetPayload: any;
  toasts: Toast[];
  /**
   * `onClose` exists for snaps: the look is only spent once it has been had,
   * so the count is recorded when the viewer closes rather than when it opens.
   * Opening-time recording is what let the server destroy the picture while it
   * was still on screen.
   */
  lightbox: { messageId: string; onClose?: () => void } | null;

  /**
   * A wallpaper being chosen but not yet applied.
   *
   * The sheet has always had a little preview with two sample bubbles, and it
   * was fine until you scrolled — which you must, to reach the presets and the
   * sliders — at which point the one thing you are judging leaves the screen.
   *
   * This lets the real conversation behind the sheet wear the choice instead.
   * A thumbnail can tell you a colour; only the actual chat, at actual size,
   * with actual messages on it, can tell you whether the text is still
   * readable at 40% dim — which is the only question anyone is really asking.
   */
  wallpaperDraft: {
    url?: string;
    preset?: string;
    tint?: string;
    dim: number;
    blur: number;
  } | null;

  setTheme: (t: Theme) => void;
  setAccent: (a: Accent) => void;
  toggleShelf: () => void;
  setShelf: (open: boolean) => void;
  openSheet: (kind: SheetKind, payload?: any) => void;
  closeSheet: () => void;
  toast: (text: string, bad?: boolean) => void;
  dropToast: (id: number) => void;
  setLightbox: (v: { messageId: string; onClose?: () => void } | null) => void;
  setWallpaperDraft: (v: UiState['wallpaperDraft']) => void;
}

const KEY = 'nook.ui';
const saved = (() => {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch {
    return {};
  }
})();

function applyTheme(theme: Theme, accent: Accent) {
  const dark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.dataset.accent = accent;
  localStorage.setItem(KEY, JSON.stringify({ theme, accent }));

  /**
   * The Android status bar is native, so `theme-color` — which the browser
   * honours — does nothing in the app. Set here rather than at sign-in so it
   * follows every theme change, including the system flipping to dark while
   * Nook is open on 'system'.
   */
  styleStatusBar(dark);
}

let toastId = 0;

export const useUi = create<UiState>((set, get) => ({
  theme: (saved.theme as Theme) || 'system',
  accent: (saved.accent as Accent) || 'terracotta',
  shelfOpen: window.innerWidth > 900,
  sheet: null,
  sheetPayload: null,
  toasts: [],
  lightbox: null,
  wallpaperDraft: null,

  setTheme(theme) {
    applyTheme(theme, get().accent);
    set({ theme });
  },
  setAccent(accent) {
    applyTheme(get().theme, accent);
    set({ accent });
  },
  toggleShelf: () => set((s) => ({ shelfOpen: !s.shelfOpen })),
  setShelf: (shelfOpen) => set({ shelfOpen }),

  openSheet: (sheet, sheetPayload = null) => set({ sheet, sheetPayload }),
  // The draft dies with the sheet. Leaving it behind would show a wallpaper
  // that was never chosen, on a chat that never agreed to it.
  closeSheet: () => set({ sheet: null, sheetPayload: null, wallpaperDraft: null }),

  toast(text, bad) {
    const id = ++toastId;
    set((s) => ({ toasts: [...s.toasts, { id, text, bad }] }));
    setTimeout(() => get().dropToast(id), bad ? 5200 : 3200);
  },
  dropToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  setWallpaperDraft: (wallpaperDraft) => set({ wallpaperDraft }),

  setLightbox: (lightbox) => {
    // Closing runs the callback the opener left behind, exactly once.
    if (!lightbox) {
      const previous = get().lightbox;
      previous?.onClose?.();
    }
    set({ lightbox });
  },
}));

// keep the document in sync at boot and when the OS theme flips
applyTheme(useUi.getState().theme, useUi.getState().accent);
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  const { theme, accent } = useUi.getState();
  if (theme === 'system') applyTheme(theme, accent);
});
