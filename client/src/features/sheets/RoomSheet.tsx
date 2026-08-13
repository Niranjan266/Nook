import { useState } from 'react';
import { useChat, selectActive } from '@/stores/chat';
import { useUi } from '@/stores/ui';
import Sheet from '@/components/Sheet';
import { MOODS, toClock, fromClock, daysUntil } from '@/lib/rooms';
import { WALLPAPER_PRESETS } from '@/lib/color';
import { stamp } from '@/lib/format';
import { IconWall, IconSchedule, IconHistory, IconClose, IconPlus, IconClock } from '@/components/Icon';

/**
 * Rooms: everything that treats a conversation as a place rather than a list.
 * Mood, a wall you can put things on, a wallpaper that knows the time of day,
 * and the history of every wallpaper this room has worn.
 */
export default function RoomSheet() {
  const { sheet, closeSheet, toast } = useUi();
  const conversation = useChat(selectActive);
  const { setMood, addWallObject, setSchedule, restoreWallpaper } = useChat();

  const [note, setNote] = useState('');
  const [objectText, setObjectText] = useState('');
  const [objectDate, setObjectDate] = useState('');
  const [busy, setBusy] = useState(false);

  const open = sheet === 'room';
  if (!conversation) return null;

  const schedule = conversation.wallpaperSchedule;
  const history = conversation.wallpaperHistory || [];

  const pickMood = async (mood: string) => {
    setBusy(true);
    try {
      await setMood(conversation.id, mood, note);
      toast(mood ? 'The room knows' : 'Mood cleared');
    } catch {
      toast('Could not set that.', true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={closeSheet} title="This room">
      {/* ── mood ───────────────────────────────────────────────────────── */}
      <div className="sheet-section">
        <span className="eyebrow">How it is right now</span>
        <p className="tiny faint" style={{ paddingLeft: 4 }}>
          Only the people in this room see this. It is not a status broadcast.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6 }}>
          {MOODS.map((m) => (
            <button
              key={m.id || 'none'}
              className={`clay-btn${conversation.roomState?.mood === m.id ? ' on' : ''}`}
              style={{ justifyContent: 'flex-start', fontSize: 'var(--t-sm)' }}
              onClick={() => pickMood(m.id)}
              disabled={busy}
            >
              <span style={{ fontSize: 15 }}>{m.emoji || '—'}</span>
              {m.label}
            </button>
          ))}
        </div>
        <input
          className="groove"
          placeholder="Add a line of context (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={120}
        />
      </div>

      {/* ── the wall ───────────────────────────────────────────────────── */}
      <div className="sheet-section">
        <span className="eyebrow row" style={{ gap: 8 }}>
          <IconWall size={15} /> The wall
        </span>
        <p className="tiny faint" style={{ paddingLeft: 4 }}>
          Pinned to the room itself, so it never scrolls away.
          {conversation.wallObjects?.length ? ` ${conversation.wallObjects.length} of 12 used.` : ''}
        </p>

        <input
          className="groove"
          placeholder="A note to leave up"
          value={objectText}
          onChange={(e) => setObjectText(e.target.value)}
          maxLength={200}
        />
        <div className="row" style={{ gap: 8 }}>
          <button
            className="clay-btn grow"
            disabled={!objectText.trim()}
            onClick={async () => {
              await addWallObject(conversation.id, {
                type: 'note',
                text: objectText.trim(),
                x: 20 + Math.random() * 60,
                y: 18 + Math.random() * 30,
              });
              setObjectText('');
              toast('Up on the wall');
            }}
          >
            <IconPlus size={16} /> Leave a note
          </button>
        </div>

        <div className="row" style={{ gap: 8 }}>
          <input
            className="groove"
            type="date"
            value={objectDate}
            onChange={(e) => setObjectDate(e.target.value)}
            aria-label="Countdown date"
          />
          <button
            className="clay-btn"
            disabled={!objectDate || !objectText.trim()}
            onClick={async () => {
              await addWallObject(conversation.id, {
                type: 'countdown',
                text: objectText.trim() || 'Countdown',
                date: new Date(objectDate).toISOString(),
                x: 25 + Math.random() * 50,
                y: 20 + Math.random() * 25,
              });
              setObjectText('');
              setObjectDate('');
              toast('Counting down');
            }}
          >
            <IconClock size={16} /> Countdown
          </button>
        </div>

        {conversation.wallObjects?.length > 0 && (
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {conversation.wallObjects.map((o) => (
              <span key={o.id} className="chip chip-quiet" style={{ height: 26 }}>
                {o.type === 'countdown' && o.date ? `${o.text} · ${daysUntil(o.date)}` : o.text}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* ── time of day ────────────────────────────────────────────────── */}
      <div className="sheet-section">
        <span className="eyebrow row" style={{ gap: 8 }}>
          <IconSchedule size={15} /> Time of day
        </span>
        <button
          className="list-row"
          onClick={() =>
            setSchedule(conversation.id, {
              enabled: !schedule.enabled,
              nightStart: schedule.nightStart,
              nightEnd: schedule.nightEnd,
              day: schedule.day || { preset: 'ochre-dune', dim: 0.3 },
              night: schedule.night || { preset: 'dusk-clay', dim: 0.55 },
            })
          }
        >
          <IconSchedule size={18} />
          <span className="grow">
            <span className="list-row-label">The room has an evening</span>
            <span className="list-row-sub">Warm and dark at night, light in the morning</span>
          </span>
          <span className="toggle" role="switch" aria-checked={schedule.enabled} />
        </button>

        {schedule.enabled && (
          <>
            <div className="row" style={{ gap: 8 }}>
              <label className="field grow">
                <span className="field-label">Evening starts</span>
                <input
                  className="groove"
                  type="time"
                  value={toClock(schedule.nightStart)}
                  onChange={(e) =>
                    setSchedule(conversation.id, { ...schedule, nightStart: fromClock(e.target.value) })
                  }
                />
              </label>
              <label className="field grow">
                <span className="field-label">Morning starts</span>
                <input
                  className="groove"
                  type="time"
                  value={toClock(schedule.nightEnd)}
                  onChange={(e) =>
                    setSchedule(conversation.id, { ...schedule, nightEnd: fromClock(e.target.value) })
                  }
                />
              </label>
            </div>

            {(['day', 'night'] as const).map((slot) => (
              <div key={slot} className="stack" style={{ gap: 6 }}>
                <span className="small muted" style={{ textTransform: 'capitalize' }}>
                  {slot} look
                </span>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 5 }}>
                  {WALLPAPER_PRESETS.map((p) => (
                    <button
                      key={p.id}
                      className={`wp-${p.id}`}
                      style={{
                        aspectRatio: '1',
                        borderRadius: 9,
                        boxShadow:
                          schedule[slot]?.preset === p.id ? '0 0 0 2.5px var(--ink)' : 'var(--clay-1)',
                      }}
                      aria-label={`${slot}: ${p.label}`}
                      onClick={() =>
                        setSchedule(conversation.id, {
                          ...schedule,
                          [slot]: { preset: p.id, tint: p.tint, dim: slot === 'night' ? 0.55 : 0.3 },
                        })
                      }
                    />
                  ))}
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      {/* ── history ────────────────────────────────────────────────────── */}
      <div className="sheet-section">
        <span className="eyebrow row" style={{ gap: 8 }}>
          <IconHistory size={15} /> Every wallpaper this room has worn
        </span>
        {history.length === 0 ? (
          <p className="small muted">Nothing yet. Change the wallpaper and this becomes a diary.</p>
        ) : (
          <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 6 }}>
            {history
              .map((h, i) => ({ ...h, i }))
              .reverse()
              .map((h) => (
                <button
                  key={h.i}
                  className={h.preset ? `wp-${h.preset}` : ''}
                  style={{
                    flex: 'none',
                    width: 64,
                    height: 84,
                    borderRadius: 12,
                    boxShadow: 'var(--clay-1)',
                    backgroundImage: h.url ? `url(${h.url})` : undefined,
                    backgroundSize: 'cover',
                    position: 'relative',
                    display: 'flex',
                    alignItems: 'flex-end',
                    justifyContent: 'center',
                    paddingBottom: 4,
                  }}
                  title={`Put this back — from ${stamp(h.at)}`}
                  onClick={() =>
                    restoreWallpaper(conversation.id, h.i).then(() => toast('Back on the wall'))
                  }
                >
                  <span
                    className="tiny"
                    style={{
                      background: 'rgba(30,26,23,.62)',
                      color: '#fff',
                      padding: '1px 6px',
                      borderRadius: 6,
                      fontSize: 9,
                    }}
                  >
                    {stamp(h.at)}
                  </span>
                </button>
              ))}
          </div>
        )}
      </div>
    </Sheet>
  );
}
