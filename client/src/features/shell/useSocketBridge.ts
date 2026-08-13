import { useEffect } from 'react';
import { connectSocket, disconnectSocket, getSocket } from '@/lib/socket';
import { useChat } from '@/stores/chat';
import { useCall } from '@/stores/call';
import { useUi } from '@/stores/ui';
import { useAuth } from '@/stores/auth';
import { playNudge } from '@/lib/sounds';

/** Wires every server event into the stores. One place, so nothing goes missing. */
export function useSocketBridge(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;

    const socket = connectSocket();
    const chat = useChat.getState;
    const call = useCall.getState;
    const ui = useUi.getState;

    socket.on('connect', () => {
      chat().setConnected(true);
      chat().flushOutbox();
    });
    socket.on('disconnect', () => chat().setConnected(false));
    socket.on('connect_error', () => chat().setConnected(false));

    socket.on('message:new', (m) => chat().onMessage(m));
    socket.on('message:edit', (m) => chat().onMessageUpdate(m));
    socket.on('message:preview', (m) => chat().onMessageUpdate(m));
    socket.on('thread:new', (p) => chat().onThreadReply(p));
    socket.on('pins:changed', (p) => chat().onPins(p));

    // A scheduled message finally landing is just a normal message arriving.
    socket.on('message:scheduled', () => chat().loadScheduled().catch(() => {}));

    socket.on('nudge', ({ from }) => {
      playNudge();
      ui().toast(`${from.displayName} nudged you`);
      if (navigator.vibrate) navigator.vibrate([120, 60, 120]);
    });
    socket.on('message:react', (m) => chat().onMessageUpdate(m));
    socket.on('message:snap-viewed', (m) => chat().onMessageUpdate(m));
    socket.on('message:delete', (m) => chat().onMessageUpdate(m));

    socket.on('receipt:delivered', (p) => chat().onReceipt('delivered', p));
    socket.on('receipt:read', (p) => chat().onReceipt('read', p));

    socket.on('typing:update', ({ conversationId, userId, typing }) =>
      chat().setTyping(conversationId, userId, typing)
    );
    socket.on('presence:update', ({ userId, online, lastSeen }) =>
      chat().applyPresence(userId, { online, lastSeen })
    );

    socket.on('conversation:new', (c) => chat().onConversation(c));
    socket.on('conversation:update', (c) => chat().onConversation(c));
    socket.on('conversation:removed', ({ conversationId }) => chat().onConversationRemoved(conversationId));
    socket.on('wallpaper:changed', (p) => chat().onWallpaper(p));

    socket.on('call:incoming', (p) => call().receive(p));
    socket.on('call:answered', (p) => call().onAnswered(p));
    socket.on('call:ice', (p) => call().onIce(p));
    socket.on('call:ended', (p) => call().onEnded(p));
    socket.on('call:cancelled', () => call().onEnded({ callId: '', reason: 'cancelled' }));

    socket.on('snap:peeked', ({ byName }) =>
      ui().toast(`${byName} may have taken a screenshot of your snap.`, true)
    );

    const onOnline = () => chat().flushOutbox();
    window.addEventListener('online', onOnline);

    const onVisible = () => {
      const activeId = useChat.getState().activeId;
      if (document.visibilityState === 'visible' && activeId) useChat.getState().markRead(activeId);
    };
    document.addEventListener('visibilitychange', onVisible);

    const onSwMessage = (e: MessageEvent) => {
      if (e.data?.type === 'open-conversation' && e.data.conversationId) {
        useChat.getState().setActive(e.data.conversationId);
      }
    };
    navigator.serviceWorker?.addEventListener('message', onSwMessage);

    return () => {
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
      navigator.serviceWorker?.removeEventListener('message', onSwMessage);
      getSocket()?.removeAllListeners();
      disconnectSocket();
    };
  }, [enabled]);
}
