# Brevo — step by step

Written for your setup: domain `niranjand.in` (DNS at BigRock), API on Render
as `nook-api-6djz`, app on Vercel at `nook.niranjand.in`.

The code is already written. This is entirely account setup and four
environment variables.

---

## Step 0 · Decide the From address first

This is the one decision that changes everything after it, and it trips almost
everyone up.

**Brevo will not send from an address you have not proved you control.** For a
single sender address, it proves that by emailing you a confirmation link. So
to verify `no-reply@niranjand.in`, you have to be able to **receive** mail at
`no-reply@niranjand.in` — and a domain on its own does not give you a mailbox.

So pick one:

| | **A · Verify one address you can already read** | **B · Authenticate the whole domain** *(recommended)* |
|---|---|---|
| Time | 2 minutes | 20 minutes + DNS propagation |
| DNS records | None | 3 (DKIM, SPF, DMARC) at BigRock |
| From address | Your Gmail, e.g. `niranjanlithikasan937@gmail.com` | Any address at your domain, e.g. `no-reply@niranjand.in` |
| Needs a mailbox at that address | Yes — you already have one | **No** — domain proof replaces it |
| How it looks | Personal Gmail sending "Nook" mail | Proper product email |
| Deliverability | Weaker; more likely to land in spam | Strong |

**B is the one to do**, and the deciding detail is the last row but one:
authenticating the domain proves control of `niranjand.in` *as a whole*, so you
can send from `no-reply@` without ever needing a mailbox there. That is the
thing that makes a no-reply address possible at all.

Use A only if you want to see the email working in the next five minutes. You
can switch to B later by changing one environment variable.

---

## Step 1 · Create the account

1. [brevo.com](https://www.brevo.com) → **Sign up free**
2. Confirm your email, fill in the company questions (any answer is fine)
3. You land on the dashboard. The free plan is **300 emails/day**, which for a
   welcome email means 300 new signups a day — far beyond where you are

Brevo may ask what you will use it for. Say **transactional**, not marketing.
It affects nothing technically, but new accounts sending marketing get a closer
look from their review team.

---

## Step 2A · Verify a single sender *(if you chose A)*

1. Top-right avatar → **Senders, Domains & Dedicated IPs**
2. **Senders** tab → **Add a sender**
3. Name `Nook`, email = an address you can actually open
4. Brevo emails a confirmation link there → click it
5. The sender shows a green tick

Set `BREVO_SENDER_EMAIL` to exactly that address in step 4.

---

## Step 2B · Authenticate `niranjand.in` *(if you chose B — recommended)*

1. Top-right avatar → **Senders, Domains & Dedicated IPs**
2. **Domains** tab → **Add a domain** → `niranjand.in` → **Save**
3. Brevo shows records to create. They look like:

| Type | Host / Name | Value |
|---|---|---|
| `TXT` | `brevo-code` *(or similar)* | the verification string Brevo shows |
| `TXT` | `mail._domainkey` | `k=rsa; p=MIGf…` — the DKIM public key |
| `TXT` | `@` | `v=spf1 include:spf.brevo.com mc` |

4. In **BigRock → Manage DNS → TXT Records**, add each one
   - Host is just the label (`mail._domainkey`), not the full name — BigRock
     appends the domain itself
   - `@` means the domain root
5. Back in Brevo, click **Verify**. Allow up to an hour.

> **If you already have an SPF record**, do not add a second one. A domain with
> two SPF records fails SPF outright — this is the single most common way
> people make their deliverability *worse* while trying to improve it. Merge
> instead: one record containing both includes.

Then set `BREVO_SENDER_EMAIL=no-reply@niranjand.in`. Nothing has to exist at
that address; the domain proof is what authorises it.

**DMARC** is optional and worth adding once DKIM and SPF pass. Start in
monitor-only mode so nothing of yours gets rejected while you watch:

| Type | Host | Value |
|---|---|---|
| `TXT` | `_dmarc` | `v=DMARC1; p=none; rua=mailto:you@yourmail.com` |

---

## Step 3 · Create the API key

1. Top-right avatar → **SMTP & API**
2. **API keys** tab → **Generate a new API key**
3. Name it `nook-render`
4. **Copy it now** — Brevo shows it once and never again

Use the **v3 API key**, not the SMTP password further down that page. The code
calls Brevo over HTTPS, which matters: Render blocks outbound SMTP ports on
free instances, so the SMTP credentials would be unusable there anyway.

Do not paste the key into chat, a file, or a commit. Straight from Brevo into
the Render dashboard.

---

## Step 4 · Set the variables

### Render → `nook-api` → Environment

| Key | Value |
|---|---|
| `BREVO_API_KEY` | *(the key from step 3)* |
| `BREVO_SENDER_EMAIL` | `no-reply@niranjand.in` *(or your verified address for path A)* |
| `BREVO_SENDER_NAME` | `Nook` |
| `APP_URL` | `https://nook.niranjand.in` |

Save. Render redeploys on its own.

### Locally → `server/.env`

Same four. Or leave `BREVO_API_KEY` empty locally and every email prints to
your terminal instead — usually what you want while developing, since you can
read the whole thing without leaving the console.

**None of these go in Vercel.** Vercel serves static files; there is no server
there to send an email. A `BREVO_API_KEY` in Vercel does nothing at best, and
if you ever prefixed it `VITE_` it would be compiled into the public
JavaScript bundle for anyone to read.

---

## Step 5 · Confirm it works

```
https://nook-api-6djz.onrender.com/api/health
```

```jsonc
{ "mail": "brevo" }   // "console" means BREVO_API_KEY did not take
```

Then create an account at `https://nook.niranjand.in` with a real email
address. The welcome email should arrive within a minute.

Check the Render logs if it does not — the send is fire-and-forget by design,
so a failure never breaks signup and never surfaces in the UI. It is written
to the log instead:

```
email     brevo rejected (400) {"message":"Sender ... not valid"}
```

Brevo also keeps its own record: **Transactional → Email → Logs**, which shows
delivered, soft-bounced and blocked for every message.

---

## What can go wrong

| Symptom | Cause |
|---|---|
| `"mail":"console"` on health | `BREVO_API_KEY` empty or misspelt in Render |
| `Sender ... not valid` in the logs | `BREVO_SENDER_EMAIL` does not match a verified sender or authenticated domain, exactly |
| Nothing arrives, no error | Check Brevo → Transactional → Logs. Usually the recipient's provider soft-bounced it |
| Lands in spam | Path A does this. Authenticate the domain (2B) |
| Domain stuck unverified | TXT records not propagated yet, or the host field has the domain appended twice |
| SPF suddenly failing | Two SPF records on the domain. There must be exactly one |
| Works locally, not on Render | The variables were set locally only — they are separate places |

---

## One thing to know before you invest the time

**The free plan puts a Brevo logo in the footer of every email, including
transactional ones.** It cannot be removed on free; it needs the Starter plan
plus a $9/month add-on, or Standard and above.

For a private chat app among friends this is cosmetic and easy to live with.
If it bothers you, [Resend](https://resend.com) has a free tier of 3,000
emails a month with no branding, and swapping is a contained change — every
email in Nook goes through `server/src/services/mail.js`, so only the `send()`
function at the top of that file would change. Say the word and I will do it.
