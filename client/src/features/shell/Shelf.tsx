import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useChat } from '@/stores/chat';
import { useUi } from '@/stores/ui';
import { useAuth } from '@/stores/auth';
import Avatar from '@/components/Avatar';
import { stamp, previewOf } from '@/lib/format';
import { listStagger, listItem, spring, springs, popIn } from '@/lib/motion';
import { usePhone } from '@/lib/useMediaQuery';
import { ThemeToggle, Badge } from './DockRail';
import Logo from '@/components/Logo';
import {
  IconPlus,
  IconSearch,
  IconPin,
  IconBellOff,
  IconClock,
  IconLock,
  IconUsers,
  IconTick,
  IconTickDouble,
  IconClockSmall,
  IconFolder,
} from '@/components/Icon';

type Tab = string;

const BUILT_IN: { id: Tab; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'unread', label: 'Unread' },
  { id: 'groups', label: 'Groups' },
  { id: 'archived', label: 'Archived' },
];

/**
 * The list staggers in once per session. The shelf remounts every time a
 * phone comes back from a conversation, and a list that re-deals itself on
 * every return reads as a reload rather than a place you came back to.
 */
let dealt = false;

export default function Shelf() {
  const { conversations, order, activeId, setActive, presence, typing } = useChat();
  const { openSheet, setShelf } = useUi();
  const folders = useAuth((s) => s.me?.folders ?? []);
  const [tab, setTab] = useState<Tab>('all');
  const [query, setQuery] = useState('');
  const isPhone = usePhone();

  const meId = (window as any).__nookMeId as string;
  const me = useAuth((s) => s.me);
  const [firstDeal] = useState(() => !dealt);
  useEffect(() => {
    dealt = true;
  }, []);

  const list = useMemo(() => {
    let items = order.map((id) => conversations[id]).filter(Boolean);
    if (tab === 'archived') items = items.filter((c) => c.archived);
    else items = items.filter((c) => !c.archived);
    if (tab === 'unread') items = items.filter((c) => c.unread > 0);
    if (tab === 'groups') items = items.filter((c) => c.type === 'group');

    // A user-made folder. Your idea of "Work" is yours, so it lives on you and
    // not on the conversation.
    const folder = folders.find((f) => f.id === tab);
    if (folder) items = items.filter((c) => folder.conversations.includes(c.id));

    if (query.trim()) {
      const q = query.toLowerCase();
      items = items.filter(
        (c) => c.name.toLowerCase().includes(q) || (c.partner?.username || '').includes(q)
      );
    }
    return items;
  }, [conversations, order, tab, query, folders]);

  const pick = (id: string) => {
    setActive(id);
    if (window.innerWidth <= 900) setShelf(false);
  };

  return (
    <motion.aside
      className="shelf"
      aria-label="Conversations"
      initial={{ opacity: 0, x: -18 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -18 }}
      transition={spring}
    >
      <div className="shelf-head">
        <div className="shelf-brand">
          {isPhone && <Logo size={34} tile={false} />}
          <h1 className="shelf-title">Chats</h1>
        </div>
        {/* On a desk the rail carries it; the phone bar has no room left. */}
        {isPhone && <ThemeToggle className="clay-round" />}
        {isPhone ? (
          me && (
            <button className="shelf-me" onClick={() => openSheet('settings')} aria-label="Your profile">
              <Avatar name={me.displayName} src={me.avatarUrl} id={me.id} accent={me.accent} size={38} />
            </button>
          )
        ) : (
          <button className="clay-round" onClick={() => openSheet('new-chat')} aria-label="New conversation">
            <IconPlus />
          </button>
        )}
      </div>

      <label className="shelf-search">
        <span className="sr-only">Filter conversations</span>
        <IconSearch size={20} className="shelf-search-icon" />
        <input
          className="groove"
          placeholder="Find a conversation"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>

      <div className="shelf-tabs" role="tablist" data-tour="chats">
        {[...BUILT_IN, ...folders.map((f) => ({ id: f.id, label: `${f.emoji ? `${f.emoji} ` : ''}${f.name}`, count: f.conversations.length }))].map(
          (t: { id: Tab; label: string; count?: number }) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              className={`shelf-tab${tab === t.id ? ' on' : ''}`}
              onClick={() => setTab(t.id)}
              title={t.count !== undefined ? `${t.count} in this folder` : undefined}
            >
              {/* One pill for the whole row, so the choice slides across. */}
              {tab === t.id && <motion.span layoutId="shelf-tab-pill" className="shelf-tab-pill" transition={springs.pop} />}
              <span>{t.label}</span>
            </button>
          )
        )}
        <button
          className="shelf-tab shelf-tab-icon"
          onClick={() => openSheet('folders')}
          aria-label="Manage folders"
          title="Folders"
        >
          <span>
            <IconFolder size={16} />
          </span>
        </button>
      </div>

      <motion.ul
        className="shelf-list"
        variants={listStagger}
        initial={firstDeal ? 'hidden' : false}
        animate="show"
      >
        <AnimatePresence initial={false}>
          {list.map((c) => {
            const online = c.partner ? presence[c.partner.id]?.online : false;
            const someoneTyping = (typing[c.id] || []).length > 0;
            const last = c.lastMessage;
            const lastIsMine = last?.sender?.id === meId;

            return (
              // layout: a new message bumping a chat to the top slides it
              // there, and the others make room, instead of a jump cut.
              <motion.li
                key={c.id}
                variants={listItem}
                layout="position"
                exit={{ opacity: 0, x: -14, transition: { duration: 0.16 } }}
                transition={{ layout: springs.gentle }}
              >
                <button
                  className={`tile${activeId === c.id ? ' active' : ''}${c.unread > 0 ? ' unread' : ''}${c.type === 'secret' ? ' secret' : ''}`}
                  style={{ ['--tile-tint' as any]: c.wallpaper?.tint || undefined }}
                  onClick={() => pick(c.id)}
                  aria-current={activeId === c.id}
                >
                  <Avatar
                    name={c.name}
                    src={c.avatarUrl}
                    id={c.partner?.id || c.id}
                    accent={c.partner?.accent}
                    size={50}
                    online={online}
                    showDot
                    square={c.type === 'group'}
                  />

                  <span className="tile-body">
                    <span className="tile-top">
                      <span className="tile-name truncate">
                        {/* A secret chat sits beside the ordinary one with the same
                            name, so the lock is what tells them apart. */}
                        {c.type === 'secret' && <IconLock size={13} className="secret-lock" />}
                        {c.name}
                      </span>
                      {last && <span className="tile-time tabular">{stamp(last.createdAt)}</span>}
                    </span>

                    <span className="tile-bottom">
                      {someoneTyping ? (
                        <span className="tile-preview tile-typing truncate">
                          typing…
                        </span>
                      ) : (
                        <>
                          {lastIsMine && last && (
                            <span className={`tile-ticks${last.readBy.length > 0 ? ' read' : ''}`}>
                              {last.status === 'pending' ? (
                                <IconClockSmall size={14} />
                              ) : last.readBy.length || last.deliveredTo.length ? (
                                <IconTickDouble size={16} />
                              ) : (
                                <IconTick size={16} />
                              )}
                            </span>
                          )}
                          <span className="tile-preview truncate">
                            {c.type === 'group' && last && last.type !== 'system' && !lastIsMine
                              ? `${last.sender?.displayName?.split(' ')[0] || ''}: `
                              : ''}
                            {last ? previewOf(last) : 'No messages yet'}
                          </span>
                        </>
                      )}

                      <span className="tile-marks">
                        {c.locked && <IconLock size={14} />}
                        {c.disappearAfter > 0 && <IconClock size={14} />}
                        {c.muted && <IconBellOff size={14} />}
                        {c.pinned && <IconPin size={14} />}
                        {c.unread > 0 && <Badge n={c.unread} />}
                      </span>
                    </span>
                  </span>
                </button>
              </motion.li>
            );
          })}
        </AnimatePresence>

        {list.length === 0 && (
          <li className="shelf-empty">
            <span className="shelf-empty-art">
              <IconUsers />
            </span>
            <p>
              {query
                ? 'Nothing matches that.'
                : tab === 'archived'
                  ? 'Nothing archived.'
                  : tab === 'unread'
                    ? 'All caught up.'
                    : 'No conversations yet. Start one — you only need a username.'}
            </p>
            {!query && tab === 'all' && (
              <button className="slab slab-sm" onClick={() => openSheet('new-chat')}>
                <IconPlus size={16} /> New conversation
              </button>
            )}
          </li>
        )}
      </motion.ul>

      {isPhone && (
        <motion.button
          className="fab"
          onClick={() => openSheet('new-chat')}
          aria-label="New conversation"
          data-tour="new-chat"
          variants={popIn}
          initial="hidden"
          animate="show"
          whileTap={{ scale: 0.92 }}
        >
          <IconPlus size={26} />
        </motion.button>
      )}
    </motion.aside>
  );
}
