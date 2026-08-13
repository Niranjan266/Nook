import { useEffect, useState } from 'react';
import { useUi } from '@/stores/ui';
import { useAuth } from '@/stores/auth';
import { useChat } from '@/stores/chat';
import Sheet from '@/components/Sheet';
import Avatar from '@/components/Avatar';
import { put } from '@/lib/api';
import type { Folder } from '@/lib/types';
import { IconPlus, IconTrash, IconCheck, IconFolder } from '@/components/Icon';

const EMOJI = ['📁', '💼', '🏠', '❤️', '🎧', '🧭', '🌿', '🔧', '📌', '🎬'];

/**
 * Folders live on the *user*, not the conversation: your idea of "Work" is
 * yours, and the other person never learns which drawer you filed them in.
 */
export default function FoldersSheet() {
  const { sheet, closeSheet, toast } = useUi();
  const { me, setMe } = useAuth();
  const { conversations, order } = useChat();

  const [folders, setFolders] = useState<Folder[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('📁');
  const [busy, setBusy] = useState(false);

  const open = sheet === 'folders';

  useEffect(() => {
    if (open && me) setFolders(me.folders || []);
  }, [open, me?.folders]);

  if (!me) return null;

  const save = async (next: Folder[]) => {
    setBusy(true);
    try {
      const res = await put<{ folders: Folder[] }>('/users/me/folders', { folders: next });
      setFolders(res.folders);
      setMe({ ...me, folders: res.folders });
    } catch (e: any) {
      toast(e?.message || 'Could not save folders.', true);
    } finally {
      setBusy(false);
    }
  };

  const addFolder = () => {
    if (!name.trim()) return;
    const folder: Folder = {
      id: `f_${Date.now().toString(36)}`,
      name: name.trim(),
      emoji,
      conversations: [],
    };
    save([...folders, folder]);
    setName('');
    setEditing(folder.id);
  };

  const toggleConversation = (folderId: string, conversationId: string) => {
    save(
      folders.map((f) =>
        f.id !== folderId
          ? f
          : {
              ...f,
              conversations: f.conversations.includes(conversationId)
                ? f.conversations.filter((c) => c !== conversationId)
                : [...f.conversations, conversationId],
            }
      )
    );
  };

  const current = folders.find((f) => f.id === editing);

  return (
    <Sheet open={open} onClose={closeSheet} title="Folders">
      {!current ? (
        <>
          <div className="sheet-section">
            <span className="eyebrow">Your folders</span>
            {folders.length === 0 && (
              <p className="small muted">
                None yet. A folder is just a filter over your conversations — nobody else can see it.
              </p>
            )}
            {folders.map((f) => (
              <div key={f.id} className="list-row">
                <span style={{ fontSize: 19 }}>{f.emoji || '📁'}</span>
                <button className="grow" style={{ textAlign: 'left' }} onClick={() => setEditing(f.id)}>
                  <span className="list-row-label">{f.name}</span>
                  <span className="list-row-sub">
                    {f.conversations.length} {f.conversations.length === 1 ? 'chat' : 'chats'}
                  </span>
                </button>
                <button
                  className="clay-round"
                  style={{ width: 32, height: 32, color: 'var(--rust)' }}
                  onClick={() => save(folders.filter((x) => x.id !== f.id))}
                  aria-label={`Delete ${f.name}`}
                >
                  <IconTrash size={15} />
                </button>
              </div>
            ))}
          </div>

          <div className="sheet-section">
            <span className="eyebrow">New folder</span>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              {EMOJI.map((e) => (
                <button
                  key={e}
                  onClick={() => setEmoji(e)}
                  aria-pressed={emoji === e}
                  style={{
                    width: 36,
                    height: 36,
                    fontSize: 18,
                    borderRadius: 11,
                    boxShadow: emoji === e ? '0 0 0 2.5px var(--ink)' : 'var(--clay-1)',
                    background: 'var(--clay-surface)',
                  }}
                >
                  {e}
                </button>
              ))}
            </div>
            <div className="row" style={{ gap: 8 }}>
              <input
                className="groove grow"
                placeholder="Work, Family, Loud ones…"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={24}
                onKeyDown={(e) => e.key === 'Enter' && addFolder()}
              />
              <button className="slab" onClick={addFolder} disabled={!name.trim() || busy}>
                <IconPlus size={16} /> Add
              </button>
            </div>
          </div>
        </>
      ) : (
        <>
          <button className="clay-btn" style={{ alignSelf: 'flex-start' }} onClick={() => setEditing(null)}>
            ← All folders
          </button>

          <div className="sheet-section">
            <span className="eyebrow row" style={{ gap: 8 }}>
              <IconFolder size={15} /> {current.emoji} {current.name}
            </span>
            <p className="tiny faint" style={{ paddingLeft: 4 }}>
              Tick the conversations that belong here.
            </p>

            {order.map((id) => {
              const c = conversations[id];
              if (!c) return null;
              const on = current.conversations.includes(id);
              return (
                <button
                  key={id}
                  className="list-row"
                  aria-pressed={on}
                  onClick={() => toggleConversation(current.id, id)}
                >
                  <Avatar
                    name={c.name}
                    src={c.avatarUrl}
                    id={c.partner?.id || c.id}
                    size={38}
                    square={c.type === 'group'}
                  />
                  <span className="grow">
                    <span className="list-row-label">{c.name}</span>
                    <span className="list-row-sub">
                      {c.type === 'group' ? `${c.members.length} people` : `@${c.partner?.username}`}
                    </span>
                  </span>
                  {on && (
                    <span className="chip">
                      <IconCheck size={13} />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </>
      )}
    </Sheet>
  );
}
