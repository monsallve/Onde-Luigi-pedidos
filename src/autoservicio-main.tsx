import { createRoot } from 'react-dom/client';
import { SelfServiceApp } from './SelfServiceApp';
import './index.css';

window.addEventListener('vite:preloadError', () => {
  window.location.reload();
});

if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js', { scope: './' })
      .catch((err) => {
        console.warn('Autoservicio SW registration skipped:', err);
      });
  });
}

createRoot(document.getElementById('root')!).render(<SelfServiceApp />);
