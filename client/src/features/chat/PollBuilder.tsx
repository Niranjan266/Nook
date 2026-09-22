import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Sheet from '@/components/Sheet';
import { IconClose, IconPlus } from '@/components/Icon';
import type { PollDraft } from '@/lib/outbox';
import '@/styles/polls.css';

/**
 * Making a poll or a shared list.
 *
 * One sheet for both because they are the same gesture — a heading and some
 * lines — and a person who opened the wrong one should not have to start
 * over somewhere else. The limits mirror lib/sendPayload.js on the server;
 * the server is still the one that refuses, this only stops the button from
 * offering something that will bounce.
 */

export type BuilderKind = 'poll' | 'list';

export interface BuiltPoll {
  type: 'poll';
  body: string;
  poll: PollDraft;
}
export interface BuiltList {
  type: 'list';
  body: string;
  list: { items: string[] };
}

interface Props {
  kind: BuilderKind | null;
  onClose: () => void;
  onSend: (built: BuiltPoll | BuiltList) => void;
}

const MIN_OPTIONS = 2;
const MAX_OPTIONS = 10;
const MAX_ITEMS = 100;

/** Offered as chips rather than a date picker: nobody closes a poll at 14:37. */
const CLOSE_AFTER: { label: string; ms: number }[] = [
  { label: '1 hour', ms: 60 * 60 * 1000 },
  { label: '1 day', ms: 24 * 60 * 60 * 1000 },
  { label: '3 days', ms: 3 * 24 * 60 * 60 * 1000 },
  { label: '1 week', ms: 7 * 24 * 60 * 60 * 1000 },
];

export default function PollBuilder({ kind, onClose, onSend }: Props) {
  const [title, setTitle] = useState('');
  const [lines, setLines] = useState<string[]>(['', '']);
  const [multiple, setMultiple] = useState(false);
  const [anonymous, setAnonymous] = useState(false);
  const [closeAfter, setCloseAfter] = useState<number | null>(null);
  const lineRefs = useRef<(HTMLInputElement | null)[]>([]);
  /** Focus the line that was just added, once it exists. */
  const focusNext = useRef<number | null>(null);

  const isPoll = kind === 'poll';
  const maxLines = isPoll ? MAX_OPTIONS : MAX_ITEMS;

  // A fresh sheet every time: yesterday's half-written poll reappearing
  // under a different chat would be a surprise, not a convenience.
  useEffect(() => {
    if (!kind) return;
    setTitle('');
    setLines(kind === 'poll' ? ['', ''] : ['']);
    setMultiple(false);
    setAnonymous(false);
    setCloseAfter(null);
  }, [kind]);

  useEffect(() => {
    if (focusNext.current === null) return;
    lineRefs.current[focusNext.current]?.focus();
    focusNext.current = null;
  }, [lines.length]);

  const filled = lines.map((l) => l.trim()).filter(Boolean);
  const duplicate = new Set(filled.map((l) => l.toLowerCase())).size !== filled.length;
  const valid = isPoll
    ? Boolean(title.trim()) && filled.length >= MIN_OPTIONS && !duplicate
    : Boolean(title.trim());

  const addLine = () => {
    if (lines.length >= maxLines) return;
    focusNext.current = lines.length;
    setLines((l) => [...l, '']);
  };

  const removeLine = (i: number) => setLines((l) => l.filter((_, j) => j !== i));

  const submit = () => {
    if (!valid || !kind) return;
    if (isPoll) {
      onSend({
        type: 'poll',
        body: title.trim(),
        poll: {
          options: filled,
          multiple,
          anonymous,
          closesAt: closeAfter ? new Date(Date.now() + closeAfter).toISOString() : null,
        },
      });
    } else {
      onSend({ type: 'list', body: title.trim(), list: { items: filled } });
    }
    onClose();
  };

  const minLines = isPoll ? MIN_OPTIONS : 1;

  return createPortal(
    <Sheet
      open={Boolean(kind)}
      onClose={onClose}
      title={isPoll ? 'New poll' : 'New list'}
      footer={
        <button className="slab slab-block" disabled={!valid} onClick={submit}>
          {isPoll ? 'Send poll' : 'Share list'}
        </button>
      }
    >
      <div className="builder stack">
        <label className="field">
          <span className="field-label">{isPoll ? 'Question' : 'Title'}</span>
          <input
            className="groove"
            value={title}
            maxLength={isPoll ? 300 : 120}
            placeholder={isPoll ? 'What should we decide?' : 'What is this list for?'}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                lineRefs.current[0]?.focus();
              }
            }}
          />
        </label>

        <div className="field">
          <span className="field-label">{isPoll ? 'Options' : 'Items'}</span>
          <div className="builder-lines">
            {lines.map((line, i) => (
              <div className="builder-line" key={i}>
                <input
                  ref={(el) => (lineRefs.current[i] = el)}
                  className="groove"
                  value={line}
                  maxLength={isPoll ? 100 : 200}
                  placeholder={isPoll ? `Option ${i + 1}` : i === 0 ? 'First thing' : 'Another thing'}
                  aria-label={isPoll ? `Option ${i + 1}` : `Item ${i + 1}`}
                  onChange={(e) => setLines((l) => l.map((x, j) => (j === i ? e.target.value : x)))}
                  // Enter on the last line makes the next one, the way a
                  // list is written on paper: without reaching for a button.
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter') return;
                    e.preventDefault();
                    if (i === lines.length - 1) {
                      if (line.trim()) addLine();
                    } else lineRefs.current[i + 1]?.focus();
                  }}
                />
                {lines.length > minLines && (
                  <button
                    type="button"
                    className="builder-remove"
                    onClick={() => removeLine(i)}
                    aria-label={`Remove ${isPoll ? 'option' : 'item'} ${i + 1}`}
                  >
                    <IconClose size={16} />
                  </button>
                )}
              </div>
            ))}
          </div>

          {lines.length < maxLines && (
            <button type="button" className="builder-add" onClick={addLine}>
              <IconPlus size={16} /> {isPoll ? 'Add option' : 'Add item'}
            </button>
          )}
          {isPoll && duplicate && <span className="field-error">Each option must be different.</span>}
        </div>

        {isPoll && (
          <div className="builder-settings">
            <button
              type="button"
              className="list-row"
              onClick={() => setMultiple((v) => !v)}
              role="switch"
              aria-checked={multiple}
            >
              <span className="grow">
                <span className="list-row-label">Multiple answers</span>
                <span className="list-row-sub">People can pick more than one</span>
              </span>
              <span className="toggle" aria-hidden="true" aria-checked={multiple} />
            </button>
            <button
              type="button"
              className="list-row"
              onClick={() => setAnonymous((v) => !v)}
              role="switch"
              aria-checked={anonymous}
            >
              <span className="grow">
                <span className="list-row-label">Anonymous</span>
                <span className="list-row-sub">Counts only — nobody sees who voted for what</span>
              </span>
              <span className="toggle" aria-hidden="true" aria-checked={anonymous} />
            </button>

            <div className="builder-close">
              <span className="list-row-label">Close automatically</span>
              <div className="builder-chips" role="radiogroup" aria-label="Close automatically">
                <button
                  type="button"
                  role="radio"
                  aria-checked={closeAfter === null}
                  className={`builder-chip${closeAfter === null ? ' on' : ''}`}
                  onClick={() => setCloseAfter(null)}
                >
                  Never
                </button>
                {CLOSE_AFTER.map((c) => (
                  <button
                    type="button"
                    key={c.ms}
                    role="radio"
                    aria-checked={closeAfter === c.ms}
                    className={`builder-chip${closeAfter === c.ms ? ' on' : ''}`}
                    onClick={() => setCloseAfter(c.ms)}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </Sheet>,
    document.body
  );
}
