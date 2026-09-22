/**
 * What goes into a backup, and what coming back from one means.
 *
 * Ordinary chat history already lives on the server and follows the account
 * to a new phone, so a backup is not a copy of that for its own sake. It is
 * for the two things that do not follow you:
 *
 *   1. Secret chats. Their keys and decrypted messages exist only on this
 *      device — lose the phone and they are gone, by design. The backup is
 *      the one sanctioned way to carry them, sealed with a password the
 *      server never sees.
 *   2. A personal archive of normal chats, readable offline, including
 *      messages that later disappear on a timer or are deleted by the other
 *      person.
 *
 * So a restore does not re-post anything. Secret-chat state goes back into
 * the secret-chat store; everything else lands in a read-only archive.
 */
import { get as idbGet, set as idbSet, del as idbDel } from 'idb-keyval';
import { get } from '../api';
import { fetchAll } from '../export';
import { sealBackup, openBackup, BackupError } from './crypto';
import { exportKeyBundle, importKeyBundle } from '../e2ee/keystore';
import { exportSecretHistory, importSecretHistory } from '../e2ee/localHistory';
import type { Conversation, Message, Me } from '../types';

export { BackupError };

/* ── the shape on disk ─────────────────────────────────────────────────── */

export interface ArchivedConversation {
  id: string;
  type: 'direct' | 'group';
  name: string;
  avatarUrl: string;
  description: string;
  partner: { id: string; username: string; displayName: string } | null;
  members: { id: string; username?: string; displayName?: string }[];
  createdAt: string;
  messageCount: number;
}

export interface ArchivedMessage {
  id: string;
  senderId: string;
  senderName: string;
  type: string;
  body: string;
  media: { url: string; thumbUrl?: string; mime?: string; name?: string; size?: number; duration?: number } | null;
  replyTo: { id: string; senderName?: string; body?: string } | null;
  forwarded: boolean;
  reactions: { userId: string; emoji: string }[];
  call: { kind: string; status: string; duration: number } | null;
  transcript: string;
  editedAt: string | null;
  deletedForAll: boolean;
  expiresAt: string | null;
  createdAt: string;
}

export interface BackupData {
  format: 'nook-backup';
  version: 1;
  createdAt: string;
  user: { id: string; username: string };
  scope: 'all' | 'selected';
  conversations: ArchivedConversation[];
  messages: Record<string, ArchivedMessage[]>;
  /** Chats that could not be included, and why — shown after a backup and a restore. */
  skipped: { id: string; name: string; reason: string }[];
  secret: { keyBundle: unknown; history: unknown } | null;
}

export interface Progress {
  phase: 'chats' | 'secret' | 'sealing' | 'uploading' | 'downloading' | 'opening' | 'restoring';
  label: string;
  /** 0–1 when known; null draws an indeterminate bar. */
  fraction: number | null;
}

const slimMessage = (m: Message): ArchivedMessage => ({
  id: m.id,
  senderId: m.sender?.id || '',
  senderName: m.sender?.displayName || m.sender?.username || '',
  type: m.type,
  body: m.body || '',
  // A snap is meant to be seen and gone. Archiving its picture would turn a
  // backup into the one place a view-once photo quietly lives forever.
  media:
    m.media && !m.viewOnce?.enabled && m.type !== 'snap'
      ? {
          url: m.media.url,
          thumbUrl: m.media.thumbUrl,
          mime: m.media.mime,
          name: m.media.name,
          size: m.media.size,
          duration: m.media.duration,
        }
      : null,
  replyTo: m.replyTo ? { id: m.replyTo.id, senderName: m.replyTo.senderName, body: m.replyTo.body } : null,
  forwarded: Boolean(m.forwarded),
  reactions: m.reactions || [],
  call: m.call || null,
  transcript: m.transcript || '',
  editedAt: m.editedAt,
  deletedForAll: Boolean(m.deletedForAll),
  expiresAt: m.expiresAt,
  createdAt: m.createdAt,
});

const slimConversation = (c: Conversation, count: number): ArchivedConversation => ({
  id: c.id,
  type: c.type,
  name: c.name,
  avatarUrl: c.avatarUrl,
  description: c.description || '',
  partner: c.partner ? { id: c.partner.id, username: c.partner.username, displayName: c.partner.displayName } : null,
  members: (c.members || []).map((m) => ({
    id: m.user.id,
    username: (m.user as any).username,
    displayName: (m.user as any).displayName,
  })),
  createdAt: c.createdAt,
  messageCount: count,
});

/* ── making one ────────────────────────────────────────────────────────── */

export async function listConversations(): Promise<Conversation[]> {
  const { conversations } = await get<{ conversations: Conversation[] }>('/conversations');
  return conversations;
}

/**
 * Gather everything, paging through the same message API the app reads from.
 * Cancellable between pages, which is where all the time goes.
 */
export async function collectBackup(
  me: Pick<Me, 'id' | 'username'>,
  {
    only,
    signal,
    onProgress,
  }: { only?: string[] | null; signal?: AbortSignal; onProgress?: (p: Progress) => void } = {}
): Promise<BackupData> {
  const all = await listConversations();
  const chosen = only ? all.filter((c) => only.includes(c.id)) : all;

  const data: BackupData = {
    format: 'nook-backup',
    version: 1,
    createdAt: new Date().toISOString(),
    user: { id: me.id, username: me.username },
    scope: only ? 'selected' : 'all',
    conversations: [],
    messages: {},
    skipped: [],
    secret: null,
  };

  for (let i = 0; i < chosen.length; i++) {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    const c = chosen[i];
    const base = i / Math.max(1, chosen.length);

    // A locked chat's history is refused until its code is entered, and
    // prompting for every code mid-backup would be miserable. Say so instead.
    if (c.locked && !c.lockOpen) {
      data.skipped.push({ id: c.id, name: c.name, reason: 'Locked — open it once, then back up again to include it' });
      continue;
    }

    onProgress?.({ phase: 'chats', label: `Reading ${c.name || 'a chat'}`, fraction: base });
    try {
      const messages = await fetchAll(c.id, {
        signal,
        onPage: (n) =>
          onProgress?.({ phase: 'chats', label: `Reading ${c.name || 'a chat'} · ${n} messages`, fraction: base }),
      });
      data.messages[c.id] = messages.filter((m) => !m.scheduledFor).map(slimMessage);
      data.conversations.push(slimConversation(c, data.messages[c.id].length));
    } catch (err: any) {
      if (err?.name === 'AbortError') throw err;
      data.skipped.push({ id: c.id, name: c.name, reason: err?.message || 'Could not be read' });
    }
  }

  onProgress?.({ phase: 'secret', label: 'Adding secret-chat keys', fraction: 0.95 });
  try {
    data.secret = { keyBundle: await exportKeyBundle(), history: await exportSecretHistory() };
  } catch {
    // The archive is still worth having; the result screen says what is missing.
    data.skipped.push({ id: 'secret', name: 'Secret chats', reason: 'Their keys could not be read on this device' });
  }

  return data;
}

export const backupFileName = (d = new Date()) => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `nook-backup-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.nookbak`;
};

export async function sealToBlob(data: BackupData, password: string): Promise<Blob> {
  const bytes = await sealBackup(data, password);
  return new Blob([bytes as BlobPart], { type: 'application/octet-stream' });
}

/**
 * Hand the file to the person. The share sheet where there is one — on a phone
 * that is how a file reaches Files, Drive or a laptop — otherwise a download.
 */
export async function saveToDevice(blob: Blob, name: string) {
  const file = new File([blob], name, { type: 'application/octet-stream' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Nook backup' });
      return;
    } catch (err: any) {
      if (err?.name === 'AbortError') throw err;
      /* fall through to a plain download */
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/* ── coming back from one ──────────────────────────────────────────────── */

export async function openBackupFile(bytes: Uint8Array, password: string): Promise<BackupData> {
  const data = (await openBackup(bytes, password)) as BackupData;
  if (!data || data.format !== 'nook-backup' || !data.user?.id)
    throw new BackupError('corrupt', 'The file opened, but it is not a Nook backup inside.');
  return data;
}

/**
 * Only into the account that made it.
 *
 * Secret-chat keys are an identity: importing one person's into another's
 * account would let the second read the first's secret chats, and give their
 * contacts a device they never verified. The archive is personal too. So a
 * mismatch is refused outright rather than offered as an option.
 */
export function checkSameAccount(data: BackupData, me: Pick<Me, 'id' | 'username'>) {
  if (data.user.id !== me.id) {
    throw new BackupError(
      'other-account',
      `This backup belongs to @${data.user.username}, not @${me.username}. ` +
        'Backups can only be restored into the account that made them — sign in as that account to restore it.'
    );
  }
}

export async function restoreBackup(data: BackupData, me: Pick<Me, 'id' | 'username'>) {
  checkSameAccount(data, me);

  let secretRestored = false;
  if (data.secret) {
    // Keys first: history without them is unreadable, keys without history
    // still let new secret messages through.
    await importKeyBundle(data.secret.keyBundle);
    if (data.secret.history != null) await importSecretHistory(data.secret.history);
    secretRestored = true;
  }

  await saveArchive(me.id, {
    createdAt: data.createdAt,
    restoredAt: new Date().toISOString(),
    conversations: data.conversations,
    messages: data.messages,
  });

  return {
    chats: data.conversations.length,
    messages: Object.values(data.messages).reduce((n, list) => n + list.length, 0),
    secretRestored,
    skipped: data.skipped,
  };
}

/* ── the archive ───────────────────────────────────────────────────────── */

export interface Archive {
  createdAt: string;
  restoredAt: string;
  conversations: ArchivedConversation[];
  messages: Record<string, ArchivedMessage[]>;
}

/**
 * Under the account's cache prefix on purpose: signing out clears it, like
 * every other copy of your messages on this device. A shared computer should
 * not keep one person's archive for the next; the backup file brings it back.
 */
const archiveKey = (userId: string) => `nook.${userId}.archive`;

export async function saveArchive(userId: string, archive: Archive) {
  await idbSet(archiveKey(userId), archive);
}

export async function readArchive(userId: string): Promise<Archive | null> {
  try {
    return ((await idbGet<Archive>(archiveKey(userId))) as Archive | undefined) || null;
  } catch {
    return null;
  }
}

export async function clearArchive(userId: string) {
  await idbDel(archiveKey(userId)).catch(() => {});
}

// Kept in their own light module so the reminder banner can load them at
// startup without pulling in the whole backup machinery.
export * from './prefs';
