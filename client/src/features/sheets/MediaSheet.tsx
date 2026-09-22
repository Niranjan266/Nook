import { useEffect, useMemo, useState } from 'react';
import { useChat, selectActive } from '@/stores/chat';
import { useUi } from '@/stores/ui';
import { motion } from 'framer-motion';
import Sheet from '@/components/Sheet';
import { springs } from '@/lib/motion';
import Blur from '@/components/Blur';
import { get } from '@/lib/api';
import { bytes, stamp } from '@/lib/format';
import type { Message } from '@/lib/types';
import { IconImage, IconFile, IconMic, IconDownload } from '@/components/Icon';
import { safeUrl } from '@/lib/config';

type Tab = 'media' | 'files' | 'voice';

/**
 * A shared constant, not a fresh `[]` per render.
 *
 * Returning a new array from a Zustand selector changes the snapshot identity
 * on every render, which React reads as "the store changed again" — and that
 * is an infinite render loop, not a subtle inefficiency.
 */
const NO_MESSAGES: Message[] = [];

/** Everything shared in one conversation, without scrolling back through it. */
export default function MediaSheet() {
  const sheet = useUi((s) => s.sheet);
  const closeSheet = useUi((s) => s.closeSheet);
  const setLightbox = useUi((s) => s.setLightbox);
  const conversation = useChat(selectActive);
  const messages = useChat((s) => (s.activeId ? s.messages[s.activeId] : undefined) ?? NO_MESSAGES);
  const [tab, setTab] = useState<Tab>('media');
  const [extra, setExtra] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);

  const open = sheet === 'media';

  /**
   * The stream only holds what's been paged in. Walk further back so the grid
   * shows the whole conversation rather than the last screenful.
   */
  useEffect(() => {
    if (!open || !conversation) return;
    setLoading(true);
    (async () => {
      const collected: Message[] = [];
      let before = messages[0]?.createdAt;
      for (let page = 0; page < 6; page++) {
        const query = new URLSearchParams({ limit: '100' });
        if (before) query.set('before', before);
        try {
          const data = await get<{ messages: Message[]; hasMore: boolean }>(
            `/messages/${conversation.id}?${query}`
          );
          collected.push(...data.messages);
          if (!data.hasMore || !data.messages.length) break;
          before = data.messages[0].createdAt;
        } catch {
          break;
        }
      }
      setExtra(collected);
      setLoading(false);
    })();
  }, [open, conversation?.id]);

  const all = useMemo(() => {
    const byId = new Map<string, Message>();
    [...extra, ...messages].forEach((m) => byId.set(m.id, m));
    return [...byId.values()]
      .filter((m) => m.media?.url && !m.deletedForAll && !m.viewOnce)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [extra, messages]);

  const media = all.filter((m) => m.type === 'image' || m.type === 'video');
  const files = all.filter((m) => m.type === 'file');
  const voice = all.filter((m) => m.type === 'voice' || m.type === 'audio');

  const shown = tab === 'media' ? media : tab === 'files' ? files : voice;

  return (
    <Sheet open={open} onClose={closeSheet} title="Shared">
      <div className="shelf-tabs" role="tablist" style={{ margin: 0, padding: 'var(--s-1) 0' }}>
        {(
          [
            ['media', `Photos & video${media.length ? ` (${media.length})` : ''}`],
            ['files', `Files${files.length ? ` (${files.length})` : ''}`],
            ['voice', `Voice${voice.length ? ` (${voice.length})` : ''}`],
          ] as [Tab, string][]
        ).map(([id, label]) => (
          <button
            key={id}
            className={`shelf-tab${tab === id ? ' on' : ''}`}
            onClick={() => setTab(id)}
            role="tab"
            aria-selected={tab === id}
          >
            {tab === id && <motion.span layoutId="media-tab-pill" className="shelf-tab-pill" transition={springs.pop} />}
            <span>{label}</span>
          </button>
        ))}
      </div>

      {loading && <p className="sheet-note">Looking back through the conversation…</p>}

      {!loading && shown.length === 0 && (
        <p className="sheet-note">
          {tab === 'media'
            ? 'No photos or video shared here yet.'
            : tab === 'files'
              ? 'No files shared here yet.'
              : 'No voice messages here yet.'}
        </p>
      )}

      {tab === 'media' && shown.length > 0 && (
        <div className="search-grid">
          {shown.map((m) => (
            <button
              key={m.id}
              onClick={() => {
                setLightbox({ messageId: m.id });
                closeSheet();
              }}
              className="search-tile"
              title={stamp(m.createdAt)}
            >
              <Blur hash={m.media?.blurhash} />
              <img
                src={safeUrl(m.media?.thumbUrl || m.media?.url)}
                alt=""
                loading="lazy"
              />
            </button>
          ))}
        </div>
      )}

      {tab !== 'media' && shown.length > 0 && (
        <div className="sheet-group">
        {shown.map((m) => (
          <a
            key={m.id}
            className="list-row"
            href={safeUrl(m.media?.url) || undefined}
            download={m.media?.name}
            target="_blank"
            rel="noreferrer"
          >
            <span className="row-icon">
              {tab === 'files' ? <IconFile size={18} /> : <IconMic size={18} />}
            </span>
            <span className="grow">
              <span className="list-row-label truncate">
                {m.media?.name || (tab === 'voice' ? 'Voice message' : 'File')}
              </span>
              <span className="list-row-sub">
                {bytes(m.media?.size)} · {stamp(m.createdAt)}
              </span>
            </span>
            <IconDownload size={18} className="chev" />
          </a>
        ))}
        </div>
      )}
    </Sheet>
  );
}
