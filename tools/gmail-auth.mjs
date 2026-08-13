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

/**
 * Values can come from the command line or the environment, so a second run
 * after fixing something in the Google console does not mean retyping a
 * 72-character client ID. Falls back to prompting.
 *
 *   node tools/gmail-auth.mjs <client-id> <client-secret>
 */
let [clientId, clientSecret] = process.argv.slice(2);
clientId ||= process.env.GMAIL_CLIENT_ID || '';
clientSecret ||= process.env.GMAIL_CLIENT_SECRET || '';

if (clientId && clientSecret) {
  line(`  GMAIL_CLIENT_ID     : ${clientId.slice(0, 24)}… (from ${process.argv[2] ? 'the command line' : 'the environment'})`);
  line('  GMAIL_CLIENT_SECRET : ••••••••');
} else {
  const rl = readline.createInterface({ input, output });
  clientId = clientId || (await rl.question('  GMAIL_CLIENT_ID     : ')).trim();
  clientSecret = clientSecret || (await rl.question('  GMAIL_CLIENT_SECRET : ')).trim();
  rl.close();
}

clientId = clientId.trim();
clientSecret = clientSecret.trim();

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
line('  Opening your browser. Sign in as the account that will send.');
line('  If nothing opens, paste this in yourself:');
line();
line(`  ${authUrl}`);
line();

// Opening it removes the most common failure: a very long URL mangled by
// copy-paste out of a terminal that soft-wrapped it.
try {
  const { spawn } = await import('node:child_process');
  const cmd =
    process.platform === 'win32' ? ['cmd', ['/c', 'start', '', authUrl]]
    : process.platform === 'darwin' ? ['open', [authUrl]]
    : ['xdg-open', [authUrl]];
  spawn(cmd[0], cmd[1], { detached: true, stdio: 'ignore' }).unref();
} catch {
  /* the printed URL above is the fallback */
}

line('  Waiting for Google to redirect back…');
line('  (Ctrl+C to give up.)');

/**
 * Turn the two ways this can fail into advice.
 *
 * Both look identical from here — the browser never comes back — but they have
 * completely different fixes, and a bare "timed out" sends people looking at
 * their network instead of at the Google console.
 */
function explainAndExit(err) {
  line();
  if (err.message === 'TIMEOUT') {
    line('  ── Google never redirected back ────────────────────────────');
    line();
    line('  Nine times in ten this means the redirect URI is not registered.');
    line('  In Google Cloud Console → APIs & Services → Credentials → open');
    line('  this OAuth client → Authorised redirect URIs → add exactly:');
    line();
    line(`      ${REDIRECT}`);
    line();
    line('  No trailing slash, http not https, port 5388. Google matches it');
    line('  character for character. Save, wait a minute, and run this again.');
    line();
    line('  If you did see a Google error page, its text says which it was:');
    line('    "Error 400: redirect_uri_mismatch"  → the URI above is missing');
    line('    "Access blocked … has not completed verification" → add your');
    line('       address under OAuth consent screen → Test users');
  } else {
    line(`  ── Did not complete: ${err.message} ──`);
  }
  line();
  process.exit(1);
}

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

  // Fifteen minutes, because signing in can mean finding a phone for 2FA.
  setTimeout(
    () => {
      server.close();
      reject(new Error('TIMEOUT'));
    },
    15 * 60 * 1000
  );
}).catch(explainAndExit);

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
