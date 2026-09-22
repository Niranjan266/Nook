import { create } from 'zustand';
import { get as apiGet, post, patch, del, put } from '@/lib/api';
import { emitAck, getSocket } from '@/lib/socket';
import {
  enqueue,
  dequeue,
  readOutbox,
  clearCacheScope,
  cacheMessages,
  readCached,
  cacheConversations,
  readCachedConversations,
  type Outgoing,
  type PollDraft,
} from '@/lib/outbox';
import { useUi } from '@/stores/ui';
import { watchConversation } from '@/lib/focus';
import type { Conversation, Message, Person, Reminder, ReminderDue, PollState, ListState } from '@/lib/types';
import { reveal, revealAll, seal, keepSent, myDeviceId, startSecretChat, resetSecretState, devicesOf } from '@/lib/e2ee/secret';
import { forgetDecrypted } from '@/lib/e2ee/media';
import type { SecretInner } from '@/lib/e2ee/localHistory';

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
  /** Lists cached before a reconnect, which may have missed events meanwhile. */
  stale: Record<string, boolean>;

  hydrate: () => Promise<void>;
  /** After a reconnect: refetch what the socket may have missed while down. */
  resync: () => Promise<void>;
  /** Sign-out: nothing of the previous account may survive into the next. */
  reset: () => void;
  loadConversations: () => Promise<void>;
  setActive: (id: string | null) => void;
  loadMessages: (conversationId: string, opts?: { more?: boolean }) => Promise<void>;

  send: (input: {
    conversationId: string;
    type?: string;
    body?: string;
    media?: any;
    viewOnce?: boolean;
    /** Seconds the recipient gets for a snap. 0 = until they close it. */
    viewSeconds?: number;
    replyTo?: string | null;
    scheduledFor?: string | null;
    transcript?: string;
    poll?: PollDraft;
    list?: { items: string[] };
  }) => Promise<void>;
  retry: (clientId: string, conversationId: string) => Promise<void>;
  flushOutbox: () => Promise<void>;

  edit: (message: Message, body: string) => Promise<void>;
  remove: (message: Message, scope: 'me' | 'everyone') => Promise<void>;
  react: (message: Message, emoji: string) => Promise<void>;
  star: (message: Message) => Promise<void>;
  forward: (messageId: string, conversationIds: string[]) => Promise<void>;
  markSnapViewed: (messageId: string) => Promise<void>;
  /** Keep a message, or a no-timer snap, so it does not disappear. */
  saveMessage: (messageId: string, saved: boolean) => Promise<void>;

  /* ── polls and shared lists ───────────────────────────────────────── */
  /** Make my votes exactly `optionIds`. Optimistic; rolls back on refusal. */
  votePoll: (message: Message, optionIds: string[]) => Promise<void>;
  closePoll: (message: Message) => Promise<void>;
  addListItem: (message: Message, text: string) => Promise<void>;
  toggleListItem: (message: Message, itemId: string, checked: boolean) => Promise<void>;
  removeListItem: (message: Message, itemId: string) => Promise<void>;

  setReplyTo: (m: Message | null) => void;
  setEditing: (m: Message | null) => void;

  openDirect: (userId: string) => Promise<string>;
  /** Start (or reopen) a secret chat with someone, on one of their devices. */
  openSecret: (userId: string, partnerDeviceId?: string) => Promise<string>;
  /** A secret attachment has been opened locally: point the bubble at it. */
  setSecretMediaUrl: (conversationId: string, messageId: string, url: string) => void;
  createGroup: (input: { name: string; memberIds: string[]; description?: string }) => Promise<string>;
  updatePrefs: (conversationId: string, prefs: Record<string, unknown>) => Promise<void>;
  setDisappearing: (conversationId: string, seconds: number) => Promise<void>;
  /** Chat lock. `code` is a PIN's digits or a pattern's dot sequence. */
  setLock: (conversationId: string, kind: 'pin' | 'pattern', code: string, currentCode?: string) => Promise<void>;
  removeLock: (conversationId: string, code: string) => Promise<void>;
  unlockChat: (conversationId: string, code: string) => Promise<void>;
  closeLock: (conversationId: string) => Promise<void>;

  setWallpaper: (
    conversationId: string,
    wallpaper: Record<string, unknown>,
    force?: boolean,
    scope?: 'mine' | 'ours'
  ) => Promise<void>;
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

  /* ── reminders ─────────────────────────────────────────────────────── */
  /** Pending, soonest first. */
  reminders: Reminder[];
  /** Fired in the last week, newest first. */
  recentReminders: Reminder[];
  /** messageId -> reminder id, for the bell on the bubble. */
  remindedIds: Record<string, string>;
  loadReminders: () => Promise<void>;
  setReminder: (messageId: string, remindAt: Date, note?: string) => Promise<Reminder>;
  cancelReminder: (id: string) => Promise<void>;
  onReminderDue: (due: ReminderDue) => void;

  /**
   * A message to scroll to once its conversation is on screen — from a
   * reminder, which points at one message rather than just a chat.
   */
  jumpTarget: { conversationId: string; messageId: string } | null;
  openAt: (conversationId: string, messageId?: string | null) => void;
  clearJump: () => void;

  /** socket entry points */
  onMessage: (m: Message) => void;
  /** onMessage for a message that is already readable. */
  applyMessage: (m: Message) => void;
  onThreadReply: (payload: { rootId: string; message: Message; root: Message }) => void;
  onPins: (payload: { conversationId: string; pins: Conversation['pins'] }) => void;
  onMessageUpdate: (m: Message) => void;
  onConversation: (c: Conversation) => void;
  onConversationRemoved: (id: string) => void;
  /** Read on another device or tab. */
  onConversationRead: (id: string) => void;
  onReceipt: (kind: 'delivered' | 'read', payload: any) => void;
  onWallpaper: (payload: { conversationId: string; wallpaper: Conversation['wallpaper'] }) => void;
}

/**
 * Only these mean "the server never heard it". Anything else is the server
 * answering no, and replaying a refusal from the outbox just earns the same
 * refusal on every reconnect, forever.
 */
const isTransient = (err: any) => err?.message === 'offline' || err?.message === 'timeout';

/** One flush at a time: `connect` and `online` often fire together. */
let flushing: Promise<void> | null = null;

const uid = () => `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

/** Bubbles ask "is there a bell on me?" — a lookup, not a scan of the list. */
const indexReminders = (list: Reminder[]) => {
  const out: Record<string, string> = {};
  for (const r of list) out[r.messageId] = r.id;
  return out;
};

/* ── poll and list helpers ─────────────────────────────────────────────── */

/** The optimistic poll: the draft, in the shape the bubble renders. */
const draftPoll = (d: PollDraft): PollState => ({
  multiple: d.multiple,
  anonymous: d.anonymous,
  closesAt: d.closesAt || null,
  closed: false,
  closedAt: null,
  closedBy: null,
  totalVoters: 0,
  options: d.options.map((text, i) => ({ id: `draft-${i}`, text, count: 0, voters: [] })),
  myVotes: [],
});

const pollDraftOf = (p: PollState): PollDraft => ({
  options: p.options.map((o) => o.text),
  multiple: p.multiple,
  anonymous: p.anonymous,
  closesAt: p.closesAt,
});

const draftList = (l: { items: string[] }, meId: string): ListState => ({
  items: l.items.map((text, i) => ({ id: `draft-${i}`, text, addedBy: meId, checkedBy: null, checkedAt: null })),
});

/**
 * My votes swapped for `next`, with every count and the voter total moved to
 * match. Counts are adjusted rather than recomputed from `voters`, because
 * on an anonymous poll `voters` is empty and would zero every bar.
 */
function withMyVotes(poll: PollState, meId: string, next: string[]): PollState {
  const had = new Set(poll.myVotes);
  const will = new Set(next);
  const options = poll.options.map((o) => {
    const delta = (will.has(o.id) ? 1 : 0) - (had.has(o.id) ? 1 : 0);
    if (!delta) return o;
    const voters = poll.anonymous
      ? o.voters
      : delta > 0
        ? [...o.voters, meId]
        : o.voters.filter((v) => v !== meId);
    return { ...o, count: Math.max(0, o.count + delta), voters };
  });
  const totalVoters = Math.max(0, poll.totalVoters + (will.size ? 1 : 0) - (had.size ? 1 : 0));
  return { ...poll, options, myVotes: next, totalVoters };
}

const findMessage = (messages: Record<string, Message[]>, m: Message) =>
  (messages[m.conversationId] || []).find((x) => x.id === m.id);

type SetChat = (fn: (s: ChatState) => Partial<ChatState>) => void;

const replaceMessage = (set: SetChat, next: Message) => {
  set((s) => ({
    messages: {
      ...s.messages,
      [next.conversationId]: (s.messages[next.conversationId] || []).map((x) => (x.id === next.id ? next : x)),
    },
  }));
  return next;
};

/**
 * Put back what was there before the tap — unless the server has already
 * sent something newer, in which case that is the truth and the guess is
 * simply gone. Comparing by reference is enough: every update replaces the
 * message object.
 */
function rollback(set: SetChat, get: () => ChatState, before: Message, guess: Message) {
  if (findMessage(get().messages, before) !== guess) return;
  replaceMessage(set, before);
}

const meIdNow = () => (window as any).__nookMeId as string;

/**
 * Secret chats never go into the message cache. Their readable copy lives in
 * the e2ee history store instead, which survives sign-out on purpose and is
 * what backups carry; a second plaintext copy in the cache would be one more
 * place for it to leak from and one more place to forget to clear.
 */
const cacheable = (conversations: Record<string, Conversation>, id: string) =>
  conversations[id]?.type !== 'secret';

/** What a secret message's ciphertext should carry, from what the composer passed. */
function innerOf(input: { type: string; body: string; media?: any; transcript?: string }, quote: Message | null): SecretInner {
  const inner: SecretInner = { t: input.type };
  if (input.body) inner.b = input.body;
  if (input.transcript) inner.tr = input.transcript;
  if (input.media?.key) {
    const m = input.media;
    inner.m = {
      url: m.url,
      key: m.key,
      iv: m.iv,
      mime: m.mime,
      name: m.name,
      size: m.size,
      width: m.width,
      height: m.height,
      duration: m.duration,
      waveform: m.waveform,
    };
  }
  if (quote) {
    inner.r = {
      id: quote.id,
      b: quote.body ? quote.body.slice(0, 200) : '',
      t: quote.type,
      n: quote.sender?.displayName || '',
    };
  }
  return inner;
}

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
  stale: {},

  /* ── boot from cache, then network ──────────────────────────────────── */

  async hydrate() {
    /**
     * The network load starts immediately and is never gated behind the cache.
     * The cache is only allowed to paint if it wins the race — otherwise a slow
     * or wedged IndexedDB would stall the whole app behind an await that never
     * settles, and the user would just see an empty list with no error.
     */
    const fresh = get().loadConversations();
    // Small, and needed for the bells on bubbles; never worth blocking on.
    get().loadReminders().catch(() => {});

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

  async resync() {
    const { activeId, messages } = get();
    // Every other list is kept for painting but refetched when next opened.
    const stale: Record<string, boolean> = {};
    Object.keys(messages).forEach((id) => {
      if (id !== activeId) stale[id] = true;
    });
    set({ stale });
    await Promise.all([
      get().loadConversations().catch(() => {}),
      // A reminder that fired while the socket was down never told this tab.
      get().loadReminders().catch(() => {}),
      activeId ? get().loadMessages(activeId) : Promise.resolve(),
    ]);
  },

  reset() {
    clearCacheScope();
    resetSecretState();
    forgetDecrypted();
    set({
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
      stale: {},
      threads: {},
      openThreadId: null,
      scheduled: [],
      reminders: [],
      recentReminders: [],
      remindedIds: {},
      jumpTarget: null,
    });
  },

  async loadConversations() {
    const { conversations } = await apiGet<{ conversations: Conversation[] }>('/conversations');
    const map: Record<string, Conversation> = {};
    conversations.forEach((c) => (map[c.id] = c));
    set({ conversations: map, order: sortOrder(map) });
    cacheConversations(conversations);

    const ids = conversations.flatMap((c) =>
      (c.type === 'direct' || c.type === 'secret') && c.partner ? [c.partner.id] : []
    );
    if (ids.length) {
      getSocket()?.emit('presence:who', ids, (map2: Record<string, Presence>) => {
        set((s) => ({ presence: { ...s.presence, ...map2 } }));
      });
    }
  },

  setActive(id) {
    set({ activeId: id, replyTo: null, editing: null });
    // The server decides whether to push based on this. Reported here rather
    // than in the view so it cannot be missed by a route that opens a chat
    // some other way.
    watchConversation(id);
    if (id) {
      if (!get().messages[id] || get().stale[id]) get().loadMessages(id);
      get().markRead(id);
    }
  },

  async loadMessages(conversationId, { more = false } = {}) {
    if (get().loading[conversationId]) return;
    set((s) => ({ loading: { ...s.loading, [conversationId]: true } }));

    if (!more && !get().messages[conversationId] && cacheable(get().conversations, conversationId)) {
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

      // Secret chats: open what this device can, before anything is drawn.
      const convo = get().conversations[conversationId];
      if (convo?.type === 'secret') data.messages = await revealAll(convo, data.messages, meIdNow());

      set((s) => {
        const current = s.messages[conversationId] || [];
        const pending = current.filter((m) => m.status === 'pending' || m.status === 'failed');
        // Anything that arrived over the socket while this request was in
        // flight is newer than the page it returns, and replacing the list
        // outright would drop it until the next reload.
        const fetched = new Set(data.messages.map((m) => m.id));
        const newest = data.messages.length
          ? new Date(data.messages[data.messages.length - 1].createdAt).getTime()
          : -Infinity;
        const arrived = current.filter(
          (m) =>
            m.status !== 'pending' &&
            m.status !== 'failed' &&
            !fetched.has(m.id) &&
            new Date(m.createdAt).getTime() > newest
        );
        const merged = more
          ? [...data.messages, ...current.filter((m) => !fetched.has(m.id))]
          : [...data.messages, ...arrived, ...pending];
        const stale = { ...s.stale };
        delete stale[conversationId];
        return {
          messages: { ...s.messages, [conversationId]: merged },
          stale,
          hasMore: { ...s.hasMore, [conversationId]: data.hasMore },
          loading: { ...s.loading, [conversationId]: false },
        };
      });
      if (cacheable(get().conversations, conversationId))
        cacheMessages(conversationId, get().messages[conversationId] || []);
    } catch {
      set((s) => ({ loading: { ...s.loading, [conversationId]: false } }));
    }
  },

  /* ── sending ────────────────────────────────────────────────────────── */

  async send({
    conversationId,
    type = 'text',
    body = '',
    media,
    viewOnce,
    viewSeconds,
    replyTo,
    scheduledFor,
    transcript,
    poll,
    list,
  }) {
    const clientId = uid();
    const meId = (window as any).__nookMeId as string;

    const convo = get().conversations[conversationId];
    if (convo?.type === 'secret') {
      if (scheduledFor) throw new Error('Secret messages cannot be scheduled.');
      const quote = replyTo ? (get().messages[conversationId] || []).find((m) => m.id === replyTo) || null : null;
      // The quote travels inside the ciphertext, named by the real name — the
      // reader's own nickname for the author would mean nothing to them.
      const authorName = quote
        ? (convo.members.find((mm) => mm.user.id === quote.sender.id)?.user as Person | undefined)?.realName ||
          (convo.members.find((mm) => mm.user.id === quote.sender.id)?.user as Person | undefined)?.displayName ||
          ''
        : '';
      const inner = innerOf({ type, body, media, transcript }, quote && { ...quote, sender: { ...quote.sender, displayName: authorName } });
      // Checked before sealing: a refusal after encrypting would spend a
      // counter the partner then has to skip over.
      if (new TextEncoder().encode(JSON.stringify(inner)).length > 15000)
        throw new Error('That secret message is too long — try splitting it.');
      // Encrypted before anything is shown or queued: the ratchet is saved
      // as it advances, so the wire string is the one thing a retry reuses.
      const wire = await seal(convo, inner);
      const createdAt = new Date().toISOString();
      await keepSent({
        // Filed under the clientId alias until the server names it; reveal()
        // re-files it under the real id when the echo arrives.
        id: `c:${clientId}`,
        clientId,
        conversationId,
        senderId: meId,
        inner,
        createdAt,
        expiresAt: convo.disappearAfter ? new Date(Date.now() + convo.disappearAfter * 1000).toISOString() : null,
      });

      const shown: Message = {
        id: clientId,
        clientId,
        conversationId,
        sender: { id: meId },
        type: 'encrypted',
        body: wire,
        media: null,
        replyTo: null,
        forwarded: false,
        mentions: [],
        reactions: [],
        deliveredTo: [],
        readBy: [],
        starred: false,
        deletedForAll: false,
        deletedForMe: false,
        editedAt: null,
        viewOnce: null,
        call: null,
        expiresAt: null,
        createdAt,
        transcript: '',
        threadRootId: null,
        replyCount: 0,
        threadUpdatedAt: null,
        editCount: 0,
        linkPreview: null,
        scheduledFor: null,
        status: 'pending',
      };
      const optimistic = { ...(await reveal(convo, shown, meId, await myDeviceId())), status: 'pending' as const };
      set((s) => ({
        messages: { ...s.messages, [conversationId]: [...(s.messages[conversationId] || []), optimistic] },
        replyTo: null,
      }));

      const payload: Outgoing = { clientId, conversationId, type: 'encrypted', body: wire, queuedAt: Date.now() };
      try {
        const res = await emitAck<{ ok: boolean; message?: Message; error?: string }>('message:send', payload);
        if (!res?.ok || !res.message) throw new Error(res?.error || 'send failed');
        get().onMessage({ ...res.message, status: 'sent' });
      } catch (err: any) {
        const transient = isTransient(err);
        if (transient) await enqueue(payload);
        set((s) => ({
          messages: {
            ...s.messages,
            [conversationId]: (s.messages[conversationId] || []).map((m) =>
              m.clientId === clientId ? { ...m, status: 'failed', failedReason: err?.message || '' } : m
            ),
          },
        }));
        if (!transient)
          useUi.getState().toast(
            err?.message && err.message !== 'send failed' ? err.message : 'That message could not be sent.',
            true
          );
      }
      return;
    }

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
        viewSeconds,
        transcript,
        scheduledFor,
        poll,
        list,
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
      viewOnce: viewOnce
        ? { enabled: true, seen: false, burnt: false, seconds: viewSeconds ?? 10, viewers: [] }
        : null,
      call: null,
      poll: poll ? draftPoll(poll) : null,
      list: list ? draftList(list, meId) : null,
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
      viewSeconds,
      transcript,
      poll,
      list,
      queuedAt: Date.now(),
    };

    try {
      const res = await emitAck<{ ok: boolean; message?: Message; error?: string }>(
        'message:send',
        payload
      );
      if (!res?.ok || !res.message) throw new Error(res?.error || 'send failed');
      get().onMessage({ ...res.message, status: 'sent' });
    } catch (err: any) {
      const transient = isTransient(err);
      if (transient) await enqueue(payload);
      set((s) => ({
        messages: {
          ...s.messages,
          [conversationId]: (s.messages[conversationId] || []).map((m) =>
            m.clientId === clientId ? { ...m, status: 'failed', failedReason: err?.message || '' } : m
          ),
        },
      }));

      /**
       * Say why.
       *
       * This `catch` swallowed everything: a refusal from the server, an
       * expired session, a dropped socket — all became an unexplained "failed"
       * bubble. Queuing for later is the right behaviour when the network is
       * simply gone, but it is the wrong behaviour when the server has said no
       * and will keep saying no, and the two were indistinguishable to anyone
       * looking at the screen. That is how "snap is not working" arrives with
       * nothing to go on.
       *
       * A refusal is reported; a transport failure stays quiet, because the
       * outbox really will send it and a toast for every subway tunnel would
       * be noise.
       */
      if (!transient)
        useUi.getState().toast(
          err?.message && err.message !== 'send failed' ? err.message : 'That message could not be sent.',
          true
        );
      else console.warn('  send  queued for later:', err);
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
    // Rebuilt from the bubble, so it has to carry everything the first send
    // did — a snap's timer and a voice note's transcript included.
    // A secret message resends its original ciphertext. Re-encrypting would
    // spend a second counter on the same words and leave a gap for no reason.
    const payload: Outgoing = msg.secret?.wire
      ? { clientId, conversationId, type: 'encrypted', body: msg.secret.wire, queuedAt: Date.now() }
      : {
      clientId,
      conversationId,
      type: msg.type,
      body: msg.body,
      media: msg.media,
      replyTo: msg.replyTo?.id || null,
      viewOnce: Boolean(msg.viewOnce?.enabled),
      viewSeconds: msg.viewOnce?.enabled ? msg.viewOnce.seconds : undefined,
      transcript: msg.transcript || undefined,
      // Rebuilt from the optimistic bubble, which holds the draft in the
      // serialised shape — turned back into what the send schema expects.
      poll: msg.type === 'poll' && msg.poll ? pollDraftOf(msg.poll) : undefined,
      list: msg.type === 'list' && msg.list ? { items: msg.list.items.map((i) => i.text) } : undefined,
      queuedAt: Date.now(),
    };
    try {
      const res = await emitAck<{ ok: boolean; message?: Message; error?: string }>('message:send', payload);
      if (!res?.ok || !res.message) throw new Error(res?.error || 'send failed');
      await dequeue(clientId);
      get().onMessage({ ...res.message, status: 'sent' });
    } catch (err: any) {
      const transient = isTransient(err);
      // Still offline: make sure it is queued exactly once. Refused: it must
      // not be, or the outbox would replay the refusal on every reconnect.
      await dequeue(clientId);
      if (transient) await enqueue(payload);
      else if (err?.message && err.message !== 'send failed') useUi.getState().toast(err.message, true);
      set((s) => ({
        messages: {
          ...s.messages,
          [conversationId]: (s.messages[conversationId] || []).map((m) =>
            m.clientId === clientId ? { ...m, status: 'failed', failedReason: err?.message || '' } : m
          ),
        },
      }));
    }
  },

  flushOutbox() {
    if (flushing) return flushing;
    flushing = (async () => {
      const queued = await readOutbox();
      for (const item of queued) {
        let res: { ok: boolean; message?: Message; error?: string };
        try {
          res = await emitAck('message:send', item);
        } catch {
          break; // still offline — keep the rest queued, order preserved
        }
        await dequeue(item.clientId);
        if (res?.ok && res.message) {
          get().onMessage({ ...res.message, status: 'sent' });
        } else {
          // The server heard it and said no. Show that on the bubble instead
          // of replaying it silently on every reconnect.
          set((s) => ({
            messages: {
              ...s.messages,
              [item.conversationId]: (s.messages[item.conversationId] || []).map((m) =>
                m.clientId === item.clientId ? { ...m, status: 'failed', failedReason: res?.error || '' } : m
              ),
            },
          }));
        }
      }
    })().finally(() => {
      flushing = null;
    });
    return flushing;
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
    // Fire and forget: the look has already been had, and a failed count is a
    // free replay rather than a lost message. Throwing here would surface an
    // error over a snap the person just finished looking at, which explains
    // nothing and interrupts the wrong moment.
    await post(`/messages/${messageId}/view`).catch(() => {});
  },

  async saveMessage(messageId, saved) {
    // Not caught: this one is a deliberate action with a button behind it, so
    // a refusal — a timer on the snap, or a snap already gone — has to be
    // said out loud rather than swallowed.
    const res = await post<{ ok: boolean; saved: boolean }>(`/messages/${messageId}/save`, { saved });
    // The server echoes `message:saved` too, but only once it has re-read the
    // row; reflecting the answer now means the button flips when it is tapped.
    const kept = res?.saved ?? saved;
    const meId = (window as any).__nookMeId as string;
    set((s) => {
      const messages = { ...s.messages };
      for (const [cid, list] of Object.entries(s.messages)) {
        if (!list.some((m) => m.id === messageId)) continue;
        messages[cid] = list.map((m) => {
          if (m.id !== messageId) return m;
          const others = (m.savedBy || []).filter((u) => u !== meId);
          return { ...m, saved: kept, savedBy: kept ? [...others, meId] : others };
        });
      }
      return { messages };
    });
  },

  /* ── polls and shared lists ─────────────────────────────────────────
     Each change is shown the moment it is tapped and put back exactly as
     it was if the server says no. The server's answer — and the
     `message:edit` broadcast that follows — then replaces the guess
     wholesale, so a vote cast by someone else in the same second is never
     overwritten by this device's optimistic copy.                         */

  async votePoll(message, optionIds) {
    const meId = (window as any).__nookMeId as string;
    const before = findMessage(get().messages, message);
    if (!before?.poll) return;
    const guess = replaceMessage(set, { ...before, poll: withMyVotes(before.poll, meId, optionIds) });
    try {
      const { message: updated } = await post<{ message: Message }>(`/messages/${message.id}/poll/vote`, {
        optionIds,
      });
      get().onMessageUpdate(updated);
    } catch (e: any) {
      rollback(set, get, before, guess);
      useUi.getState().toast(e?.message || 'Your vote did not go through.', true);
    }
  },

  async closePoll(message) {
    const { message: updated } = await post<{ message: Message }>(`/messages/${message.id}/poll/close`);
    get().onMessageUpdate(updated);
  },

  async addListItem(message, text) {
    // Not optimistic: the new row needs the server's id before it can be
    // ticked or removed, and adding is rare enough that the wait is fine.
    const { message: updated } = await post<{ message: Message }>(`/messages/${message.id}/list/items`, { text });
    get().onMessageUpdate(updated);
  },

  async toggleListItem(message, itemId, checked) {
    const meId = (window as any).__nookMeId as string;
    const before = findMessage(get().messages, message);
    if (!before?.list) return;
    const guess = replaceMessage(set, {
      ...before,
      list: {
        items: before.list.items.map((i) =>
          i.id === itemId
            ? { ...i, checkedBy: checked ? meId : null, checkedAt: checked ? new Date().toISOString() : null }
            : i
        ),
      },
    });
    try {
      const { message: updated } = await patch<{ message: Message }>(
        `/messages/${message.id}/list/items/${itemId}`,
        { checked }
      );
      get().onMessageUpdate(updated);
    } catch (e: any) {
      rollback(set, get, before, guess);
      useUi.getState().toast(e?.message || 'That did not save.', true);
    }
  },

  async removeListItem(message, itemId) {
    const before = findMessage(get().messages, message);
    if (!before?.list) return;
    const guess = replaceMessage(set, { ...before, list: { items: before.list.items.filter((i) => i.id !== itemId) } });
    try {
      const { message: updated } = await del<{ message: Message }>(`/messages/${message.id}/list/items/${itemId}`);
      get().onMessageUpdate(updated);
    } catch (e: any) {
      rollback(set, get, before, guess);
      useUi.getState().toast(e?.message || 'That item could not be removed.', true);
    }
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

  async openSecret(userId, partnerDeviceId) {
    /**
     * Reopen, don't duplicate. Tapping "New secret chat" on someone twice used
     * to make a second empty chat beside the first. Reuse is only right while
     * the old one still points at this device and at the partner's current
     * one — if they have moved phones, the old chat is bound to a device they
     * no longer read, and a fresh one is what they need.
     */
    const [mine, theirs] = await Promise.all([
      myDeviceId(),
      partnerDeviceId ? Promise.resolve(partnerDeviceId) : devicesOf(userId).then((d) => d[0]?.deviceId || null).catch(() => null),
    ]);
    if (mine && theirs) {
      const meId = meIdNow();
      const existing = Object.values(get().conversations).find((c) => {
        if (c.type !== 'secret' || !c.secret) return false;
        const ends = [c.secret.initiator, c.secret.responder];
        const me = ends.find((e) => e.userId === meId);
        const peer = ends.find((e) => e.userId === userId);
        return me?.deviceId === mine && peer?.deviceId === theirs;
      });
      if (existing) return existing.id;
    }
    const conversation = await startSecretChat(userId, partnerDeviceId);
    get().onConversation(conversation);
    return conversation.id;
  },

  setSecretMediaUrl(conversationId, messageId, url) {
    set((s) => ({
      messages: {
        ...s.messages,
        [conversationId]: (s.messages[conversationId] || []).map((m) =>
          m.id === messageId && m.media ? { ...m, media: { ...m.media, url, thumbUrl: '' } } : m
        ),
      },
    }));
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

  async setLock(conversationId, kind, code, currentCode) {
    const { conversation } = await put<{ conversation: Conversation }>(
      `/conversations/${conversationId}/lock`,
      { kind, code, ...(currentCode ? { currentCode } : {}) }
    );
    get().onConversation(conversation);
  },

  async removeLock(conversationId, code) {
    const { conversation } = await del<{ conversation: Conversation }>(
      `/conversations/${conversationId}/lock`,
      { code }
    );
    get().onConversation(conversation);
  },

  async unlockChat(conversationId, code) {
    const { conversation } = await post<{ conversation: Conversation }>(
      `/conversations/${conversationId}/lock/verify`,
      { code }
    );
    get().onConversation(conversation);
    // The history was refused while it was shut, so there is nothing cached
    // to show — fetch it now that the server will hand it over.
    await get().loadMessages(conversationId);
  },

  async closeLock(conversationId) {
    await post(`/conversations/${conversationId}/lock/close`);
    // Re-fetch so the preview disappears from the list at the same moment the
    // chat closes, rather than lingering until something else refreshes it.
    await get().loadConversations();
  },

  async setWallpaper(conversationId, wallpaper, force, scope) {
    // scope=mine writes to your own membership: no consent, nobody else sees it.
    const query = scope === 'mine' ? '?scope=mine' : force ? '?force=1' : '';
    const { conversation } = await put<{ conversation: Conversation }>(
      `/conversations/${conversationId}/wallpaper${query}`,
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

  /* ── reminders ──────────────────────────────────────────────────────── */

  reminders: [],
  recentReminders: [],
  remindedIds: {},
  jumpTarget: null,

  async loadReminders() {
    const { upcoming, recent } = await apiGet<{ upcoming: Reminder[]; recent: Reminder[] }>('/reminders');
    set({ reminders: upcoming, recentReminders: recent, remindedIds: indexReminders(upcoming) });
  },

  async setReminder(messageId, remindAt, note = '') {
    const { reminder } = await post<{ reminder: Reminder }>('/reminders', {
      messageId,
      remindAt: remindAt.toISOString(),
      note,
    });
    // Setting one twice moves it on the server, so replace rather than append.
    set((s) => {
      const reminders = [...s.reminders.filter((r) => r.id !== reminder.id), reminder].sort(
        (a, b) => new Date(a.remindAt).getTime() - new Date(b.remindAt).getTime()
      );
      return { reminders, remindedIds: indexReminders(reminders) };
    });
    return reminder;
  },

  async cancelReminder(id) {
    await del(`/reminders/${id}`);
    set((s) => {
      const reminders = s.reminders.filter((r) => r.id !== id);
      return { reminders, remindedIds: indexReminders(reminders) };
    });
  },

  onReminderDue(due) {
    set((s) => {
      const fired = s.reminders.find((r) => r.id === due.id);
      const reminders = s.reminders.filter((r) => r.id !== due.id);
      const recent = fired
        ? [{ ...fired, firedAt: new Date().toISOString(), gone: due.gone }, ...s.recentReminders]
        : s.recentReminders;
      return { reminders, recentReminders: recent, remindedIds: indexReminders(reminders) };
    });
  },

  openAt(conversationId, messageId) {
    set({ jumpTarget: messageId ? { conversationId, messageId } : null });
    // Jumping within the chat already open should not throw away a half-set
    // reply, which is what re-activating it would do.
    if (!messageId || get().activeId !== conversationId) get().setActive(conversationId);
  },

  clearJump: () => set({ jumpTarget: null }),

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
    if (m.type !== 'encrypted') return get().applyMessage(m);
    /**
     * Ciphertext: opened first, then handled like any other arrival. A chat
     * this device has not loaded yet still gets the message — as a
     * placeholder that the next load replaces with the real thing.
     */
    const convo = get().conversations[m.conversationId];
    if (!convo) return get().applyMessage({ ...m, type: 'text', body: '', secret: { state: 'waiting', wire: m.body } });
    myDeviceId()
      .then((deviceId) => reveal(convo, m, meIdNow(), deviceId))
      .then((shown) => get().applyMessage(shown))
      .catch(() => get().applyMessage({ ...m, type: 'text', body: '', secret: { state: 'failed', wire: m.body } }));
  },

  applyMessage(m) {
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

    if (cacheable(get().conversations, m.conversationId))
      cacheMessages(m.conversationId, get().messages[m.conversationId] || []);

    // No sound here: notify.messageArrived plays it, honouring the chat's
    // tone and the Settings switches. Both used to fire, so every message
    // chimed twice.
    const looking = get().activeId === m.conversationId && document.visibilityState === 'visible';

    if (looking) get().markRead(m.conversationId);
  },

  onMessageUpdate(m) {
    // Reactions, receipts and unsends of secret messages arrive as ciphertext
    // again; the kept copy makes reopening them free.
    if (m.type === 'encrypted' && !m.deletedForMe) {
      const convo = get().conversations[m.conversationId];
      if (convo) {
        myDeviceId()
          .then((deviceId) => reveal(convo, m, meIdNow(), deviceId))
          .then((shown) => {
            // Keep a file already opened on screen rather than flashing back.
            const current = (get().messages[m.conversationId] || []).find((x) => x.id === m.id);
            const media =
              current?.media?.url?.startsWith('blob:') && shown.media ? { ...shown.media, url: current.media.url } : shown.media;
            get().onMessageUpdate({ ...shown, media });
          })
          .catch(() => {});
        return;
      }
    }
    set((s) => {
      const list = s.messages[m.conversationId] || [];
      return {
        messages: {
          ...s.messages,
          // Deleted for me on another device: it goes, as it did on that one.
          [m.conversationId]: m.deletedForMe
            ? list.filter((x) => x.id !== m.id)
            : list.map((x) => (x.id === m.id ? m : x)),
        },
      };
    });
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

  onConversationRead(id) {
    set((s) => {
      const convo = s.conversations[id];
      if (!convo || !convo.unread) return s;
      return { conversations: { ...s.conversations, [id]: { ...convo, unread: 0 } } };
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
