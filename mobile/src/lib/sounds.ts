/**
 * Notification tone names.
 *
 * On the web these are synthesised with the Web Audio API. On a phone the OS
 * owns notification sounds — a JS-generated tone can't play when the app is
 * backgrounded, which is precisely when a notification matters. So the choice
 * is stored per conversation and mapped to an Android notification channel;
 * iOS uses the default unless a custom sound file is bundled.
 *
 * The list is kept identical to the web app so the setting means the same thing
 * on both, and syncs cleanly through the same API field.
 */
export const SOUND_NAMES = [
  { id: 'default', label: 'Nook', description: 'Two soft notes, rising' },
  { id: 'knock', label: 'Knock', description: 'Someone at the door' },
  { id: 'pebble', label: 'Pebble', description: 'A drop into water' },
  { id: 'chime', label: 'Chime', description: 'Clear and bright' },
  { id: 'wood', label: 'Wood', description: 'A dull, warm tap' },
  { id: 'hush', label: 'Hush', description: 'Barely there' },
  { id: 'none', label: 'Silent', description: 'No sound at all' },
] as const;

export type SoundId = (typeof SOUND_NAMES)[number]['id'];

/** Android notification channels — one per tone, created at startup. */
export const soundChannel = (id: SoundId) => (id === 'none' ? 'silent' : `messages-${id}`);
