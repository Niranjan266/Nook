# Sign in with Google — setup

Five minutes. If you already made a Google Cloud project for Gmail sending,
**reuse it** — you only need one more OAuth client.

The button does not appear on the front door until both variables are set, so
there is never a control that leads nowhere.

---

## Step 1 · OAuth client

1. [console.cloud.google.com](https://console.cloud.google.com) → select your project
2. **APIs & Services → Credentials → Create credentials → OAuth client ID**
3. Application type: **Web application**
4. Name: `nook-login`
5. **Authorised redirect URIs** — add every origin the API will answer on:

```
https://nook-api-6djz.onrender.com/api/auth/google/callback
https://nook-api.niranjand.in/api/auth/google/callback
http://localhost:4000/api/auth/google/callback
```

> Google matches these **exactly** — scheme, host, port, path, and the absence
> of a trailing slash. `redirect_uri_mismatch` is the single most common error
> here and it always means one of those characters differs. Adding all three
> now saves changing it when you move to the custom domain.

6. **Create** → copy the client ID and secret

**These go to the API, not to Vercel.** The redirect lands on the API, and the
secret is used server-side to redeem the code. Nothing about Google sign-in
touches the frontend build.

## Step 2 · Consent screen

If you set this up for Gmail sending it is already done. Otherwise:
**APIs & Services → OAuth consent screen** → External → app name `Nook`, your
support and developer email → Save.

Scopes are `openid email profile`, all three "non-sensitive", so Google does
not require app verification. You will see an "unverified app" interstitial
until you press **Publish app** — and unlike the Gmail token, sign-in keeps
working while it is in Testing. Publish it anyway so your friends do not meet
a scary warning screen.

## Step 3 · Set the variables

**Render → `nook-api` → Environment:**

| Key | Value |
|---|---|
| `GOOGLE_CLIENT_ID` | *(from step 1)* |
| `GOOGLE_CLIENT_SECRET` | *(from step 1)* |

Locally, the same two in `server/.env`.

Confirm the server agrees:

```
https://nook-api-6djz.onrender.com/api/auth/google/available
→ {"available":true}
```

That endpoint is what the front door asks before drawing the button.

---

## How the flow works

```
  Continue with Google        (our button, an ordinary link)
        ↓
  API /api/auth/google/start  signs a state nonce, redirects to Google
        ↓
  Google consent screen
        ↓
  API /api/auth/google/callback
        verifies state · redeems the code · reads the ID token
        finds or creates the account
        mints a 60-second single-use handoff code
        ↓
  App /?g=<code>              exchanged for a session, then stripped from the URL
```

**Why a handoff code and not just a cookie.** Google redirects to the *API*,
which is a different origin from the app. Setting the session cookie there and
hoping the browser keeps it depends on `COOKIE_DOMAIN` being configured and on
both hosts sharing a parent domain — untrue while the API is on
`onrender.com`. The handoff works regardless, and a spent code is worthless,
which matters for something that briefly sits in browser history.

**Why not Google's JavaScript button.** It renders Google's own control with
almost no styling control, and it would be the one element on the sign-in
screen that looks like every other website. This flow is a plain redirect, so
the button is ours — Slab shape, our type and spacing, carrying Google's
four-colour mark because their brand terms require that much.

---

## Account rules, and the one that matters

**Returning users** are matched on Google's `sub`, not on email. People change
their email address; `sub` never changes.

**New users** get a username derived from their email local part, with a
numeric suffix if it is taken (`ram.jay`, then `ram.jay2`). They get a Nook ID
like anyone else, their Google profile picture, and an email already marked
verified — because Google verified it.

**Linking to an existing password account happens only when *both* sides have
proven the address:** Google reports `email_verified`, and the Nook account
confirmed its address through the emailed code.

That restriction is the whole point. Nook emails are optional and unverified by
default, so matching on email alone would be an account takeover: anyone could
type a stranger's address into their profile, wait for that person to sign in
with Google, and have them dropped into the attacker's account. When the rule
is not satisfied a separate account is created instead — recoverable, whereas a
wrong link is not.

**Accounts made through Google have no password.** They are flagged
`passwordless`, and trying to sign in with one is told *"This account signs in
with Google"* rather than *"wrong password"* — otherwise people sit there
trying passwords for an account that never had one.

---

## What can go wrong

| Symptom | Cause |
|---|---|
| No button on the front door | `GOOGLE_CLIENT_ID` or `GOOGLE_CLIENT_SECRET` unset. Check `/api/auth/google/available` |
| `redirect_uri_mismatch` | The URI in Google Cloud differs from `<PUBLIC_URL>/api/auth/google/callback` by at least one character |
| Back at sign-in with "did not complete" | Look for `google token exchange failed` in the Render logs — usually a wrong secret |
| "That sign-in link has expired" | The handoff lasts 60 seconds, and a redeploy in the middle clears them. Press the button again |
| Bounced with `bad_state` | The sign-in took over ten minutes, or `JWT_ACCESS_SECRET` changed between start and callback |
| Signed in but immediately signed out | Not Google's doing — that is `COOKIE_DOMAIN`. See `ENV-VARS.md` |
| A duplicate account instead of linking | Working as intended. Verify the email on the password account first, then sign in with Google again |
