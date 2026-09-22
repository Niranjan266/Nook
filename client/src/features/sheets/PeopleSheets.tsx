import { useEffect, useState } from 'react';
import { get, post } from '@/lib/api';
import { useChat } from '@/stores/chat';
import { useFriends } from '@/stores/friends';
import { useUi } from '@/stores/ui';
import Sheet from '@/components/Sheet';
import Avatar from '@/components/Avatar';
import { stamp, duration, lastSeenLabel, previewOf } from '@/lib/format';
import type { Person, Message, CallRecord } from '@/lib/types';
import {
  IconSearch,
  IconUsers,
  IconCheck,
  IconStarFill,
  IconCallIn,
  IconCallOut,
  IconPhone,
  IconVideo,
  IconPlus,
} from '@/components/Icon';
import { useMessageSearch, SearchBox, SearchChips, SearchResults, openResult, type SearchKind } from './MessageSearch';

/* ── new conversation ─────────────────────────────────────────────────────── */

export function NewChatSheet() {
  const sheet = useUi((s) => s.sheet);
  const closeSheet = useUi((s) => s.closeSheet);
  const openSheet = useUi((s) => s.openSheet);
  const toast = useUi((s) => s.toast);
  const openDirect = useChat((s) => s.openDirect);
  const setActive = useChat((s) => s.setActive);
  const { send: sendRequest, accept } = useFriends();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Person[]>([]);
  const [contacts, setContacts] = useState<Person[]>([]);
  /** The server tells us whether the query was Nook-ID shaped, so the empty
      state can say something true rather than guessing. */
  const [wasNookId, setWasNookId] = useState(false);
  const open = sheet === 'new-chat';

  useEffect(() => {
    if (!open) return;
    get<{ contacts: Person[] }>('/users').then((r) => setContacts(r.contacts)).catch(() => {});
  }, [open]);

  useEffect(() => {
    if (q.trim().length < 2) {
      setResults([]);
      setWasNookId(false);
      return;
    }
    const t = setTimeout(() => {
      get<{ users: Person[]; exactNookId?: boolean }>(`/users/search?q=${encodeURIComponent(q)}`)
        .then((r) => {
          setResults(r.users);
          setWasNookId(Boolean(r.exactNookId));
        })
        .catch(() => {});
    }, 280);
    return () => clearTimeout(t);
  }, [q]);

  /**
   * What tapping a person does now depends on where you stand with them.
   *
   * Opening a chat you cannot write in is not useless — you can see the
   * request state and act on it there — so every state still opens the
   * conversation. What changes is whether a request goes out first, and what
   * the row says will happen, which is the part that was missing.
   */
  const start = async (person: Person) => {
    try {
      const id = await openDirect(person.id);
      if (person.friendship === 'none' || person.friendship === 'declined') {
        await sendRequest(person.id);
        toast(`Request sent to ${person.displayName.split(' ')[0]}`);
      } else if (person.friendship === 'received') {
        await accept(person.id);
        toast(`You and ${person.displayName.split(' ')[0]} can chat now`);
      } else if (person.friendship === 'friends') {
        await post(`/users/${person.id}/contact`);
      }
      setActive(id);
      closeSheet();
    } catch (e: any) {
      toast(e?.message || 'Could not open that conversation.', true);
    }
  };

  const actionFor = (p: Person) => {
    if (p.friendship === 'sent') return 'Waiting';
    if (p.friendship === 'received') return 'Accept';
    if (p.friendship === 'friends' || !p.friendship) return '';
    return 'Add';
  };

  const shown = q.trim().length >= 2 ? results : contacts;

  return (
    <Sheet open={open} onClose={closeSheet} title="New conversation">
      <label className="field">
        <span className="sr-only">Find someone by username or Nook ID</span>
        <input
          className="groove"
          placeholder="Username or Nook ID"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoCapitalize="none"
          spellCheck={false}
        />
      </label>
      <p className="tiny faint" style={{ padding: '4px 4px 0' }}>
        A Nook ID looks like <code>nook-7f3k2q</code>. Yours is in Settings.
      </p>

      <button className="list-row" onClick={() => openSheet('new-group')}>
        <span className="clay-round" style={{ width: 40, height: 40, boxShadow: 'none', background: 'var(--clay-sunk)' }}>
          <IconUsers size={19} />
        </span>
        <span className="grow">
          <span className="list-row-label">New group</span>
          <span className="list-row-sub">Pick a few people</span>
        </span>
      </button>

      <div className="sheet-section">
        <span className="eyebrow">{q.trim().length >= 2 ? 'Search results' : 'Your contacts'}</span>
        {shown.map((p) => (
          <button key={p.id} className="list-row" onClick={() => start(p)}>
            <Avatar name={p.displayName} src={p.avatarUrl} id={p.id} accent={p.accent} size={42} online={p.online} showDot />
            <span className="grow" style={{ minWidth: 0 }}>
              <span className="list-row-label">{p.displayName}</span>
              <span className="list-row-sub">
                @{p.username}
                {p.nookId ? ` · ${p.nookId}` : ''}
              </span>
            </span>
            {/* Says what the tap will do, so nobody discovers the rule by
                hitting it. Blank for people you can already talk to. */}
            {actionFor(p) && (
              <span className={`chip${p.friendship === 'sent' ? ' chip-quiet' : ''}`} style={{ flex: 'none' }}>
                {actionFor(p)}
              </span>
            )}
          </button>
        ))}
        {shown.length === 0 && (
          <p className="small muted" style={{ padding: '10px 4px' }}>
            {q.trim().length < 2
              ? 'No contacts yet. Search for a username or Nook ID to start.'
              : wasNookId
                ? // Saying "no such name" when they pasted a code would send
                  // them hunting for a typo in the name instead of the code.
                  'No account has that Nook ID. Check for a typo — codes never change, so an old one still works.'
                : 'Nobody by that name. Usernames are exact — no phone numbers involved.'}
          </p>
        )}
      </div>
    </Sheet>
  );
}

/* ── new group ────────────────────────────────────────────────────────────── */

export function NewGroupSheet() {
  const sheet = useUi((s) => s.sheet);
  const closeSheet = useUi((s) => s.closeSheet);
  const toast = useUi((s) => s.toast);
  const createGroup = useChat((s) => s.createGroup);
  const setActive = useChat((s) => s.setActive);
  const [name, setName] = useState('');
  const [q, setQ] = useState('');
  const [people, setPeople] = useState<Person[]>([]);
  const [picked, setPicked] = useState<Person[]>([]);
  const [busy, setBusy] = useState(false);
  const open = sheet === 'new-group';

  /**
   * Friends only, both in the list and in search.
   *
   * A group used to accept anyone, which made it a way around the whole
   * friend-request rule — you could put a stranger in a two-person "group" and
   * message them. The server refuses that now, so offering strangers here
   * would only produce a 403 after the person had picked them and typed a
   * name. Better not to offer what will be refused.
   */
  useEffect(() => {
    if (!open) return;
    setName('');
    setPicked([]);
    setQ('');
    get<{ friends: Person[] }>('/users/friends').then((r) => setPeople(r.friends)).catch(() => {});
  }, [open]);

  useEffect(() => {
    if (q.trim().length < 2) return;
    const t = setTimeout(() => {
      get<{ users: Person[] }>(`/users/search?q=${encodeURIComponent(q)}`)
        .then((r) => setPeople(r.users.filter((u) => u.friendship === 'friends')))
        .catch(() => {});
    }, 280);
    return () => clearTimeout(t);
  }, [q]);

  const toggle = (p: Person) =>
    setPicked((cur) => (cur.some((x) => x.id === p.id) ? cur.filter((x) => x.id !== p.id) : [...cur, p]));

  const create = async () => {
    setBusy(true);
    try {
      const id = await createGroup({ name: name.trim(), memberIds: picked.map((p) => p.id) });
      setActive(id);
      closeSheet();
    } catch (e: any) {
      toast(e?.message || 'Could not create that group.', true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={closeSheet}
      title="New group"
      footer={
        <button className="slab slab-block" disabled={!name.trim() || !picked.length || busy} onClick={create}>
          {busy ? 'Creating…' : `Create with ${picked.length} ${picked.length === 1 ? 'person' : 'people'}`}
        </button>
      }
    >
      <label className="field">
        <span className="field-label">Group name</span>
        <input className="groove" value={name} onChange={(e) => setName(e.target.value)} placeholder="Friday Plans" maxLength={50} />
      </label>

      {picked.length > 0 && (
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {picked.map((p) => (
            <button key={p.id} className="chip chip-quiet" style={{ height: 30, paddingRight: 6 }} onClick={() => toggle(p)}>
              {p.displayName.split(' ')[0]} ✕
            </button>
          ))}
        </div>
      )}

      <label className="field">
        <span className="field-label">Add people</span>
        <input className="groove" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your friends" autoCapitalize="none" />
      </label>

      <div className="sheet-section">
        {people.length === 0 && (
          <p className="small muted" style={{ padding: '10px 4px' }}>
            {q.trim().length >= 2
              ? 'Nobody by that name among your friends. You can only add people who have accepted you.'
              : 'No friends yet. Add someone from New conversation first.'}
          </p>
        )}
        {people.map((p) => {
          const on = picked.some((x) => x.id === p.id);
          return (
            <button key={p.id} className="list-row" onClick={() => toggle(p)} aria-pressed={on}>
              <Avatar name={p.displayName} src={p.avatarUrl} id={p.id} accent={p.accent} size={40} />
              <span className="grow">
                <span className="list-row-label">{p.displayName}</span>
                <span className="list-row-sub">@{p.username}</span>
              </span>
              {on && (
                <span className="chip">
                  <IconCheck size={13} />
                </span>
              )}
            </button>
          );
        })}
      </div>
    </Sheet>
  );
}

/* ── forward ──────────────────────────────────────────────────────────────── */

export function ForwardSheet() {
  const sheet = useUi((s) => s.sheet);
  const sheetPayload = useUi((s) => s.sheetPayload);
  const closeSheet = useUi((s) => s.closeSheet);
  const toast = useUi((s) => s.toast);
  const conversations = useChat((s) => s.conversations);
  const order = useChat((s) => s.order);
  const forward = useChat((s) => s.forward);
  const [picked, setPicked] = useState<string[]>([]);
  const open = sheet === 'forward';

  useEffect(() => {
    if (open) setPicked([]);
  }, [open]);

  const go = async () => {
    try {
      await forward(sheetPayload.messageId, picked);
      toast(`Forwarded to ${picked.length} ${picked.length === 1 ? 'chat' : 'chats'}`);
      closeSheet();
    } catch {
      toast('Could not forward that.', true);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={closeSheet}
      title="Forward to"
      footer={
        <button className="slab slab-block" disabled={!picked.length} onClick={go}>
          {picked.length ? `Forward to ${picked.length}` : 'Pick a chat'}
        </button>
      }
    >
      <div className="sheet-section">
        {order.map((id) => {
          const c = conversations[id];
          if (!c) return null;
          const on = picked.includes(id);
          return (
            <button
              key={id}
              className="list-row"
              aria-pressed={on}
              onClick={() => setPicked((p) => (on ? p.filter((x) => x !== id) : [...p, id]))}
            >
              <Avatar name={c.name} src={c.avatarUrl} id={c.partner?.id || c.id} size={40} square={c.type === 'group'} />
              <span className="grow">
                <span className="list-row-label">{c.name}</span>
                <span className="list-row-sub">{c.type === 'group' ? `${c.members.length} people` : `@${c.partner?.username}`}</span>
              </span>
              {on && (
                <span className="chip">
                  <IconCheck size={13} />
                </span>
              )}
            </button>
          );
        })}
      </div>
    </Sheet>
  );
}

/* ── search across everything ─────────────────────────────────────────────── */

export function SearchSheet() {
  const sheet = useUi((s) => s.sheet);
  const closeSheet = useUi((s) => s.closeSheet);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<SearchKind>('all');
  const open = sheet === 'search';

  useEffect(() => {
    if (!open) {
      setQ('');
      setKind('all');
    }
  }, [open]);

  const state = useMessageSearch({ open, q, kind });

  return (
    <Sheet open={open} onClose={closeSheet} title="Search messages">
      <SearchBox value={q} onChange={setQ} placeholder="What are you looking for?" />
      <SearchChips kind={kind} onChange={setKind} />
      <SearchResults
        state={state}
        query={q}
        kind={kind}
        scope="all"
        onPick={openResult}
        idleHint="Type at least two letters, or pick a filter to browse every chat."
      />
    </Sheet>
  );
}

/* ── starred ──────────────────────────────────────────────────────────────── */

export function StarredSheet() {
  const sheet = useUi((s) => s.sheet);
  const closeSheet = useUi((s) => s.closeSheet);
  const conversations = useChat((s) => s.conversations);
  const setActive = useChat((s) => s.setActive);
  const [items, setItems] = useState<Message[]>([]);
  const open = sheet === 'starred';

  useEffect(() => {
    if (!open) return;
    get<{ messages: Message[] }>('/messages/starred/all').then((r) => setItems(r.messages)).catch(() => {});
  }, [open]);

  return (
    <Sheet open={open} onClose={closeSheet} title="Starred">
      <div className="sheet-section">
        {items.map((m) => {
          const c = conversations[m.conversationId];
          return (
            <button
              key={m.id}
              className="list-row"
              onClick={() => {
                setActive(m.conversationId);
                closeSheet();
              }}
            >
              <span className="clay-round" style={{ width: 38, height: 38, color: 'var(--ochre-deep)' }}>
                <IconStarFill size={17} />
              </span>
              <span className="grow">
                <span className="list-row-label truncate">{c?.name || 'Conversation'}</span>
                <span className="list-row-sub truncate">{previewOf(m)}</span>
              </span>
              <span className="tiny faint tabular">{stamp(m.createdAt)}</span>
            </button>
          );
        })}
        {!items.length && <p className="small muted">Nothing starred yet. Star a message to keep it here.</p>}
      </div>
    </Sheet>
  );
}

/* ── call history ─────────────────────────────────────────────────────────── */

export function CallsSheet() {
  const sheet = useUi((s) => s.sheet);
  const closeSheet = useUi((s) => s.closeSheet);
  const setActive = useChat((s) => s.setActive);
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const open = sheet === 'calls';

  useEffect(() => {
    if (!open) return;
    get<{ calls: CallRecord[] }>('/calls').then((r) => setCalls(r.calls)).catch(() => {});
  }, [open]);

  return (
    <Sheet open={open} onClose={closeSheet} title="Calls">
      <div className="sheet-section">
        {calls.map((c) => {
          const missed = c.status === 'missed' || c.status === 'declined';
          return (
            <button
              key={c.id}
              className="list-row"
              onClick={() => {
                setActive(c.conversationId);
                closeSheet();
              }}
            >
              <Avatar name={c.with.displayName} src={c.with.avatarUrl} id={c.with.id} accent={c.with.accent} size={40} />
              <span className="grow">
                <span className="list-row-label" style={missed ? { color: 'var(--rust)' } : undefined}>
                  {c.with.displayName}
                </span>
                <span className="list-row-sub row" style={{ gap: 5 }}>
                  {c.direction === 'outgoing' ? <IconCallOut size={13} /> : <IconCallIn size={13} />}
                  {missed ? (c.status === 'declined' ? 'Declined' : 'Missed') : duration(c.duration)}
                  <span aria-hidden="true">·</span>
                  {stamp(c.at)}
                </span>
              </span>
              {c.kind === 'video' ? <IconVideo size={17} style={{ opacity: 0.6 }} /> : <IconPhone size={17} style={{ opacity: 0.6 }} />}
            </button>
          );
        })}
        {!calls.length && <p className="small muted">No calls yet.</p>}
      </div>
    </Sheet>
  );
}

/* ── friend requests ──────────────────────────────────────────────────────── */

/**
 * Both directions in one sheet.
 *
 * Incoming is the part that needs an answer, so it goes first and carries the
 * buttons. Outgoing is there so "did I already ask them?" has an answer that
 * is not "search for them and squint at the button label" — and so a request
 * sent to the wrong person can be taken back.
 */
export function RequestsSheet() {
  const sheet = useUi((s) => s.sheet);
  const closeSheet = useUi((s) => s.closeSheet);
  const toast = useUi((s) => s.toast);
  const openDirect = useChat((s) => s.openDirect);
  const setActive = useChat((s) => s.setActive);
  const { incoming, outgoing, load, accept, decline, cancel } = useFriends();
  const [busy, setBusy] = useState('');
  const open = sheet === 'requests';

  useEffect(() => {
    if (open) load().catch(() => {});
  }, [open]);

  const run = async (id: string, fn: () => Promise<unknown>, done?: string) => {
    setBusy(id);
    try {
      await fn();
      if (done) toast(done);
    } catch (e: any) {
      toast(e?.message || 'That did not work.', true);
    } finally {
      setBusy('');
    }
  };

  const openChatWith = async (p: Person) => {
    try {
      setActive(await openDirect(p.id));
      closeSheet();
    } catch (e: any) {
      toast(e?.message || 'Could not open that conversation.', true);
    }
  };

  return (
    <Sheet open={open} onClose={closeSheet} title="Requests">
      <div className="sheet-section">
        <span className="eyebrow">Waiting for you</span>
        {incoming.map((r) => (
          <div key={r.user.id} className="list-row" style={{ cursor: 'default' }}>
            <Avatar name={r.user.displayName} src={r.user.avatarUrl} id={r.user.id} accent={r.user.accent} size={42} />
            <span className="grow" style={{ minWidth: 0 }}>
              <span className="list-row-label">{r.user.displayName}</span>
              <span className="list-row-sub">{r.note || `@${r.user.username}`}</span>
            </span>
            <span className="row" style={{ gap: 6, flex: 'none' }}>
              <button
                className="clay-btn"
                disabled={busy === r.user.id}
                onClick={() => run(r.user.id, () => decline(r.user.id), 'Declined')}
              >
                Decline
              </button>
              <button
                className="slab"
                disabled={busy === r.user.id}
                onClick={() =>
                  run(r.user.id, async () => {
                    await accept(r.user.id);
                    await openChatWith(r.user);
                  })
                }
              >
                Accept
              </button>
            </span>
          </div>
        ))}
        {incoming.length === 0 && (
          <p className="small muted" style={{ padding: '10px 4px' }}>
            Nobody is waiting on you.
          </p>
        )}
      </div>

      {outgoing.length > 0 && (
        <div className="sheet-section">
          <span className="eyebrow">You asked</span>
          {outgoing.map((r) => (
            <div key={r.user.id} className="list-row" style={{ cursor: 'default' }}>
              <Avatar name={r.user.displayName} src={r.user.avatarUrl} id={r.user.id} accent={r.user.accent} size={42} />
              <span className="grow" style={{ minWidth: 0 }}>
                <span className="list-row-label">{r.user.displayName}</span>
                <span className="list-row-sub">Waiting for them to accept</span>
              </span>
              <button
                className="clay-btn"
                style={{ flex: 'none' }}
                disabled={busy === r.user.id}
                onClick={() => run(r.user.id, () => cancel(r.user.id), 'Request taken back')}
              >
                Cancel
              </button>
            </div>
          ))}
        </div>
      )}
    </Sheet>
  );
}
