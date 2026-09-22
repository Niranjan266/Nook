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

/* ── the look ───────────────────────────────────────────────────────────────
   Midnight Pebble, in the one form email can carry. Built with tables and
   inline styles on purpose: Outlook renders HTML through Word, which ignores
   flexbox, grid, box-shadow and most of border-radius, and Gmail strips
   <style> blocks on some clients — so the layout is a table and every rule is
   an attribute.

   Light only. The app is dark-first, but mail clients "helpfully" invert dark
   designs in ways nobody can predict (Outlook recolours, Gmail half-inverts),
   so a fixed lavender page with a white card is the one version that looks
   the same everywhere. `color-scheme: light only` asks clients to leave it.

   Where Outlook squares the pill corners, what's left is a flat iris button —
   plainer, still unmistakably a button. That is the trade for reliability.
   ────────────────────────────────────────────────────────────────────────── */

const PAGE = '#F4F2FB';
const CARD = '#FFFFFF';
/** Borders use a flat hex, never rgba(): Outlook drops a colour function it
    does not understand and falls back to a heavy black line. */
const LINE = '#E4E0F3';
const WELL = '#F4F2FB';
const INK = '#1F1B2E';
const MUTED = '#5E5875';
const IRIS = '#5443D6';
const IRIS_SOFT = '#E6E2FF';

/**
 * Fredoka is a web font and almost no mail client will fetch it, so the stack
 * is really about the fallbacks: Nunito where it is installed, Arial Rounded
 * on Macs and most Windows machines, then plain Arial — all of which keep the
 * soft, round feel well enough at heading sizes.
 */
const DISPLAY = "'Fredoka','Nunito','Arial Rounded MT Bold',Arial,sans-serif";
const BODY = "'Nunito',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const MONO = 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace';

// The logo is a PNG served by the web app: Gmail and Outlook show no SVG.
const logoUrl = (appUrl) => `${String(appUrl).replace(/\/+$/, '')}/email-logo.png`;

/** The mark above the card. Shared so every Nook email opens the same way. */
const brand = (appUrl) => `
      <tr><td align="center" style="padding:0 0 20px">
        <img src="${logoUrl(appUrl)}" width="56" height="56" alt="Nook"
             style="display:block;border:0;width:56px;height:56px">
      </td></tr>`;

/** The white card. Outlook drops the radius; the 1px line survives. */
const cardOpen = (pad = '36px 32px') =>
  `<tr><td bgcolor="${CARD}" style="background:${CARD};border:1px solid ${LINE};border-radius:24px;padding:${pad}">`;

/** A small uppercase line above a heading. */
const eyebrow = (text) =>
  `<div style="font-family:${BODY};font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:${IRIS};font-weight:800">${text}</div>`;

/** Recovery and verification: one heading, one sentence, one code. The
    code cell is padded less on the right because letter-spacing leaves a
    gap after the last digit, and the pair should look centred. */
const shell = (heading, lead, code) => `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
       style="background:${PAGE};padding:40px 16px">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
           style="max-width:440px;font-family:${BODY}">
      ${brand(env.appUrl)}
      ${cardOpen()}
        ${eyebrow('Nook')}
        <h1 style="margin:12px 0 8px;font-family:${DISPLAY};font-size:26px;font-weight:600;color:${INK};line-height:1.2">${heading}</h1>
        <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:${MUTED}">${lead}</p>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
          <tr><td align="center" bgcolor="${WELL}"
                  style="background:${WELL};border:1px solid ${LINE};border-radius:16px;padding:16px 14px 16px 24px;
                         font-family:${MONO};font-size:30px;font-weight:700;letter-spacing:.32em;color:${INK}">${code}</td></tr>
        </table>
        <p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:${MUTED}">
          This code expires in 15 minutes. If you didn't ask for it, you can ignore this email —
          nothing has changed on your account.
        </p>
      </td></tr>
    </table>
  </td></tr>
</table>`;

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

/* ── welcome ──────────────────────────────────────────────────────────────── */

/**
 * The primary button: an iris pill with white text.
 *
 * The `<a>` is padded rather than the `<td>` so the whole button is clickable
 * in clients that shrink anchor hit areas to the text. bgcolor as well as the
 * style, because some Outlook builds only honour the attribute.
 */
const slab = (href, label) => `
<table role="presentation" cellpadding="0" cellspacing="0" border="0">
  <tr>
    <td align="center" bgcolor="${IRIS}" style="background:${IRIS};border-radius:999px">
      <a href="${href}" style="display:inline-block;padding:14px 30px;color:#FFFFFF;border-radius:999px;
         font-family:${BODY};text-decoration:none;font-weight:800;font-size:15px">${label}</a>
    </td>
  </tr>
</table>`;

const row = (label, value) => `
<tr>
  <td style="padding:12px 0;border-bottom:1px solid ${LINE}">
    <span style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:${MUTED};font-weight:700">${label}</span><br>
    <span style="font-family:${MONO};font-size:16px;color:${INK}">${value}</span>
  </td>
</tr>`;

/**
 * One "try this first" line: a numbered pebble beside a short title and
 * sentence. A table per row, because a two-column layout is the one thing
 * every client agrees on only when it is a table.
 */
const tip = (n, title, body) => `
<tr>
  <td valign="top" width="48" style="padding:0 0 20px">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
      <tr><td align="center" valign="middle" width="32" height="32" bgcolor="${IRIS_SOFT}"
              style="background:${IRIS_SOFT};border-radius:16px;font-family:${DISPLAY};font-size:15px;font-weight:700;color:${IRIS}">${n}</td></tr>
    </table>
  </td>
  <td valign="top" style="padding:0 0 20px">
    <div style="font-size:15px;font-weight:800;color:${INK};line-height:1.35">${title}</div>
    <div style="font-size:14px;line-height:1.6;color:${MUTED}">${body}</div>
  </td>
</tr>`;

function welcomeHtml({ displayName, username, nookId, appUrl }) {
  const download = `${appUrl.replace(/\/+$/, '')}/download`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<title>Welcome to Nook</title></head>
<body style="margin:0;padding:0;background:${PAGE}">
<!-- Shown in the inbox list under the subject, so it does the work of a subtitle. -->
<div style="display:none;max-height:0;overflow:hidden;opacity:0">
  Your corner of the internet is ready, ${esc(displayName)}. Here's your Nook ID and three things to try first.
</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
       style="background:${PAGE};padding:40px 16px">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
           style="max-width:480px;font-family:${BODY}">

      ${brand(appUrl)}

      <!-- the card -->
      ${cardOpen()}

        ${eyebrow('Welcome to Nook')}
        <h1 style="margin:12px 0 12px;font-family:${DISPLAY};font-size:30px;font-weight:600;line-height:1.15;color:${INK}">
          Hi ${esc(displayName)}, your corner is ready.
        </h1>
        <p style="margin:0 0 24px;font-size:15px;line-height:1.65;color:${MUTED}">
          Nook is a small, quiet place for the people you actually want to hear from.
          No feed, no reels, no strangers, no ads — just your people.
        </p>

        <!-- account details, in a lavender well -->
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
               bgcolor="${WELL}" style="background:${WELL};border-radius:20px;margin:0 0 28px">
          <tr><td style="padding:8px 20px">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              ${row('Your username', '@' + esc(username))}
              <tr><td style="padding:12px 0">
                <span style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:${MUTED};font-weight:700">Your Nook ID</span><br>
                <span style="font-family:${MONO};font-size:20px;font-weight:700;color:${IRIS};letter-spacing:.04em">${esc(nookId)}</span>
              </td></tr>
            </table>
          </td></tr>
        </table>

        <div style="font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:${MUTED};font-weight:800;margin:0 0 16px">
          Three things to try first
        </div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 8px">
          ${tip(1, 'Bring your people in', 'Share your Nook ID — friends paste it into search to find you. It never changes, even if your username does.')}
          ${tip(2, 'Make a chat feel like yours', 'Set a wallpaper on any conversation. Nook tints the bubbles to match it.')}
          ${tip(3, 'Say more than text', 'Send a voice note, or a snap that disappears after it is seen.')}
        </table>

        ${slab(appUrl, 'Open Nook')}

        <p style="margin:20px 0 0;font-size:14px;line-height:1.6;color:${MUTED}">
          On Android? <a href="${download}" style="color:${IRIS};font-weight:800;text-decoration:underline">Get the app</a>
          for notifications that arrive even when your phone is locked.
        </p>
      </td></tr>

      <!-- footer -->
      <tr><td style="padding:24px 20px 0;font-size:12px;line-height:1.65;color:${MUTED};text-align:center">
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
<meta name="supported-color-schemes" content="light only">
<title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:${PAGE}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
       style="background:${PAGE};padding:40px 16px">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
           style="max-width:480px;font-family:${BODY}">
      ${brand(env.appUrl)}
      ${cardOpen()}
        ${eyebrow('Nook')}
        <h1 style="margin:12px 0 16px;font-family:${DISPLAY};font-size:26px;font-weight:600;line-height:1.2;color:${INK}">
          ${esc(greeting)}
        </h1>
        ${paragraphs(body)}
        ${slab(env.appUrl, 'Open Nook')}
        <p style="margin:28px 0 0;padding-top:20px;border-top:1px solid ${LINE};
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
