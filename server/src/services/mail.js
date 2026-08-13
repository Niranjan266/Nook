/**
 * Transactional email via Brevo. Only used for optional account recovery —
 * Nook works entirely without an email address.
 *
 * No API key? Codes are printed to the server console so dev still works.
 */
import { env } from '../config/env.js';
import { sendViaGmail, gmailReady } from './gmail.js';

const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email';

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
  if (pinned === 'gmail') return gmailReady() ? 'gmail' : 'console';
  if (pinned === 'brevo') return env.brevo.enabled ? 'brevo' : 'console';
  if (pinned === 'console') return 'console';

  if (gmailReady()) return 'gmail';
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
        : 'no Gmail or Brevo credentials configured';
    return toConsole({ to, subject, text, why });
  }

  try {
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
      `Hi ${displayName} — use this code to reset your password.`,
      code
    ),
    text: `Your Nook recovery code is ${code}. It expires in 15 minutes.`,
  });
}

export function sendEmailVerification({ to, code, displayName }) {
  return send({
    to,
    subject: `${code} — confirm your email for Nook`,
    html: shell(
      'Confirm your email',
      `Hi ${displayName} — adding an email means you can recover your account if you forget your password. It stays private.`,
      code
    ),
    text: `Your Nook confirmation code is ${code}. It expires in 15 minutes.`,
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

function welcomeHtml({ displayName, username, nookId, appUrl }) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only">
<title>Welcome to Nook</title></head>
<body style="margin:0;padding:0;background:${BISQUE}">
<!-- Shown in the inbox list under the subject, so it does the work of a subtitle. -->
<div style="display:none;max-height:0;overflow:hidden;opacity:0">
  Your corner of the internet is ready. Here's your Nook ID.
</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
       style="background:${BISQUE};padding:40px 16px">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
           style="max-width:460px;background:${SURFACE};border-radius:28px;padding:36px;
                  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
      <tr><td>
        <div style="font-size:12px;letter-spacing:.2em;text-transform:uppercase;color:${MUTED}">Nook</div>
        <h1 style="margin:14px 0 10px;font-size:28px;line-height:1.15;color:${INK};letter-spacing:-0.02em">
          Welcome, ${displayName}.
        </h1>
        <p style="margin:0 0 26px;font-size:15px;line-height:1.65;color:${MUTED}">
          Your corner of the internet is ready. No feed, no reels, no strangers —
          just the people you actually want to hear from.
        </p>

        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
               style="margin:0 0 26px">
          ${row('Your username', '@' + username)}
          ${row('Your Nook ID', nookId)}
        </table>

        <p style="margin:0 0 22px;font-size:14px;line-height:1.65;color:${MUTED}">
          Share your <strong style="color:${INK}">Nook ID</strong> with anyone you want to hear from —
          they can paste it straight into search. It is yours permanently and never changes,
          so it keeps working even if you change your username later.
        </p>

        ${slab(appUrl, 'Open Nook')}

        <p style="margin:26px 0 0;padding-top:20px;border-top:1px solid ${HAIRLINE};
                  font-size:13px;line-height:1.6;color:${MUTED}">
          Your email is only ever used to get you back in if you forget your password.
          Nook has no ads and nothing to sell.
          <br><br>
          Didn't sign up? Someone typed your address by mistake — ignore this and no account is
          attached to you.
        </p>
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
    subject: 'Welcome to Nook — here’s your Nook ID',
    html: welcomeHtml({ displayName, username, nookId, appUrl }),
    text: [
      `Welcome, ${displayName}.`,
      '',
      'Your corner of the internet is ready.',
      '',
      `Username: @${username}`,
      `Nook ID:  ${nookId}`,
      '',
      'Share your Nook ID with anyone you want to hear from — they can paste it',
      'straight into search. It is yours permanently and never changes, so it keeps',
      'working even if you change your username later.',
      '',
      `Open Nook: ${appUrl}`,
      '',
      'Your email is only used to get you back in if you forget your password.',
      "Didn't sign up? Ignore this — no account is attached to you.",
    ].join('\n'),
  });
}

export const mailProvider = resolveProvider;
