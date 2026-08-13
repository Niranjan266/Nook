/**
 * Transactional email via Brevo. Only used for optional account recovery —
 * Nook works entirely without an email address.
 *
 * No API key? Codes are printed to the server console so dev still works.
 */
import { env } from '../config/env.js';

const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email';

async function send({ to, subject, html, text }) {
  if (!env.brevo.enabled) {
    console.log('\n  ┌─ email (console fallback — no BREVO_API_KEY) ──────────────');
    console.log(`  │ to      ${to}`);
    console.log(`  │ subject ${subject}`);
    console.log(`  │ ${text.replace(/\n/g, '\n  │ ')}`);
    console.log('  └────────────────────────────────────────────────────────────\n');
    return { delivered: false, channel: 'console' };
  }

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

export const mailProvider = () => (env.brevo.enabled ? 'brevo' : 'console');
