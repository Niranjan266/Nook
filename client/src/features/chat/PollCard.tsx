import { useEffect, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import type { Message, Conversation, Person } from '@/lib/types';
import { useChat } from '@/stores/chat';
import { useUi } from '@/stores/ui';
import { useAuth } from '@/stores/auth';
import Avatar from '@/components/Avatar';
import { IconPoll, IconChecklist, IconCheck, IconClose, IconPlus } from '@/components/Icon';
import { spring } from '@/lib/motion';
import '@/styles/polls.css';

/**
 * The inside of a poll bubble and a list bubble.
 *
 * Neither keeps its own copy of the results. Everything is read from the
 * message, which the store replaces on every vote — this device's optimistic
 * guess first, then the server's answer, then whatever anyone else did — so
 * the card can never disagree with the chat it sits in.
 */

interface Props {
  message: Message;
  conversation: Conversation;
  meId: string;
}

/** The members, by id, so a voter id becomes a face without another request. */
function peopleOf(conversation: Conversation) {
  const map = new Map<string, Partial<Person> & { id: string }>();
  for (const m of conversation.members) map.set(m.user.id, m.user as Partial<Person> & { id: string });
  return map;
}

/** Honour both the system setting and Nook's own switch. */
function useCalm() {
  const system = useReducedMotion();
  const mine = useAuth((s) => s.me?.settings.reduceMotion);
  return Boolean(system || mine);
}

function closesLabel(iso: string) {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'Closing now';
  const h = Math.round(ms / 3_600_000);
  if (h < 1) return `Closes in ${Math.max(1, Math.round(ms / 60_000))} min`;
  if (h < 36) return `Closes in ${h} h`;
  return `Closes in ${Math.round(h / 24)} days`;
}

/* ── poll ─────────────────────────────────────────────────────────────────── */

export function PollCard({ message: m, conversation, meId }: Props) {
  const poll = m.poll;
  const calm = useCalm();
  const [closing, setClosing] = useState(false);
  const [, setTick] = useState(0);

  /**
   * Close on screen at the deadline, not at the next fetch. The server
   * already refuses votes from that moment; without this the card would keep
   * offering them and answer each tap with an error.
   */
  const closesAt = poll?.closesAt && !poll.closed ? new Date(poll.closesAt).getTime() : 0;
  useEffect(() => {
    if (!closesAt) return;
    const wait = closesAt - Date.now();
    // setTimeout overflows past ~24.8 days; the deadline is at most a month
    // out, and a re-render on the way there is harmless.
    const timer = setTimeout(() => setTick((n) => n + 1), Math.min(Math.max(0, wait) + 250, 2 ** 31 - 1));
    return () => clearTimeout(timer);
  }, [closesAt]);

  if (!poll) return null;

  const { votePoll, closePoll } = useChat.getState();
  const toast = useUi.getState().toast;
  const people = peopleOf(conversation);
  const mine = m.sender.id === meId;
  // Still on its way: the options have no server ids to vote with yet.
  const pending = m.status === 'pending' || m.status === 'failed';
  const closed = poll.closed || Boolean(closesAt && closesAt <= Date.now());
  const locked = closed || pending;

  const choose = (optionId: string) => {
    if (locked) return;
    const had = poll.myVotes.includes(optionId);
    const next = poll.multiple
      ? had
        ? poll.myVotes.filter((id) => id !== optionId)
        : [...poll.myVotes, optionId]
      : had
        ? [] // tapping your own answer again takes it back
        : [optionId];
    void votePoll(m, next);
  };

  const leader = Math.max(0, ...poll.options.map((o) => o.count));
  const settings = [poll.multiple ? 'Pick any' : 'Pick one', poll.anonymous ? 'Anonymous' : null]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className={`poll-card${closed ? ' closed' : ''}`}>
      <span className="poll-kind">
        <IconPoll size={15} /> {closed ? 'Poll closed' : 'Poll'} · {settings}
      </span>
      <p className="poll-question">{m.body}</p>

      <div className="poll-options" role={poll.multiple ? 'group' : 'radiogroup'} aria-label={m.body}>
        {poll.options.map((o) => {
          const picked = poll.myVotes.includes(o.id);
          const pct = poll.totalVoters ? Math.round((o.count / poll.totalVoters) * 100) : 0;
          const top = closed && o.count > 0 && o.count === leader;
          return (
            <button
              key={o.id}
              type="button"
              className={`poll-option${picked ? ' picked' : ''}${top ? ' top' : ''}`}
              role={poll.multiple ? 'checkbox' : 'radio'}
              aria-checked={picked}
              aria-disabled={locked}
              onClick={() => choose(o.id)}
            >
              <motion.span
                className="poll-bar"
                aria-hidden="true"
                initial={false}
                animate={{ width: `${pct}%` }}
                transition={calm ? { duration: 0 } : spring}
              />
              <span className={`poll-mark${poll.multiple ? ' square' : ''}`} aria-hidden="true">
                {picked && <IconCheck size={12} strokeWidth={3} />}
              </span>
              <span className="poll-text">{o.text}</span>
              {!poll.anonymous && o.voters.length > 0 && (
                <span className="poll-voters" aria-hidden="true">
                  {o.voters.slice(0, 3).map((id) => {
                    const p = people.get(id);
                    return (
                      <span key={id} className="poll-voter">
                        <Avatar name={p?.displayName || '?'} src={p?.avatarUrl} id={id} accent={p?.accent} size={18} />
                      </span>
                    );
                  })}
                </span>
              )}
              <span className="poll-count tabular">
                {pct}%<span className="sr-only">, {o.count} {o.count === 1 ? 'vote' : 'votes'}</span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="poll-foot">
        <span>
          {poll.totalVoters === 0
            ? 'No votes yet'
            : `${poll.totalVoters} ${poll.totalVoters === 1 ? 'person' : 'people'} voted`}
          {!closed && poll.closesAt && ` · ${closesLabel(poll.closesAt)}`}
        </span>
        {mine && !locked && (
          <button
            type="button"
            className="poll-close"
            disabled={closing}
            onClick={async () => {
              setClosing(true);
              try {
                await closePoll(m);
              } catch (e: any) {
                toast(e?.message || 'Could not close the poll.', true);
              } finally {
                setClosing(false);
              }
            }}
          >
            Close poll
          </button>
        )}
      </div>
    </div>
  );
}

/* ── list ─────────────────────────────────────────────────────────────────── */

export function ListCard({ message: m, conversation, meId }: Props) {
  const list = m.list;
  const calm = useCalm();
  const [draft, setDraft] = useState('');
  const [adding, setAdding] = useState(false);
  if (!list) return null;

  const { addListItem, toggleListItem, removeListItem } = useChat.getState();
  const toast = useUi.getState().toast;
  const people = peopleOf(conversation);
  const pending = m.status === 'pending' || m.status === 'failed';
  const isAdmin = conversation.myRole === 'admin';
  const ownsList = m.sender.id === meId;
  const done = list.items.filter((i) => i.checkedBy).length;

  const add = async () => {
    const text = draft.trim();
    if (!text || adding) return;
    setAdding(true);
    try {
      await addListItem(m, text);
      setDraft('');
    } catch (e: any) {
      toast(e?.message || 'Could not add that.', true);
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="list-card">
      <span className="poll-kind">
        <IconChecklist size={15} /> List · {done}/{list.items.length} done
      </span>
      <p className="poll-question">{m.body}</p>

      <ul className="list-items">
        <AnimatePresence initial={false}>
          {list.items.map((item) => {
            const checker = item.checkedBy ? people.get(item.checkedBy) : null;
            const canRemove = !pending && (item.addedBy === meId || ownsList || isAdmin);
            return (
              <motion.li
                key={item.id}
                className={`list-item${item.checkedBy ? ' checked' : ''}`}
                initial={calm ? false : { opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={calm ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, height: 0 }}
                transition={calm ? { duration: 0 } : spring}
              >
                <button
                  type="button"
                  className="list-tick"
                  role="checkbox"
                  aria-checked={Boolean(item.checkedBy)}
                  disabled={pending}
                  onClick={() => void toggleListItem(m, item.id, !item.checkedBy)}
                >
                  <span className="poll-mark square" aria-hidden="true">
                    {item.checkedBy && <IconCheck size={12} strokeWidth={3} />}
                  </span>
                  <span className="list-text">
                    <span className="list-label">{item.text}</span>
                    {item.checkedBy && (
                      <span className="list-by">
                        {item.checkedBy === meId ? 'You' : checker?.displayName || 'Someone'}
                      </span>
                    )}
                  </span>
                </button>
                {canRemove && (
                  <button
                    type="button"
                    className="list-remove"
                    aria-label={`Remove ${item.text}`}
                    onClick={() => void removeListItem(m, item.id)}
                  >
                    <IconClose size={14} />
                  </button>
                )}
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ul>

      {!pending && (
        <form
          className="list-add"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <input
            value={draft}
            maxLength={200}
            placeholder="Add an item"
            aria-label={`Add an item to ${m.body}`}
            onChange={(e) => setDraft(e.target.value)}
            // The bubble listens for swipes and long-presses; typing here
            // must not start either.
            onPointerDown={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.stopPropagation()}
          />
          <button type="submit" className="list-add-btn" disabled={!draft.trim() || adding} aria-label="Add">
            <IconPlus size={16} />
          </button>
        </form>
      )}
    </div>
  );
}
