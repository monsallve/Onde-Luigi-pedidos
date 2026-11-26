/* Isolated Service Worker exclusively for O'NDE LUIGI Autoservicio PWA (/autoservicio/ scope) */

const CACHE_VERSION = 'v4';
const SHELL_CACHE = `ondeluigi-autoservicio-shell-${CACHE_VERSION}`;
const ASSET_CACHE = `ondeluigi-autoservicio-assets-${CACHE_VERSION}`;
const FONT_CACHE = `ondeluigi-autoservicio-fonts-${CACHE_VERSION}`;
const ACTIVE_CACHES = new Set([SHELL_CACHE, ASSET_CACHE, FONT_CACHE]);

const BUILD_PRECACHE_ASSETS = /* @__AUTOSERVICIO_PRECACHE__ */ [];

const CORE_SHELL_PATHS = [
  './',
  './index.html',
  './manifest-autoservicio.webmanifest',
  './pwa-192x192.png',
  './pwa-512x512.png',
  './pwa-maskable-512x512.png',
  './apple-touch-icon.png',
  './icon.svg',
  '../onde-luigi-logo.png',
];

function isBypassedFirebaseOrApiHost(hostname) {
  return (
    hostname.endsWith('googleapis.com') ||
    hostname.endsWith('gstatic.com') ||
    hostname.endsWith('firebaseio.com') ||
    hostname.endsWith('firebaseapp.com') ||
    hostname.endsWith('firebasestorage.app') ||
    hostname.endsWith('cloudfunctions.net')
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
          .filter((key) => key.startsWith('ondeluigi-autoservicio-') && !ACTIVE_CACHES.has(key))
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
      '<!doctype html><html lang="es"><body style="background:#0A0A0A;color:#fff;font-family:sans-serif;padding:24px;text-align:center"><h2>Sin conexión</h2><p>Conéctate a internet para enviar pedidos en O\'NDE LUIGI Autoservicio.</p></body></html>',
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

  // Cache Google Fonts stylesheets and webfont files safely
  if (
    url.hostname === 'fonts.googleapis.com' ||
    url.hostname === 'fonts.gstatic.com'
  ) {
    event.respondWith(cacheFirst(request, FONT_CACHE));
    return;
  }

  // Never intercept or cache Firestore, Firebase Storage, Auth, or external APIs
  if (isBypassedFirebaseOrApiHost(url.hostname)) {
    return;
  }

  if (url.origin !== self.location.origin) {
    return;
  }

  const scopeUrl = self.registration.scope;
  const scopePath = new URL(scopeUrl).pathname;

  // Handle navigation strictly within /autoservicio/ scope
  if (request.mode === 'navigate') {
    if (!url.pathname.startsWith(scopePath)) {
      event.respondWith(Response.redirect(scopeUrl, 302));
      return;
    }
    event.respondWith(networkFirstNavigation(request, scopeUrl));
    return;
  }

  // Never cache POS files or POS service worker
  if (
    url.pathname === '/' ||
    /\/pos(\/|$)/i.test(url.pathname) ||
    url.pathname.endsWith('/sw-notifications.js') ||
    url.pathname.endsWith('/sw-pos.js') ||
    url.pathname.endsWith('/manifest-pos.webmanifest')
  ) {
    return;
  }

  // Cache Vite hashed build chunks (/assets/*.js, /assets/*.css) fast
  if (/\/assets\/.+\.(js|css|woff2?|svg|png|jpg|jpeg|webp)$/i.test(url.pathname)) {
    event.respondWith(cacheFirst(request, ASSET_CACHE));
    return;
  }

  // Stale-while-revalidate for /autoservicio/ assets, manifest, and /menu/ product photos
  if (
    url.pathname.startsWith(scopePath) ||
    url.pathname.endsWith('/manifest-autoservicio.webmanifest') ||
    /\/menu\/.+\.(png|jpg|jpeg|webp|svg)$/i.test(url.pathname)
  ) {
    event.respondWith(staleWhileRevalidate(request, ASSET_CACHE));
  }
});
