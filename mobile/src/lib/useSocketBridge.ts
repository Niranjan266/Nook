import { useEffect } from 'react';
import { AppState } from 'react-native';
import { connectSocket, disconnectSocket, getSocket } from './socket';
import { useChat } from '../stores';

/** Wires every server event into the store. One place, so nothing goes missing. */
export function useSocketBridge(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;

    const socket = connectSocket();
    const chat = useChat.getState;

    socket.on('connect', () => chat().setConnected(true));
    socket.on('disconnect', () => chat().setConnected(false));
    socket.on('connect_error', () => chat().setConnected(false));

    socket.on('message:new', (m) => chat().onMessage(m));
    socket.on('message:edit', (m) => chat().onUpdate(m));
    socket.on('message:react', (m) => chat().onUpdate(m));
    socket.on('message:preview', (m) => chat().onUpdate(m));
    socket.on('message:delete', (m) => chat().onUpdate(m));
    socket.on('message:snap-viewed', (m) => chat().onUpdate(m));

    socket.on('thread:new', ({ rootId, message, root }) => {
      useChat.setState((s) => ({
        threads: s.threads[rootId]
          ? { ...s.threads, [rootId]: [...s.threads[rootId].filter((m) => m.id !== message.id), message] }
          : s.threads,
        messages: {
          ...s.messages,
          [root.conversationId]: (s.messages[root.conversationId] || []).map((m) =>
            m.id === root.id ? { ...m, replyCount: root.replyCount } : m
          ),
        },
      }));
    });

    socket.on('receipt:delivered', (p) => chat().onReceipt('delivered', p));
    socket.on('receipt:read', (p) => chat().onReceipt('read', p));

    socket.on('typing:update', ({ conversationId, userId, typing }) =>
      chat().setTyping(conversationId, userId, typing)
    );
    socket.on('presence:update', ({ userId, online, lastSeen }) =>
      chat().setPresence(userId, { online, lastSeen })
    );

    socket.on('conversation:new', (c) => chat().onConversation(c));
    socket.on('conversation:update', (c) => chat().onConversation(c));
    socket.on('pins:changed', ({ conversationId, pins }) => {
      useChat.setState((s) => {
        const convo = s.conversations[conversationId];
        if (!convo) return s;
        return { conversations: { ...s.conversations, [conversationId]: { ...convo, pins } } };
      });
    });
    socket.on('wallpaper:changed', ({ conversationId, wallpaper }) => {
      useChat.setState((s) => {
        const convo = s.conversations[conversationId];
        if (!convo) return s;
        return { conversations: { ...s.conversations, [conversationId]: { ...convo, wallpaper } } };
      });
    });

    /**
     * Coming back from the background: the socket may have been killed by the
     * OS while suspended, and any messages sent meanwhile were missed. Reconnect
     * and re-sync rather than trusting the in-memory state.
     */
    const appState = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        const s = getSocket();
        if (!s?.connected) connectSocket();
        chat().load().catch(() => {});
        const activeId = chat().activeId;
        if (activeId) chat().loadMessages(activeId).catch(() => {});
      }
    });

    return () => {
      appState.remove();
      getSocket()?.removeAllListeners();
      disconnectSocket();
    };
  }, [enabled]);
}
