/**
 * Every notification Nook can send, defined once.
 *
 * WHY THIS EXISTS
 *
 * The copy used to live at the call site. A new message wrote its own title in
 * services/messages.js, a friend request wrote a different one in
 * routes/users.js, an incoming call wrote a third in sockets/index.js, and the
 * admin panel typed a fourth by hand. Nothing was wrong with any of them
 * individually. Together they meant there was no such thing as "how Nook
 * writes a notification" — only six places that each had an opinion, and no
 * way to change the tone of any of it without finding all six.
 *
 * It also meant the three channels disagreed. A friend request said
 * "X wants to chat" on a phone and nothing at all by email, and the in-app
 * banner said something else again. The same event should not describe itself
 * three different ways depending on where you happen to be looking.
 *
 * So a template here is one event with three renderings — push, email, banner
 * — and the shared facts sit above them where they cannot drift apart.
 *
 * WHAT A TEMPLATE IS
 *
 *   id       stable key, used in the database and the admin panel; renaming
 *            one is a migration, so they are chosen to outlive their wording
 *   label    what a human calls it in the composer
 *   kind     'automatic' (the app sends it) or 'announcement' (you do)
 *   fields   the blanks, for the composer to draw inputs for
 *   push     ({ ...values }) => payload for services/push.js notify()
 *   email    ({ ...values }) => { subject, heading, body } or null when the
 *            event is too small to be worth an email
 *   banner   ({ ...values }) => { title, body } shown inside the open app
 *
 * WHAT IT DELIBERATELY IS NOT
 *
 * Not a template language. The values arrive from an admin form and end up in
 * an email, so anything that interprets them is a way for a typo to become a
 * broken send, and for a paste to become something worse. They are plain
 * functions returning plain objects; escaping happens in the mail layer that
 * builds the HTML, as it already did.
 */

/**
 * Announcements need somewhere to send you. Everything else is about a
 * conversation and already knows where it belongs.
 */
const HOME = '/';

/**
 * Who the notification is from.
 *
 * Every automatic template puts this in the title, so an absent one does not
 * degrade — it renders the word "undefined" onto somebody's lock screen. A
 * display name should always exist, and "should always" is exactly the class
 * of assumption worth one line of defence when the cost of being wrong is
 * visible to a user and invisible to us.
 */
const who = (name) => String(name || '').trim() || 'Someone';

/**
 * Notification bodies are read on a lock screen at arm's length, so they are
 * cut short rather than wrapped. Android and every browser truncate anyway —
 * doing it here means the cut lands after a word instead of mid-syllable.
 */
export function trim(text, max = 120) {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${space > max * 0.6 ? cut.slice(0, space) : cut}…`;
}

/* ── automatic: the app sends these itself ────────────────────────────────── */

const automatic = {
  /**
   * A new message.
   *
   * `preview` is resolved by the caller rather than here, because whether the
   * text may be shown at all is a privacy decision that depends on the
   * recipient's settings and on whether the chat is locked — questions this
   * file has no business answering. It receives the answer, not the inputs.
   */
  message: {
    id: 'message',
    label: 'New message',
    kind: 'automatic',
    fields: ['sender', 'preview', 'conversationName'],
    push: ({ sender, preview, conversationName, conversationId, messageId, icon, sound, vibrate }) => ({
      title: conversationName ? `${who(sender)} · ${conversationName}` : who(sender),
      body: trim(preview) || 'New message',
      tag: `convo-${conversationId}`,
      conversationId: String(conversationId ?? ''),
      messageId: String(messageId ?? ''),
      icon: icon || '/logo.svg',
      sound,
      vibrate,
    }),
    // No email. A message that arrives while you are away is what push is for;
    // emailing every one of them would make Nook a worse mailing list.
    email: null,
    banner: ({ sender, preview }) => ({ title: who(sender), body: trim(preview, 80) }),
  },

  friendRequest: {
    id: 'friend-request',
    label: 'Someone wants to chat',
    kind: 'automatic',
    fields: ['sender', 'note'],
    push: ({ sender, note, userId }) => ({
      title: `${who(sender)} wants to chat`,
      body: trim(note) || 'Tap to accept or decline.',
      tag: `friend-request-${userId}`,
      data: { kind: 'friend-request', userId: String(userId ?? '') },
      url: HOME,
      icon: '/logo.svg',
    }),
    email: ({ sender, note }) => ({
      subject: `${who(sender)} wants to chat on Nook`,
      heading: `${who(sender)} wants to chat`,
      body: [
        note ? `They said: "${trim(note, 300)}"` : `${who(sender)} has asked to start a conversation with you.`,
        '',
        'You can accept or decline in Nook. Nobody can message you until you accept — that is the whole point of the request.',
      ].join('\n'),
    }),
    banner: ({ sender }) => ({ title: who(sender), body: 'wants to chat' }),
  },

  friendAccepted: {
    id: 'friend-accepted',
    label: 'Request accepted',
    kind: 'automatic',
    fields: ['sender'],
    push: ({ sender, userId }) => ({
      title: `${who(sender)} accepted`,
      body: 'You can talk now.',
      tag: `friend-accepted-${userId}`,
      data: { kind: 'friend-accepted', userId: String(userId ?? '') },
      url: HOME,
      icon: '/logo.svg',
    }),
    email: null, // Pleasant, but not worth an inbox.
    banner: ({ sender }) => ({ title: who(sender), body: 'accepted your request' }),
  },

  nudge: {
    id: 'nudge',
    label: 'Nudge',
    kind: 'automatic',
    fields: ['sender'],
    push: ({ sender, userId }) => ({
      title: who(sender),
      body: 'nudged you',
      tag: `nudge-${userId}`,
      // A nudge is a deliberate interruption — it is the one thing whose
      // entire purpose is to get through. Anything less than urgent makes it
      // pointless.
      urgent: true,
      icon: '/logo.svg',
    }),
    email: null,
    banner: ({ sender }) => ({ title: who(sender), body: 'nudged you' }),
  },

  call: {
    id: 'call',
    label: 'Incoming call',
    kind: 'automatic',
    fields: ['sender', 'video'],
    push: ({ sender, video, callId, conversationId }) => ({
      title: who(sender),
      body: video ? 'Video call' : 'Voice call',
      tag: `call-${callId}`,
      conversationId: String(conversationId ?? ''),
      urgent: true,
      icon: '/logo.svg',
    }),
    email: null, // An email about a call is an email about something over.
    banner: ({ sender, video }) => ({ title: who(sender), body: video ? 'Video call' : 'Voice call' }),
  },

  /**
   * Confirming an email address.
   *
   * Deliberately the only template with a `code`, and deliberately used for
   * nothing else. A six-digit code is the most phishable thing Nook ever
   * sends: it arrives in an inbox, it looks the same as every other code
   * anyone gets, and it is worth stealing — a verified address is what Google
   * sign-in links accounts by, so whoever confirms an address can be linked to
   * it later. So the copy is fixed here rather than assembled at a call site,
   * and it always says three things: what the code is for, that it expires,
   * and that ignoring it changes nothing. The last one is what makes an
   * unexpected code safe to ignore instead of alarming.
   *
   * `email: null` would be wrong and `push` would be worse — a code pushed to
   * a phone defeats the point of sending it to the address being proved. Push
   * and banner are absent by design, not by omission.
   */
  emailVerify: {
    id: 'email-verify',
    label: 'Confirm your email',
    kind: 'automatic',
    fields: ['code', 'displayName'],
    push: null,
    email: ({ code, displayName }) => ({
      // The code goes in the subject: most people read it from the inbox list
      // and never open the message, which is a real saving on a phone.
      subject: `${code} — confirm your email for Nook`,
      heading: 'Confirm your email',
      lede: `Hi ${who(displayName)} — adding an email means you can get back into your nook if you forget your password. It stays private, and it is never shown to anyone.`,
      code: String(code ?? ''),
      body: [
        `Your Nook confirmation code is ${code}.`,
        '',
        'It expires in 15 minutes.',
        '',
        "If you didn't ask for this, ignore it — nothing on your account has changed, and no code can be used without also being signed in as you.",
      ].join('\n'),
    }),
    banner: null,
  },

  pushTest: {
    id: 'push-test',
    label: 'Test notification',
    kind: 'automatic',
    fields: [],
    push: () => ({
      title: 'Nook',
      body: 'Notifications are working. This is the only one you asked for.',
      tag: 'nook-test',
      icon: '/logo.svg',
    }),
    email: null,
    banner: () => ({ title: 'Nook', body: 'Notifications are working.' }),
  },
};

/* ── announcements: you send these ────────────────────────────────────────── */

/**
 * These exist because "write your own title and body every time" is how
 * announcements end up inconsistent and, occasionally, alarming. A
 * maintenance notice and a new-feature note want different tones, and
 * deciding that once is better than deciding it at 11pm with the panel open.
 *
 * Every one takes `message` — the thing you actually want to say — and wraps
 * it in the framing that kind of announcement needs. The words are yours; the
 * shape is not up for grabs each time.
 */
const announcements = {
  update: {
    id: 'update',
    label: 'Update',
    kind: 'announcement',
    hint: "Something has changed and people should know. The neutral one — use it when the others do not fit.",
    fields: ['headline', 'message', 'url'],
    push: ({ headline, message, url }) => ({
      title: trim(headline, 60) || 'Nook update',
      body: trim(message) || 'Open Nook to see what changed.',
      tag: 'nook-announcement',
      url: url || HOME,
      icon: '/logo.svg',
    }),
    email: ({ headline, message }) => ({
      subject: trim(headline, 70) || 'A Nook update',
      heading: trim(headline, 70) || 'A Nook update',
      body: message,
    }),
    banner: ({ headline, message }) => ({
      title: trim(headline, 60) || 'Nook update',
      body: trim(message, 100),
    }),
  },

  feature: {
    id: 'feature',
    label: 'New feature',
    kind: 'announcement',
    hint: 'Something new to try. Says what it is and where to find it.',
    fields: ['headline', 'message', 'url'],
    push: ({ headline, message, url }) => ({
      title: `New in Nook: ${trim(headline, 50)}`,
      body: trim(message),
      tag: 'nook-announcement',
      url: url || HOME,
      icon: '/logo.svg',
    }),
    email: ({ headline, message }) => ({
      subject: `New in Nook: ${trim(headline, 60)}`,
      heading: trim(headline, 70),
      body: [message, '', 'It is live now — open Nook and it is there.'].join('\n'),
    }),
    banner: ({ headline }) => ({ title: 'New in Nook', body: trim(headline, 90) }),
  },

  maintenance: {
    id: 'maintenance',
    label: 'Maintenance',
    kind: 'announcement',
    hint: 'Nook will be interrupted. Leads with when, because that is the only part anyone needs.',
    fields: ['when', 'message', 'url'],
    push: ({ when, message }) => ({
      title: 'Nook maintenance',
      body: trim(when ? `${when} — ${message}` : message),
      tag: 'nook-announcement',
      url: HOME,
      icon: '/logo.svg',
    }),
    email: ({ when, message }) => ({
      subject: when ? `Nook maintenance — ${trim(when, 50)}` : 'Nook maintenance',
      heading: 'Planned maintenance',
      body: [
        when ? `When: ${when}` : '',
        when ? '' : '',
        message,
        '',
        'Nothing you have sent is affected. Messages written while Nook is unreachable are queued and go out when it is back.',
      ]
        .filter((line, i, all) => !(line === '' && all[i - 1] === ''))
        .join('\n'),
    }),
    banner: ({ when }) => ({
      title: 'Planned maintenance',
      body: when ? trim(when, 90) : 'Nook will be briefly unavailable.',
    }),
  },

  notice: {
    id: 'notice',
    label: 'Important notice',
    kind: 'announcement',
    hint: 'Security or account matters. Plain, no reassurance you have not earned.',
    fields: ['headline', 'message', 'url'],
    push: ({ headline, message, url }) => ({
      title: trim(headline, 60) || 'Important',
      body: trim(message),
      tag: 'nook-announcement',
      url: url || HOME,
      urgent: true,
      icon: '/logo.svg',
    }),
    email: ({ headline, message }) => ({
      subject: trim(headline, 70) || 'An important note about your Nook account',
      heading: trim(headline, 70) || 'Something you should know',
      body: [
        message,
        '',
        'Nook will never ask you for your password, and no email from us will ever contain a link that asks you to enter it.',
      ].join('\n'),
    }),
    banner: ({ headline, message }) => ({
      title: trim(headline, 60) || 'Important',
      body: trim(message, 100),
    }),
  },
};

export const TEMPLATES = { ...automatic, ...announcements };

/** Look one up by its stable id rather than its key. */
export function byId(id) {
  return Object.values(TEMPLATES).find((t) => t.id === id) || null;
}

/** What the admin composer needs to draw itself — no functions cross the wire. */
export function catalogue() {
  return Object.values(TEMPLATES)
    .filter((t) => t.kind === 'announcement')
    .map(({ id, label, hint, fields }) => ({
      id,
      label,
      hint,
      fields,
      // Whether this kind can reach each channel at all, so the composer can
      // grey out what it cannot do rather than silently sending nothing.
      channels: { push: true, email: Boolean(byId(id)?.email), banner: true },
    }));
}

/**
 * Render one template into every channel at once.
 *
 * Returning all three together rather than one at a time is what keeps them
 * honest: a preview shows exactly what a send will produce, because the
 * preview and the send call this same function.
 */
export function render(id, values = {}) {
  const template = byId(id);
  if (!template) return null;
  return {
    id: template.id,
    label: template.label,
    push: typeof template.push === 'function' ? template.push(values) : null,
    email: typeof template.email === 'function' ? template.email(values) : null,
    banner: typeof template.banner === 'function' ? template.banner(values) : null,
  };
}
