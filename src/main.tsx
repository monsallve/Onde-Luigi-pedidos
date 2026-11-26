import { createRoot } from 'react-dom/client';
import './index.css';
import {
  buildPublicAutoservicioLink,
  extractSafeOrderIdFromUrl,
  shouldPosRedirectToAutoservicio,
} from './utils/autoservicioRouteGuard';

window.addEventListener('vite:preloadError', () => {
  window.location.reload();
});

const shouldRedirectToSelfService =
  typeof window !== 'undefined' &&
  shouldPosRedirectToAutoservicio({
    pathname: window.location.pathname,
    search: window.location.search,
    hash: window.location.hash,
  });

if (shouldRedirectToSelfService) {
  const orderId = extractSafeOrderIdFromUrl({
    search: window.location.search,
    hash: window.location.hash,
  });
  window.location.replace(buildPublicAutoservicioLink(window.location.href, orderId));
} else {
  if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
    navigator.serviceWorker
      .getRegistrations()
      .then((registrations) => {
        for (const reg of registrations) {
          const scriptUrl =
            reg.active?.scriptURL || reg.installing?.scriptURL || reg.waiting?.scriptURL || '';
          let scopePath = '';
          let scriptPath = '';
          try {
            scopePath = new URL(reg.scope).pathname;
            scriptPath = scriptUrl ? new URL(scriptUrl).pathname : '';
          } catch {
            // ignore invalid URLs
          }
          const isAutoservicioSw =
            /\/autoservicio\/sw\.js$/i.test(scriptPath) || /\/autoservicio\/?$/i.test(scopePath);
          const isNotificationsSw = /\/sw-notifications\.js$/i.test(scriptPath);
          if (!isAutoservicioSw && !isNotificationsSw) {
            void reg.unregister();
          }
        }
      })
      .catch(() => {});

    navigator.serviceWorker.register('./sw-notifications.js', { scope: './' }).catch(() => {});
  }

  void import('./App.tsx').then(({ default: App }) => {
    createRoot(document.getElementById('root')!).render(<App />);
  });
}
