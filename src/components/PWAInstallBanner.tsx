import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, MoreVertical, Share, Smartphone, X } from 'lucide-react';
import { isInsidePosPath } from '../utils/autoservicioRouteGuard';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isAndroid, setIsAndroid] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    setIsInstalled(isStandalone);

    const ua = window.navigator.userAgent.toLowerCase();
    setIsIOS(/iphone|ipad|ipod/.test(ua));
    setIsAndroid(/android/.test(ua));

    // Only capture beforeinstallprompt when inside the isolated /pos/ scope
    if (!isInsidePosPath(window.location.pathname)) {
      return;
    }

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const onInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const install = async () => {
    if (!deferredPrompt) return false;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setIsInstalled(true);
      setDeferredPrompt(null);
      return true;
    }
    return false;
  };

  return {
    isInstallable: Boolean(deferredPrompt),
    isInstalled,
    isIOS,
    isAndroid,
    install,
  };
}

export const PWAInstallButton: React.FC<{
  compact?: boolean;
  alwaysShowGuideOption?: boolean;
}> = ({ compact = false, alwaysShowGuideOption = false }) => {
  const { isInstallable, isInstalled, isIOS, isAndroid, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (!isInstallable && !isIOS && !alwaysShowGuideOption) {
    return null;
  }

  const handleClick = async () => {
    if (isInstallable) {
      const accepted = await install();
      if (!accepted && (isIOS || isAndroid)) {
        setShowGuide(true);
      }
      return;
    }
    setShowGuide(true);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => void handleClick()}
        aria-label="Instalar App POS O'NDE LUIGI"
        className={
          isInstallable
            ? 'min-h-[36px] flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-bold text-black hover:bg-amber-400 transition-colors whitespace-nowrap shrink-0'
            : 'min-h-[36px] flex items-center gap-1.5 rounded-lg border border-[#27272E] bg-[#141418] px-3 py-1.5 text-xs font-semibold text-zinc-200 hover:border-amber-500/80 hover:text-amber-300 transition-colors whitespace-nowrap shrink-0'
        }
      >
        {isInstallable ? (
          <Download className="w-3.5 h-3.5 shrink-0" />
        ) : (
          <Smartphone className="w-3.5 h-3.5 text-amber-400 shrink-0" />
        )}
        <span>{compact ? 'App POS' : 'Instalar App POS'}</span>
      </button>

      {showGuide &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-sm sm:p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pos-pwa-guide-title"
            onClick={() => setShowGuide(false)}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="w-full sm:max-w-md max-h-[90vh] overflow-y-auto rounded-t-3xl sm:rounded-2xl bg-[#141418] text-white p-5 shadow-2xl border border-[#27272E] space-y-4"
            >
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h3
                    id="pos-pwa-guide-title"
                    className="font-poster text-xl font-extrabold text-white tracking-wide uppercase"
                  >
                    INSTALAR APP POS
                  </h3>
                  <p className="text-[11px] text-zinc-400">
                    Instala O&apos;NDE LUIGI POS como aplicación independiente (coexiste con Autoservicio).
                  </p>
                </div>
                <button
                  type="button"
                  aria-label="Cerrar guía de instalación POS"
                  onClick={() => setShowGuide(false)}
                  className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-zinc-400 hover:bg-[#1C1C22] hover:text-white shrink-0"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-3">
                <div
                  className={`rounded-xl border p-3.5 space-y-2 ${
                    isIOS
                      ? 'border-amber-500/70 bg-amber-500/10'
                      : 'border-[#27272E] bg-[#0A0A0A]'
                  }`}
                >
                  <p className="text-xs font-extrabold uppercase tracking-wider text-amber-400">
                    iPhone / iPad (Safari)
                  </p>
                  <ol className="space-y-1.5 text-xs text-zinc-300">
                    <li>
                      <strong className="text-white">1.</strong> Toca{' '}
                      <strong className="text-white inline-flex items-center gap-1">
                        Compartir <Share className="w-3.5 h-3.5 text-amber-400 inline" />
                      </strong>{' '}
                      en Safari.
                    </li>
                    <li>
                      <strong className="text-white">2.</strong> Elige{' '}
                      <strong className="text-white">Agregar a inicio</strong>.
                    </li>
                    <li>
                      <strong className="text-white">3.</strong> Pulsa{' '}
                      <strong className="text-white">Agregar</strong> para guardar Luigi POS.
                    </li>
                  </ol>
                </div>

                <div
                  className={`rounded-xl border p-3.5 space-y-2 ${
                    isAndroid && !isIOS
                      ? 'border-amber-500/70 bg-amber-500/10'
                      : 'border-[#27272E] bg-[#0A0A0A]'
                  }`}
                >
                  <p className="text-xs font-extrabold uppercase tracking-wider text-amber-400">
                    Android (Chrome / Edge)
                  </p>
                  <ol className="space-y-1.5 text-xs text-zinc-300">
                    <li>
                      <strong className="text-white">1.</strong> Toca{' '}
                      <strong className="text-white inline-flex items-center gap-0.5">
                        <MoreVertical className="w-3.5 h-3.5 text-amber-400 inline" /> Más opciones
                      </strong>{' '}
                      en el navegador.
                    </li>
                    <li>
                      <strong className="text-white">2.</strong> Selecciona{' '}
                      <strong className="text-white">Instalar aplicación</strong>.
                    </li>
                  </ol>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowGuide(false)}
                className="w-full min-h-[44px] rounded-xl bg-amber-500 text-black text-sm font-extrabold hover:bg-amber-400 transition-colors"
              >
                Entendido
              </button>
            </div>
          </div>,
          document.body
        )}
    </>
  );
};
