# Sending through Gmail — step by step

About 10 minutes, all of it in Google Cloud Console. No credit card, no DNS.

---

## Why this uses the API and not SMTP

The obvious way to "use Gmail" is `smtp.gmail.com` on port 587. **That cannot
work on Render.** Free instances block outbound traffic on ports 25, 465 and
587, and port 25 is blocked on every Render plan. The failure is a connection
timeout with no explanation, which reads exactly like a bug in your own code —
people lose afternoons to it.

Gmail also exposes a REST API on port 443, which nothing blocks. It costs an
OAuth setup once and then works everywhere: locally, on Render's free tier, and
on any host that would have blocked SMTP. That is what Nook uses.

---

## Two things to accept before you start

**1. The From address will be your Gmail address.**

Gmail rewrites `From` to the account that authorised, unless the address is a
verified "Send mail as" alias on that same account — and verifying
`no-reply@niranjand.in` as an alias needs a mailbox there to receive the
confirmation link, which a domain alone does not give you. So recipients will
see your Gmail address. For a private app among friends this is fine, and
arguably friendlier. For something that looks like a product, Brevo with an
authenticated domain is the better fit — see `BREVO-SETUP.md`.

**2. 500 emails a day**, and it is your personal mailbox doing the sending. At
Nook's scale that is 500 new signups a day, so not a practical ceiling — but it
is worth knowing that heavy automated sending can attract limits on the account
you use for everything else.

---

## Step 1 · Google Cloud project

1. [console.cloud.google.com](https://console.cloud.google.com) → sign in
2. Project dropdown (top left) → **New project** → name it `nook` → **Create**
3. Make sure the new project is selected before continuing — everything below
   applies to the *selected* project, and setting up the wrong one is the
   commonest way to end up with a client ID that will not authorise

## Step 2 · Enable the Gmail API

1. **APIs & Services → Library**
2. Search **Gmail API** → open it → **Enable**

Skip this and sending fails later with a 403 whose message does not mention the
API being off. Nook's error text calls it out, but it is easier to just do it now.

## Step 3 · OAuth consent screen

1. **APIs & Services → OAuth consent screen**
2. User type: **External** → **Create**
3. App name `Nook`, your email for both support and developer contact → **Save and continue**
4. Scopes: skip → **Save and continue**
5. **Test users** → **Add users** → add the Gmail address that will be sending
6. **Save and continue**

> ### Publishing status is not optional here
>
> While the consent screen sits on **Testing**, two things are true, and both
> bite:
>
> 1. **Only accounts on the Test users list can consent at all.** Everyone else
>    gets *"Access blocked: Nook has not completed the Google verification
>    process — Error 403: access_denied"*. That includes the account you want to
>    send mail from, and — because the same OAuth client also powers Nook's
>    sign-in — **every person who tries to sign in with Google**.
> 2. **Refresh tokens expire after seven days.** Mail works, then silently stops
>    a week later with `invalid_grant`.
>
> So: add the sending account under **Test users** to unblock yourself now, then
> **Publish app** to fix both properly. Publishing is free and instant.
>
> Publishing shows an "unverified app" warning to anyone consenting to a
> sensitive scope, and caps you at 100 such users. Neither matters here: exactly
> one person ever consents to `gmail.send` — you, once, to connect the sender.
> Full Google verification only exists to remove that warning for a public
> audience you do not have.

## Step 4 · OAuth client

1. **APIs & Services → Credentials → Create credentials → OAuth client ID**
2. Application type: **Web application**
3. Name: `nook-server`
4. **Authorised redirect URIs → Add URI**:
   ```
   http://localhost:5388
   ```
   Exactly that — no trailing slash, `http` not `https`. It only ever receives
   Google's redirect on your own machine during setup.
5. **Create**. Copy the client ID and client secret.

## Step 5 · Get the refresh token

Double-click **`Gmail-Auth.bat`** in the project folder. It will:

1. Ask for the client ID and secret you just copied
2. Print a Google URL — open it, sign in as the sending account, and consent
3. Catch the redirect on `localhost:5388`
4. Ask Gmail which account authorised, so the sender address is the one that
   actually consented
5. Print all six environment variables, ready to paste

It requests only `gmail.send`. The token it produces cannot read your inbox.

**The refresh token is a long-lived credential that can send mail as you.** It
is generated on your machine for that reason — put it straight into the Render
dashboard. Not into a commit, a message, or a screenshot.

## Step 6 · Set the variables

### `server/.env` — for local development

```
GMAIL_CLIENT_ID=…
GMAIL_CLIENT_SECRET=…
GMAIL_REFRESH_TOKEN=…
GMAIL_SENDER=you@gmail.com
GMAIL_SENDER_NAME=Nook
MAIL_PROVIDER=gmail
APP_URL=http://localhost:5173
```

### Render → `nook-api` → Environment

The same, with `APP_URL=https://nook.niranjand.in`.

**None of these go in Vercel.** Vercel serves static files; there is no server
there to send anything.

`MAIL_PROVIDER=auto` also works and picks Gmail whenever it is configured.
Setting `gmail` explicitly is worth it if you have Brevo configured too and
want certainty about which one sent a message.

## Step 7 · Check

```
https://nook-api-6djz.onrender.com/api/health
```

```jsonc
{ "mail": "gmail" }   // "console" means a GMAIL_* value is missing
```

Then sign up at `https://nook.niranjand.in` with a real address.

---

## What can go wrong

| Symptom | Cause |
|---|---|
| `"mail":"console"` | One of the four required `GMAIL_*` values is empty. All four are needed |
| `Gmail auth failed (400): invalid_grant` | Token revoked, expired, or from a different client. Re-run `Gmail-Auth.bat` |
| `invalid_client` | `GMAIL_CLIENT_ID` or `GMAIL_CLIENT_SECRET` is wrong |
| `Gmail send failed (403)` | Gmail API not enabled on that project — step 2 |
| Worked, then stopped after a week | Consent screen still on "Testing". Publish it — step 3 |
| `redirect_uri_mismatch` during setup | The URI must be exactly `http://localhost:5388`, no trailing slash |
| From shows your Gmail, not `no-reply@` | Expected. See "Two things to accept" above |

---

## Switching back to Brevo

Nothing to rewrite — set `MAIL_PROVIDER=brevo` and make sure `BREVO_API_KEY` is
set. Both transports live behind the same `send()` in
`server/src/services/mail.js`, so the three email templates are untouched by
the choice.
