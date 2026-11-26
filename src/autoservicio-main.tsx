import { createRoot } from 'react-dom/client';
import { SelfServiceApp } from './SelfServiceApp';
import { syncDynamicManifestLink } from './utils/pwaManifest';
import './index.css';

window.addEventListener('vite:preloadError', () => {
  window.location.reload();
});

if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  syncDynamicManifestLink(document, window.location.pathname);
}

if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    // Clean up any legacy root "/" or sw-notifications.js registration so it never shadows /autoservicio/
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
            // ignore
          }
          const isLegacyRootSw =
            scopePath === '/' || /\/sw-notifications\.js$/i.test(scriptPath);
          if (isLegacyRootSw) {
            void reg.unregister();
          }
        }
      })
      .catch(() => {});

    navigator.serviceWorker
      .register('./sw.js', { scope: './' })
      .catch((err) => {
        console.warn('Autoservicio SW registration skipped:', err);
      });
  });
}

createRoot(document.getElementById('root')!).render(<SelfServiceApp />);
