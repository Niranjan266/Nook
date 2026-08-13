/**
 * One-time Gmail authorisation.
 *
 * Walks you through Google's consent screen and prints the refresh token. Run
 * it on your own machine: the token is a long-lived credential that can send
 * mail as you, so it should be generated where you are and pasted straight
 * into a dashboard — never through a chat, a ticket, or a commit.
 *
 * A refresh token does not expire on its own, but Google revokes it if you
 * change your password, remove the app's access, or leave a project on the
 * "Testing" publishing status for more than seven days. That last one is the
 * usual reason mail silently stops a week after it started working.
 *
 *     node tools/gmail-auth.mjs
 */
import http from 'node:http';
import crypto from 'node:crypto';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const PORT = 5388;
const REDIRECT = `http://localhost:${PORT}`;
// Just enough to send. Not gmail.modify, not full — this token should not be
// able to read your inbox.
const SCOPE = 'https://www.googleapis.com/auth/gmail.send';

const line = (s = '') => console.log(s);

line();
line('  ╭──────────────────────────────────────────────╮');
line('  │  Nook — connect Gmail                        │');
line('  ╰──────────────────────────────────────────────╯');
line();
line('  Before you start, in Google Cloud Console:');
line('    1. Create (or pick) a project');
line('    2. APIs & Services → Library → enable "Gmail API"');
line('    3. APIs & Services → OAuth consent screen');
line('         • User type: External');
line('         • Add yourself under "Test users"');
line('    4. Credentials → Create credentials → OAuth client ID');
line('         • Application type: Web application');
line(`         • Authorised redirect URI: ${REDIRECT}`);
line();
line('  Then paste the client ID and secret below.');
line();

const rl = readline.createInterface({ input, output });
const clientId = (await rl.question('  GMAIL_CLIENT_ID     : ')).trim();
const clientSecret = (await rl.question('  GMAIL_CLIENT_SECRET : ')).trim();
rl.close();

if (!clientId || !clientSecret) {
  line('\n  Both values are required. Nothing was saved.\n');
  process.exit(1);
}

// Guards against a stray request to the callback being treated as the real one.
const state = crypto.randomBytes(16).toString('hex');

const authUrl =
  'https://accounts.google.com/o/oauth2/v2/auth?' +
  new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT,
    response_type: 'code',
    scope: SCOPE,
    // Google only returns a refresh token on the first consent for a client.
    // `prompt=consent` forces the screen every time, so re-running this always
    // produces a token instead of silently returning only an access token.
    access_type: 'offline',
    prompt: 'consent',
    state,
  }).toString();

line();
line('  Open this in your browser, sign in as the account that will send:');
line();
line(`  ${authUrl}`);
line();
line('  Waiting for Google to redirect back…');

const code = await new Promise((resolve, reject) => {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, REDIRECT);
    if (url.pathname !== '/') {
      res.writeHead(404).end();
      return;
    }

    const err = url.searchParams.get('error');
    const got = url.searchParams.get('code');

    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(
      `<body style="margin:0;background:#E9E1D6;font-family:system-ui,sans-serif">
         <div style="max-width:420px;margin:80px auto;background:#F4EEE6;border-radius:28px;padding:36px">
           <div style="font-size:12px;letter-spacing:.2em;text-transform:uppercase;color:#5C5349">Nook</div>
           <h1 style="margin:12px 0 8px;color:#1E1A17">${err ? 'Not connected' : 'Connected'}</h1>
           <p style="color:#5C5349;line-height:1.6">
             ${err ? `Google said: ${err}` : 'You can close this tab and go back to your terminal.'}
           </p>
         </div>
       </body>`
    );

    server.close();
    if (err) return reject(new Error(err));
    if (url.searchParams.get('state') !== state) return reject(new Error('state mismatch'));
    if (!got) return reject(new Error('no code returned'));
    resolve(got);
  });

  server.listen(PORT);
  setTimeout(() => {
    server.close();
    reject(new Error('timed out after 5 minutes'));
  }, 5 * 60 * 1000);
});

const res = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: REDIRECT,
    grant_type: 'authorization_code',
  }),
});

const data = await res.json();
if (!res.ok || !data.refresh_token) {
  line();
  line(`  Failed: ${JSON.stringify(data)}`);
  line();
  line('  No refresh token usually means this client has been authorised before.');
  line('  Revoke it at https://myaccount.google.com/permissions and run this again.');
  line();
  process.exit(1);
}

// Ask Gmail which account just authorised, so the sender address is the one
// that actually consented rather than whatever you remember typing.
let address = '';
try {
  const who = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
    headers: { authorization: `Bearer ${data.access_token}` },
  });
  address = (await who.json()).emailAddress || '';
} catch {
  /* not fatal — you can fill GMAIL_SENDER in by hand */
}

line();
line('  ── Paste these into server/.env and into Render ─────────────');
line();
line(`  GMAIL_CLIENT_ID=${clientId}`);
line(`  GMAIL_CLIENT_SECRET=${clientSecret}`);
line(`  GMAIL_REFRESH_TOKEN=${data.refresh_token}`);
line(`  GMAIL_SENDER=${address || 'you@gmail.com'}`);
line('  GMAIL_SENDER_NAME=Nook');
line('  MAIL_PROVIDER=gmail');
line();
line('  ─────────────────────────────────────────────────────────────');
line();
line('  These are secrets. Put them straight into the dashboard —');
line('  not into a commit, a message, or a screenshot.');
line();
