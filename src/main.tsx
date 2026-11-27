import { createRoot } from 'react-dom/client';
import './index.css';
import {
  buildPublicAutoservicioLink,
  extractSafeOrderIdFromUrl,
  isInsidePosPath,
  resolvePosBasePath,
  shouldPosRedirectToAutoservicio,
} from './utils/autoservicioRouteGuard';
import { installGlobalInputExecutionGuard } from './utils/inputSecurity';
import { syncDynamicManifestLink } from './utils/pwaManifest';

installGlobalInputExecutionGuard();

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
} else if (
  typeof window !== 'undefined' &&
  !isInsidePosPath(window.location.pathname)
) {
  const targetPosPath = resolvePosBasePath(window.location.pathname);
  window.location.replace(`${targetPosPath}${window.location.search}${window.location.hash}`);
} else {
  if (typeof document !== 'undefined' && typeof window !== 'undefined') {
    syncDynamicManifestLink(document, window.location.pathname);
  }

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
          const isPosSw =
            /\/pos\/sw-pos\.js$/i.test(scriptPath) && /\/pos\/$/i.test(scopePath);

          // Unregister legacy root "/" SWs or sw-notifications.js so root scope never swallows /autoservicio/
          if (!isAutoservicioSw && !isPosSw) {
            void reg.unregister();
          }
        }
      })
      .catch(() => {});

    navigator.serviceWorker.register('./sw-pos.js', { scope: './' }).catch(() => {});
  }

  void import('./App.tsx').then(({ default: App }) => {
    createRoot(document.getElementById('root')!).render(<App />);
  });
}
