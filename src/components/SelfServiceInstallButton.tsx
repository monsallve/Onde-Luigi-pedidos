import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, MoreVertical, Share, Smartphone, X } from 'lucide-react';
import { isInsideAutoservicioPath } from '../utils/autoservicioRouteGuard';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

function useSelfServicePwaInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isAndroid, setIsAndroid] = useState(false);

  useEffect(() => {
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    setIsInstalled(isStandalone);

    const ua = window.navigator.userAgent.toLowerCase();
    setIsIOS(/iphone|ipad|ipod/.test(ua));
    setIsAndroid(/android/.test(ua));

    // Only capture beforeinstallprompt inside the isolated /autoservicio/ scope
    if (!isInsideAutoservicioPath(window.location.pathname)) {
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

export const SelfServiceInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, isAndroid, install } = useSelfServicePwaInstall();
  const [guideOpen, setGuideOpen] = useState(false);

  useEffect(() => {
    if (!guideOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setGuideOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [guideOpen]);

  // Automatically suppress install button when already running in standalone PWA mode
  if (isInstalled) {
    return null;
  }

  const handleTriggerInstall = async () => {
    if (isInstallable) {
      const accepted = await install();
      if (!accepted && (isIOS || isAndroid)) {
        setGuideOpen(true);
      }
      return;
    }
    setGuideOpen(true);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => void handleTriggerInstall()}
        aria-label="Instalar aplicación de Autoservicio O'NDE LUIGI"
        className="min-h-[38px] px-2.5 sm:px-3 rounded-xl border border-[#27272E] bg-[#1C1C22] text-xs font-semibold text-zinc-200 hover:border-amber-500/80 hover:text-amber-300 inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
      >
        {isInstallable ? (
          <Download className="w-3.5 h-3.5 text-amber-400 shrink-0" />
        ) : (
          <Smartphone className="w-3.5 h-3.5 text-amber-400 shrink-0" />
        )}
        <span className="hidden sm:inline">Instalar Autoservicio</span>
        <span className="sm:hidden">Instalar</span>
      </button>

      {guideOpen &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-sm sm:p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="self-pwa-guide-title"
            onClick={() => setGuideOpen(false)}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="w-full sm:max-w-md max-h-[90vh] overflow-y-auto rounded-t-3xl sm:rounded-2xl bg-[#141418] text-white p-5 shadow-2xl border border-[#27272E] space-y-4"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <h3
                    id="self-pwa-guide-title"
                    className="font-poster text-xl font-extrabold text-white tracking-wide uppercase"
                  >
                    INSTALAR AUTOSERVICIO
                  </h3>
                  <p className="text-[11px] text-zinc-400">
                    Accede directo a nuestra carta y a tu turno desde la pantalla de inicio.
                  </p>
                </div>
                <button
                  type="button"
                  aria-label="Cerrar guía de instalación"
                  onClick={() => setGuideOpen(false)}
                  className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-zinc-400 hover:bg-[#1C1C22] hover:text-white shrink-0"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-3">
                {/* iOS Safari Guide */}
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
                      <strong className="text-white">1.</strong> Toca el botón{' '}
                      <strong className="text-white inline-flex items-center gap-1">
                        Compartir <Share className="w-3.5 h-3.5 text-amber-400 inline" />
                      </strong>{' '}
                      en la barra de Safari.
                    </li>
                    <li>
                      <strong className="text-white">2.</strong> Elige{' '}
                      <strong className="text-white">Agregar a inicio</strong>.
                    </li>
                    <li>
                      <strong className="text-white">3.</strong> Toca{' '}
                      <strong className="text-white">Agregar</strong> arriba a la derecha.
                    </li>
                  </ol>
                </div>

                {/* Android Chrome / Edge Guide */}
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
                      <strong className="text-white">1.</strong> Toca el menú{' '}
                      <strong className="text-white inline-flex items-center gap-0.5">
                        <MoreVertical className="w-3.5 h-3.5 text-amber-400 inline" /> Más opciones
                      </strong>{' '}
                      arriba a la derecha.
                    </li>
                    <li>
                      <strong className="text-white">2.</strong> Pulsa{' '}
                      <strong className="text-white">Instalar aplicación</strong> o{' '}
                      <strong className="text-white">Agregar a pantalla principal</strong>.
                    </li>
                  </ol>
                </div>

                {!isIOS && !isAndroid && (
                  <p className="text-[11px] text-zinc-400 leading-relaxed px-1">
                    En computador (Chrome o Edge), usa el ícono de instalar en la barra de direcciones para abrir el Autoservicio como ventana independiente.
                  </p>
                )}
              </div>

              <button
                type="button"
                onClick={() => setGuideOpen(false)}
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
