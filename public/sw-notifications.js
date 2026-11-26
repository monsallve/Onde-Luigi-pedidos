/* Service Worker notification handlers for O'NDE LUIGI POS */

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  if (!event.data) return;
  let payload = {};
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "O'NDE LUIGI", body: event.data.text() };
  }

  const title = payload.title || "O'NDE LUIGI · Alerta POS";
  const options = {
    body: payload.body || payload.message || 'Nueva actualización en tiempo real.',
    icon: './pwa-192x192.png',
    badge: './pwa-192x192.png',
    tag: payload.tag || payload.id || 'ondeluigi-push',
    renotify: true,
    silent: false,
    vibrate: [180, 70, 180],
    data: payload.data || { url: './' },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || data.type !== 'SHOW_LOCAL_NOTIFICATION') return;
  const { title, options } = data.payload || {};
  if (!title) return;
  event.waitUntil(self.registration.showNotification(title, options || {}));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const payload = event.notification.data || {};
  const targetUrl = payload.url || './';

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if ('focus' in client) {
            client.focus();
            client.postMessage({
              type: 'ONDE_LUIGI_NOTIF_CLICK',
              payload,
            });
            return;
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
        return undefined;
      })
  );
});
