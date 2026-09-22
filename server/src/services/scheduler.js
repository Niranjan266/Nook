/**
 * A small in-process scheduler.
 *
 * Four jobs:
 *   1. Deliver messages whose scheduled time has arrived (send later).
 *   2. Sweep expired disappearing messages — SQLite has no TTL index, so
 *      unlike Mongo this has to be done explicitly.
 *   3. Apply per-conversation retention rules.
 *   4. Fire message reminders that have come due.
 *
 * Deliberately not a job queue. At this size a 20-second tick over an indexed
 * query is cheaper to run and far cheaper to reason about. If Nook ever runs on
 * more than one instance, move this behind a lock or a real queue — two
 * instances would otherwise race, though `claimScheduled` already makes double
 * delivery impossible.
 */
import * as M from '../db/messages.js';
import * as C from '../db/conversations.js';
import { deliver, assertMayReach } from './messages.js';
import { releaseDueReminders } from './reminders.js';
import { pruneFired } from '../db/reminders.js';

const TICK = 20_000;

/**
 * Reminders on their own clock. A reminder is a promise about a minute the
 * person picked, so it gets a tighter tick than send-later — and the test
 * suite shortens it to a second rather than waiting out fifteen.
 */
const REMINDER_TICK = Math.max(250, Number(process.env.REMINDER_TICK_MS) || 15_000);

let timer = null;
let sweeper = null;
let reminders = null;

async function releaseDueMessages() {
  const due = await M.dueScheduled();

  for (const stub of due) {
    // Claim it first, so a slow delivery can't be picked up twice.
    if (!(await M.claimScheduled(stub.id))) continue;

    /**
     * Claiming marks it delivered, and a delivered row is in everybody's
     * history. So if the sender may no longer reach these people — blocked or
     * unfriended since they scheduled it — the row has to go, not merely stay
     * un-fanned-out: otherwise the refused message turns up on the next load.
     */
    const convo = await C.findConversation(stub.conversation_id);
    try {
      if (!convo) throw new Error('conversation is gone');
      await assertMayReach(convo, stub.sender_id);
    } catch (err) {
      console.error('  scheduler dropped', stub.id, err.message);
      await M.deleteMessageRow(stub.id);
      continue;
    }

    const message = await M.findMessage(stub.id);
    const threadRoot = stub.thread_root_id ? await M.findMessage(stub.thread_root_id) : null;

    try {
      await deliver({ message, convo, senderId: stub.sender_id, threadRoot });
    } catch (err) {
      console.error('  scheduler failed to deliver', stub.id, err.message);
    }
  }
}

async function applyRetention() {
  const rules = await C.conversationsWithRetention();
  for (const rule of rules) {
    await M.applyRetention(rule.id, Date.now() - rule.retention_days * 86400_000);
  }
}

export function startScheduler() {
  if (timer) return;

  const tick = async () => {
    try {
      await releaseDueMessages();
      await M.deleteExpired();
    } catch (err) {
      console.error('  scheduler tick error:', err.message);
    }
  };

  timer = setInterval(tick, TICK);
  tick();

  /**
   * Overlapping passes would only race each other to the same claims, which
   * claimReminder already makes harmless — skipping is just cheaper. Due rows
   * are found by `remind_at <= now`, so anything that fell due while the
   * server was down fires on the first pass after it comes back.
   */
  let busy = false;
  const remind = async () => {
    if (busy) return;
    busy = true;
    try {
      await releaseDueReminders();
    } catch (err) {
      console.error('  scheduler reminder tick error:', err.message);
    } finally {
      busy = false;
    }
  };
  reminders = setInterval(remind, REMINDER_TICK);
  remind();

  // Retention is a once-an-hour concern, not a once-a-tick one.
  sweeper = setInterval(() => {
    applyRetention().catch(() => {});
    pruneFired().catch(() => {});
  }, 60 * 60 * 1000);

  console.log('  scheduler send-later, disappearing messages, retention, reminders');
}

export function stopScheduler() {
  if (timer) clearInterval(timer);
  if (sweeper) clearInterval(sweeper);
  if (reminders) clearInterval(reminders);
  timer = null;
  sweeper = null;
  reminders = null;
}
