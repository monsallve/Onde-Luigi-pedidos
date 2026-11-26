/* Legacy root notification SW stub: self-cleans so "/" never hijacks /pos/ or /autoservicio/ PWA scopes */
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      try {
        await self.registration.unregister();
      } catch {
        // ignore
      }
      const clients = await self.clients.matchAll({ type: 'window' });
      for (const client of clients) {
        if ('navigate' in client) {
          // leave active pages undisturbed
        }
      }
    })()
  );
});
