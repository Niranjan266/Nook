import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useChat } from '@/stores/chat';
import { useUi } from '@/stores/ui';
import { useAuth } from '@/stores/auth';
import Avatar from '@/components/Avatar';
import { stamp, previewOf } from '@/lib/format';
import { listStagger, listItem, spring } from '@/lib/motion';
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

export default function Shelf() {
  const { conversations, order, activeId, setActive, presence, typing } = useChat();
  const { openSheet, setShelf } = useUi();
  const folders = useAuth((s) => s.me?.folders ?? []);
  const [tab, setTab] = useState<Tab>('all');
  const [query, setQuery] = useState('');

  const meId = (window as any).__nookMeId as string;

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
        <h1 className="shelf-title">Nook</h1>
        <button className="clay-round" onClick={() => openSheet('new-chat')} aria-label="New conversation">
          <IconPlus />
        </button>
      </div>

      <div className="shelf-search">
        <label className="row" style={{ position: 'relative' }}>
          <span className="sr-only">Filter conversations</span>
          <IconSearch
            size={17}
            style={{ position: 'absolute', left: 14, color: 'var(--ink-faint)', pointerEvents: 'none' }}
          />
          <input
            className="groove"
            style={{ paddingLeft: 40 }}
            placeholder="Find a conversation"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>

      <div className="shelf-tabs" role="tablist">
        {BUILT_IN.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={`shelf-tab${tab === t.id ? ' on' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
        {folders.map((f) => (
          <button
            key={f.id}
            role="tab"
            aria-selected={tab === f.id}
            className={`shelf-tab${tab === f.id ? ' on' : ''}`}
            onClick={() => setTab(f.id)}
            title={`${f.conversations.length} in this folder`}
          >
            {f.emoji ? `${f.emoji} ` : ''}
            {f.name}
          </button>
        ))}
        <button
          className="shelf-tab"
          onClick={() => openSheet('folders')}
          aria-label="Manage folders"
          title="Folders"
        >
          <IconFolder size={15} />
        </button>
      </div>

      <motion.ul className="shelf-list" variants={listStagger} initial="hidden" animate="show">
        <AnimatePresence initial={false}>
          {list.map((c) => {
            const online = c.partner ? presence[c.partner.id]?.online : false;
            const someoneTyping = (typing[c.id] || []).length > 0;
            const last = c.lastMessage;
            const lastIsMine = last?.sender?.id === meId;

            return (
              <motion.li key={c.id} variants={listItem} layout exit={{ opacity: 0, x: -14 }} transition={spring}>
                <button
                  className={`tile${activeId === c.id ? ' active' : ''}${c.unread > 0 ? ' unread' : ''}`}
                  style={{ ['--tile-tint' as any]: c.wallpaper?.tint || undefined }}
                  onClick={() => pick(c.id)}
                  aria-current={activeId === c.id}
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

                  <span className="tile-body">
                    <span className="tile-top">
                      <span className="tile-name truncate">{c.name}</span>
                      {last && <span className="tile-time tabular">{stamp(last.createdAt)}</span>}
                    </span>

                    <span className="tile-bottom">
                      {someoneTyping ? (
                        <span className="tile-preview truncate" style={{ color: 'var(--moss-deep)', fontWeight: 600 }}>
                          typing…
                        </span>
                      ) : (
                        <>
                          {lastIsMine && last && (
                            <span
                              className={`ticks${last.readBy.length > 0 ? ' read' : ''}`}
                              style={{ color: last.readBy.length ? 'var(--clay-blue)' : 'var(--ink-faint)' }}
                            >
                              {last.status === 'pending' ? (
                                <IconClockSmall size={12} />
                              ) : last.readBy.length || last.deliveredTo.length ? (
                                <IconTickDouble size={15} />
                              ) : (
                                <IconTick size={15} />
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
                        {c.locked && <IconLock size={13} style={{ color: 'var(--ink-faint)' }} />}
                        {c.disappearAfter > 0 && <IconClock size={13} style={{ color: 'var(--ink-faint)' }} />}
                        {c.muted && <IconBellOff size={13} style={{ color: 'var(--ink-faint)' }} />}
                        {c.pinned && <IconPin size={13} style={{ color: 'var(--ink-faint)' }} />}
                        {c.unread > 0 && <span className="chip">{c.unread > 99 ? '99+' : c.unread}</span>}
                      </span>
                    </span>
                  </span>
                </button>
              </motion.li>
            );
          })}
        </AnimatePresence>

        {list.length === 0 && (
          <li className="stack" style={{ gap: 12, padding: '32px 16px', textAlign: 'center', alignItems: 'center' }}>
            <span className="clay-round" style={{ width: 54, height: 54, color: 'var(--ink-faint)' }}>
              <IconUsers />
            </span>
            <p className="small muted" style={{ maxWidth: 220 }}>
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
    </motion.aside>
  );
}
