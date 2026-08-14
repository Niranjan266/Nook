import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useChat, selectActive } from '@/stores/chat';
import { useUi } from '@/stores/ui';
import { useAuth } from '@/stores/auth';
import Sheet from '@/components/Sheet';
import { upload } from '@/lib/api';
import { WALLPAPER_PRESETS, dominantColor, prepareWallpaper } from '@/lib/color';
import { spring } from '@/lib/motion';
import { IconImage, IconCheck, IconUsers, IconUser, IconRefresh } from '@/components/Icon';

export default function WallpaperSheet() {
  const { sheet, closeSheet, toast } = useUi();
  const conversation = useChat(selectActive);
  const setWallpaper = useChat((s) => s.setWallpaper);
  const meId = useAuth((s) => s.me?.id);

  const open = sheet === 'wallpaper';
  const fileInput = useRef<HTMLInputElement>(null);

  const [preset, setPreset] = useState('');
  const [url, setUrl] = useState('');
  const [tint, setTint] = useState('');
  const [dim, setDim] = useState(0.35);
  const [blur, setBlur] = useState(0);
  const [busy, setBusy] = useState(false);

  /**
   * Whether this look is yours alone or the room's. Defaults to "just me" —
   * that is the choice nobody else has to agree to, so it is the one that can
   * be made without consequence.
   *
   * Declared here with the other hooks, above the early return below: React
   * requires the same hooks in the same order on every render.
   */
  const [scope, setScope] = useState<'mine' | 'ours'>('mine');

  useEffect(() => {
    if (!open || !conversation) return;
    // Start from whatever you are actually looking at, so the sheet opens
    // showing the current background rather than resetting it.
    const wp = conversation.myWallpaper || conversation.wallpaper;
    setPreset(wp.preset);
    setUrl(wp.url);
    setTint(wp.tint);
    setDim(wp.dim);
    setBlur(wp.blur);
    setScope('mine');
  }, [open, conversation?.id]);

  if (!conversation) return null;

  const isGroup = conversation.type === 'group';
  const needsConsent = !isGroup && conversation.members.length > 1;
  // Groups: admins only. Don't offer an action the server will refuse.
  const canEdit = !isGroup || conversation.myRole === 'admin';

  async function pickFile(file: File) {
    setBusy(true);
    try {
      const blob = await prepareWallpaper(file);
      const localUrl = URL.createObjectURL(blob);
      const colour = await dominantColor(localUrl);
      URL.revokeObjectURL(localUrl);

      const { media } = await upload(blob, 'wallpaper', undefined, 'wallpaper.jpg');
      setUrl(media.url);
      setPreset('');
      setTint(colour);
    } catch (e: any) {
      toast(e?.message || 'Could not use that image.', true);
    } finally {
      setBusy(false);
    }
  }

  const asksPermission = scope === 'ours' && needsConsent;

  const apply = async () => {
    setBusy(true);
    try {
      await setWallpaper(conversation.id, { url, preset, tint, dim, blur }, !needsConsent, scope);
      toast(
        scope === 'mine'
          ? 'Set — only you see this'
          : asksPermission
            ? 'Suggested — they can accept it'
            : 'Wallpaper set'
      );
      closeSheet();
    } catch (e: any) {
      toast(e?.message || 'Could not save that.', true);
    } finally {
      setBusy(false);
    }
  };

  const clearMine = async () => {
    setBusy(true);
    try {
      await setWallpaper(conversation.id, { url: '', preset: '', tint: '', dim, blur }, true, 'mine');
      toast('Back to the room’s wallpaper');
      closeSheet();
    } catch (e: any) {
      toast(e?.message || 'Could not reset that.', true);
    } finally {
      setBusy(false);
    }
  };

  const previewStyle: React.CSSProperties = {
    backgroundImage: url ? `url(${url})` : undefined,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    filter: blur ? `blur(${blur}px)` : undefined,
    transform: blur ? 'scale(1.08)' : undefined,
  };

  return (
    <Sheet
      open={open}
      onClose={closeSheet}
      title="Wallpaper"
      footer={
        <>
          <button className="clay-btn" style={{ flex: 1 }} onClick={closeSheet}>
            Cancel
          </button>
          <button
            className="slab"
            style={{ flex: 2 }}
            onClick={apply}
            disabled={busy || (scope === 'ours' && !canEdit)}
          >
            {busy
              ? 'Working…'
              : scope === 'mine'
                ? 'Set for me'
                : asksPermission
                  ? 'Suggest to both of you'
                  : 'Set wallpaper'}
          </button>
        </>
      }
    >
      {/* live preview with two sample bubbles */}
      <div
        className="clay sunk"
        style={{
          position: 'relative',
          height: 180,
          borderRadius: 'var(--r-clay-lg)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'flex-end',
          gap: 8,
          padding: 14,
        }}
      >
        <div className={`wallpaper${preset ? ` wp-${preset}` : ''}`} style={{ ...previewStyle, ['--wp-dim' as any]: dim }} />
        <motion.div
          className="bubble"
          style={{ position: 'relative', alignSelf: 'flex-start', maxWidth: '72%' }}
          layout
          transition={spring}
        >
          <span className="msg-text" style={{ fontSize: 14 }}>
            Does this one work?
          </span>
        </motion.div>
        <motion.div
          className="bubble"
          style={{
            position: 'relative',
            alignSelf: 'flex-end',
            maxWidth: '72%',
            background: tint || 'var(--accent)',
            color: '#FDF8F2',
          }}
          layout
          transition={spring}
        >
          <span className="msg-text" style={{ fontSize: 14 }}>
            Bubbles pick up the colour.
          </span>
        </motion.div>
      </div>

      {/*
        Who this is for. This is the control that answers the complaint that
        changing a wallpaper always needed the other person's approval: on the
        left it is yours alone and nobody is asked, on the right it is the
        room's and they are.
      */}
      <div className="sheet-section">
        <span className="eyebrow">Who sees it</span>
        <div className="seg" role="group" aria-label="Who this wallpaper is for">
          <button
            className={`seg-item${scope === 'mine' ? ' on' : ''}`}
            onClick={() => setScope('mine')}
            aria-pressed={scope === 'mine'}
          >
            <IconUser size={15} />
            <span>Just me</span>
          </button>
          <button
            className={`seg-item${scope === 'ours' ? ' on' : ''}`}
            onClick={() => setScope('ours')}
            aria-pressed={scope === 'ours'}
          >
            <IconUsers size={15} />
            <span>{isGroup ? 'Everyone' : 'Both of us'}</span>
          </button>
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          {scope === 'mine'
            ? 'Only you will see this. No one is asked, and it changes nothing for anyone else.'
            : isGroup
              ? canEdit
                ? 'This becomes the room’s wallpaper for every member.'
                : 'Only a group admin can set the room’s wallpaper — ask one, or keep it to yourself above.'
              : asksPermission
                ? `${conversation.name.split(' ')[0]} gets asked before it changes for both of you.`
                : 'This becomes the room’s wallpaper.'}
        </p>
      </div>

      {conversation.myWallpaper && (
        <button className="list-row" onClick={clearMine} disabled={busy}>
          <span
            className="clay-round"
            style={{ width: 40, height: 40, background: 'var(--clay-sunk)', boxShadow: 'none' }}
          >
            <IconRefresh size={18} />
          </span>
          <span className="grow">
            <span className="list-row-label">Use the room’s wallpaper again</span>
            <span className="list-row-sub">Drops your personal one and goes back to the shared look</span>
          </span>
        </button>
      )}

      <div className="sheet-section">
        <span className="eyebrow">Built in</span>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
          {WALLPAPER_PRESETS.map((p) => (
            <button
              key={p.id}
              className={`wp-${p.id}`}
              style={{
                aspectRatio: '3 / 4',
                borderRadius: 'var(--r-clay-sm)',
                boxShadow: preset === p.id && !url ? '0 0 0 3px var(--ink)' : 'var(--clay-1)',
                position: 'relative',
              }}
              onClick={() => {
                setPreset(p.id);
                setUrl('');
                setTint(p.tint);
              }}
              aria-label={p.label}
              aria-pressed={preset === p.id && !url}
            >
              {preset === p.id && !url && (
                <span className="chip" style={{ position: 'absolute', top: 4, right: 4 }}>
                  <IconCheck size={12} />
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      <button className="list-row" onClick={() => fileInput.current?.click()} disabled={busy}>
        <span className="clay-round" style={{ width: 40, height: 40, background: 'var(--clay-sunk)', boxShadow: 'none' }}>
          <IconImage size={19} />
        </span>
        <span className="grow">
          <span className="list-row-label">Upload your own</span>
          <span className="list-row-sub">We pull the main colour out of it automatically</span>
        </span>
      </button>

      <div className="sheet-section">
        <span className="eyebrow">Readability</span>
        <label className="stack" style={{ gap: 6 }}>
          <span className="small muted row" style={{ justifyContent: 'space-between' }}>
            <span>Dim</span>
            <span className="tabular">{Math.round(dim * 100)}%</span>
          </span>
          <input type="range" min={0} max={0.85} step={0.05} value={dim} onChange={(e) => setDim(Number(e.target.value))} />
        </label>
        <label className="stack" style={{ gap: 6 }}>
          <span className="small muted row" style={{ justifyContent: 'space-between' }}>
            <span>Blur</span>
            <span className="tabular">{blur}px</span>
          </span>
          <input type="range" min={0} max={16} step={1} value={blur} onChange={(e) => setBlur(Number(e.target.value))} />
        </label>
      </div>

      <div className="sheet-section">
        <span className="eyebrow">Bubble tint</span>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {['', '#C0603C', '#57694A', '#CE9535', '#47606F', '#A33F2F', tint].filter((v, i, a) => a.indexOf(v) === i).map((c) => (
            <button
              key={c || 'default'}
              onClick={() => setTint(c)}
              aria-label={c || 'Default'}
              aria-pressed={tint === c}
              style={{
                width: 38,
                height: 38,
                borderRadius: 12,
                background: c || 'var(--accent)',
                boxShadow: tint === c ? '0 0 0 3px var(--ink)' : 'var(--clay-1)',
              }}
            />
          ))}
        </div>
      </div>

      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) pickFile(f);
          e.target.value = '';
        }}
      />
    </Sheet>
  );
}
