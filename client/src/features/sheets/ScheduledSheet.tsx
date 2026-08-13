import { useEffect } from 'react';
import { useChat } from '@/stores/chat';
import { useUi } from '@/stores/ui';
import Sheet from '@/components/Sheet';
import Avatar from '@/components/Avatar';
import { IconSchedule, IconTrash } from '@/components/Icon';

/** Messages written now, arriving later. Cancellable until they land. */
export default function ScheduledSheet() {
  const { sheet, closeSheet, toast } = useUi();
  const { scheduled, loadScheduled, cancelScheduled, conversations, setActive } = useChat();
  const open = sheet === 'scheduled';

  useEffect(() => {
    if (open) loadScheduled().catch(() => {});
  }, [open]);

  return (
    <Sheet open={open} onClose={closeSheet} title="Scheduled">
      <div className="sheet-section">
        {scheduled.length === 0 && (
          <p className="small muted">
            Nothing waiting. Write a message, then use the clock next to the send button to pick when it
            arrives.
          </p>
        )}

        {scheduled.map((m) => {
          const c = conversations[m.conversationId];
          return (
            <div key={m.id} className="list-row">
              <Avatar
                name={c?.name || '?'}
                src={c?.avatarUrl}
                id={m.conversationId}
                size={38}
                square={c?.type === 'group'}
              />
              <button
                className="grow"
                style={{ textAlign: 'left' }}
                onClick={() => {
                  setActive(m.conversationId);
                  closeSheet();
                }}
              >
                <span className="list-row-label truncate">{c?.name || 'Conversation'}</span>
                <span className="list-row-sub truncate">{m.body}</span>
                <span className="tiny" style={{ color: 'var(--accent-deep)', fontWeight: 600 }}>
                  <IconSchedule size={11} style={{ verticalAlign: -1 }} />{' '}
                  {m.scheduledFor ? new Date(m.scheduledFor).toLocaleString() : ''}
                </span>
              </button>
              <button
                className="clay-round"
                style={{ width: 32, height: 32, color: 'var(--rust)' }}
                onClick={() => cancelScheduled(m.id).then(() => toast('Cancelled'))}
                aria-label="Cancel this scheduled message"
              >
                <IconTrash size={15} />
              </button>
            </div>
          );
        })}
      </div>
    </Sheet>
  );
}
