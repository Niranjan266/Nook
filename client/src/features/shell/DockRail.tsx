import { useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { useChat } from '@/stores/chat';
import { useUi } from '@/stores/ui';
import { useAuth } from '@/stores/auth';
import { useFriends, selectPendingCount } from '@/stores/friends';
import Avatar from '@/components/Avatar';
import { spring, popIn } from '@/lib/motion';
import { usePhone, useMediaQuery } from '@/lib/useMediaQuery';
import {
  IconMenu,
  IconPlus,
  IconSettings,
  IconPhone,
  IconSearch,
  IconUser,
  IconSun,
  IconMoon,
} from '@/components/Icon';

/**
 * One tap between light and dark.
 *
 * 'system' resolves to the opposite of whatever is showing, so the tap always
 * visibly does something — a button that flips 'system' to 'system' would
 * appear to work only half the time. It shows where you are going, not where
 * you are: a moon in the daylight, a sun at night.
 */
export function ThemeToggle() {
  const theme = useUi((s) => s.theme);
  const setTheme = useUi((s) => s.setTheme);
  const me = useAuth((s) => s.me);
  const patchMe = useAuth((s) => s.patchMe);
  const systemDark = useMediaQuery('(prefers-color-scheme: dark)');
  const reduced = useReducedMotion();
  const dark = theme === 'dark' || (theme === 'system' && systemDark);
  const label = dark ? 'Switch to light theme' : 'Switch to dark theme';

  const flip = () => {
    const next = dark ? 'light' : 'dark';
    setTheme(next);
    // Same write the Settings sheet makes, so the two never disagree.
    if (me) patchMe({ settings: { ...me.settings, theme: next } }).catch(() => {});
  };

  return (
    <button
      className="clay-round"
      onClick={flip}
      aria-label={label}
      title={label}
      data-tour="theme"
      // Clips the outgoing icon's spin; the button's own shadow is untouched.
      style={{ overflow: 'hidden' }}
    >
      <AnimatePresence initial={false}>
        <motion.span
          key={dark ? 'sun' : 'moon'}
          // Both icons share one grid cell, so the swap is a true cross-fade.
          style={{ gridArea: '1 / 1', display: 'grid', placeItems: 'center' }}
          initial={reduced ? { opacity: 0 } : { opacity: 0, rotate: -120, scale: 0.4 }}
          animate={{ opacity: 1, rotate: 0, scale: 1 }}
          exit={reduced ? { opacity: 0 } : { opacity: 0, rotate: 120, scale: 0.4 }}
          transition={reduced ? { duration: 0.15 } : spring}
        >
          {dark ? <IconSun /> : <IconMoon />}
        </motion.span>
      </AnimatePresence>
    </button>
  );
}

export default function DockRail() {
  const { conversations, order, activeId, setActive, presence } = useChat();
  const { toggleShelf, openSheet } = useUi();
  const me = useAuth((s) => s.me);
  const pendingRequests = useFriends(selectPendingCount);
  const [hover, setHover] = useState<string | null>(null);
  const isPhone = usePhone();

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
        <button className="clay-round" onClick={() => openSheet('search')} aria-label="Search messages" data-tour="search">
          <IconSearch />
        </button>
        <button className="clay-round" onClick={() => openSheet('calls')} aria-label="Call history">
          <IconPhone />
        </button>
        {/* Only present when someone is actually waiting. A permanent icon for
            an empty inbox is a permanent invitation to check nothing. */}
        {pendingRequests > 0 && (
          <div className="rail-item">
            <button
              className="clay-round"
              onClick={() => openSheet('requests')}
              aria-label={`${pendingRequests} friend request${pendingRequests === 1 ? '' : 's'}`}
            >
              <IconUser />
            </button>
            <span className="chip">{pendingRequests > 9 ? '9+' : pendingRequests}</span>
          </div>
        )}
        <button
          className="clay-round"
          onClick={() => openSheet('new-chat')}
          aria-label="New conversation"
          data-tour="new-chat"
        >
          <IconPlus />
        </button>
        {/* The phone dock is already five across at 360px; there the toggle
            lives in the Shelf header instead. */}
        {!isPhone && <ThemeToggle />}
        <button
          className="clay-round"
          onClick={() => openSheet('settings')}
          aria-label="Settings and profile"
          data-tour="settings"
        >
          {me ? <Avatar name={me.displayName} src={me.avatarUrl} id={me.id} accent={me.accent} size={34} /> : <IconSettings />}
        </button>
      </div>
    </nav>
  );
}
