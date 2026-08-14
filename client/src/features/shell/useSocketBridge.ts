import { useEffect } from 'react';
import { connectSocket, disconnectSocket, getSocket } from '@/lib/socket';
import { useChat } from '@/stores/chat';
import { useCall } from '@/stores/call';
import { useUi } from '@/stores/ui';
import { useAuth } from '@/stores/auth';
import { playNudge, type SoundId } from '@/lib/sounds';
import { previewOf } from '@/lib/format';
import * as notifier from '@/lib/notify';

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

    socket.on('message:new', (m) => {
      chat().onMessage(m);

      // Push covers people who are disconnected; this covers the case the
      // server deliberately skips — a live socket in a tab nobody is looking
      // at. Without it, being "online" meant being told nothing.
      const me = useAuth.getState().me;
      if (!me || m.sender?.id === me.id) return;

      const state = chat();
      const convo = state.conversations[m.conversationId];
      notifier.messageArrived({
        conversationId: m.conversationId,
        conversationName: convo?.name || m.sender?.displayName || 'Nook',
        senderName: m.sender?.displayName || 'Someone',
        preview: previewOf(m),
        isActive: state.activeId === m.conversationId,
        muted: Boolean(convo?.muted),
        sound: (convo?.sound as SoundId) || 'default',
        soundOn: me.settings?.soundOn ?? true,
        avatarUrl: convo?.avatarUrl || m.sender?.avatarUrl || '',
        accent: convo?.partner?.accent || m.sender?.accent,
        onOpen: (id) => chat().setActive(id),
      });
    });
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

    // A rename you made on another device. Names are resolved server-side, so
    // the cheapest correct response is to re-fetch rather than try to patch
    // the new name into every cached conversation, member list and message.
    socket.on('nickname:update', () => chat().loadConversations());
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
