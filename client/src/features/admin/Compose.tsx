/**
 * Writing to people.
 *
 * Two channels rather than one button that does both. Email reaches people who
 * are not in the app; an in-app message reaches people who are and lands in a
 * conversation they can scroll back to. Most announcements want one or the
 * other, and a tool that quietly does both is a tool that surprises you.
 */
import { useState } from 'react';
import { motion } from 'framer-motion';
import { spring } from '@/lib/motion';
import { adminPost, type AdminUser } from '@/lib/adminApi';
import { IconWarning, IconCheck, IconSend } from '@/components/Icon';

type Channel = 'email' | 'message';

interface Result {
  attempted: number;
  sent: number;
  channel?: string;
  failed?: { email: string; error: string }[];
}

export default function Compose({ people }: { people: AdminUser[] }) {
  const [channel, setChannel] = useState<Channel>('email');
  const [to, setTo] = useState('all');
  const [subject, setSubject] = useState('');
  const [heading, setHeading] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [confirming, setConfirming] = useState(false);

  const audienceCount =
    to === 'all'
      ? channel === 'email'
        ? people.filter((p) => p.email && !p.suspended).length
        : people.filter((p) => !p.suspended).length
      : 1;

  const ready = body.trim() && (channel === 'message' || subject.trim());

  async function send() {
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const r =
        channel === 'email'
          ? await adminPost<Result>('/broadcast/email', { to, subject, heading, body })
          : await adminPost<Result>('/broadcast/message', { to, body });
      setResult(r);
      setConfirming(false);
      if (r.sent > 0) setBody('');
    } catch (e: any) {
      setError(e.message || 'Could not send.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <motion.section
      className="admin-compose"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={spring}
    >
      <div className="admin-sorts" role="group" aria-label="Channel">
        <button
          className={`admin-sort${channel === 'email' ? ' on' : ''}`}
          onClick={() => {
            setChannel('email');
            setResult(null);
          }}
        >
          Email
        </button>
        <button
          className={`admin-sort${channel === 'message' ? ' on' : ''}`}
          onClick={() => {
            setChannel('message');
            setResult(null);
          }}
        >
          In-app message
        </button>
      </div>

      <label className="field">
        <span className="field-label">To</span>
        <select className="groove" value={to} onChange={(e) => setTo(e.target.value)}>
          <option value="all">Everyone ({audienceCount})</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.displayName} · @{p.username}
              {channel === 'email' && !p.email ? ' — no email' : ''}
            </option>
          ))}
        </select>
      </label>

      {channel === 'email' && (
        <>
          <label className="field">
            <span className="field-label">Subject</span>
            <input
              className="groove"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              maxLength={140}
              placeholder="Nook will be down on Saturday"
            />
          </label>
          <label className="field">
            <span className="field-label">Heading — optional</span>
            <input
              className="groove"
              value={heading}
              onChange={(e) => setHeading(e.target.value)}
              maxLength={90}
              placeholder="Defaults to “Hello <their name>”"
            />
          </label>
        </>
      )}

      <label className="field">
        <span className="field-label">Message</span>
        <textarea
          className="groove admin-textarea"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={7}
          maxLength={channel === 'email' ? 8000 : 4000}
          placeholder={
            channel === 'email'
              ? 'Leave a blank line between paragraphs.'
              : 'This arrives as a message from the Nook account, with a notification.'
          }
        />
      </label>

      {channel === 'email' && body.trim() && (
        <div className="admin-preview" aria-label="Preview">
          <span className="eyebrow">Preview</span>
          <div className="admin-preview-card">
            <div className="admin-preview-brand">Nook</div>
            <h3>{heading.trim() || 'Hello Alex'}</h3>
            {body.split(/\n{2,}/).map((p, i) => (
              <p key={i}>{p}</p>
            ))}
            <span className="admin-preview-btn">Open Nook</span>
          </div>
        </div>
      )}

      {error && (
        <p className="admin-error">
          <IconWarning size={14} /> {error}
        </p>
      )}

      {result && (
        <div className={result.sent === result.attempted ? 'admin-banner-ok' : 'admin-banner-bad'}>
          {result.sent === result.attempted ? <IconCheck size={15} /> : <IconWarning size={15} />}
          <span>
            {result.sent} of {result.attempted} sent
            {result.channel ? ` via ${result.channel}` : ''}.
            {result.channel === 'console' &&
              ' No mail provider is configured, so these went to the server log rather than anyone’s inbox.'}
            {result.failed?.length ? ` First failure: ${result.failed[0].error}` : ''}
          </span>
        </div>
      )}

      {/* Sending to everyone is not undoable, so it takes two deliberate
          actions — and the second one says the number out loud. */}
      {!confirming ? (
        <button
          className="slab slab-block"
          disabled={!ready || busy}
          onClick={() => (to === 'all' ? setConfirming(true) : send())}
        >
          <IconSend size={16} />
          {to === 'all' ? `Send to everyone (${audienceCount})` : 'Send'}
        </button>
      ) : (
        <div className="admin-danger">
          <p className="tiny">
            This {channel === 'email' ? 'emails' : 'messages'} <strong>{audienceCount} people</strong>{' '}
            and cannot be taken back.
          </p>
          <div className="row" style={{ gap: 6 }}>
            <button className="clay-btn grow" onClick={() => setConfirming(false)} disabled={busy}>
              Cancel
            </button>
            <button className="slab grow" onClick={send} disabled={busy}>
              {busy ? 'Sending…' : 'Yes, send it'}
            </button>
          </div>
        </div>
      )}
    </motion.section>
  );
}
