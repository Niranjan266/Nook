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

export const sendPayloadSchema = z.object({
  type: z.enum(['text', 'image', 'video', 'audio', 'voice', 'file', 'snap', 'sticker']).default('text'),
  body: z.string().max(8000).optional(),
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
}).superRefine((p, ctx) => {
  if (p.type !== 'sticker') return;
  // A sticker is the picture and nothing else: no caption to render beside a
  // bubble that is not there, and no view-once, which is what a snap is for.
  if (!p.media) ctx.addIssue({ code: 'custom', path: ['media'], message: 'A sticker needs its picture.' });
  else if (!isOwnMediaUrl(p.media.url))
    ctx.addIssue({ code: 'custom', path: ['media', 'url'], message: 'Stickers must be uploaded to Nook.' });
  if (p.body?.trim()) ctx.addIssue({ code: 'custom', path: ['body'], message: 'Stickers do not take a caption.' });
  if (p.viewOnce) ctx.addIssue({ code: 'custom', path: ['viewOnce'], message: 'A sticker cannot be view-once.' });
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
  if (payload.media?.publicId) {
    const owner = await uploadOwner(payload.media.publicId);
    if (!owner || String(owner) !== String(senderId)) delete payload.media.publicId;
  }
  return payload;
}
