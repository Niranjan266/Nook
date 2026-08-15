/**
 * Writing to people.
 *
 * Two channels rather than one button that does both. Email reaches people who
 * are not in the app; an in-app message reaches people who are and lands in a
 * conversation they can scroll back to. Most announcements want one or the
 * other, and a tool that quietly does both is a tool that surprises you.
 */
import { useState } from 'react';
import { adminPost, type AdminUser } from '@/lib/adminApi';
import { IconWarning, IconCheck, IconSend } from '@/components/Icon';

type Channel = 'email' | 'message' | 'push';
type Format = 'text' | 'html';

interface Result {
  attempted: number;
  sent?: number;
  channel?: string;
  failed?: { email: string; error: string }[];
  /** Push only: people whose devices took it, and how many devices that was. */
  reached?: number;
  devices?: number;
  silent?: number;
  provider?: string;
}

export default function Compose({ people }: { people: AdminUser[] }) {
  const [channel, setChannel] = useState<Channel>('email');
  const [format, setFormat] = useState<Format>('text');
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
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

  const ready =
    channel === 'push'
      ? Boolean(title.trim() && body.trim())
      : Boolean(body.trim() && (channel === 'message' || subject.trim()));

  async function send() {
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const r =
        channel === 'email'
          ? await adminPost<Result>('/broadcast/email', { to, subject, heading, body, format })
          : channel === 'push'
            ? await adminPost<Result>('/broadcast/push', { to, title, body, url })
            : await adminPost<Result>('/broadcast/message', { to, body });
      setResult(r);
      setConfirming(false);
      if ((r.sent ?? r.reached ?? 0) > 0) setBody('');
    } catch (e: any) {
      setError(e.message || 'Could not send.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="admin-compose rise-in">
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
        <button
          className={`admin-sort${channel === 'push' ? ' on' : ''}`}
          onClick={() => {
            setChannel('push');
            setResult(null);
          }}
        >
          Notification
        </button>
      </div>

      {channel === 'push' && (
        <p className="tiny faint" style={{ margin: '2px 0 0' }}>
          A phone or Chrome notification and nothing else — it leaves no message behind. Only reaches
          people who turned notifications on.
        </p>
      )}

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

      {channel === 'push' && (
        <>
          <label className="field">
            <span className="field-label">Title</span>
            <input
              className="groove"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={80}
              placeholder="Nook is back"
            />
          </label>
          <label className="field">
            <span className="field-label">Where it opens — optional</span>
            <input
              className="groove"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              maxLength={400}
              placeholder="Defaults to the app"
            />
          </label>
        </>
      )}

      {channel === 'email' && (
        <>
          {/* Two ways to write the same email. The template is right almost
              always; raw HTML is for a design built somewhere else, and takes
              the whole body rather than being wrapped — half a template around
              someone else's layout gives you two headers and two footers. */}
          <div className="admin-sorts" role="group" aria-label="Email format" style={{ marginBottom: 8 }}>
            <button
              className={`admin-sort${format === 'text' ? ' on' : ''}`}
              onClick={() => setFormat('text')}
            >
              Nook template
            </button>
            <button
              className={`admin-sort${format === 'html' ? ' on' : ''}`}
              onClick={() => setFormat('html')}
            >
              My own HTML
            </button>
          </div>

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
          {format === 'text' && (
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
          )}
        </>
      )}

      <label className="field">
        <span className="field-label">
          {channel === 'email' && format === 'html' ? 'HTML' : channel === 'push' ? 'Body' : 'Message'}
        </span>
        <textarea
          className="groove admin-textarea"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={channel === 'email' && format === 'html' ? 14 : 7}
          spellCheck={!(channel === 'email' && format === 'html')}
          maxLength={channel === 'email' ? (format === 'html' ? 200000 : 8000) : channel === 'push' ? 240 : 4000}
          style={
            channel === 'email' && format === 'html'
              ? { fontFamily: 'var(--font-mono, monospace)', fontSize: 13, whiteSpace: 'pre' }
              : undefined
          }
          placeholder={
            channel === 'push'
              ? 'One or two lines. This is all they see.'
              : channel === 'email'
                ? format === 'html'
                  ? '<!doctype html> … paste a full email here'
                  : 'Leave a blank line between paragraphs.'
                : 'This arrives as a message from the Nook account, with a notification.'
          }
        />
      </label>

      {channel === 'email' && format === 'html' && (
        <p className="tiny faint" style={{ margin: '-2px 0 0' }}>
          Sent exactly as written — no Nook wrapper. Use{' '}
          <code>{'{{name}}'}</code>, <code>{'{{email}}'}</code>, <code>{'{{app_url}}'}</code> and{' '}
          <code>{'{{year}}'}</code> and they will be filled in per person. A plain-text version is
          generated automatically, which is what keeps it out of spam folders.
        </p>
      )}

      {channel === 'email' && format === 'text' && body.trim() && (
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

      {/*
        A push counts differently and must say so. "Sent to 40 people" is a lie
        when 30 of them never turned notifications on, and reporting it as a
        success would hide the only fact worth knowing.
      */}
      {result &&
        (channel === 'push' ? (
          <div className={result.reached === result.attempted ? 'admin-banner-ok' : 'admin-banner-bad'}>
            {result.reached === result.attempted ? <IconCheck size={15} /> : <IconWarning size={15} />}
            <span>
              Reached {result.reached} of {result.attempted} people
              {result.devices ? ` on ${result.devices} device${result.devices === 1 ? '' : 's'}` : ''}.
              {result.silent
                ? ` ${result.silent} never turned notifications on, so they got nothing.`
                : ''}
              {result.provider === 'ephemeral' &&
                ' Push keys are not set on the server, so subscriptions break on every restart.'}
            </span>
          </div>
        ) : (
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
        ))}

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
            This {channel === 'email' ? 'emails' : channel === 'push' ? 'notifies' : 'messages'}{' '}
            <strong>{audienceCount} people</strong> and cannot be taken back.
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
    </section>
  );
}
