import { create } from 'zustand';
import { get, post, del } from '@/lib/api';
import type { Person } from '@/lib/types';

export interface FriendRequest {
  user: Person;
  note: string;
  at: string;
}

interface FriendState {
  incoming: FriendRequest[];
  outgoing: FriendRequest[];
  loaded: boolean;

  load: () => Promise<void>;
  send: (userId: string, note?: string) => Promise<string>;
  accept: (userId: string) => Promise<void>;
  decline: (userId: string) => Promise<void>;
  cancel: (userId: string) => Promise<void>;
  unfriend: (userId: string) => Promise<void>;

  /** Socket arrivals. */
  onRequest: (r: FriendRequest) => void;
  onResolved: (userId: string) => void;
}

/**
 * Friend requests, kept in their own store rather than folded into the chat
 * store. They are not conversations: they arrive when no chat exists yet, they
 * disappear on an action taken from three different screens, and the badge
 * that counts them has to be right everywhere at once. One small store that
 * every screen reads beats each screen keeping its own copy and drifting.
 */
export const useFriends = create<FriendState>((set, store) => ({
  incoming: [],
  outgoing: [],
  loaded: false,

  async load() {
    const r = await get<{ incoming: FriendRequest[]; outgoing: FriendRequest[] }>(
      '/users/friends/requests'
    );
    set({ incoming: r.incoming || [], outgoing: r.outgoing || [], loaded: true });
  },

  async send(userId, note) {
    const r = await post<{ friendship: string }>(`/users/${userId}/friend`, note ? { note } : {});
    await store().load();
    return r.friendship;
  },

  async accept(userId) {
    await post(`/users/${userId}/friend/accept`);
    // Drop it locally first so the row goes away on the tap rather than after
    // the round trip; `load` then reconciles with the server's truth.
    set((s) => ({ incoming: s.incoming.filter((r) => r.user.id !== userId) }));
    await store().load();
  },

  async decline(userId) {
    await post(`/users/${userId}/friend/decline`);
    set((s) => ({ incoming: s.incoming.filter((r) => r.user.id !== userId) }));
  },

  async cancel(userId) {
    await del(`/users/${userId}/friend`);
    set((s) => ({ outgoing: s.outgoing.filter((r) => r.user.id !== userId) }));
  },

  async unfriend(userId) {
    await post(`/users/${userId}/unfriend`);
    await store().load();
  },

  onRequest(r) {
    set((s) =>
      s.incoming.some((x) => x.user.id === r.user.id)
        ? s
        : { incoming: [r, ...s.incoming] }
    );
  },

  onResolved(userId) {
    set((s) => ({
      incoming: s.incoming.filter((r) => r.user.id !== userId),
      outgoing: s.outgoing.filter((r) => r.user.id !== userId),
    }));
  },
}));

export const selectPendingCount = (s: FriendState) => s.incoming.length;
