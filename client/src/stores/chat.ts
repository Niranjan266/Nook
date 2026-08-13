import { create } from 'zustand';
import { get as apiGet, post, patch, del, put } from '@/lib/api';
import { emitAck, getSocket } from '@/lib/socket';
import {
  enqueue,
  dequeue,
  readOutbox,
  cacheMessages,
  readCached,
  cacheConversations,
  readCachedConversations,
  type Outgoing,
} from '@/lib/outbox';
import { playSound, type SoundId } from '@/lib/sounds';
import type { Conversation, Message, Person } from '@/lib/types';

interface Presence {
  online: boolean;
  lastSeen: string | null;
}

interface ChatState {
  conversations: Record<string, Conversation>;
  order: string[];
  messages: Record<string, Message[]>;
  hasMore: Record<string, boolean>;
  loading: Record<string, boolean>;
  activeId: string | null;
  presence: Record<string, Presence>;
  typing: Record<string, string[]>;
  replyTo: Message | null;
  editing: Message | null;
  connected: boolean;

  hydrate: () => Promise<void>;
  loadConversations: () => Promise<void>;
  setActive: (id: string | null) => void;
  loadMessages: (conversationId: string, opts?: { more?: boolean }) => Promise<void>;

  send: (input: {
    conversationId: string;
    type?: string;
    body?: string;
    media?: any;
    viewOnce?: boolean;
    replyTo?: string | null;
    scheduledFor?: string | null;
    transcript?: string;
  }) => Promise<void>;
  retry: (clientId: string, conversationId: string) => Promise<void>;
  flushOutbox: () => Promise<void>;

  edit: (message: Message, body: string) => Promise<void>;
  remove: (message: Message, scope: 'me' | 'everyone') => Promise<void>;
  react: (message: Message, emoji: string) => Promise<void>;
  star: (message: Message) => Promise<void>;
  forward: (messageId: string, conversationIds: string[]) => Promise<void>;
  markSnapViewed: (messageId: string) => Promise<void>;

  setReplyTo: (m: Message | null) => void;
  setEditing: (m: Message | null) => void;

  openDirect: (userId: string) => Promise<string>;
  createGroup: (input: { name: string; memberIds: string[]; description?: string }) => Promise<string>;
  updatePrefs: (conversationId: string, prefs: Record<string, unknown>) => Promise<void>;
  setDisappearing: (conversationId: string, seconds: number) => Promise<void>;
  setWallpaper: (conversationId: string, wallpaper: Record<string, unknown>, force?: boolean) => Promise<void>;
  respondWallpaper: (conversationId: string, accept: boolean) => Promise<void>;
  addMembers: (conversationId: string, memberIds: string[]) => Promise<void>;
  removeMember: (conversationId: string, userId: string) => Promise<void>;
  setRole: (conversationId: string, userId: string, role: 'member' | 'admin') => Promise<void>;
  updateGroup: (conversationId: string, patchBody: Record<string, unknown>) => Promise<void>;

  markRead: (conversationId: string) => void;
  setTyping: (conversationId: string, userId: string, on: boolean) => void;
  applyPresence: (userId: string, p: Presence) => void;
  setConnected: (v: boolean) => void;

  /* ── section 4: threads, pins, folders ─────────────────────────────── */
  threads: Record<string, Message[]>;
  openThreadId: string | null;
  openThread: (rootId: string | null) => Promise<void>;
  sendInThread: (rootId: string, body: string) => Promise<void>;

  pin: (conversationId: string, messageId: string) => Promise<void>;
  unpin: (conversationId: string, messageId: string) => Promise<void>;

  /* ── rooms ─────────────────────────────────────────────────────────── */
  setMood: (conversationId: string, mood: string, note?: string, hours?: number) => Promise<void>;
  addWallObject: (conversationId: string, object: Record<string, unknown>) => Promise<void>;
  removeWallObject: (conversationId: string, objectId: string) => Promise<void>;
  setSchedule: (conversationId: string, schedule: Record<string, unknown>) => Promise<void>;
  restoreWallpaper: (conversationId: string, index: number) => Promise<void>;
  setPace: (conversationId: string, pace: { slowMode?: number; retentionDays?: number }) => Promise<void>;

  /* ── scheduled sends ───────────────────────────────────────────────── */
  scheduled: Message[];
  loadScheduled: () => Promise<void>;
  cancelScheduled: (id: string) => Promise<void>;

  /** socket entry points */
  onMessage: (m: Message) => void;
  onThreadReply: (payload: { rootId: string; message: Message; root: Message }) => void;
  onPins: (payload: { conversationId: string; pins: Conversation['pins'] }) => void;
  onMessageUpdate: (m: Message) => void;
  onConversation: (c: Conversation) => void;
  onConversationRemoved: (id: string) => void;
  onReceipt: (kind: 'delivered' | 'read', payload: any) => void;
  onWallpaper: (payload: { conversationId: string; wallpaper: Conversation['wallpaper'] }) => void;
}

const uid = () => `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const sortOrder = (convos: Record<string, Conversation>) =>
  Object.values(convos)
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime();
    })
    .map((c) => c.id);

export const useChat = create<ChatState>((set, get) => ({
  conversations: {},
  order: [],
  messages: {},
  hasMore: {},
  loading: {},
  activeId: null,
  presence: {},
  typing: {},
  replyTo: null,
  editing: null,
  connected: false,

  /* ── boot from cache, then network ──────────────────────────────────── */

  async hydrate() {
    /**
     * The network load starts immediately and is never gated behind the cache.
     * The cache is only allowed to paint if it wins the race — otherwise a slow
     * or wedged IndexedDB would stall the whole app behind an await that never
     * settles, and the user would just see an empty list with no error.
     */
    const fresh = get().loadConversations();

    readCachedConversations<Conversation>()
      .then((cached) => {
        if (!cached.length || Object.keys(get().conversations).length) return;
        const map: Record<string, Conversation> = {};
        cached.forEach((c) => (map[c.id] = c));
        set({ conversations: map, order: sortOrder(map) });
      })
      .catch(() => {});

    await fresh;
  },

  async loadConversations() {
    const { conversations } = await apiGet<{ conversations: Conversation[] }>('/conversations');
    const map: Record<string, Conversation> = {};
    conversations.forEach((c) => (map[c.id] = c));
    set({ conversations: map, order: sortOrder(map) });
    cacheConversations(conversations);

    const ids = conversations.flatMap((c) =>
      c.type === 'direct' && c.partner ? [c.partner.id] : []
    );
    if (ids.length) {
      getSocket()?.emit('presence:who', ids, (map2: Record<string, Presence>) => {
        set((s) => ({ presence: { ...s.presence, ...map2 } }));
      });
    }
  },

  setActive(id) {
    set({ activeId: id, replyTo: null, editing: null });
    if (id) {
      if (!get().messages[id]) get().loadMessages(id);
      get().markRead(id);
    }
  },

  async loadMessages(conversationId, { more = false } = {}) {
    if (get().loading[conversationId]) return;
    set((s) => ({ loading: { ...s.loading, [conversationId]: true } }));

    if (!more && !get().messages[conversationId]) {
      const cached = await readCached<Message>(conversationId);
      if (cached.length) set((s) => ({ messages: { ...s.messages, [conversationId]: cached } }));
    }

    try {
      const existing = get().messages[conversationId] || [];
      const oldest = more ? existing.find((m) => !m.status)?.createdAt : undefined;
      const query = new URLSearchParams({ limit: '40' });
      if (oldest) query.set('before', oldest);

      const data = await apiGet<{ messages: Message[]; hasMore: boolean }>(
        `/messages/${conversationId}?${query}`
      );

      set((s) => {
        const current = s.messages[conversationId] || [];
        const pending = current.filter((m) => m.status === 'pending' || m.status === 'failed');
        const merged = more
          ? [...data.messages, ...current.filter((m) => !data.messages.some((n) => n.id === m.id))]
          : [...data.messages, ...pending];
        return {
          messages: { ...s.messages, [conversationId]: merged },
          hasMore: { ...s.hasMore, [conversationId]: data.hasMore },
          loading: { ...s.loading, [conversationId]: false },
        };
      });
      cacheMessages(conversationId, get().messages[conversationId] || []);
    } catch {
      set((s) => ({ loading: { ...s.loading, [conversationId]: false } }));
    }
  },

  /* ── sending ────────────────────────────────────────────────────────── */

  async send({ conversationId, type = 'text', body = '', media, viewOnce, replyTo, scheduledFor, transcript }) {
    const clientId = uid();
    const meId = (window as any).__nookMeId as string;

    // A scheduled message doesn't belong in the stream yet — it hasn't happened.
    if (scheduledFor) {
      const res = await emitAck<{ ok: boolean; message?: Message; error?: string }>('message:send', {
        clientId,
        conversationId,
        type,
        body,
        media,
        replyTo: replyTo || null,
        viewOnce,
        transcript,
        scheduledFor,
      });
      if (!res?.ok) throw new Error(res?.error || 'Could not schedule that.');
      if (res.message) set((s) => ({ scheduled: [...s.scheduled, res.message!] }));
      return;
    }

    const optimistic: Message = {
      id: clientId,
      clientId,
      conversationId,
      sender: { id: meId },
      type: type as Message['type'],
      body,
      media: media || null,
      replyTo: replyTo ? { id: replyTo } : null,
      forwarded: false,
      mentions: [],
      reactions: [],
      deliveredTo: [],
      readBy: [],
      starred: false,
      deletedForAll: false,
      deletedForMe: false,
      editedAt: null,
      viewOnce: viewOnce ? { enabled: true, seen: false, burnt: false, viewers: [] } : null,
      call: null,
      expiresAt: null,
      createdAt: new Date().toISOString(),
      transcript: transcript || '',
      threadRootId: null,
      replyCount: 0,
      threadUpdatedAt: null,
      editCount: 0,
      linkPreview: null,
      scheduledFor: null,
      status: 'pending',
    };

    set((s) => ({
      messages: { ...s.messages, [conversationId]: [...(s.messages[conversationId] || []), optimistic] },
      replyTo: null,
    }));

    const payload: Outgoing = {
      clientId,
      conversationId,
      type,
      body,
      media,
      replyTo: replyTo || null,
      viewOnce,
      queuedAt: Date.now(),
    };

    try {
      const res = await emitAck<{ ok: boolean; message?: Message; error?: string }>(
        'message:send',
        payload
      );
      if (!res?.ok || !res.message) throw new Error(res?.error || 'send failed');
      get().onMessage({ ...res.message, status: 'sent' });
    } catch {
      await enqueue(payload);
      set((s) => ({
        messages: {
          ...s.messages,
          [conversationId]: (s.messages[conversationId] || []).map((m) =>
            m.clientId === clientId ? { ...m, status: 'failed' } : m
          ),
        },
      }));
    }
  },

  async retry(clientId, conversationId) {
    const msg = (get().messages[conversationId] || []).find((m) => m.clientId === clientId);
    if (!msg) return;
    set((s) => ({
      messages: {
        ...s.messages,
        [conversationId]: (s.messages[conversationId] || []).map((m) =>
          m.clientId === clientId ? { ...m, status: 'pending' } : m
        ),
      },
    }));
    try {
      const res = await emitAck<{ ok: boolean; message?: Message }>('message:send', {
        clientId,
        conversationId,
        type: msg.type,
        body: msg.body,
        media: msg.media,
        replyTo: msg.replyTo?.id || null,
        viewOnce: Boolean(msg.viewOnce?.enabled),
      });
      if (res?.ok && res.message) {
        await dequeue(clientId);
        get().onMessage({ ...res.message, status: 'sent' });
      } else throw new Error('failed');
    } catch {
      set((s) => ({
        messages: {
          ...s.messages,
          [conversationId]: (s.messages[conversationId] || []).map((m) =>
            m.clientId === clientId ? { ...m, status: 'failed' } : m
          ),
        },
      }));
    }
  },

  async flushOutbox() {
    const queued = await readOutbox();
    for (const item of queued) {
      try {
        const res = await emitAck<{ ok: boolean; message?: Message }>('message:send', item);
        if (res?.ok && res.message) {
          await dequeue(item.clientId);
          get().onMessage({ ...res.message, status: 'sent' });
        }
      } catch {
        break; // still offline — keep the rest queued, order preserved
      }
    }
  },

  /* ── message actions ────────────────────────────────────────────────── */

  async edit(message, body) {
    const { message: updated } = await patch<{ message: Message }>(`/messages/${message.id}`, { body });
    get().onMessageUpdate(updated);
    set({ editing: null });
  },

  async remove(message, scope) {
    await del(`/messages/${message.id}?scope=${scope}`);
    if (scope === 'me') {
      set((s) => ({
        messages: {
          ...s.messages,
          [message.conversationId]: (s.messages[message.conversationId] || []).filter(
            (m) => m.id !== message.id
          ),
        },
      }));
    }
  },

  async react(message, emoji) {
    // optimistic
    const meId = (window as any).__nookMeId as string;
    set((s) => ({
      messages: {
        ...s.messages,
        [message.conversationId]: (s.messages[message.conversationId] || []).map((m) => {
          if (m.id !== message.id) return m;
          const mine = m.reactions.find((r) => r.userId === meId);
          const rest = m.reactions.filter((r) => r.userId !== meId);
          return { ...m, reactions: mine?.emoji === emoji ? rest : [...rest, { userId: meId, emoji }] };
        }),
      },
    }));
    try {
      const { message: updated } = await post<{ message: Message }>(`/messages/${message.id}/react`, {
        emoji,
      });
      get().onMessageUpdate(updated);
    } catch {
      /* server rejected — next fetch corrects it */
    }
  },

  async star(message) {
    const { starred } = await post<{ starred: boolean }>(`/messages/${message.id}/star`);
    set((s) => ({
      messages: {
        ...s.messages,
        [message.conversationId]: (s.messages[message.conversationId] || []).map((m) =>
          m.id === message.id ? { ...m, starred } : m
        ),
      },
    }));
  },

  async forward(messageId, conversationIds) {
    await post(`/messages/${messageId}/forward`, { conversationIds });
  },

  async markSnapViewed(messageId) {
    await post(`/messages/${messageId}/view`);
  },

  setReplyTo: (replyTo) => set({ replyTo, editing: null }),
  setEditing: (editing) => set({ editing, replyTo: null }),

  /* ── conversation actions ───────────────────────────────────────────── */

  async openDirect(userId) {
    const { conversation } = await post<{ conversation: Conversation }>('/conversations/direct', {
      userId,
    });
    get().onConversation(conversation);
    return conversation.id;
  },

  async createGroup(input) {
    const { conversation } = await post<{ conversation: Conversation }>('/conversations/group', input);
    get().onConversation(conversation);
    return conversation.id;
  },

  async updatePrefs(conversationId, prefs) {
    const { conversation } = await patch<{ conversation: Conversation }>(
      `/conversations/${conversationId}/prefs`,
      prefs
    );
    get().onConversation(conversation);
  },

  async setDisappearing(conversationId, seconds) {
    const { conversation } = await patch<{ conversation: Conversation }>(
      `/conversations/${conversationId}/disappearing`,
      { seconds }
    );
    get().onConversation(conversation);
  },

  async setWallpaper(conversationId, wallpaper, force) {
    const { conversation } = await put<{ conversation: Conversation }>(
      `/conversations/${conversationId}/wallpaper${force ? '?force=1' : ''}`,
      wallpaper
    );
    get().onConversation(conversation);
  },

  async respondWallpaper(conversationId, accept) {
    const { conversation } = await post<{ conversation: Conversation }>(
      `/conversations/${conversationId}/wallpaper/respond`,
      { accept }
    );
    get().onConversation(conversation);
  },

  async addMembers(conversationId, memberIds) {
    const { conversation } = await post<{ conversation: Conversation }>(
      `/conversations/${conversationId}/members`,
      { memberIds }
    );
    get().onConversation(conversation);
  },

  async removeMember(conversationId, userId) {
    await del(`/conversations/${conversationId}/members/${userId}`);
    const meId = (window as any).__nookMeId as string;
    if (userId === meId) get().onConversationRemoved(conversationId);
    else await get().loadConversations();
  },

  async setRole(conversationId, userId, role) {
    await patch(`/conversations/${conversationId}/members/${userId}/role`, { role });
    await get().loadConversations();
  },

  async updateGroup(conversationId, patchBody) {
    const { conversation } = await patch<{ conversation: Conversation }>(
      `/conversations/${conversationId}/group`,
      patchBody
    );
    get().onConversation(conversation);
  },

  /* ── receipts, presence, typing ─────────────────────────────────────── */

  markRead(conversationId) {
    const convo = get().conversations[conversationId];
    if (!convo) return;
    getSocket()?.emit('message:read', { conversationId });
    set((s) => ({
      conversations: { ...s.conversations, [conversationId]: { ...convo, unread: 0 } },
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

  applyPresence(userId, p) {
    set((s) => ({ presence: { ...s.presence, [userId]: p } }));
  },

  setConnected: (connected) => set({ connected }),

  /* ── threads ────────────────────────────────────────────────────────── */

  threads: {},
  openThreadId: null,

  async openThread(rootId) {
    set({ openThreadId: rootId });
    if (!rootId) return;
    const data = await apiGet<{ root: Message; replies: Message[] }>(`/messages/thread/${rootId}`);
    set((s) => ({
      threads: { ...s.threads, [rootId]: data.replies },
      messages: {
        ...s.messages,
        [data.root.conversationId]: (s.messages[data.root.conversationId] || []).map((m) =>
          m.id === data.root.id ? data.root : m
        ),
      },
    }));
  },

  async sendInThread(rootId, body) {
    const conversationId = get().activeId;
    if (!conversationId || !body.trim()) return;
    const res = await emitAck<{ ok: boolean; message?: Message }>('message:send', {
      conversationId,
      body: body.trim(),
      threadRoot: rootId,
      clientId: uid(),
    });
    if (res?.ok && res.message) {
      set((s) => ({
        threads: {
          ...s.threads,
          [rootId]: [...(s.threads[rootId] || []).filter((m) => m.id !== res.message!.id), res.message!],
        },
      }));
    }
  },

  /* ── pins ───────────────────────────────────────────────────────────── */

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

  /* ── rooms ──────────────────────────────────────────────────────────── */

  async setMood(conversationId, mood, note, hours) {
    const { conversation } = await put<{ conversation: Conversation }>(`/rooms/${conversationId}/mood`, {
      mood,
      note,
      hours,
    });
    get().onConversation(conversation);
  },

  async addWallObject(conversationId, object) {
    const { conversation } = await post<{ conversation: Conversation }>(
      `/rooms/${conversationId}/wall`,
      object
    );
    get().onConversation(conversation);
  },

  async removeWallObject(conversationId, objectId) {
    const { conversation } = await del<{ conversation: Conversation }>(
      `/rooms/${conversationId}/wall/${objectId}`
    );
    get().onConversation(conversation);
  },

  async setSchedule(conversationId, schedule) {
    const { conversation } = await put<{ conversation: Conversation }>(
      `/rooms/${conversationId}/schedule`,
      schedule
    );
    get().onConversation(conversation);
  },

  async restoreWallpaper(conversationId, index) {
    const { conversation } = await post<{ conversation: Conversation }>(
      `/rooms/${conversationId}/history/${index}/restore`
    );
    get().onConversation(conversation);
  },

  async setPace(conversationId, pace) {
    const { conversation } = await patch<{ conversation: Conversation }>(
      `/rooms/${conversationId}/pace`,
      pace
    );
    get().onConversation(conversation);
  },

  /* ── scheduled sends ────────────────────────────────────────────────── */

  scheduled: [],

  async loadScheduled() {
    const { messages } = await apiGet<{ messages: Message[] }>('/messages/scheduled/all');
    set({ scheduled: messages });
  },

  async cancelScheduled(id) {
    await del(`/messages/scheduled/${id}`);
    set((s) => ({ scheduled: s.scheduled.filter((m) => m.id !== id) }));
  },

  /* ── socket handlers ────────────────────────────────────────────────── */

  onThreadReply({ rootId, message, root }) {
    set((s) => {
      const existing = s.threads[rootId] || [];
      const threads = s.threads[rootId]
        ? { ...s.threads, [rootId]: [...existing.filter((m) => m.id !== message.id), message] }
        : s.threads;

      return {
        threads,
        messages: {
          ...s.messages,
          [root.conversationId]: (s.messages[root.conversationId] || []).map((m) =>
            m.id === root.id ? { ...m, replyCount: root.replyCount, threadUpdatedAt: root.threadUpdatedAt } : m
          ),
        },
      };
    });
  },

  onPins({ conversationId, pins }) {
    set((s) => {
      const convo = s.conversations[conversationId];
      if (!convo) return s;
      return { conversations: { ...s.conversations, [conversationId]: { ...convo, pins } } };
    });
  },

  onMessage(m) {
    set((s) => {
      const list = s.messages[m.conversationId] || [];
      const withoutOptimistic = list.filter(
        (x) => !(m.clientId && x.clientId === m.clientId) && x.id !== m.id
      );
      const next = [...withoutOptimistic, m].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );

      const convo = s.conversations[m.conversationId];
      const meId = (window as any).__nookMeId as string;
      const isMine = m.sender.id === meId;
      const isActive = s.activeId === m.conversationId && document.visibilityState === 'visible';

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

    cacheMessages(m.conversationId, get().messages[m.conversationId] || []);

    // Per-person tone. Silent if it's mine, if the chat is muted, if sound is
    // off globally, or if I'm already looking at this exact conversation.
    const meId = (window as any).__nookMeId as string;
    const convo = get().conversations[m.conversationId];
    const looking = get().activeId === m.conversationId && document.visibilityState === 'visible';
    if (m.sender.id !== meId && convo && !convo.muted && !looking) {
      const soundOn = (window as any).__nookSoundOn !== false;
      if (soundOn) playSound((convo.sound || 'default') as SoundId);
    }

    if (looking) get().markRead(m.conversationId);
  },

  onMessageUpdate(m) {
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
    cacheConversations(Object.values(get().conversations));
  },

  onConversationRemoved(id) {
    set((s) => {
      const conversations = { ...s.conversations };
      delete conversations[id];
      const messages = { ...s.messages };
      delete messages[id];
      return {
        conversations,
        messages,
        order: sortOrder(conversations),
        activeId: s.activeId === id ? null : s.activeId,
      };
    });
  },

  onReceipt(kind, payload) {
    const { conversationId, messageIds, userId, userIds } = payload;
    const who: string[] = userIds || (userId ? [userId] : []);
    set((s) => ({
      messages: {
        ...s.messages,
        [conversationId]: (s.messages[conversationId] || []).map((m) => {
          if (!messageIds.includes(m.id)) return m;
          const field = kind === 'read' ? 'readBy' : 'deliveredTo';
          const merged = [...new Set([...(m[field] as string[]), ...who])];
          return { ...m, [field]: merged };
        }),
      },
    }));
  },

  onWallpaper({ conversationId, wallpaper }) {
    set((s) => {
      const convo = s.conversations[conversationId];
      if (!convo) return s;
      return {
        conversations: { ...s.conversations, [conversationId]: { ...convo, wallpaper } },
      };
    });
  },
}));

export const selectActive = (s: ChatState) => (s.activeId ? s.conversations[s.activeId] : null);

/** Stable reference — a fresh [] from a selector re-renders forever. */
const NO_MESSAGES: Message[] = [];
export const selectMessages = (s: ChatState) =>
  (s.activeId ? s.messages[s.activeId] : undefined) ?? NO_MESSAGES;
