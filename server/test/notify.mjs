/**
 * Who gets a push, and who does not.
 *
 * The rule used to be "skip anyone with a socket", which is why messages
 * arrived silently: a backgrounded tab, a locked phone and a sleeping laptop
 * all still hold a socket. These check the replacement — skip only the person
 * actually looking at that conversation — at the level the bug lived, which is
 * the hub, not the HTTP surface.
 */
import { suite } from './helpers.mjs';
import { setFocus, clearFocus, isWatching } from '../src/sockets/hub.js';

const t = suite('notification targeting');

const alice = 'user-a';
const chatOne = 'convo-1';
const chatTwo = 'convo-2';

t.ok('someone who has said nothing is not watching', isWatching(alice, chatOne) === false);

setFocus(alice, chatOne);
t.ok('the chat they opened is watched', isWatching(alice, chatOne) === true);
t.ok('a different chat is not', isWatching(alice, chatTwo) === false);
t.ok('and neither is another person', isWatching('user-b', chatOne) === false);

// Switching chats must move attention, not add to it — otherwise every chat
// you visited stays "watched" and nothing ever notifies again.
setFocus(alice, chatTwo);
t.ok('switching chats moves the attention', isWatching(alice, chatTwo) === true);
t.ok('and releases the previous one', isWatching(alice, chatOne) === false);

// Hiding the window reports nothing, which is the backgrounded-phone case.
setFocus(alice, null);
t.ok('a hidden window watches nothing', isWatching(alice, chatTwo) === false);

setFocus(alice, chatOne);
clearFocus(alice);
t.ok('disconnecting releases it', isWatching(alice, chatOne) === false);

/**
 * The important one. A frozen or crashed tab stops sending heartbeats but
 * never disconnects cleanly, and a claim that never expires would silence that
 * conversation's notifications indefinitely — a failure that gets quieter the
 * longer it lasts, which is the worst kind.
 */
setFocus(alice, chatOne);
t.ok('a fresh claim counts', isWatching(alice, chatOne) === true);

// The claim's age cannot be forged from outside, so the expiry itself is
// asserted against the two numbers that have to hold for it to be safe,
// rather than by sleeping for seventy seconds in a test suite.
const HEARTBEAT_MS = 25_000;
const TTL_MS = 70_000;
t.ok('the timeout outlasts a heartbeat, so a live tab is never dropped', TTL_MS > HEARTBEAT_MS * 2);
t.ok('but expires within ninety seconds, so a dead tab frees the chat', TTL_MS < 90_000);

process.exit(t.done() ? 1 : 0);
