/**
 * What a client may put in a message, checked once for every way in.
 *
 * The REST route validated its body with zod and the socket handler — the
 * path clients actually use — passed whatever arrived straight through. So the
 * socket accepted `type: 'system'` and `'call'`, a forged `call` object, a
 * snap timer of a week, and any `media` at all. Both paths now parse with this
 * one schema, which is the only way the two can stay the same.
 */
import { z } from 'zod';
import { uploadOwner } from '../db/messages.js';
import { env } from '../config/env.js';
import { POLL_MIN_OPTIONS, POLL_MAX_OPTIONS, LIST_MAX_ITEMS } from '../db/polls.js';

/**
 * Media links end up in `src` and `href` on every client. Only web URLs and
 * our own `/uploads/` paths are allowed — a `javascript:` link in `href` runs
 * in the recipient's session the moment they tap "open".
 */
export function isSafeMediaUrl(value) {
  if (typeof value !== 'string') return false;
  if (value.startsWith('/uploads/')) return true;
  try {
    const { protocol } = new URL(value);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * A file this server stored: a local `/uploads/` path (bare or behind
 * PUBLIC_URL), or our own Cloudinary account. Stickers are only ever made
 * here, so one pointing anywhere else is a hotlink to a picture nobody
 * uploaded — and a sticker renders with no frame or caption to say where it
 * came from.
 */
export function isOwnMediaUrl(value) {
  if (!isSafeMediaUrl(value)) return false;
  if (value.startsWith('/uploads/')) return !value.includes('..');
  if (env.publicUrl && value.startsWith(`${env.publicUrl}/uploads/`)) return !value.includes('..');
  if (env.cloudinary.enabled && value.startsWith(`https://res.cloudinary.com/${env.cloudinary.cloudName}/`)) return true;
  return false;
}

const mediaUrl = z.string().max(2048).refine(isSafeMediaUrl, 'That media link is not allowed.');
const num = z.number().nonnegative().nullish();

export const mediaSchema = z.object({
  url: mediaUrl,
  thumbUrl: z.union([z.literal(''), mediaUrl]).nullish(),
  mime: z.string().max(200).nullish(),
  name: z.string().max(300).nullish(),
  size: num,
  width: num,
  height: num,
  duration: num,
  waveform: z.array(z.number()).max(1000).nullish(),
  blurhash: z.string().max(200).nullish(),
  publicId: z.string().max(300).nullish(),
  provider: z.string().max(20).nullish(),
});

/**
 * A poll's question travels in `body`, like a list's title; this is the rest.
 *
 * A deadline must be in the future and within a month. A past one would
 * create a poll that is closed on arrival, and an unbounded one is a poll
 * nobody remembers to close, which is what closing early is for.
 */
const MAX_POLL_WINDOW_MS = 31 * 24 * 60 * 60 * 1000;

export const pollSchema = z.object({
  options: z
    .array(z.string().trim().min(1, 'Options cannot be empty.').max(100, 'Keep each option under 100 characters.'))
    .min(POLL_MIN_OPTIONS, 'A poll needs at least two options.')
    .max(POLL_MAX_OPTIONS, 'A poll can have at most ten options.')
    .refine(
      (options) => new Set(options.map((o) => o.toLowerCase())).size === options.length,
      'Each option must be different.'
    ),
  multiple: z.boolean().default(false),
  anonymous: z.boolean().default(false),
  closesAt: z
    .string()
    .max(64)
    .nullish()
    .refine((v) => {
      if (!v) return true;
      const t = new Date(v).getTime();
      return Number.isFinite(t) && t > Date.now() && t - Date.now() <= MAX_POLL_WINDOW_MS;
    }, 'Pick a closing time in the next month.'),
});

export const listSchema = z.object({
  items: z
    .array(z.string().trim().min(1, 'Items cannot be empty.').max(200, 'Keep each item under 200 characters.'))
    .max(LIST_MAX_ITEMS, `A list can hold at most ${LIST_MAX_ITEMS} items.`)
    .default([]),
});

/**
 * Ciphertext is longer than what it hides — base64 plus a header — so an
 * 8000-character message encrypts to more than 8000 characters. Encrypted
 * bodies get their own ceiling instead of silently failing near the top.
 */
const PLAIN_MAX = 8000;
const CIPHER_MAX = 24000;

const baseSendSchema = z.object({
  // 'encrypted' is a secret-chat message: `body` is ciphertext the server
  // stores and relays without reading. What it really is — text, a photo, a
  // voice note — is inside the ciphertext, where only the two devices see it.
  type: z.enum(['text', 'image', 'video', 'audio', 'voice', 'file', 'snap', 'sticker', 'poll', 'list', 'encrypted']).default('text'),
  body: z.string().max(CIPHER_MAX).optional(),
  media: mediaSchema.nullish(),
  replyTo: z.string().max(64).nullable().optional(),
  forwardedFrom: z.string().max(64).nullable().optional(),
  mentions: z.array(z.string().max(64)).max(100).optional(),
  clientId: z.string().max(100).optional(),
  viewOnce: z.boolean().optional(),
  // How long the recipient may look at a snap. 0 means they close it
  // themselves; capped at a minute so "view once" keeps meaning something.
  viewSeconds: z.number().int().min(0).max(60).optional(),
  threadRoot: z.string().max(64).nullable().optional(),
  scheduledFor: z.string().max(64).nullable().optional(),
  transcript: z.string().max(8000).optional(),
  poll: pollSchema.optional(),
  list: listSchema.optional(),
});

export const sendPayloadSchema = baseSendSchema.superRefine((p, ctx) => {
  /**
   * Each shape belongs to exactly one type. A text message carrying `poll`
   * would write poll rows under a message nothing renders as a poll, and a
   * poll with no options would sit in the chat as an empty card forever.
   */
  const title = (p.body || '').trim();
  const issue = (path, message) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });

  if (p.type === 'poll') {
    if (!p.poll) issue('poll', 'A poll needs options.');
    if (!title) issue('body', 'Ask a question.');
    if (title.length > 300) issue('body', 'Keep the question under 300 characters.');
  } else if (p.poll) {
    issue('poll', 'Only a poll can carry poll options.');
  }

  if (p.type === 'list') {
    if (!title) issue('body', 'Give the list a title.');
    if (title.length > 120) issue('body', 'Keep the title under 120 characters.');
  } else if (p.list) {
    issue('list', 'Only a list can carry list items.');
  }

  // A poll that vanishes after one look is a poll nobody can finish voting in.
  if ((p.type === 'poll' || p.type === 'list') && (p.media || p.viewOnce))
    issue('type', 'Polls and lists cannot carry media.');

  if (p.type === 'sticker') {
    // A sticker is the picture and nothing else: no caption to render beside a
    // bubble that is not there, and no view-once, which is what a snap is for.
    if (!p.media) issue('media', 'A sticker needs its picture.');
    else if (!isOwnMediaUrl(p.media.url))
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['media', 'url'], message: 'Stickers must be uploaded to Nook.' });
    if (title) issue('body', 'Stickers do not take a caption.');
    if (p.viewOnce) issue('viewOnce', 'A sticker cannot be view-once.');
  }

  if (p.type !== 'encrypted' && (p.body || '').length > PLAIN_MAX)
    issue('body', 'That message is too long.');
});

/**
 * Parse a send, then decide whether its file id can be trusted.
 *
 * `publicId` is what unsend and a burnt snap delete at the provider, so a
 * client-supplied one is kept only when this sender is the person who uploaded
 * that file. Anything else is dropped: the message still shows the picture,
 * it just cannot be used to delete it.
 */
export async function parseSendPayload(raw, senderId) {
  const payload = sendPayloadSchema.parse(raw ?? {});
  // One sticker file is shared by every chat it is sent to and by the tray.
  // Unsending one copy must not delete it for all the others.
  if (payload.type === 'sticker' && payload.media) delete payload.media.publicId;
  if (payload.type === 'poll' || payload.type === 'list') payload.body = payload.body.trim();
  if (payload.media?.publicId) {
    const owner = await uploadOwner(payload.media.publicId);
    if (!owner || String(owner) !== String(senderId)) delete payload.media.publicId;
  }
  return payload;
}
