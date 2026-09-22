/**
 * What a new-message push may say, for one recipient.
 *
 * Pulled out of `deliver` so the decision can be tested without a phone: the
 * rules for secret chats are the kind that must never regress quietly, and a
 * pure function is the only thing a test can hold still long enough to check.
 */
import { TEMPLATES } from '../services/templates.js';

export const preview = (m) => {
  // Ciphertext is never a preview, whatever conversation it turns up in.
  if (m.type === 'encrypted') return 'New secret message';
  if (m.type === 'text') return (m.body || '').slice(0, 120);
  if (m.type === 'image') return '📷 Photo';
  if (m.type === 'video') return '🎬 Video';
  if (m.type === 'voice') return '🎙 Voice message';
  if (m.type === 'audio') return '🎵 Audio';
  if (m.type === 'file') return `📎 ${m.media?.name || 'File'}`;
  if (m.type === 'snap') return '🔥 Snap';
  if (m.type === 'sticker') return '🌟 Sticker';
  if (m.type === 'poll') return `📊 Poll: ${(m.body || '').slice(0, 100)}`;
  if (m.type === 'list') return `📝 List: ${(m.body || '').slice(0, 100)}`;
  if (m.type === 'call') return m.call?.kind === 'video' ? 'Video call' : 'Voice call';
  return m.body || '';
};

/**
 * @param {object} o
 * @param {object} o.convo       hydrated conversation
 * @param {object} o.message     hydrated message
 * @param {object} o.sender      the sending user
 * @param {boolean} o.showPreview  the recipient allows message text on alerts
 * @param {string} o.sound
 * @param {boolean} o.vibrate
 */
export function messagePushPayload({ convo, message, sender, showPreview, sound, vibrate }) {
  /**
   * A secret chat says who, never what — and with previews off, not even who.
   *
   * Previews-off already means "nothing on the lock screen someone else could
   * read". For an ordinary chat that still allows the sender's name; for a
   * chat the person went out of their way to make secret, the name is the
   * one remaining fact, so it goes too.
   */
  if (convo.type === 'secret' || message.type === 'encrypted') {
    return TEMPLATES.secretMessage.push({
      sender: showPreview ? sender?.displayName : 'Nook',
      conversationId: convo.id,
      messageId: message.id,
      icon: showPreview ? sender?.avatarUrl || '/logo.svg' : '/logo.svg',
      sound,
      vibrate,
    });
  }

  return TEMPLATES.message.push({
    sender: sender?.displayName,
    preview: showPreview ? preview(message) : 'New message',
    conversationName: convo.type === 'group' ? convo.name : '',
    conversationId: convo.id,
    messageId: message.id,
    icon: sender?.avatarUrl || '/logo.svg',
    sound,
    vibrate,
  });
}
