/* Nook service worker — push notifications + an offline shell. */

// Bumping this name is what evicts an old cache: `activate` deletes every key
// that is not the current one. It must change whenever the caching rules do.
const SHELL = 'nook-shell-v2';

// '/' is deliberately absent. It is the same document as /index.html, and
// having it precached under its own key is what let a stale copy be served.
const ASSETS = ['/index.html', '/logo.svg', '/favicon.svg', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/**
 * Two strategies, split on one question: is the URL content-addressed?
 *
 * Files under /assets are emitted by Vite with a hash of their contents in the
 * name, so a given URL can never mean two different things. Those are safe to
 * serve from cache forever.
 *
 * Everything else — above all `/index.html`, which is the document that names
 * the current bundle hash — must come from the network first. Serving that
 * from cache pins the app to whichever build the visitor happened to see
 * first, and because this file's own bytes rarely change between deploys, the
 * `install` handler does not re-run and the stale copy is never refreshed. The
 * result is a user stuck on an old build with no way to escape but a manual
 * unregister.
 */
const immutable = (url) => url.pathname.startsWith('/assets/');

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    // Keep the offline fallback current, so it is the last good shell rather
    // than the first one ever seen.
    if (response.ok && request.mode === 'navigate') {
      const copy = response.clone();
      caches.open(SHELL).then((cache) => cache.put('/index.html', copy));
    }
    return response;
  } catch (err) {
    const cached = await caches.match(request, { ignoreSearch: true });
    if (cached) return cached;
    if (request.mode === 'navigate') {
      const shell = await caches.match('/index.html');
      if (shell) return shell;
    }
    throw err;
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const copy = response.clone();
    caches.open(SHELL).then((cache) => cache.put(request, copy));
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/socket.io')) return;
  if (url.pathname === '/sw.js') return;

  event.respondWith(immutable(url) ? cacheFirst(request) : networkFirst(request));
});

/* ── push ─────────────────────────────────────────────────────────────────── */

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'Nook', body: event.data ? event.data.text() : '' };
  }

  const options = {
    body: data.body || '',
    icon: data.icon || '/logo.svg',
    badge: '/favicon.svg',
    tag: data.tag || 'nook',
    renotify: true,
    data: { conversationId: data.conversationId, messageId: data.messageId },
    actions: data.urgent
      ? [{ action: 'open', title: 'Answer' }]
      : [
          { action: 'reply', title: 'Reply' },
          { action: 'read', title: 'Mark read' },
        ],
    vibrate: data.urgent ? [200, 100, 200, 100, 200] : [90, 40, 90],
  };

  event.waitUntil(self.registration.showNotification(data.title || 'Nook', options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const conversationId = event.notification.data?.conversationId;
  const target = conversationId ? `/?c=${conversationId}` : '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          client.postMessage({ type: 'open-conversation', conversationId, action: event.action });
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    })
  );
});
