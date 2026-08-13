import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useChat } from '@/stores/chat';
import { useUi } from '@/stores/ui';
import { useAuth } from '@/stores/auth';
import Avatar from '@/components/Avatar';
import { spring, popIn } from '@/lib/motion';
import { IconMenu, IconPlus, IconSettings, IconPhone, IconSearch } from '@/components/Icon';

export default function DockRail() {
  const { conversations, order, activeId, setActive, presence } = useChat();
  const { toggleShelf, openSheet } = useUi();
  const me = useAuth((s) => s.me);
  const [hover, setHover] = useState<string | null>(null);

  const pinned = order.map((id) => conversations[id]).filter((c) => c && (c.pinned || c.unread > 0)).slice(0, 8);

  return (
    <nav className="rail" aria-label="Main">
      <button className="rail-logo" onClick={toggleShelf} aria-label="Toggle conversation list" title="Conversations">
        <img src="/logo.svg" alt="Nook" />
      </button>

      <button className="clay-round" onClick={toggleShelf} aria-label="Conversations">
        <IconMenu />
      </button>

      <div className="rail-scroll">
        <AnimatePresence initial={false}>
          {pinned.map((c) => {
            const online = c.partner ? presence[c.partner.id]?.online : false;
            return (
              <motion.div
                key={c.id}
                className={`rail-item${activeId === c.id ? ' active' : ''}`}
                variants={popIn}
                initial="hidden"
                animate="show"
                exit="exit"
                onMouseEnter={() => setHover(c.id)}
                onMouseLeave={() => setHover(null)}
              >
                <button
                  onClick={() => setActive(c.id)}
                  aria-label={c.name}
                  aria-current={activeId === c.id}
                  style={{ display: 'block' }}
                >
                  <Avatar
                    name={c.name}
                    src={c.avatarUrl}
                    id={c.partner?.id || c.id}
                    accent={c.partner?.accent}
                    size={46}
                    online={online}
                    showDot
                    square={c.type === 'group'}
                  />
                </button>
                {c.unread > 0 && <span className="chip">{c.unread > 99 ? '99+' : c.unread}</span>}
                <AnimatePresence>
                  {hover === c.id && (
                    <motion.span
                      className="rail-tip"
                      initial={{ opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -6 }}
                      transition={spring}
                    >
                      {c.name}
                    </motion.span>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      <div className="rail-foot">
        <button className="clay-round" onClick={() => openSheet('search')} aria-label="Search messages">
          <IconSearch />
        </button>
        <button className="clay-round" onClick={() => openSheet('calls')} aria-label="Call history">
          <IconPhone />
        </button>
        <button className="clay-round" onClick={() => openSheet('new-chat')} aria-label="New conversation">
          <IconPlus />
        </button>
        <button className="clay-round" onClick={() => openSheet('settings')} aria-label="Settings and profile">
          {me ? <Avatar name={me.displayName} src={me.avatarUrl} id={me.id} accent={me.accent} size={34} /> : <IconSettings />}
        </button>
      </div>
    </nav>
  );
}
