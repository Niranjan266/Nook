/**
 * The template composer.
 *
 * Writing an announcement from a blank box means deciding the tone, the
 * framing and the wording every time — usually in a hurry, often at the exact
 * moment when getting it wrong matters most. A template decides the shape once
 * so the only thing left to write is the thing you actually wanted to say.
 *
 * The catalogue comes from the server (services/templates.js), so adding a
 * template needs no change here at all: a new kind arrives with its own label,
 * its own hint and its own list of blanks, and this draws the form for it.
 *
 * The preview is not a mock-up of what the server will do. It asks the server
 * to render the template and shows the answer, so what you see is what will be
 * sent — a preview built separately from the sender is a preview that will
 * eventually disagree with reality, and it will do so at the worst moment.
 */
import { useEffect, useState } from 'react';
import { adminGet, adminPost, type AdminUser } from '@/lib/adminApi';
import { IconWarning, IconCheck, IconSend } from '@/components/Icon';

interface TemplateInfo {
  id: string;
  label: string;
  hint?: string;
  fields: string[];
  channels: { push: boolean; email: boolean; banner: boolean };
}

interface Rendered {
  id: string;
  label: string;
  push: { title: string; body: string; url?: string } | null;
  email: { subject: string; heading: string; body: string } | null;
  banner: { title: string; body: string } | null;
}

interface SendResult {
  template: string;
  attempted: number;
  push: { reached: number; devices: number; silent: number } | null;
  email: { sent: number; failed: number } | null;
}

/** The blanks, in human words. Keys match `fields` on the server. */
const LABELS: Record<string, string> = {
  headline: 'Headline',
  message: 'What you want to say',
  url: 'Link (optional)',
  when: 'When',
};

const PLACEHOLDERS: Record<string, string> = {
  headline: 'Wallpapers now sync across devices',
  message: 'Say it the way you would say it out loud.',
  url: '/  — or a full https:// address',
  when: 'Sunday 2am–3am IST',
};

const LONG = new Set(['message']);

export default function Templates({ people }: { people: AdminUser[] }) {
  const [catalogue, setCatalogue] = useState<TemplateInfo[]>([]);
  const [id, setId] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [to, setTo] = useState('all');
  const [push, setPush] = useState(true);
  const [email, setEmail] = useState(false);

  const [preview, setPreview] = useState<Rendered | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<SendResult | null>(null);
  const [confirming, setConfirming] = useState(false);

  const chosen = catalogue.find((t) => t.id === id) || null;

  useEffect(() => {
    adminGet<{ templates: TemplateInfo[] }>('/templates')
      .then((r) => {
        setCatalogue(r.templates);
        if (r.templates[0]) setId(r.templates[0].id);
      })
      .catch((e) => setError(e.message || 'Could not load the templates.'));
  }, []);

  /**
   * Re-render on every keystroke, debounced.
   *
   * Debounced rather than on blur because the whole value of this panel is
   * seeing the notification take shape as you type — the moment you notice
   * "that will be cut off on a lock screen" is while you are still writing it,
   * not after you have moved on.
   */
  useEffect(() => {
    if (!id) return;
    const timer = window.setTimeout(() => {
      adminPost<Rendered>('/templates/preview', { id, values })
        .then(setPreview)
        .catch(() => setPreview(null));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [id, values]);

  // Switching template keeps whatever blanks the new one also has, and drops
  // the rest — retyping the same message because you changed the framing is
  // the kind of small insult that stops people using a tool.
  useEffect(() => {
    if (!chosen) return;
    setValues((old) => Object.fromEntries(chosen.fields.map((f) => [f, old[f] || ''])));
    setResult(null);
    setConfirming(false);
    if (!chosen.channels.email) setEmail(false);
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const reachable = people.filter((p) => !p.suspended);
  const mailable = reachable.filter((p) => p.email);
  const audienceCount = to === 'all' ? (email ? mailable.length : reachable.length) : 1;

  const ready = Boolean(id && values.message?.trim() && (push || email));

  async function send() {
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const r = await adminPost<SendResult>('/templates/send', {
        id,
        to,
        values,
        channels: { push, email },
      });
      setResult(r);
      setConfirming(false);
    } catch (e: any) {
      setError(e.message || 'Could not send.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="admin-compose rise-in">
      {/* ── which kind ─────────────────────────────────────────────────── */}
      <div className="admin-sorts" role="group" aria-label="Template">
        {catalogue.map((t) => (
          <button
            key={t.id}
            className={`admin-sort${id === t.id ? ' on' : ''}`}
            onClick={() => setId(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {chosen?.hint && <p className="admin-note">{chosen.hint}</p>}

      {/* ── the blanks ─────────────────────────────────────────────────── */}
      {chosen?.fields.map((field) => (
        <label key={field} className="field">
          <span>{LABELS[field] || field}</span>
          {LONG.has(field) ? (
            <textarea
              className="admin-textarea groove"
              rows={5}
              value={values[field] || ''}
              placeholder={PLACEHOLDERS[field]}
              onChange={(e) => setValues((v) => ({ ...v, [field]: e.target.value }))}
            />
          ) : (
            <input
              className="groove"
              value={values[field] || ''}
              placeholder={PLACEHOLDERS[field]}
              onChange={(e) => setValues((v) => ({ ...v, [field]: e.target.value }))}
            />
          )}
        </label>
      ))}

      {/* ── preview ────────────────────────────────────────────────────── */}
      {preview && (
        <div className="admin-preview-card">
          <div className="admin-preview-brand">On a phone</div>
          {/*
            Styled as a lock-screen notification rather than shown as a title
            and a body in two boxes. The question this panel has to answer is
            "does that read well at a glance, cut to two lines, next to
            everything else competing for attention" — and that question is not
            answerable from a form.
          */}
          <div className="admin-notif">
            <div className="admin-notif-icon" aria-hidden="true">
              <svg viewBox="0 0 96 96" width="26" height="26">
                <rect x="6" y="6" width="84" height="84" rx="26" fill="#EDE3D6" />
                <path d="M32 74 V46 a16 16 0 0 1 32 0 V74 Z" fill="#C0603C" />
              </svg>
            </div>
            <div className="admin-notif-text">
              <b>{preview.push?.title || '—'}</b>
              <span>{preview.push?.body || '—'}</span>
            </div>
          </div>

          {preview.email ? (
            <>
              <div className="admin-preview-brand" style={{ marginTop: 18 }}>
                In an inbox
              </div>
              <div className="admin-mail">
                <div className="admin-mail-subject">{preview.email.subject}</div>
                <div className="admin-mail-heading">{preview.email.heading}</div>
                <div className="admin-mail-body">{preview.email.body}</div>
              </div>
            </>
          ) : (
            <p className="admin-note" style={{ marginTop: 14 }}>
              This kind does not send an email — it is too small to be worth an inbox.
            </p>
          )}
        </div>
      )}

      {/* ── where it goes ──────────────────────────────────────────────── */}
      <div className="field">
        <span>Send by</span>
        <div className="admin-sorts" role="group" aria-label="Channels">
          <button className={`admin-sort${push ? ' on' : ''}`} onClick={() => setPush(!push)}>
            {push ? '✓ ' : ''}Notification
          </button>
          <button
            className={`admin-sort${email ? ' on' : ''}`}
            disabled={!chosen?.channels.email}
            onClick={() => setEmail(!email)}
            title={chosen?.channels.email ? '' : 'This kind has no email version'}
          >
            {email ? '✓ ' : ''}Email
          </button>
        </div>
      </div>

      <label className="field">
        <span>To</span>
        <select className="groove" value={to} onChange={(e) => setTo(e.target.value)}>
          <option value="all">Everyone ({email ? mailable.length : reachable.length})</option>
          {reachable.map((p) => (
            <option key={p.id} value={p.id}>
              {p.displayName} · @{p.username}
            </option>
          ))}
        </select>
      </label>

      {error && (
        <p className="admin-error">
          <IconWarning size={15} /> {error}
        </p>
      )}

      {result && (
        <p className="admin-banner-ok">
          <IconCheck size={15} />
          {[
            result.push && `${result.push.reached} of ${result.attempted} got a notification (${result.push.devices} devices)`,
            result.email && `${result.email.sent} emailed${result.email.failed ? `, ${result.email.failed} failed` : ''}`,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      )}

      {/*
        Announcements reach everyone at once and cannot be recalled, so the
        button asks twice — and the second press says the number out loud,
        because "Send" and "Send to 214 people" are different decisions.
      */}
      {!confirming ? (
        <button className="slab" disabled={!ready || busy} onClick={() => setConfirming(true)}>
          <IconSend size={16} /> Send
        </button>
      ) : (
        <div className="admin-actions">
          <button className="slab" disabled={busy} onClick={send}>
            {busy ? 'Sending…' : `Yes — send to ${audienceCount}`}
          </button>
          <button className="slab slab-quiet" disabled={busy} onClick={() => setConfirming(false)}>
            Back
          </button>
        </div>
      )}
    </section>
  );
}
