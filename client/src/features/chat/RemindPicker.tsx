import { useState } from 'react';
import { useChat } from '@/stores/chat';
import { useUi } from '@/stores/ui';
import { IconBell, IconBellOff, IconBack, IconSchedule } from '@/components/Icon';
import { quickPicks, toLocalInput, fromLocalInput, whenFull, whenHint } from '@/lib/reminders';

/**
 * "Remind me" — the second page of a message's menu.
 *
 * Quick picks first, because nearly every reminder is one of four times and
 * a date picker for "in an hour" is a chore. Custom is there for the rest.
 * Everything is computed from the device clock; the server only sees the
 * instant it lands on.
 */
export default function RemindPicker({
  messageId,
  onBack,
  onDone,
}: {
  messageId: string;
  onBack: () => void;
  onDone: () => void;
}) {
  const existingId = useChat((s) => s.remindedIds[messageId]);
  const existing = useChat((s) => (existingId ? s.reminders.find((r) => r.id === existingId) : undefined));
  const { setReminder, cancelReminder } = useChat.getState();
  const toast = useUi.getState().toast;

  const [custom, setCustom] = useState(false);
  const [value, setValue] = useState(() => toLocalInput(new Date(Date.now() + 2 * 3600_000)));
  const [busy, setBusy] = useState(false);

  const picks = quickPicks();

  const choose = async (at: Date) => {
    if (busy) return;
    if (at.getTime() <= Date.now()) return toast('Pick a time that has not happened yet.', true);
    setBusy(true);
    try {
      await setReminder(messageId, at);
      toast(`I'll remind you ${whenFull(at)}`);
      onDone();
    } catch (err: any) {
      toast(err?.message || 'Could not set that reminder.', true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="remind-picker" role="menu" aria-label="Remind me">
      <button className="list-row remind-head" onClick={onBack}>
        <IconBack size={16} />
        <span className="grow">
          <span className="list-row-label">Remind me</span>
          {existing && <span className="list-row-sub">Set for {whenFull(existing.remindAt)}</span>}
        </span>
      </button>

      {!custom &&
        picks.map((p) => (
          <button key={p.id} className="list-row" role="menuitem" disabled={busy} onClick={() => choose(p.at)}>
            <IconBell size={17} />
            <span className="grow">
              <span className="list-row-label">{p.label}</span>
            </span>
            <span className="remind-hint">{p.hint}</span>
          </button>
        ))}

      {!custom ? (
        <button className="list-row" role="menuitem" onClick={() => setCustom(true)}>
          <IconSchedule size={17} />
          <span className="grow">
            <span className="list-row-label">Pick a date &amp; time…</span>
          </span>
        </button>
      ) : (
        <form
          className="remind-custom"
          onSubmit={(e) => {
            e.preventDefault();
            const at = fromLocalInput(value);
            if (at && !Number.isNaN(at.getTime())) choose(at);
          }}
        >
          <input
            className="groove"
            type="datetime-local"
            value={value}
            min={toLocalInput(new Date())}
            onChange={(e) => setValue(e.target.value)}
            aria-label="Remind me at"
            autoFocus
          />
          <button className="slab slab-sm" type="submit" disabled={busy || !value}>
            Set{value && fromLocalInput(value) ? ` · ${whenHint(fromLocalInput(value)!)}` : ''}
          </button>
        </form>
      )}

      {existing && (
        <button
          className="list-row danger"
          onClick={() =>
            cancelReminder(existing.id)
              .then(() => {
                toast('Reminder cancelled');
                onDone();
              })
              .catch((err) => toast(err?.message || 'Could not cancel that.', true))
          }
        >
          <IconBellOff size={17} />
          <span className="grow">
            <span className="list-row-label">Cancel reminder</span>
          </span>
        </button>
      )}
    </div>
  );
}
