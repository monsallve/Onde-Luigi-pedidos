import React, { useEffect, useRef, useState } from 'react';
import { WifiOff } from 'lucide-react';
import { ErrorBoundary } from './components/ErrorBoundary';
import {
  buildIsolatedAutoservicioUrl,
  extractSafeOrderIdFromUrl,
  isDisallowedPosOrAdminNavigation,
  resolveAutoservicioBasePath,
} from './utils/autoservicioRouteGuard';
import { SelfServiceView } from './views/SelfServiceView';

const SelfServiceOfflineIndicator: React.FC = () => {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  if (isOnline) return null;

  return (
    <div
      role="status"
      className="fixed bottom-4 left-4 z-40 flex items-center gap-2 rounded-xl bg-amber-500 px-3.5 py-2 text-xs font-bold text-neutral-950 shadow-xl border border-amber-300/40"
    >
      <WifiOff className="w-4 h-4 shrink-0" />
      <span>Sin conexión — Conéctate para enviar tu pedido</span>
    </div>
  );
};

export const SelfServiceApp: React.FC = () => {
  const canonicalBasePathRef = useRef<string>(
    typeof window !== 'undefined'
      ? resolveAutoservicioBasePath(window.location.pathname)
      : '/autoservicio/'
  );

  const [initialOrderId, setInitialOrderId] = useState<string | undefined>(() => {
    if (typeof window === 'undefined') return undefined;
    return extractSafeOrderIdFromUrl({
      search: window.location.search,
      hash: window.location.hash,
    });
  });

  useEffect(() => {
    const enforceAutoservicioIsolation = () => {
      if (typeof window === 'undefined') return;
      const current = {
        pathname: window.location.pathname,
        search: window.location.search,
        hash: window.location.hash,
      };
      const orderId = extractSafeOrderIdFromUrl(current);
      if (orderId) {
        setInitialOrderId(orderId);
      }

      if (isDisallowedPosOrAdminNavigation(current)) {
        const safeRelativeUrl = buildIsolatedAutoservicioUrl(
          window.location.href,
          canonicalBasePathRef.current
        );
        try {
          window.history.replaceState(window.history.state, '', safeRelativeUrl);
        } catch {
          window.location.replace(safeRelativeUrl);
        }
      }
    };

    enforceAutoservicioIsolation();
    window.addEventListener('popstate', enforceAutoservicioIsolation);
    window.addEventListener('hashchange', enforceAutoservicioIsolation);
    return () => {
      window.removeEventListener('popstate', enforceAutoservicioIsolation);
      window.removeEventListener('hashchange', enforceAutoservicioIsolation);
    };
  }, []);

  return (
    <ErrorBoundary>
      <SelfServiceView initialOrderId={initialOrderId} />
      <SelfServiceOfflineIndicator />
    </ErrorBoundary>
  );
};
