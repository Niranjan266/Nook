import { useEffect } from 'react';
import { useChat } from '@/stores/chat';
import { useUi } from '@/stores/ui';
import Sheet from '@/components/Sheet';
import Avatar from '@/components/Avatar';
import { IconBell, IconTrash, IconLock } from '@/components/Icon';
import { whenFull } from '@/lib/reminders';
import type { Reminder } from '@/lib/types';

/** Messages you asked to come back to. Private — nobody in the chat can tell. */
export default function RemindersSheet() {
  const sheet = useUi((s) => s.sheet);
  const closeSheet = useUi((s) => s.closeSheet);
  const toast = useUi((s) => s.toast);
  const upcoming = useChat((s) => s.reminders);
  const recent = useChat((s) => s.recentReminders);
  const conversations = useChat((s) => s.conversations);
  const { loadReminders, cancelReminder, openAt } = useChat.getState();
  const open = sheet === 'reminders';

  useEffect(() => {
    if (open) loadReminders().catch(() => {});
  }, [open]);

  const row = (r: Reminder, pending: boolean) => {
    const c = conversations[r.conversationId];
    const what = r.gone
      ? 'This message was deleted'
      : r.locked
        ? 'In a locked chat'
        : r.snippet || 'A message';
    return (
      <div key={r.id} className={`list-row${pending ? '' : ' reminder-past'}`}>
        <Avatar name={c?.name || '?'} src={c?.avatarUrl} id={r.conversationId} size={38} square={c?.type === 'group'} />
        <button
          className="grow"
          style={{ textAlign: 'left' }}
          disabled={!c}
          onClick={() => {
            // Straight to the message, not merely the chat it is in.
            openAt(r.conversationId, r.gone ? null : r.messageId);
            closeSheet();
          }}
        >
          <span className="list-row-label truncate">
            {r.note || c?.name || 'Conversation'}
          </span>
          <span className="list-row-sub truncate" style={r.gone ? { fontStyle: 'italic' } : undefined}>
            {r.locked && <IconLock size={11} style={{ verticalAlign: -1, marginRight: 4 }} />}
            {r.senderName && !r.gone && !r.locked ? `${r.senderName}: ` : ''}
            {what}
          </span>
          <span className="tiny" style={{ color: pending ? 'var(--accent-deep)' : 'var(--ink-faint)', fontWeight: 600 }}>
            <IconBell size={11} style={{ verticalAlign: -1 }} /> {pending ? '' : 'Reminded '}
            {whenFull(pending ? r.remindAt : r.firedAt || r.remindAt)}
          </span>
        </button>
        {pending && (
          <button
            className="clay-round"
            style={{ width: 32, height: 32, color: 'var(--rust)' }}
            onClick={() =>
              cancelReminder(r.id)
                .then(() => toast('Reminder cancelled'))
                .catch((err) => toast(err?.message || 'Could not cancel that.', true))
            }
            aria-label="Cancel this reminder"
          >
            <IconTrash size={15} />
          </button>
        )}
      </div>
    );
  };

  return (
    <Sheet open={open} onClose={closeSheet} title="Reminders">
      <div className="sheet-section">
        {upcoming.length === 0 && (
          <p className="small muted">
            Nothing waiting. Open a message's menu and choose <strong>Remind me</strong> to have it brought back
            later.
          </p>
        )}
        {upcoming.map((r) => row(r, true))}
      </div>

      {recent.length > 0 && (
        <div className="sheet-section">
          <span className="eyebrow">Earlier this week</span>
          {recent.map((r) => row(r, false))}
        </div>
      )}
    </Sheet>
  );
}
