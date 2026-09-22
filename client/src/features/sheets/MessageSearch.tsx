import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useChat, selectActive } from '@/stores/chat';
import { useUi } from '@/stores/ui';
import { useAuth } from '@/stores/auth';
import { motion } from 'framer-motion';
import Sheet from '@/components/Sheet';
import { springs } from '@/lib/motion';
import Avatar from '@/components/Avatar';
import Blur from '@/components/Blur';
import { stamp, previewOf } from '@/lib/format';
import { safeUrl } from '@/lib/config';
import type { Message } from '@/lib/types';
import { IconSearch, IconClose, IconPlay } from '@/components/Icon';

/* ── shared by the in-chat panel and the global sheet ─────────────────────── */

export type SearchKind = 'all' | 'photos' | 'videos' | 'voice' | 'files' | 'links';

export const SEARCH_KINDS: [SearchKind, string][] = [
  ['all', 'All'],
  ['photos', 'Photos'],
  ['videos', 'Videos'],
  ['voice', 'Voice'],
  ['files', 'Files'],
  ['links', 'Links'],
];

const EMPTY_LABEL: Record<SearchKind, string> = {
  all: 'Nothing matched.',
  photos: 'No photos found.',
  videos: 'No videos found.',
  voice: 'No voice notes found.',
  files: 'No files found.',
  links: 'No links found.',
};

/** The words the server matched on, cleaned the same way it cleans them. */
const termsOf = (q: string) =>
  q
    .replace(/["'()*:^-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8);

const escapeRx = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The matched words marked up, as React nodes.
 *
 * Built from split strings rather than an HTML string with <mark> spliced in:
 * a message body is somebody else's text, and anything that ends at
 * dangerouslySetInnerHTML is one crafted message away from running script in
 * the reader's session. React escapes every piece here for free.
 */
export function Highlight({ text, query }: { text: string; query: string }) {
  const terms = termsOf(query);
  if (!terms.length || !text) return <>{text}</>;
  // A capturing split puts the matches at the odd indexes.
  const parts = text.split(new RegExp(`(${terms.map(escapeRx).join('|')})`, 'gi'));
  return (
    <>
      {parts.map((part, i) =>
        i % 2 ? (
          <mark key={i} className="search-mark">
            {part}
          </mark>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        )
      )}
    </>
  );
}

/**
 * A long message trimmed to the neighbourhood of its first match, so the
 * match is on screen in a one-line row instead of truncated off the end.
 */
export function snippet(text: string, query: string, radius = 48) {
  const flat = text.replace(/\s+/g, ' ').trim();
  const terms = termsOf(query);
  if (!terms.length || flat.length <= radius * 2) return flat;
  const hit = flat.search(new RegExp(terms.map(escapeRx).join('|'), 'i'));
  if (hit <= radius) return flat;
  return `…${flat.slice(hit - radius / 2)}`;
}

interface SearchState {
  results: Message[];
  loading: boolean;
  loadingMore: boolean;
  error: string;
  /** True once there is something to search for — text, a filter or a sender. */
  active: boolean;
  hasMore: boolean;
  loadMore: () => void;
}

/**
 * Debounced, cancellable, paged search.
 *
 * Typing "harbour" fires one request, not seven — and when a slow response
 * for "harb" lands after the one for "harbour", the abort and the sequence
 * number both make sure it is dropped rather than painted over the newer
 * results. Either alone has a gap: an abort cannot stop a response already
 * being parsed, and a counter alone leaves the requests running.
 */
export function useMessageSearch({
  open,
  q,
  kind,
  from = '',
  conversationId = '',
}: {
  open: boolean;
  q: string;
  kind: SearchKind;
  from?: string;
  conversationId?: string;
}): SearchState {
  const [results, setResults] = useState<Message[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const seq = useRef(0);
  const more = useRef<AbortController | null>(null);

  const text = q.trim();
  const active = open && (text.length >= 2 || kind !== 'all' || Boolean(from));

  const params = (extra: Record<string, string> = {}) => {
    const p = new URLSearchParams({ limit: '30', type: kind, ...extra });
    if (text.length >= 2) p.set('q', text);
    if (from) p.set('from', from);
    if (conversationId) p.set('conversationId', conversationId);
    return p;
  };

  const explain = (e: unknown) =>
    e instanceof ApiError && e.status === 403
      ? 'This chat is locked. Open it with your code to search it.'
      : e instanceof ApiError
        ? e.message
        : 'Search failed. Try again.';

  useEffect(() => {
    const mine = ++seq.current;
    more.current?.abort();
    setLoadingMore(false);
    if (!active) {
      setResults([]);
      setCursor(null);
      setLoading(false);
      setError('');
      return;
    }

    setLoading(true);
    setError('');
    const ctrl = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const data = await api<{ results: Message[]; nextCursor: string | null }>(
          `/messages/search/all?${params()}`,
          { signal: ctrl.signal }
        );
        if (mine !== seq.current) return;
        setResults(data.results);
        setCursor(data.nextCursor);
      } catch (e) {
        if (ctrl.signal.aborted || mine !== seq.current) return;
        setResults([]);
        setCursor(null);
        setError(explain(e));
      } finally {
        if (mine === seq.current) setLoading(false);
      }
    }, 250);

    return () => {
      window.clearTimeout(timer);
      ctrl.abort();
    };
  }, [active, text, kind, from, conversationId]);

  const loadMore = () => {
    if (!cursor || loadingMore || loading) return;
    const mine = seq.current;
    const ctrl = new AbortController();
    more.current = ctrl;
    setLoadingMore(true);
    api<{ results: Message[]; nextCursor: string | null }>(`/messages/search/all?${params({ cursor })}`, {
      signal: ctrl.signal,
    })
      .then((data) => {
        if (mine !== seq.current) return;
        // By id, in case something new arrived between the two pages.
        setResults((prev) => {
          const known = new Set(prev.map((m) => m.id));
          return [...prev, ...data.results.filter((m) => !known.has(m.id))];
        });
        setCursor(data.nextCursor);
      })
      .catch((e) => {
        if (!ctrl.signal.aborted && mine === seq.current) setError(explain(e));
      })
      .finally(() => {
        if (mine === seq.current) setLoadingMore(false);
      });
  };

  return { results, loading, loadingMore, error, active, hasMore: Boolean(cursor), loadMore };
}

export function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <label className="field search-box">
      <IconSearch size={17} className="search-box-icon" aria-hidden="true" />
      <input
        className="groove"
        type="search"
        enterKeyHint="search"
        autoCapitalize="none"
        placeholder={placeholder}
        aria-label={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {value && (
        <button type="button" className="search-box-clear" onClick={() => onChange('')} aria-label="Clear search">
          <IconClose size={15} />
        </button>
      )}
    </label>
  );
}

export function SearchChips({ kind, onChange }: { kind: SearchKind; onChange: (k: SearchKind) => void }) {
  return (
    <div className="shelf-tabs search-chips" role="group" aria-label="Filter by type">
      {SEARCH_KINDS.map(([id, label]) => (
        <button
          key={id}
          type="button"
          className={`shelf-tab${kind === id ? ' on' : ''}`}
          aria-pressed={kind === id}
          onClick={() => onChange(id)}
        >
          {kind === id && <motion.span layoutId="search-kind-pill" className="shelf-tab-pill" transition={springs.pop} />}
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * Results as a list of rows, or as a grid when the filter is photos or video
 * — a list of rows that each say "Photo" is no way to find a picture.
 */
export function SearchResults({
  state,
  query,
  kind,
  scope,
  onPick,
  idleHint,
}: {
  state: SearchState;
  query: string;
  kind: SearchKind;
  scope: 'chat' | 'all';
  onPick: (m: Message) => void;
  idleHint: string;
}) {
  const conversations = useChat((s) => s.conversations);
  const { results, loading, loadingMore, error, active, hasMore, loadMore } = state;
  const grid = kind === 'photos' || kind === 'videos';

  return (
    <div className="sheet-section search-results" aria-busy={loading}>
      {!active && <p className="sheet-note">{idleHint}</p>}
      {active && loading && !results.length && <p className="sheet-note">Looking…</p>}
      {active && error && <p className="sheet-note bad">{error}</p>}
      {active && !loading && !error && !results.length && <p className="sheet-note">{EMPTY_LABEL[kind]}</p>}

      {grid && results.length > 0 && (
        <div className="search-grid">
          {results.map((m) => (
            <button
              key={m.id}
              type="button"
              className="search-tile"
              onClick={() => onPick(m)}
              title={stamp(m.createdAt)}
              aria-label={`${m.type === 'video' ? 'Video' : 'Photo'} from ${m.sender.displayName || 'someone'}, ${stamp(m.createdAt)}`}
            >
              <Blur hash={m.media?.blurhash} />
              {m.type === 'video' && !m.media?.thumbUrl ? (
                <video src={safeUrl(m.media?.url)} muted playsInline preload="metadata" />
              ) : (
                <img src={safeUrl(m.media?.thumbUrl || m.media?.url)} alt="" loading="lazy" />
              )}
              {m.type === 'video' && (
                <span className="search-tile-badge" aria-hidden="true">
                  <IconPlay size={14} />
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {!grid &&
        results.map((m) => {
          const c = conversations[m.conversationId];
          const who = m.sender.displayName || 'Someone';
          const body = m.body ? snippet(m.body, query) : '';
          return (
            <button key={m.id} type="button" className="list-row search-row" onClick={() => onPick(m)}>
              {scope === 'all' ? (
                <Avatar name={c?.name || '?'} src={c?.avatarUrl} id={m.conversationId} size={38} square={c?.type === 'group'} />
              ) : (
                <Avatar name={who} src={m.sender.avatarUrl} id={m.sender.id} accent={m.sender.accent} size={38} />
              )}
              <span className="grow" style={{ minWidth: 0 }}>
                <span className="list-row-label truncate">
                  {scope === 'all' ? c?.name || 'Conversation' : who}
                </span>
                <span className="list-row-sub search-row-sub">
                  {scope === 'all' && c?.type === 'group' && <strong>{who}: </strong>}
                  {body ? <Highlight text={body} query={query} /> : previewOf(m)}
                </span>
              </span>
              <span className="tiny faint tabular" style={{ flex: 'none' }}>
                {stamp(m.createdAt)}
              </span>
            </button>
          );
        })}

      {hasMore && (
        <button type="button" className="clay-btn search-more" onClick={loadMore} disabled={loadingMore}>
          {loadingMore ? 'Loading…' : 'Show more'}
        </button>
      )}
    </div>
  );
}

/**
 * Go to a result: open its chat, then ask the conversation to scroll to it.
 *
 * A thread reply is not in the main stream, so it opens its thread and the
 * jump goes to the thread's root instead.
 */
export function openResult(m: Message) {
  const chat = useChat.getState();
  const ui = useUi.getState();
  ui.closeSheet();
  if (chat.activeId !== m.conversationId) chat.setActive(m.conversationId);
  if (m.threadRootId) {
    ui.requestJump(m.conversationId, m.threadRootId);
    chat.openThread(m.threadRootId);
  } else {
    ui.requestJump(m.conversationId, m.id);
  }
}

/* ── search inside one conversation ──────────────────────────────────────── */

export default function ChatSearchSheet() {
  const sheet = useUi((s) => s.sheet);
  const closeSheet = useUi((s) => s.closeSheet);
  const conversation = useChat(selectActive);
  const meId = useAuth((s) => s.me?.id || '');
  const open = sheet === 'chat-search' && Boolean(conversation);

  const [q, setQ] = useState('');
  const [kind, setKind] = useState<SearchKind>('all');
  const [from, setFrom] = useState('');

  // A fresh search per chat — filters from the last one mean nothing here.
  useEffect(() => {
    setQ('');
    setKind('all');
    setFrom('');
  }, [conversation?.id]);

  const people = useMemo(
    () =>
      (conversation?.members || [])
        .map((m) => m.user)
        .map((u) => ({
          id: u.id,
          name: u.id === meId ? 'You' : ('displayName' in u && u.displayName) || ('username' in u && u.username) || 'Member',
        }))
        .sort((a, b) => (a.id === meId ? -1 : b.id === meId ? 1 : a.name.localeCompare(b.name))),
    [conversation?.members, meId]
  );

  const state = useMessageSearch({ open, q, kind, from, conversationId: conversation?.id });

  return (
    <Sheet open={open} onClose={closeSheet} title="Search this chat">
      <div className="search-head">
      <SearchBox value={q} onChange={setQ} placeholder={`Search in ${conversation?.name || 'this chat'}`} />
      <SearchChips kind={kind} onChange={setKind} />
      {conversation?.type === 'group' && people.length > 1 && (
        <label className="search-from">
          <span className="small muted">From</span>
          <select className="groove" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From">
            <option value="">Anyone</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      )}
      </div>
      <SearchResults
        state={state}
        query={q}
        kind={kind}
        scope="chat"
        onPick={openResult}
        idleHint="Type at least two letters, or pick a filter to browse."
      />
    </Sheet>
  );
}
