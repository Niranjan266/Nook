import { create } from 'zustand';
import {
  get as apiGet,
  post,
  patch,
  put,
  del,
  setToken,
  saveRefreshToken,
  bootstrapSession,
} from '../lib/api';
import { emitAck, getSocket } from '../lib/socket';

/* ── shared types (mirrors the web client) ───────────────────────────────── */

export interface Person {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string;
  about?: string;
  accent: string;
  online?: boolean;
  lastSeen?: string | null;
  quietHours?: { window: string; start: number; end: number; quietNow: boolean } | null;
}

export interface Message {
  id: string;
  clientId?: string;
  conversationId: string;
  sender: { id: string } & Partial<Person>;
  type: string;
  body: string;
  media: any;
  transcript: string;
  replyTo: any;
  forwarded: boolean;
  reactions: { userId: string; emoji: string }[];
  deliveredTo: string[];
  readBy: string[];
  starred: boolean;
  deletedForAll: boolean;
  editedAt: string | null;
  editCount: number;
  linkPreview: any;
  threadRootId: string | null;
  replyCount: number;
  viewOnce: { enabled: boolean; seen: boolean; burnt: boolean } | null;
  call: { kind: string; status: string; duration: number } | null;
  scheduledFor: string | null;
  createdAt: string;
  status?: 'pending' | 'failed' | 'sent';
}

export interface Conversation {
  id: string;
  type: 'direct' | 'group';
  name: string;
  avatarUrl: string;
  partner: Person | null;
  members: { user: Person; role: string }[];
  wallpaper: any;
  wallpaperSchedule: any;
  wallpaperHistory: any[];
  wallObjects: any[];
  roomState: { mood: string; note: string } | null;
  pins: { messageId: string; message: Message | null }[];
  unread: number;
  muted: boolean;
  archived: boolean;
  pinned: boolean;
  locked: boolean;
  sound: string;
  slowMode: number;
  disappearAfter: number;
  myRole: string;
  lastMessage: Message | null;
  lastActivity: string;
}

export interface Me extends Person {
  settings: Record<string, any>;
  privacy: Record<string, any>;
  quietHoursSettings?: any;
  folders: { id: string; name: string; emoji: string; conversations: string[] }[];
}

/* ── auth ────────────────────────────────────────────────────────────────── */

interface AuthState {
  me: Me | null;
  status: 'loading' | 'out' | 'in';
  init: () => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  signup: (i: { username: string; displayName: string; password: string }) => Promise<void>;
  logout: () => Promise<void>;
  patchMe: (patchBody: Record<string, unknown>) => Promise<void>;
}

export const useAuth = create<AuthState>((set, get) => ({
  me: null,
  status: 'loading',

  async init() {
    const ok = await bootstrapSession();
    if (!ok) return set({ status: 'out', me: null });
    try {
      const { user } = await apiGet<{ user: Me }>('/auth/me');
      set({ me: user, status: 'in' });
    } catch {
      set({ status: 'out', me: null });
    }
  },

  async login(username, password) {
    const data = await post<any>('/auth/login', { username, password });
    setToken(data.accessToken);
    await saveRefreshToken(data.refreshToken || null);
    set({ me: data.user, status: 'in' });
  },

  async signup(input) {
    const data = await post<any>('/auth/signup', input);
    setToken(data.accessToken);
    await saveRefreshToken(data.refreshToken || null);
    set({ me: data.user, status: 'in' });
  },

  async logout() {
    try {
      await post('/auth/logout');
    } catch {
      /* going anyway */
    }
    setToken(null);
    await saveRefreshToken(null);
    set({ me: null, status: 'out' });
  },

  async patchMe(patchBody) {
    const { user } = await patch<{ user: Me }>('/users/me', patchBody);
    set({ me: { ...(get().me as Me), ...user } });
  },
}));

/* ── chat ────────────────────────────────────────────────────────────────── */

const uid = () => `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
const NO_MESSAGES: Message[] = [];

const sortOrder = (map: Record<string, Conversation>) =>
  Object.values(map)
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime();
    })
    .map((c) => c.id);

interface ChatState {
  conversations: Record<string, Conversation>;
  order: string[];
  messages: Record<string, Message[]>;
  hasMore: Record<string, boolean>;
  threads: Record<string, Message[]>;
  presence: Record<string, { online: boolean; lastSeen: string | null }>;
  typing: Record<string, string[]>;
  connected: boolean;
  activeId: string | null;

  load: () => Promise<void>;
  loadMessages: (id: string, more?: boolean) => Promise<void>;
  setActive: (id: string | null) => void;
  send: (input: {
    conversationId: string;
    type?: string;
    body?: string;
    media?: any;
    replyTo?: string | null;
    viewOnce?: boolean;
    transcript?: string;
    scheduledFor?: string | null;
    threadRoot?: string | null;
  }) => Promise<void>;
  markRead: (id: string) => void;
  react: (m: Message, emoji: string) => Promise<void>;
  star: (m: Message) => Promise<void>;
  remove: (m: Message, scope: 'me' | 'everyone') => Promise<void>;
  pin: (conversationId: string, messageId: string) => Promise<void>;
  unpin: (conversationId: string, messageId: string) => Promise<void>;
  openDirect: (userId: string) => Promise<string>;
  createGroup: (i: { name: string; memberIds: string[] }) => Promise<string>;
  updatePrefs: (id: string, prefs: Record<string, unknown>) => Promise<void>;
  setMood: (id: string, mood: string, note?: string) => Promise<void>;
  setWallpaper: (id: string, wp: Record<string, unknown>, force?: boolean) => Promise<void>;
  respondWallpaper: (id: string, accept: boolean) => Promise<void>;
  loadThread: (rootId: string) => Promise<void>;
  sendInThread: (rootId: string, body: string) => Promise<void>;

  onMessage: (m: Message) => void;
  onUpdate: (m: Message) => void;
  onConversation: (c: Conversation) => void;
  onReceipt: (kind: 'delivered' | 'read', p: any) => void;
  setTyping: (conversationId: string, userId: string, on: boolean) => void;
  setPresence: (userId: string, p: any) => void;
  setConnected: (v: boolean) => void;
}

export const useChat = create<ChatState>((set, get) => ({
  conversations: {},
  order: [],
  messages: {},
  hasMore: {},
  threads: {},
  presence: {},
  typing: {},
  connected: false,
  activeId: null,

  async load() {
    const { conversations } = await apiGet<{ conversations: Conversation[] }>('/conversations');
    const map: Record<string, Conversation> = {};
    conversations.forEach((c) => (map[c.id] = c));
    set({ conversations: map, order: sortOrder(map) });

    const ids = conversations.flatMap((c) => (c.partner ? [c.partner.id] : []));
    if (ids.length) {
      getSocket()?.emit('presence:who', ids, (p: any) =>
        set((s) => ({ presence: { ...s.presence, ...p } }))
      );
    }
  },

  async loadMessages(id, more = false) {
    const existing = get().messages[id] || [];
    const query = new URLSearchParams({ limit: '40' });
    if (more && existing.length) query.set('before', existing[0].createdAt);

    const data = await apiGet<{ messages: Message[]; hasMore: boolean }>(`/messages/${id}?${query}`);
    set((s) => {
      const current = s.messages[id] || [];
      const merged = more
        ? [...data.messages, ...current.filter((m) => !data.messages.some((n) => n.id === m.id))]
        : data.messages;
      return {
        messages: { ...s.messages, [id]: merged },
        hasMore: { ...s.hasMore, [id]: data.hasMore },
      };
    });
  },

  setActive(id) {
    set({ activeId: id });
    if (id) {
      if (!get().messages[id]) get().loadMessages(id).catch(() => {});
      get().markRead(id);
    }
  },

  async send({ conversationId, type = 'text', body = '', media, replyTo, viewOnce, transcript, scheduledFor, threadRoot }) {
    const clientId = uid();
    const meId = useAuth.getState().me?.id || '';

    if (scheduledFor || threadRoot) {
      const res = await emitAck<any>('message:send', {
        clientId,
        conversationId,
        type,
        body,
        media,
        replyTo,
        viewOnce,
        transcript,
        scheduledFor,
        threadRoot,
      });
      if (!res?.ok) throw new Error(res?.error || 'Could not send.');
      if (threadRoot && res.message) {
        set((s) => ({
          threads: {
            ...s.threads,
            [threadRoot]: [...(s.threads[threadRoot] || []), res.message],
          },
        }));
      }
      return;
    }

    // Optimistic: the bubble appears the instant you tap send.
    const optimistic: Message = {
      id: clientId,
      clientId,
      conversationId,
      sender: { id: meId },
      type,
      body,
      media: media || null,
      transcript: transcript || '',
      replyTo: replyTo ? { id: replyTo } : null,
      forwarded: false,
      reactions: [],
      deliveredTo: [],
      readBy: [],
      starred: false,
      deletedForAll: false,
      editedAt: null,
      editCount: 0,
      linkPreview: null,
      threadRootId: null,
      replyCount: 0,
      viewOnce: viewOnce ? { enabled: true, seen: false, burnt: false } : null,
      call: null,
      scheduledFor: null,
      createdAt: new Date().toISOString(),
      status: 'pending',
    };

    set((s) => ({
      messages: { ...s.messages, [conversationId]: [...(s.messages[conversationId] || []), optimistic] },
    }));

    try {
      const res = await emitAck<any>('message:send', {
        clientId,
        conversationId,
        type,
        body,
        media,
        replyTo,
        viewOnce,
        transcript,
      });
      if (!res?.ok || !res.message) throw new Error(res?.error || 'send failed');
      get().onMessage({ ...res.message, status: 'sent' });
    } catch {
      set((s) => ({
        messages: {
          ...s.messages,
          [conversationId]: (s.messages[conversationId] || []).map((m) =>
            m.clientId === clientId ? { ...m, status: 'failed' as const } : m
          ),
        },
      }));
    }
  },

  markRead(id) {
    const convo = get().conversations[id];
    if (!convo) return;
    getSocket()?.emit('message:read', { conversationId: id });
    set((s) => ({ conversations: { ...s.conversations, [id]: { ...convo, unread: 0 } } }));
  },

  async react(m, emoji) {
    const { message } = await post<{ message: Message }>(`/messages/${m.id}/react`, { emoji });
    get().onUpdate(message);
  },

  async star(m) {
    const { starred } = await post<{ starred: boolean }>(`/messages/${m.id}/star`);
    set((s) => ({
      messages: {
        ...s.messages,
        [m.conversationId]: (s.messages[m.conversationId] || []).map((x) =>
          x.id === m.id ? { ...x, starred } : x
        ),
      },
    }));
  },

  async remove(m, scope) {
    await del(`/messages/${m.id}?scope=${scope}`);
    if (scope === 'me') {
      set((s) => ({
        messages: {
          ...s.messages,
          [m.conversationId]: (s.messages[m.conversationId] || []).filter((x) => x.id !== m.id),
        },
      }));
    }
  },

  async pin(conversationId, messageId) {
    const { conversation } = await post<{ conversation: Conversation }>(
      `/conversations/${conversationId}/pins/${messageId}`
    );
    get().onConversation(conversation);
  },

  async unpin(conversationId, messageId) {
    const { conversation } = await del<{ conversation: Conversation }>(
      `/conversations/${conversationId}/pins/${messageId}`
    );
    get().onConversation(conversation);
  },

  async openDirect(userId) {
    const { conversation } = await post<{ conversation: Conversation }>('/conversations/direct', { userId });
    get().onConversation(conversation);
    return conversation.id;
  },

  async createGroup(input) {
    const { conversation } = await post<{ conversation: Conversation }>('/conversations/group', input);
    get().onConversation(conversation);
    return conversation.id;
  },

  async updatePrefs(id, prefs) {
    const { conversation } = await patch<{ conversation: Conversation }>(
      `/conversations/${id}/prefs`,
      prefs
    );
    get().onConversation(conversation);
  },

  async setMood(id, mood, note) {
    const { conversation } = await put<{ conversation: Conversation }>(`/rooms/${id}/mood`, { mood, note });
    get().onConversation(conversation);
  },

  async setWallpaper(id, wp, force) {
    const { conversation } = await put<{ conversation: Conversation }>(
      `/conversations/${id}/wallpaper${force ? '?force=1' : ''}`,
      wp
    );
    get().onConversation(conversation);
  },

  async respondWallpaper(id, accept) {
    const { conversation } = await post<{ conversation: Conversation }>(
      `/conversations/${id}/wallpaper/respond`,
      { accept }
    );
    get().onConversation(conversation);
  },

  async loadThread(rootId) {
    const data = await apiGet<{ root: Message; replies: Message[] }>(`/messages/thread/${rootId}`);
    set((s) => ({ threads: { ...s.threads, [rootId]: data.replies } }));
  },

  async sendInThread(rootId, body) {
    const conversationId = get().activeId;
    if (!conversationId || !body.trim()) return;
    await get().send({ conversationId, body: body.trim(), threadRoot: rootId });
  },

  /* ── socket handlers ───────────────────────────────────────────────────── */

  onMessage(m) {
    set((s) => {
      const list = s.messages[m.conversationId] || [];
      const without = list.filter((x) => !(m.clientId && x.clientId === m.clientId) && x.id !== m.id);
      const next = [...without, m].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );

      const convo = s.conversations[m.conversationId];
      const meId = useAuth.getState().me?.id;
      const isMine = m.sender.id === meId;
      const isActive = s.activeId === m.conversationId;

      const conversations = convo
        ? {
            ...s.conversations,
            [m.conversationId]: {
              ...convo,
              lastMessage: m,
              lastActivity: m.createdAt,
              unread: isMine || isActive ? convo.unread : convo.unread + 1,
            },
          }
        : s.conversations;

      return {
        messages: { ...s.messages, [m.conversationId]: next },
        conversations,
        order: sortOrder(conversations),
      };
    });

    if (get().activeId === m.conversationId) get().markRead(m.conversationId);
  },

  onUpdate(m) {
    set((s) => ({
      messages: {
        ...s.messages,
        [m.conversationId]: (s.messages[m.conversationId] || []).map((x) => (x.id === m.id ? m : x)),
      },
    }));
  },

  onConversation(c) {
    set((s) => {
      const conversations = { ...s.conversations, [c.id]: { ...s.conversations[c.id], ...c } };
      return { conversations, order: sortOrder(conversations) };
    });
  },

  onReceipt(kind, { conversationId, messageIds, userId, userIds }) {
    const who: string[] = userIds || (userId ? [userId] : []);
    set((s) => ({
      messages: {
        ...s.messages,
        [conversationId]: (s.messages[conversationId] || []).map((m) => {
          if (!messageIds.includes(m.id)) return m;
          const field = kind === 'read' ? 'readBy' : 'deliveredTo';
          return { ...m, [field]: [...new Set([...(m as any)[field], ...who])] };
        }),
      },
    }));
  },

  setTyping(conversationId, userId, on) {
    set((s) => {
      const current = s.typing[conversationId] || [];
      const next = on
        ? current.includes(userId)
          ? current
          : [...current, userId]
        : current.filter((u) => u !== userId);
      return { typing: { ...s.typing, [conversationId]: next } };
    });
  },

  setPresence(userId, p) {
    set((s) => ({ presence: { ...s.presence, [userId]: p } }));
  },

  setConnected: (connected) => set({ connected }),
}));

export const selectMessages = (id: string | null) => (s: ChatState) =>
  (id ? s.messages[id] : undefined) ?? NO_MESSAGES;
