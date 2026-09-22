/**
 * Transactional email — Gmail first, with Resend and Brevo kept as fallbacks.
 * Nook works entirely without an email address.
 *
 * No API key? Codes are printed to the server console so dev still works.
 */
import { env } from '../config/env.js';
import { sendViaGmail, gmailReady } from './gmail.js';
import { TEMPLATES } from './templates.js';

const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email';
const RESEND_ENDPOINT = 'https://api.resend.com/emails';

/**
 * Which transport is in play.
 *
 * `auto` prefers Gmail when it is configured, because configuring it is a
 * deliberate act — nobody fills in three OAuth values by accident — then
 * Brevo, then the console. Setting MAIL_PROVIDER explicitly pins one, which
 * matters when both are configured and you need to know which sent a message.
 */
export function resolveProvider() {
  const pinned = env.mailProvider;
  if (pinned === 'resend') return env.resend.enabled ? 'resend' : 'console';
  if (pinned === 'gmail') return gmailReady() ? 'gmail' : 'console';
  if (pinned === 'brevo') return env.brevo.enabled ? 'brevo' : 'console';
  if (pinned === 'console') return 'console';

  // Gmail first: mail goes out from the Gmail inbox itself, so that address
  // is what people see and where their replies land. Resend only answers
  // when Gmail is not configured.
  if (gmailReady()) return 'gmail';
  if (env.resend.enabled) return 'resend';
  if (env.brevo.enabled) return 'brevo';
  return 'console';
}

function toConsole({ to, subject, text, why }) {
  console.log(`\n  ┌─ email (console — ${why}) ─────────────────────────────`);
  console.log(`  │ to      ${to}`);
  console.log(`  │ subject ${subject}`);
  console.log(`  │ ${text.replace(/\n/g, '\n  │ ')}`);
  console.log('  └────────────────────────────────────────────────────────────\n');
  return { delivered: false, channel: 'console' };
}

async function sendViaResend({ to, subject, html, text }) {
  const res = await fetch(RESEND_ENDPOINT, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.resend.apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ from: env.resend.from, to: [to], subject, html, text }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    // Resend explains itself in the body — an unverified sender domain is
    // the usual one, and worth seeing in the log verbatim.
    const detail = await res.text();
    console.error(`  email     resend rejected (${res.status}) ${detail}`);
    return { delivered: false, channel: 'resend', error: detail };
  }
  return { delivered: true, channel: 'resend' };
}

async function sendViaBrevo({ to, subject, html, text }) {
  const res = await fetch(BREVO_ENDPOINT, {
    method: 'POST',
    headers: {
      'api-key': env.brevo.apiKey,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      sender: { email: env.brevo.senderEmail, name: env.brevo.senderName },
      to: [{ email: to }],
      subject,
      htmlContent: html,
      textContent: text,
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    console.error(`  email     brevo rejected (${res.status}) ${detail}`);
    return { delivered: false, channel: 'brevo', error: detail };
  }
  return { delivered: true, channel: 'brevo' };
}

async function send({ to, subject, html, text }) {
  const provider = resolveProvider();

  if (provider === 'console') {
    const why =
      env.mailProvider === 'console'
        ? 'MAIL_PROVIDER=console'
        : 'no Resend, Gmail or Brevo credentials configured';
    return toConsole({ to, subject, text, why });
  }

  try {
    if (provider === 'resend') return await sendViaResend({ to, subject, html, text });
    if (provider === 'gmail') {
      await sendViaGmail({ to, subject, html, text });
      return { delivered: true, channel: 'gmail' };
    }
    return await sendViaBrevo({ to, subject, html, text });
  } catch (err) {
    // Never throw out of here. Callers treat mail as a courtesy — a signup
    // must not fail because a mail provider is having a bad afternoon.
    console.error(`  email     ${provider} failed: ${err.message}`);
    return { delivered: false, channel: provider, error: err.message };
  }
}

/**
 * Escape before interpolating anything a person typed. A display name is
 * whatever someone chose to call themselves, and went into these emails raw —
 * so a name could carry a link or a fake "reset here" button into a message
 * that really did come from Nook.
 */
const esc = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const shell = (heading, lead, code) => `
<div style="background:#E9E1D6;padding:40px 16px;font-family:ui-sans-serif,system-ui,sans-serif">
  <div style="max-width:440px;margin:0 auto;background:#F4EEE6;border-radius:28px;padding:36px;
              box-shadow:0 18px 40px rgba(30,26,23,.10)">
    <div style="font-size:13px;letter-spacing:.18em;text-transform:uppercase;color:#5C5349">Nook</div>
    <h1 style="margin:14px 0 8px;font-size:26px;color:#1E1A17;line-height:1.2">${heading}</h1>
    <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#5C5349">${lead}</p>
    <div style="display:inline-block;background:#F4EEE6;border:2px solid #1E1A17;border-radius:8px;
                box-shadow:4px 4px 0 #1E1A17;padding:14px 22px;font-family:ui-monospace,monospace;
                font-size:30px;letter-spacing:.32em;color:#1E1A17">${code}</div>
    <p style="margin:24px 0 0;font-size:13px;color:#5C5349">
      This code expires in 15 minutes. If you didn't ask for it, you can ignore this email —
      nothing has changed on your account.
    </p>
  </div>
</div>`;

export function sendRecoveryCode({ to, code, displayName }) {
  return send({
    to,
    subject: `${code} is your Nook recovery code`,
    html: shell(
      'Get back into your nook',
      `Hi ${esc(displayName)} — use this code to reset your password.`,
      esc(code)
    ),
    text: `Your Nook recovery code is ${code}. It expires in 15 minutes.`,
  });
}

/**
 * Confirming an email address.
 *
 * The words come from the template catalogue, the HTML is built here. That
 * split is the same one every other template uses: what Nook says lives in one
 * place so it can be read and changed as a whole, and how an email is rendered
 * stays with the tables and inline styles that make it survive Outlook.
 *
 * `emailVerify` is the only template this uses, and this is the only thing
 * that uses it — a confirmation code is the most phishable thing Nook sends,
 * so there is exactly one path that can produce one.
 */
export function sendEmailVerification({ to, code, displayName }) {
  const copy = TEMPLATES.emailVerify.email({ code, displayName });
  return send({
    to,
    subject: copy.subject,
    html: shell(esc(copy.heading), esc(copy.lede), esc(copy.code)),
    text: copy.body,
  });
}

/* ── welcome ────────────────────────────────────────────────────────────────
   Built with tables and inline styles on purpose. Outlook renders HTML through
   Word, which ignores flexbox, grid, and most of `border-radius`; Gmail strips
   <style> blocks entirely on some clients. So the layout is a table, every
   rule is an attribute, and the design survives by leaning on the parts of the
   Clay/Slab system that translate: flat warm fills, the 2px ink border and the
   hard offset shadow — the latter faked with a nested table cell, since
   box-shadow does not render in Outlook either.
   ────────────────────────────────────────────────────────────────────────── */

const BISQUE = '#E9E1D6';
const SURFACE = '#F4EEE6';
const INK = '#1E1A17';
const MUTED = '#5C5349';
const TERRACOTTA = '#C0603C';
/** Flattened equivalent of rgba(30,26,23,.09) over SURFACE — see note below. */
const HAIRLINE = '#DED5C8';

/**
 * A Slab button.
 *
 * The app's Slab has a hard 4px offset shadow. There is no way to reproduce
 * that in email that renders the same everywhere: `box-shadow` is ignored by
 * Outlook, and the usual `transform: translate` trick is ignored too — which
 * would collapse the shadow layer directly under the button and, in a few
 * clients, shift the layout instead. A faithful-but-unpredictable button is
 * worse than a simplified reliable one, so the shadow is dropped here and the
 * Slab is carried by what does travel: the flat terracotta fill and the 2px
 * ink border. Outlook also squares off `border-radius`, which is harmless —
 * Slab corners are nearly square by design anyway.
 *
 * The `<a>` is padded rather than the `<td>` so the whole button is clickable
 * in clients that shrink anchor hit areas to the text.
 */
const slab = (href, label) => `
<table role="presentation" cellpadding="0" cellspacing="0" border="0">
  <tr>
    <td align="center" bgcolor="${TERRACOTTA}"
        style="border:2px solid ${INK};border-radius:8px">
      <a href="${href}" style="display:inline-block;padding:13px 26px;color:#FFF6EF;
         text-decoration:none;font-weight:700;font-size:15px;letter-spacing:-0.01em">${label}</a>
    </td>
  </tr>
</table>`;

/**
 * Borders use a flat hex, not rgba(). Outlook drops any declaration containing
 * a colour function it does not understand, and the fallback there is not "no
 * border" but the browser default — a black line four times too heavy.
 */
const row = (label, value) => `
<tr>
  <td style="padding:9px 0;border-bottom:1px solid ${HAIRLINE}">
    <span style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:${MUTED}">${label}</span><br>
    <span style="font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:16px;color:${INK}">${value}</span>
  </td>
</tr>`;

/**
 * One "try this first" line: a numbered clay token beside a short title and
 * sentence. A table per row, because a two-column layout is the one thing
 * every client agrees on only when it is a table.
 */
const tip = (n, title, body) => `
<tr>
  <td valign="top" width="44" style="padding:0 0 18px">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
      <tr><td align="center" valign="middle" width="32" height="32" bgcolor="${BISQUE}"
              style="border:2px solid ${INK};border-radius:10px;font-size:14px;font-weight:800;color:${TERRACOTTA}">${n}</td></tr>
    </table>
  </td>
  <td valign="top" style="padding:0 0 18px">
    <div style="font-size:15px;font-weight:700;color:${INK};line-height:1.35">${title}</div>
    <div style="font-size:14px;line-height:1.6;color:${MUTED}">${body}</div>
  </td>
</tr>`;

function welcomeHtml({ displayName, username, nookId, appUrl }) {
  // The logo is a PNG served by the web app: Gmail and Outlook show no SVG.
  const logo = `${appUrl.replace(/\/+$/, '')}/email-logo.png`;
  const download = `${appUrl.replace(/\/+$/, '')}/download`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only">
<title>Welcome to Nook</title></head>
<body style="margin:0;padding:0;background:${BISQUE}">
<!-- Shown in the inbox list under the subject, so it does the work of a subtitle. -->
<div style="display:none;max-height:0;overflow:hidden;opacity:0">
  Your corner of the internet is ready, ${esc(displayName)}. Here's your Nook ID and three things to try first.
</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
       style="background:${BISQUE};padding:36px 14px">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
           style="max-width:480px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">

      <!-- brand -->
      <tr><td align="center" style="padding:0 0 18px">
        <img src="${logo}" width="64" height="64" alt="Nook"
             style="display:block;border:0;width:64px;height:64px">
      </td></tr>

      <!-- the card -->
      <tr><td style="background:${SURFACE};border:2px solid ${INK};border-radius:28px;padding:34px 30px">

        <div style="font-size:12px;letter-spacing:.2em;text-transform:uppercase;color:${TERRACOTTA};font-weight:700">
          Welcome to Nook
        </div>
        <h1 style="margin:12px 0 10px;font-size:30px;line-height:1.12;color:${INK};letter-spacing:-0.02em">
          Hi ${esc(displayName)}, your corner is ready.
        </h1>
        <p style="margin:0 0 24px;font-size:15px;line-height:1.65;color:${MUTED}">
          Nook is a small, quiet place for the people you actually want to hear from.
          No feed, no reels, no strangers, no ads — just your people.
        </p>

        <!-- account details, as a sunken panel -->
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
               style="background:${BISQUE};border-radius:18px;margin:0 0 26px">
          <tr><td style="padding:6px 18px 8px">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              ${row('Your username', '@' + esc(username))}
              <tr><td style="padding:9px 0">
                <span style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:${MUTED}">Your Nook ID</span><br>
                <span style="font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:20px;font-weight:700;color:${TERRACOTTA};letter-spacing:.04em">${esc(nookId)}</span>
              </td></tr>
            </table>
          </td></tr>
        </table>

        <div style="font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:${MUTED};margin:0 0 14px">
          Three things to try first
        </div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 8px">
          ${tip(1, 'Bring your people in', 'Share your Nook ID — friends paste it into search to find you. It never changes, even if your username does.')}
          ${tip(2, 'Make a chat feel like yours', 'Set a wallpaper on any conversation. Nook tints the bubbles to match it.')}
          ${tip(3, 'Say more than text', 'Send a voice note, or a snap that disappears after it is seen.')}
        </table>

        ${slab(appUrl, 'Open Nook')}

        <p style="margin:18px 0 0;font-size:14px;line-height:1.6;color:${MUTED}">
          On Android? <a href="${download}" style="color:${TERRACOTTA};font-weight:700;text-decoration:underline">Get the app</a>
          for notifications that arrive even when your phone is locked.
        </p>
      </td></tr>

      <!-- footer -->
      <tr><td style="padding:22px 18px 0;font-size:12px;line-height:1.65;color:${MUTED};text-align:center">
        Your email is only ever used to get you back in if you forget your password.
        Nook has no ads and nothing to sell.<br>
        Didn't sign up? Someone typed your address by mistake — ignore this and no account is attached to you.
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

export function sendWelcome({ to, displayName, username, nookId }) {
  const appUrl = env.appUrl;
  return send({
    to,
    // A name is user input; a line break in a header would start a new one.
    subject: `Welcome to Nook, ${String(displayName).replace(/[\r\n]+/g, ' ').slice(0, 60)} — your corner is ready`,
    html: welcomeHtml({ displayName, username, nookId, appUrl }),
    text: [
      `Welcome, ${displayName}.`,
      '',
      'Your corner of the internet is ready.',
      '',
      `Username: @${username}`,
      `Nook ID:  ${nookId}`,
      '',
      'Three things to try first:',
      '  1. Share your Nook ID — friends paste it into search to find you.',
      '  2. Set a wallpaper on a chat; Nook tints the bubbles to match.',
      '  3. Send a voice note, or a snap that disappears after it is seen.',
      '',
      `Open Nook: ${appUrl}`,
      `Android app: ${appUrl.replace(/\/+$/, '')}/download`,
      '',
      'Your email is only used to get you back in if you forget your password.',
      "Didn't sign up? Ignore this — no account is attached to you.",
    ].join('\n'),
  });
}

/* ── broadcast ────────────────────────────────────────────────────────────
   An announcement written in the panel, wearing the same clothes as every
   other Nook email so it does not look like it came from somewhere else.
   ────────────────────────────────────────────────────────────────────────── */


/** Blank line = paragraph. Single newline = line break. Nothing else. */
const paragraphs = (body) =>
  esc(body)
    .split(/\n{2,}/)
    .map(
      (p) =>
        `<p style="margin:0 0 16px;font-size:15px;line-height:1.65;color:${MUTED}">${p.replace(/\n/g, '<br>')}</p>`
    )
    .join('');

/**
 * `format` decides who owns the markup.
 *
 * 'text' wraps the message in the Nook template, which is the right default:
 * it renders in Outlook, it carries the branding, and nobody has to think
 * about email HTML.
 *
 * 'html' hands the whole body over untouched, for a design built elsewhere.
 * The template is not merged into it — half a template around someone else's
 * layout is how emails end up with two headers and two footers. Placeholders
 * are still substituted, because a bulk email that cannot say the recipient's
 * name is barely worth sending.
 */
export function sendBroadcast({ to, displayName, subject, heading, body, format = 'text' }) {
  if (format === 'html') {
    const filled = fillPlaceholders(body, { displayName, appUrl: env.appUrl, email: to });
    return send({
      to,
      subject,
      html: filled,
      // A plain-text alternative is what stops a rich email scoring as spam,
      // and it is what people on a watch or a screen reader actually get.
      text: htmlToText(filled),
    });
  }

  const greeting = heading || `Hello ${displayName}`;
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only">
<title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:${BISQUE}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
       style="background:${BISQUE};padding:40px 16px">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
           style="max-width:460px;background:${SURFACE};border-radius:28px;padding:36px;
                  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
      <tr><td>
        <div style="font-size:12px;letter-spacing:.2em;text-transform:uppercase;color:${MUTED}">Nook</div>
        <h1 style="margin:14px 0 14px;font-size:26px;line-height:1.2;color:${INK};letter-spacing:-0.02em">
          ${esc(greeting)}
        </h1>
        ${paragraphs(body)}
        ${slab(env.appUrl, 'Open Nook')}
        <p style="margin:26px 0 0;padding-top:20px;border-top:1px solid ${HAIRLINE};
                  font-size:13px;line-height:1.6;color:${MUTED}">
          You are getting this because you have a Nook account. It is not marketing and there is
          nothing to unsubscribe from — we only write when there is something you need to know.
        </p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;

  return send({
    to,
    subject,
    html,
    text: `${greeting}\n\n${body}\n\nOpen Nook: ${env.appUrl}`,
  });
}

/**
 * The few substitutions a hand-written email needs. Deliberately a fixed short
 * list rather than a template language: this input comes from the admin page
 * and goes straight into an email body, so the less of it that is interpreted,
 * the fewer ways it can misbehave.
 */
export function fillPlaceholders(html, { displayName, appUrl, email }) {
  return String(html)
    .replaceAll('{{name}}', esc(displayName || 'there'))
    .replaceAll('{{email}}', esc(email || ''))
    .replaceAll('{{app_url}}', appUrl || '')
    .replaceAll('{{year}}', String(new Date().getFullYear()));
}

/** Crude but honest: strip the tags, keep the words, collapse the whitespace. */
export function htmlToText(html) {
  return String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|h[1-6])>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

export const mailProvider = resolveProvider;
