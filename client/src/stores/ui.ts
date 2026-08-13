import { create } from 'zustand';

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
  lightbox: { messageId: string } | null;

  setTheme: (t: Theme) => void;
  setAccent: (a: Accent) => void;
  toggleShelf: () => void;
  setShelf: (open: boolean) => void;
  openSheet: (kind: SheetKind, payload?: any) => void;
  closeSheet: () => void;
  toast: (text: string, bad?: boolean) => void;
  dropToast: (id: number) => void;
  setLightbox: (v: { messageId: string } | null) => void;
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
  closeSheet: () => set({ sheet: null, sheetPayload: null }),

  toast(text, bad) {
    const id = ++toastId;
    set((s) => ({ toasts: [...s.toasts, { id, text, bad }] }));
    setTimeout(() => get().dropToast(id), bad ? 5200 : 3200);
  },
  dropToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  setLightbox: (lightbox) => set({ lightbox }),
}));

// keep the document in sync at boot and when the OS theme flips
applyTheme(useUi.getState().theme, useUi.getState().accent);
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  const { theme, accent } = useUi.getState();
  if (theme === 'system') applyTheme(theme, accent);
});
