/**
 * Message reminders — the rules, and the firing.
 *
 * The route and the scheduler both need to answer "may this person still see
 * this message?", once when the reminder is set and again when it comes due,
 * so the answer lives here where the two cannot drift apart.
 */
import * as C from '../db/conversations.js';
import * as M from '../db/messages.js';
import * as R from '../db/reminders.js';
import { findUserById } from '../db/users.js';
import { serializeUser } from '../lib/serialize.js';
import { hasUnlock } from '../lib/lockgrants.js';
import { emitToUser, isLooking } from '../sockets/hub.js';
import { notify } from './push.js';
import { preview } from './messages.js';
import { TEMPLATES } from './templates.js';

/** Enough for anyone using it as intended; a ceiling for anyone who is not. */
export const MAX_ACTIVE = 100;
/** Past a year it is a calendar entry, not a reminder. */
export const MAX_AHEAD_MS = 365 * 86400_000;

const mineIn = (convo, userId) => convo?.members?.find((m) => String(m.user?.id || m.user) === String(userId));

/**
 * Why a message is no longer there for this person, or null if it is.
 *
 * 'mine' is the person having deleted it for themselves — they threw it away,
 * so reminding them of it would be arguing with their own decision.
 */
export function whyGone(msg, userId) {
  if (!msg) return 'deleted';
  if (msg.deletedForAll || msg.viewOnce?.burntAt) return 'deleted';
  // Not yet delivered is a scheduled send: it has not happened for anyone.
  if (!msg.delivered) return 'deleted';
  if ((msg.deletedFor || []).some((u) => String(u) === String(userId))) return 'mine';
  return null;
}

/** A locked chat the person has not opened says nothing about its contents. */
export const isLockedFor = (convo, userId) => {
  const mine = mineIn(convo, userId);
  return Boolean(mine?.locked && mine?.lockHash) && !hasUnlock(userId, String(convo.id));
};

/**
 * The reminder as the client sees it, with enough of the message to draw a
 * row. The snippet is left out for a locked chat — the list would otherwise
 * be a way to read one without the code.
 */
export async function serializeReminder(r, userId) {
  const [msg, convo] = await Promise.all([M.findMessage(r.messageId), C.findConversationForUser(r.conversationId, userId)]);
  const gone = Boolean(whyGone(msg, userId)) || !convo;
  const locked = convo ? isLockedFor(convo, userId) : false;
  return {
    id: String(r.id),
    messageId: String(r.messageId),
    conversationId: String(r.conversationId),
    remindAt: r.remindAt.toISOString(),
    note: r.note,
    createdAt: r.createdAt.toISOString(),
    firedAt: r.firedAt ? r.firedAt.toISOString() : null,
    gone,
    locked,
    snippet: gone || locked ? '' : preview(msg),
    senderName: msg ? serializeUser(msg.sender, userId)?.displayName || '' : '',
  };
}

/**
 * Fire one reminder that has already been claimed.
 *
 * Three endings: the message is there (remind with a snippet), it was deleted
 * by someone else (say so — they asked to be told, and silence would look like
 * the feature failing), or it is no longer theirs to see at all (left the chat,
 * or deleted it themselves) — dropped without a word.
 *
 * Quiet hours and mute are deliberately ignored. Those silence other people;
 * this is an alarm the person set for themselves, at a time they chose.
 */
export async function fireReminder(r) {
  const convo = await C.findConversationForUser(r.conversationId, r.userId);
  if (!convo) return R.setOutcome(r.id, 'dropped');

  const msg = await M.findMessage(r.messageId);
  const why = whyGone(msg, r.userId);
  if (why === 'mine') return R.setOutcome(r.id, 'dropped');
  const gone = Boolean(why);

  const user = await findUserById(r.userId);
  const member = mineIn(convo, r.userId);
  const locked = isLockedFor(convo, r.userId);

  // Previews follow the same per-chat-over-global rule as message pushes: a
  // reminder lands on a lock screen just the same.
  const perChat = member?.notifyPreview;
  const previewsOn = perChat === 1 || ((perChat === -1 || perChat === undefined) && user?.settings?.notifyPreview !== false);
  const snippet = gone || locked ? '' : preview(msg);

  const values = {
    sender: msg ? serializeUser(msg.sender, r.userId)?.displayName : '',
    preview: previewsOn ? snippet : '',
    // The note is theirs, but a locked chat's reminder should not say more on
    // a lock screen than the chat itself would.
    note: locked ? '' : r.note,
    gone,
    conversationId: convo.id,
    messageId: r.messageId,
    reminderId: r.id,
  };

  await R.setOutcome(r.id, gone ? 'gone' : 'sent');

  // In-app first: it is instant, and it carries the full snippet because the
  // app itself is already unlocked in front of the person.
  emitToUser(r.userId, 'reminder:due', {
    id: String(r.id),
    conversationId: String(convo.id),
    messageId: gone ? null : String(r.messageId),
    gone,
    locked,
    note: values.note,
    snippet,
    senderName: values.sender || '',
    banner: TEMPLATES.reminder.banner({ ...values, preview: snippet }),
  });

  // Someone in the app right now has the banner; a push on top would be the
  // same reminder twice on the same screen.
  if (isLooking(r.userId)) return;
  await notify(r.userId, TEMPLATES.reminder.push(values)).catch(() => 0);
}

/** One scheduler pass. Returns how many this instance fired, for logging and tests. */
export async function releaseDueReminders() {
  let fired = 0;
  for (const r of await R.dueReminders()) {
    // Claimed before anything is sent — see claimReminder for why that order.
    if (!(await R.claimReminder(r.id))) continue;
    try {
      await fireReminder(r);
      fired += 1;
    } catch (err) {
      console.error('  scheduler reminder failed', r.id, err.message);
    }
  }
  return fired;
}
