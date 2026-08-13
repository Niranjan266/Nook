import { useEffect, useState } from 'react';
import { get, post } from '@/lib/api';
import { useChat } from '@/stores/chat';
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

/* ── new conversation ─────────────────────────────────────────────────────── */

export function NewChatSheet() {
  const { sheet, closeSheet, openSheet, toast } = useUi();
  const { openDirect, setActive } = useChat();
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

  const start = async (person: Person) => {
    try {
      const id = await openDirect(person.id);
      await post(`/users/${person.id}/contact`);
      setActive(id);
      closeSheet();
    } catch (e: any) {
      toast(e?.message || 'Could not open that conversation.', true);
    }
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
            <span className="grow">
              <span className="list-row-label">{p.displayName}</span>
              <span className="list-row-sub">
                @{p.username}
                {p.nookId ? ` · ${p.nookId}` : ''}
              </span>
            </span>
          </button>
        ))}
        {shown.length === 0 && (
          <p className="small muted" style={{ padding: '10px 4px' }}>
            {q.trim().length < 2
              ? 'No contacts yet. Search for a username or Nook ID to start.'
              : wasNookId
                ? // Saying "no such name" when they pasted a code would send
                  // them hunting for a typo in the name instead of the code.
                  'No account has that Nook ID. Codes can be regenerated — ask them for a fresh one.'
                : 'Nobody by that name. Usernames are exact — no phone numbers involved.'}
          </p>
        )}
      </div>
    </Sheet>
  );
}

/* ── new group ────────────────────────────────────────────────────────────── */

export function NewGroupSheet() {
  const { sheet, closeSheet, toast } = useUi();
  const { createGroup, setActive } = useChat();
  const [name, setName] = useState('');
  const [q, setQ] = useState('');
  const [people, setPeople] = useState<Person[]>([]);
  const [picked, setPicked] = useState<Person[]>([]);
  const [busy, setBusy] = useState(false);
  const open = sheet === 'new-group';

  useEffect(() => {
    if (!open) return;
    setName('');
    setPicked([]);
    setQ('');
    get<{ contacts: Person[] }>('/users').then((r) => setPeople(r.contacts)).catch(() => {});
  }, [open]);

  useEffect(() => {
    if (q.trim().length < 2) return;
    const t = setTimeout(() => {
      get<{ users: Person[] }>(`/users/search?q=${encodeURIComponent(q)}`)
        .then((r) => setPeople(r.users))
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
        <input className="groove" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search usernames" autoCapitalize="none" />
      </label>

      <div className="sheet-section">
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
  const { sheet, sheetPayload, closeSheet, toast } = useUi();
  const { conversations, order, forward } = useChat();
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
  const { sheet, closeSheet } = useUi();
  const { conversations, setActive } = useChat();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const open = sheet === 'search';

  useEffect(() => {
    if (!open) {
      setQ('');
      setResults([]);
    }
  }, [open]);

  useEffect(() => {
    if (q.trim().length < 2) return setResults([]);
    setBusy(true);
    const t = setTimeout(() => {
      get<{ results: Message[] }>(`/messages/search/all?q=${encodeURIComponent(q)}`)
        .then((r) => setResults(r.results))
        .catch(() => {})
        .finally(() => setBusy(false));
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <Sheet open={open} onClose={closeSheet} title="Search messages">
      <label className="field" style={{ position: 'relative' }}>
        <IconSearch size={17} style={{ position: 'absolute', left: 14, top: 15, color: 'var(--ink-faint)' }} />
        <input
          className="groove"
          style={{ paddingLeft: 40 }}
          placeholder="What are you looking for?"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </label>

      <div className="sheet-section">
        {busy && <p className="small muted">Looking…</p>}
        {results.map((m) => {
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
              <Avatar name={c?.name || '?'} src={c?.avatarUrl} id={m.conversationId} size={38} square={c?.type === 'group'} />
              <span className="grow">
                <span className="list-row-label truncate">{c?.name || 'Conversation'}</span>
                <span className="list-row-sub truncate">{previewOf(m)}</span>
              </span>
              <span className="tiny faint tabular">{stamp(m.createdAt)}</span>
            </button>
          );
        })}
        {!busy && q.length >= 2 && !results.length && <p className="small muted">Nothing matched.</p>}
      </div>
    </Sheet>
  );
}

/* ── starred ──────────────────────────────────────────────────────────────── */

export function StarredSheet() {
  const { sheet, closeSheet } = useUi();
  const { conversations, setActive } = useChat();
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
  const { sheet, closeSheet } = useUi();
  const { setActive } = useChat();
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
