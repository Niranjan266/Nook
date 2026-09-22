import { useState, type MouseEvent, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { useChat } from '@/stores/chat';
import { useUi, type SheetKind } from '@/stores/ui';
import { useAuth } from '@/stores/auth';
import { useFriends, selectPendingCount } from '@/stores/friends';
import Avatar from '@/components/Avatar';
import { spring, springs, popIn, prefersReducedMotion } from '@/lib/motion';
import { usePhone, useMediaQuery } from '@/lib/useMediaQuery';
import {
  IconChat,
  IconMenu,
  IconPlus,
  IconSettings,
  IconPhone,
  IconSearch,
  IconUser,
  IconSun,
  IconMoon,
} from '@/components/Icon';
import Logo from '@/components/Logo';

type Theme = 'light' | 'dark' | 'system';

/**
 * Switch the theme with a circle that grows out of `from`.
 *
 * The View Transitions API snapshots the old page, lets us change the theme,
 * and hands over both pictures; clipping the new one to a growing circle is
 * the whole effect. Where the API is missing (Firefox, older WebViews) or the
 * person asked for less motion, the switch falls back to the colour fade
 * main.tsx already runs.
 */
export function revealTheme(next: Theme, setTheme: (t: Theme) => void, from?: Element | null) {
  const doc = document as Document & {
    startViewTransition?: (cb: () => void) => { ready: Promise<void>; finished: Promise<void> };
  };
  if (!doc.startViewTransition || !from || prefersReducedMotion()) {
    setTheme(next);
    return;
  }
  const r = from.getBoundingClientRect();
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;
  const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  const root = document.documentElement;
  root.classList.add('theme-reveal');
  // flushSync: the new snapshot is taken when the callback returns, so the
  // icon swap has to have rendered by then too.
  const t = doc.startViewTransition(() => flushSync(() => setTheme(next)));
  t.ready
    .then(() =>
      root.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { duration: 520, easing: 'cubic-bezier(0.65, 0, 0.35, 1)', pseudoElement: '::view-transition-new(root)' }
      )
    )
    .catch(() => {});
  t.finished.finally(() => root.classList.remove('theme-reveal'));
}

/**
 * One tap between light and dark.
 *
 * 'system' resolves to the opposite of whatever is showing, so the tap always
 * visibly does something — a button that flips 'system' to 'system' would
 * appear to work only half the time. It shows where you are going, not where
 * you are: a moon in the daylight, a sun at night.
 */
export function ThemeToggle({ className = 'nav-btn theme-toggle' }: { className?: string }) {
  const theme = useUi((s) => s.theme);
  const setTheme = useUi((s) => s.setTheme);
  const me = useAuth((s) => s.me);
  const patchMe = useAuth((s) => s.patchMe);
  const systemDark = useMediaQuery('(prefers-color-scheme: dark)');
  const reduced = useReducedMotion();
  const dark = theme === 'dark' || (theme === 'system' && systemDark);
  const label = dark ? 'Switch to light theme' : 'Switch to dark theme';

  const flip = (e: MouseEvent<HTMLButtonElement>) => {
    const next = dark ? 'light' : 'dark';
    revealTheme(next, setTheme, e.currentTarget);
    // Same write the Settings sheet makes, so the two never disagree.
    if (me) patchMe({ settings: { ...me.settings, theme: next } }).catch(() => {});
  };

  return (
    <button
      className={className}
      onClick={flip}
      aria-label={label}
      title={label}
      data-tour="theme"
      // Clips the outgoing icon's spin.
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

/** A count that pops each time it changes, so a new message is felt, not just shown. */
export function Badge({ n, max = 99 }: { n: number; max?: number }) {
  return (
    <motion.span
      key={n}
      className="chip"
      initial={{ scale: 0.4 }}
      animate={{ scale: 1 }}
      transition={springs.pop}
    >
      {n > max ? `${max}+` : n}
    </motion.span>
  );
}

/**
 * A navigation button. The pill behind the active one is a single shared
 * element (layoutId), so switching tabs slides it across rather than one
 * fading out and another in. On a phone it carries a label; on the rail the
 * label is the tooltip.
 */
function NavButton({
  on,
  label,
  onClick,
  icon,
  badge,
  pillId,
  tour,
  className = '',
}: {
  on: boolean;
  label: string;
  onClick: () => void;
  icon: ReactNode;
  badge?: ReactNode;
  pillId: string;
  tour?: string;
  className?: string;
}) {
  return (
    <button
      className={`nav-btn${on ? ' on' : ''}${className ? ` ${className}` : ''}`}
      onClick={onClick}
      aria-label={label}
      aria-current={on ? 'page' : undefined}
      title={label}
      data-tour={tour}
    >
      <span className="nav-icon">
        {on && <motion.span layoutId={pillId} className="nav-pill" transition={springs.pop} />}
        {icon}
      </span>
      <span className="nav-label" aria-hidden="true">
        {label}
      </span>
      {badge}
    </button>
  );
}

/** Sheets that are a destination of their own, and so a tab. */
const TAB_SHEETS: SheetKind[] = ['search', 'calls', 'requests', 'settings'];

export default function DockRail() {
  const { conversations, order, activeId, setActive, presence } = useChat();
  const { toggleShelf, openSheet, closeSheet } = useUi();
  const sheet = useUi((s) => s.sheet);
  const me = useAuth((s) => s.me);
  const pendingRequests = useFriends(selectPendingCount);
  const [hover, setHover] = useState<string | null>(null);
  const isPhone = usePhone();

  const pinned = order.map((id) => conversations[id]).filter((c) => c && (c.pinned || c.unread > 0)).slice(0, 8);
  const tab = TAB_SHEETS.includes(sheet) ? sheet : 'chats';
  const pillId = isPhone ? 'nav-pill-phone' : 'nav-pill-rail';
  const unreadTotal = order.reduce((n, id) => n + (conversations[id]?.unread || 0), 0);

  const meIcon = me ? (
    <Avatar name={me.displayName} src={me.avatarUrl} id={me.id} accent={me.accent} size={isPhone ? 26 : 32} />
  ) : (
    <IconSettings />
  );

  return (
    <nav className="rail" aria-label="Main">
      <button className="rail-logo" onClick={toggleShelf} aria-label="Toggle conversation list" title="Conversations">
        <Logo size={40} />
      </button>

      <div className="rail-top">
        {/* The list itself: on a desk it folds the shelf away, on a phone it is
            the home tab (and closes whatever sheet is over it). */}
        <NavButton
          on={tab === 'chats' && isPhone}
          label="Chats"
          pillId={pillId}
          className="rail-chats"
          icon={isPhone ? <IconChat size={22} /> : <IconMenu />}
          badge={isPhone && unreadTotal > 0 ? <Badge n={unreadTotal} /> : undefined}
          onClick={() => (isPhone && sheet ? closeSheet() : toggleShelf())}
        />
      </div>

      <div className="rail-scroll">
        <AnimatePresence initial={false}>
          {pinned.map((c) => {
            const online = c.partner ? presence[c.partner.id]?.online : false;
            return (
              <motion.div
                key={c.id}
                className="rail-item"
                variants={popIn}
                initial="hidden"
                animate="show"
                exit="exit"
                layout
                transition={springs.gentle}
                onMouseEnter={() => setHover(c.id)}
                onMouseLeave={() => setHover(null)}
              >
                {activeId === c.id && (
                  <motion.span layoutId="rail-mark" className="rail-mark" transition={springs.pop} />
                )}
                <button onClick={() => setActive(c.id)} aria-label={c.name} aria-current={activeId === c.id}>
                  <Avatar
                    name={c.name}
                    src={c.avatarUrl}
                    id={c.partner?.id || c.id}
                    accent={c.partner?.accent}
                    size={44}
                    online={online}
                    showDot
                    square={c.type === 'group'}
                  />
                </button>
                {c.unread > 0 && <Badge n={c.unread} />}
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
        <NavButton
          on={tab === 'search'}
          label="Search"
          pillId={pillId}
          tour="search"
          icon={<IconSearch size={isPhone ? 22 : 20} />}
          onClick={() => openSheet('search')}
        />
        <NavButton
          on={tab === 'calls'}
          label="Calls"
          pillId={pillId}
          icon={<IconPhone size={isPhone ? 22 : 20} />}
          onClick={() => openSheet('calls')}
        />
        {/* Only present when someone is actually waiting. A permanent icon for
            an empty inbox is a permanent invitation to check nothing. */}
        {pendingRequests > 0 && (
          <NavButton
            on={tab === 'requests'}
            label={isPhone ? 'Requests' : `${pendingRequests} friend request${pendingRequests === 1 ? '' : 's'}`}
            pillId={pillId}
            icon={<IconUser size={isPhone ? 22 : 20} />}
            badge={<Badge n={pendingRequests} max={9} />}
            onClick={() => openSheet('requests')}
          />
        )}
        {/* On a phone, new chat is the floating button over the list. */}
        <button
          className="nav-btn rail-new"
          onClick={() => openSheet('new-chat')}
          aria-label="New conversation"
          title="New conversation"
          data-tour={isPhone ? undefined : 'new-chat'}
        >
          <IconPlus />
        </button>
        {/* The phone bar is full; there the toggle lives in the Shelf header. */}
        {!isPhone && <ThemeToggle />}
        <NavButton
          on={tab === 'settings'}
          label={isPhone ? 'You' : 'Settings and profile'}
          pillId={pillId}
          tour="settings"
          icon={meIcon}
          onClick={() => openSheet('settings')}
        />
      </div>
    </nav>
  );
}
