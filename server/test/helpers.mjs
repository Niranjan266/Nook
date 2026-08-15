/**
 * The small amount of shared machinery the suites need.
 *
 * These tests talk to a real server over HTTP rather than importing the route
 * handlers. That is deliberate: nearly every bug worth catching here lives in
 * the seam between layers — a check that exists in the service but not on the
 * route, a serialiser that leaks a field the route thought it had hidden — and
 * a test that imports the function under test cannot see any of them.
 */
export const BASE = process.env.NOOK_TEST_BASE || 'http://127.0.0.1:4111/api';

export function suite(title) {
  let pass = 0;
  let fail = 0;
  console.log(`\n── ${title} ──\n`);

  return {
    ok(name, condition, detail = '') {
      if (condition) {
        pass += 1;
        console.log(`  PASS  ${name}`);
      } else {
        fail += 1;
        console.log(`  FAIL  ${name}   ${detail}`);
      }
    },
    done() {
      console.log(`\n  ${pass} passed, ${fail} failed\n`);
      return fail;
    },
  };
}

export async function api(path, { method = 'GET', token, body, cookie } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(cookie ? { cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json, cookies: res.headers.getSetCookie?.() || [] };
}

/**
 * Usernames cap at 20 characters, which is easy to blow past when a test
 * appends a timestamp and a random suffix — and the failure looks like a
 * server bug rather than a test bug, so it is worth doing once, here.
 */
export async function register(prefix, { withEmail = false } = {}) {
  const username = (
    prefix +
    Date.now().toString(36).slice(-5) +
    Math.random().toString(36).slice(2, 5)
  ).slice(0, 20);

  const r = await api('/auth/signup', {
    method: 'POST',
    body: {
      username,
      displayName: prefix,
      password: 'testpass123',
      // Only when the test needs it: an email address makes signup try to send
      // a welcome message, which is noise in every suite that does not care.
      ...(withEmail ? { email: `${username}@example.test` } : {}),
    },
  });
  if (!r.json.user) throw new Error(`signup failed for ${prefix}: ${r.status} ${JSON.stringify(r.json)}`);
  return { token: r.json.accessToken, id: r.json.user.id, username };
}

/** Two accounts that have agreed to talk — the precondition for most tests. */
export async function befriend(a, b) {
  await api(`/users/${b.id}/friend`, { method: 'POST', token: a.token });
  await api(`/users/${a.id}/friend/accept`, { method: 'POST', token: b.token });
}

export async function directChat(a, b) {
  const r = await api('/conversations/direct', { method: 'POST', token: a.token, body: { userId: b.id } });
  return r.json.conversation.id;
}

export const say = (token, conversationId, body) =>
  api(`/messages/${conversationId}`, { method: 'POST', token, body: { body, type: 'text' } });

export const adminToken = async () =>
  (
    await api('/admin/sign-in', {
      method: 'POST',
      body: { username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD },
    })
  ).json.token;

/** The forced-sign-out check allows one second of grace; wait past it. */
export const settle = (ms = 1500) => new Promise((r) => setTimeout(r, ms));
