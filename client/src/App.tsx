import { useEffect, useState, lazy, Suspense } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useAuth } from '@/stores/auth';
import { useChat, selectActive } from '@/stores/chat';
import { useUi } from '@/stores/ui';

import FrontDoor from '@/features/auth/FrontDoor';
import DockRail from '@/features/shell/DockRail';
import Shelf from '@/features/shell/Shelf';
import Conversation from '@/features/chat/Conversation';
import CallOverlay from '@/features/calls/CallOverlay';
import { useSocketBridge } from '@/features/shell/useSocketBridge';

import Toasts from '@/components/Toasts';
import Lightbox from '@/components/Lightbox';
import {
  NewChatSheet,
  NewGroupSheet,
  ForwardSheet,
  SearchSheet,
  StarredSheet,
  CallsSheet,
} from '@/features/sheets/PeopleSheets';
import ChatInfoSheet from '@/features/sheets/ChatInfoSheet';
import WallpaperSheet from '@/features/sheets/WallpaperSheet';
import SettingsSheet from '@/features/sheets/SettingsSheet';
import RoomSheet from '@/features/sheets/RoomSheet';
import FoldersSheet from '@/features/sheets/FoldersSheet';
import ScheduledSheet from '@/features/sheets/ScheduledSheet';
import MediaSheet from '@/features/sheets/MediaSheet';
import ThreadPanel from '@/features/chat/ThreadPanel';

import { registerServiceWorker } from '@/lib/push';
import { setToken } from '@/lib/api';
import { IMPERSONATE_KEY } from '@/lib/adminApi';
import { initTitle, watchFocus, onBanner } from '@/lib/notify';
import MessageBanner, { type BannerMessage } from '@/components/MessageBanner';
import { setCacheScope } from '@/lib/outbox';
import { usePhone, useNarrow } from '@/lib/useMediaQuery';
import { spring } from '@/lib/motion';
import { IconPlus, IconWarning } from '@/components/Icon';

function Empty() {
  const openSheet = useUi((s) => s.openSheet);
  return (
    <section className="surface">
      <div className="empty">
        <svg className="empty-art" viewBox="0 0 200 200" fill="none" aria-hidden="true">
          <rect x="18" y="26" width="164" height="132" rx="38" fill="var(--clay-surface)" />
          <path d="M72 146V98a28 28 0 0 1 56 0v48Z" fill="var(--accent)" opacity="0.92" />
          <rect x="72" y="140" width="56" height="6" fill="var(--ink)" opacity="0.15" />
          <path
            d="M46 60h30M46 74h18"
            stroke="var(--clay-edge)"
            strokeWidth="6"
            strokeLinecap="round"
          />
        </svg>
        <h3>Pick a conversation</h3>
        <p>
          Or start a new one. Nook only needs a username — no phone number, no address book upload, no
          suggested people you half know.
        </p>
        <button className="slab" onClick={() => openSheet('new-chat')}>
          <IconPlus size={17} /> New conversation
        </button>
      </div>
    </section>
  );
}

function OfflineBar() {
  const connected = useChat((s) => s.connected);
  return (
    <AnimatePresence>
      {!connected && (
        <motion.div
          className="toast bad"
          style={{ position: 'fixed', top: 12, left: '50%', zIndex: 130 }}
          initial={{ opacity: 0, y: -20, x: '-50%' }}
          animate={{ opacity: 1, y: 0, x: '-50%' }}
          exit={{ opacity: 0, y: -20, x: '-50%' }}
          transition={spring}
        >
          <IconWarning size={16} />
          Reconnecting — anything you send is queued
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * The admin panel is a separate chunk, fetched only when someone actually
 * visits /nookcontrol. Ordinary visitors never download a byte of it — which
 * matters for load time, and means the panel's existence is not advertised in
 * the main bundle.
 */
const AdminApp = lazy(() => import('@/features/admin/AdminApp'));

const isAdminRoute = () => window.location.pathname.replace(/\/+$/, '') === '/nookcontrol';

export default function App() {
  // Read once: this decides which application you are running, and it should
  // not change under you mid-session.
  const [adminRoute] = useState(isAdminRoute);

  if (adminRoute) {
    return (
      <Suspense fallback={<div className="center" style={{ height: '100dvh' }} />}>
        <AdminApp />
      </Suspense>
    );
  }

  return <Nook />;
}

function Nook() {
  const { me, status, init } = useAuth();
  const conversation = useChat(selectActive);
  const hydrate = useChat((s) => s.hydrate);
  const { shelfOpen, sheet } = useUi();
  const isPhone = usePhone();
  const isNarrow = useNarrow();

  useEffect(() => {
    /**
     * A session handed over by the admin panel. Adopted before init() so it
     * wins over whatever refresh cookie is lying around, and removed the
     * instant it is read — it is single-use by construction.
     */
    const handed = sessionStorage.getItem(IMPERSONATE_KEY);
    if (handed) {
      sessionStorage.removeItem(IMPERSONATE_KEY);
      setToken(handed);
    }
    init();
    registerServiceWorker();
    initTitle();
    return watchFocus();
  }, [init]);

  useEffect(() => {
    if (me) {
      (window as any).__nookMeId = me.id;
      (window as any).__nookSoundOn = me.settings?.soundOn ?? true;
      document.documentElement.dataset.accent = me.accent || 'terracotta';
      // Scope the offline cache to this account before anything reads it.
      setCacheScope(me.id);
      hydrate();
    }
  }, [me?.id]);

  /**
   * The arrival banner lives here rather than inside the chat view, so it
   * survives switching conversations and appears over sheets too — an
   * interruption that vanishes when you navigate is not an interruption.
   */
  const [banner, setBanner] = useState<BannerMessage | null>(null);
  useEffect(
    () =>
      onBanner((m) =>
        setBanner({
          // A fresh id per arrival restarts the dwell timer instead of
          // inheriting whatever was left of the previous one's.
          id: `${m.conversationId}:${Date.now()}`,
          conversationId: m.conversationId,
          title: m.conversationName || m.senderName,
          body: m.preview,
          avatarUrl: m.avatarUrl,
          accent: m.accent,
          onOpen: () => m.onOpen(m.conversationId),
        })
      ),
    []
  );

  useSocketBridge(Boolean(me));

  if (status === 'loading') {
    return (
      <div className="center" style={{ height: '100dvh' }}>
        <motion.img
          src="/logo.svg"
          alt="Nook"
          width={72}
          height={72}
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: [0.5, 1, 0.5], scale: 1 }}
          transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
        />
      </div>
    );
  }

  if (status === 'out' || !me) return <FrontDoor />;

  /**
   * Phone  — one pane at a time: the list, or the conversation.
   * Tablet — the conversation always; the list slides over it as a drawer.
   * Wide   — both, side by side.
   */
  const showShelf = isNarrow ? shelfOpen || !conversation : true;
  const showSurface = isPhone ? Boolean(conversation) && !shelfOpen : true;

  return (
    <>
      <div className="shell">
        <DockRail />

        <AnimatePresence initial={false}>{showShelf && <Shelf key="shelf" />}</AnimatePresence>

        {showSurface &&
          (conversation ? <Conversation key={conversation.id} conversation={conversation} /> : <Empty />)}
      </div>

      <NewChatSheet />
      <NewGroupSheet />
      <ForwardSheet />
      <SearchSheet />
      <StarredSheet />
      <CallsSheet />
      <ChatInfoSheet />
      <WallpaperSheet />
      <SettingsSheet />
      <RoomSheet />
      <FoldersSheet />
      <ScheduledSheet />
      <MediaSheet />

      <ThreadPanel />
      <CallOverlay />
      <Lightbox />
      <MessageBanner message={banner} onDismiss={() => setBanner(null)} />
      <Toasts />
      <OfflineBar />
    </>
  );
}
