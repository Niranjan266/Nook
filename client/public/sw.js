/* Nook service worker — push notifications + an offline shell. */

const SHELL = 'nook-shell-v1';
const ASSETS = ['/', '/index.html', '/logo.svg', '/favicon.svg', '/manifest.webmanifest'];

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

/* Network-first for navigation so the app is never stale; cache is the fallback. */
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/socket.io')) return;

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match('/index.html')));
    return;
  }

  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ||
        fetch(request).then((response) => {
          if (response.ok && url.pathname.startsWith('/assets')) {
            const copy = response.clone();
            caches.open(SHELL).then((cache) => cache.put(request, copy));
          }
          return response;
        })
    )
  );
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
