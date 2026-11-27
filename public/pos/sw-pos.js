/* Isolated Service Worker exclusively for O'NDE LUIGI POS PWA (/pos/ scope) */

const CACHE_VERSION = 'v5';
const SHELL_CACHE = `ondeluigi-pos-shell-${CACHE_VERSION}`;
const ASSET_CACHE = `ondeluigi-pos-assets-${CACHE_VERSION}`;
const FONT_CACHE = `ondeluigi-pos-fonts-${CACHE_VERSION}`;
const MEDIA_CACHE = `ondeluigi-pos-media-${CACHE_VERSION}`;
const MAX_MEDIA_CACHE_ENTRIES = 150;
const ACTIVE_CACHES = new Set([SHELL_CACHE, ASSET_CACHE, FONT_CACHE, MEDIA_CACHE]);

const BUILD_PRECACHE_ASSETS = /* @__POS_PRECACHE__ */ [];

const CORE_SHELL_PATHS = [
  './',
  './index.html',
  './manifest-pos.webmanifest',
  './pwa-192x192.png',
  './pwa-512x512.png',
  './pwa-maskable-512x512.png',
  './apple-touch-icon.png',
  './icon.svg',
  '../onde-luigi-logo.webp',
  '../onde-luigi-banner.webp',
  '../menu/doble_todo.webp',
  '../menu/especial.webp',
  '../menu/mixta.webp',
  '../menu/pollo.webp',
  '../menu/queso.webp',
  '../menu/sencilla.webp',
  '../menu/tocineta.webp',
];

function isFirebaseStorageMediaRequest(url, request) {
  const isStorageHost =
    url.hostname === 'firebasestorage.googleapis.com' ||
    url.hostname.endsWith('.firebasestorage.app');
  if (!isStorageHost) return false;
  return url.searchParams.get('alt') === 'media' || request.destination === 'image';
}

function isBypassedFirebaseOrApiHost(hostname) {
  return (
    hostname.endsWith('googleapis.com') ||
    hostname.endsWith('gstatic.com') ||
    hostname.endsWith('firebaseio.com') ||
    hostname.endsWith('firebaseapp.com') ||
    hostname.endsWith('firebasestorage.app') ||
    hostname.endsWith('cloudfunctions.net') ||
    hostname.endsWith('google.com')
  );
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const scopeUrl = self.registration.scope;
      const shellCache = await caches.open(SHELL_CACHE);
      const urlsToCache = Array.from(
        new Set([...CORE_SHELL_PATHS, ...BUILD_PRECACHE_ASSETS])
      ).map((rel) => new URL(rel, scopeUrl).toString());

      await Promise.allSettled(
        urlsToCache.map(async (targetUrl) => {
          try {
            const res = await fetch(targetUrl, {
              cache: 'reload',
              credentials: 'same-origin',
            });
            if (res && res.ok) {
              await shellCache.put(targetUrl, res);
            }
          } catch {
            // Ignore transient precache miss in dev/offline
          }
        })
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith('ondeluigi-pos-') && !ACTIVE_CACHES.has(key))
          .map((key) => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});

async function networkFirstNavigation(request, scopeUrl) {
  const shellCache = await caches.open(SHELL_CACHE);
  const shellFallbackUrl = new URL('./index.html', scopeUrl).toString();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4500);
    const networkResponse = await fetch(request, { signal: controller.signal });
    clearTimeout(timer);
    if (networkResponse && networkResponse.ok) {
      await shellCache.put(shellFallbackUrl, networkResponse.clone());
    }
    return networkResponse;
  } catch {
    const cached =
      (await shellCache.match(shellFallbackUrl)) ||
      (await shellCache.match(new URL('./', scopeUrl).toString()));
    if (cached) return cached;
    return new Response(
      '<!doctype html><html lang="es"><body style="background:#0A0A0A;color:#fff;font-family:sans-serif;padding:24px;text-align:center"><h2>Sin conexión</h2><p>Conéctate a internet para sincronizar pedidos en O\'NDE LUIGI POS.</p></body></html>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && (response.ok || response.type === 'opaque')) {
    await cache.put(request, response.clone());
  }
  return response;
}

async function trimCache(cache, maxEntries) {
  try {
    const keys = await cache.keys();
    if (keys.length <= maxEntries) return;
    const excess = keys.length - maxEntries;
    await Promise.all(keys.slice(0, excess).map((key) => cache.delete(key)));
  } catch {
    // ignore quota trim errors
  }
}

async function cacheFirstBounded(request, cacheName, maxEntries = MAX_MEDIA_CACHE_ENTRIES) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && (response.ok || response.type === 'opaque')) {
    await cache.put(request, response.clone());
    await trimCache(cache, maxEntries);
  }
  return response;
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const networkPromise = fetch(request)
    .then(async (response) => {
      if (response && response.ok) {
        await cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  if (cached) return cached;
  const networkRes = await networkPromise;
  return networkRes || Response.error();
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  if (
    url.hostname === 'fonts.googleapis.com' ||
    url.hostname === 'fonts.gstatic.com'
  ) {
    event.respondWith(cacheFirst(request, FONT_CACHE));
    return;
  }

  // Cache immutable Firebase Storage images persistently on-device to save Spark egress
  if (isFirebaseStorageMediaRequest(url, request)) {
    event.respondWith(cacheFirstBounded(request, MEDIA_CACHE, MAX_MEDIA_CACHE_ENTRIES));
    return;
  }

  if (isBypassedFirebaseOrApiHost(url.hostname)) {
    return;
  }

  if (url.origin !== self.location.origin) {
    return;
  }

  if (url.pathname.startsWith('/__/auth/') || /\/autoservicio(\/|$)/i.test(url.pathname)) {
    return;
  }

  const scopeUrl = self.registration.scope;
  const scopePath = new URL(scopeUrl).pathname;

  if (request.mode === 'navigate') {
    if (url.pathname.startsWith(scopePath)) {
      event.respondWith(networkFirstNavigation(request, scopeUrl));
    }
    return;
  }

  if (/\/assets\/.+\.(js|css|woff2?|svg|png|jpg|jpeg|webp)$/i.test(url.pathname)) {
    event.respondWith(cacheFirst(request, ASSET_CACHE));
    return;
  }

  if (
    /\/menu\/.+\.(png|jpg|jpeg|webp|svg)$/i.test(url.pathname) ||
    /\/onde-luigi-(?:logo|banner)\.(webp|png|jpg|jpeg)$/i.test(url.pathname)
  ) {
    event.respondWith(cacheFirstBounded(request, MEDIA_CACHE, MAX_MEDIA_CACHE_ENTRIES));
    return;
  }

  if (
    url.pathname.startsWith(scopePath) ||
    url.pathname.endsWith('/manifest-pos.webmanifest')
  ) {
    event.respondWith(staleWhileRevalidate(request, ASSET_CACHE));
  }
});

/* POS Real-Time Push & Notification Handlers (FCM + Web Push) */
self.addEventListener('push', (event) => {
  if (!event.data) return;
  let payload = {};
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "O'NDE LUIGI · POS", body: event.data.text() };
  }

  const notif = payload.notification || {};
  const data = payload.data || {};
  const title = notif.title || payload.title || data.title || "O'NDE LUIGI · Alerta POS";
  const body =
    notif.body ||
    payload.body ||
    payload.message ||
    data.body ||
    'Nueva actualización en tiempo real.';
  const scopeUrl = self.registration.scope;
  const iconUrl = new URL('./pwa-192x192.png', scopeUrl).toString();
  const targetUrl =
    (payload.fcmOptions && payload.fcmOptions.link) || data.url || './';

  const options = {
    body,
    icon: notif.icon || iconUrl,
    badge: iconUrl,
    tag: data.notificationId || payload.tag || payload.id || 'ondeluigi-push',
    renotify: true,
    silent: false,
    requireInteraction: data.type === 'nueva_comanda' || data.type === 'venta_anulada',
    vibrate: data.type === 'venta_anulada' ? [220, 80, 220] : [180, 70, 180],
    data: {
      ...data,
      url: targetUrl,
    },
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
  const scopeUrl = self.registration.scope;
  const targetUrl = new URL(payload.url || './', scopeUrl).toString();

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if (client.url && client.url.startsWith(scopeUrl) && 'focus' in client) {
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
