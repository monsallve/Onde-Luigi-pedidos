import React, { useEffect, useState } from 'react';
import { Download, Share, Smartphone, X } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    setIsInstalled(isStandalone);

    const ua = window.navigator.userAgent.toLowerCase();
    setIsIOS(/iphone|ipad|ipod/.test(ua));

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
    install,
  };
}

export const PWAInstallButton: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={install}
        aria-label="Instalar aplicación O'NDE LUIGI"
        className="min-h-[40px] flex items-center gap-2 rounded-lg bg-amber-500 px-3 py-2 text-xs font-bold text-black hover:bg-amber-400 transition-colors whitespace-nowrap shrink-0"
      >
        <Download className="w-4 h-4 shrink-0" />
        <span>{compact ? 'Instalar' : 'Instalar App'}</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          aria-label="Cómo instalar en iPhone o iPad"
          className="min-h-[40px] flex items-center gap-1.5 rounded-lg border border-[#27272E] bg-[#1C1C22] px-3 py-1.5 text-xs font-semibold text-white hover:border-zinc-500 transition-colors whitespace-nowrap shrink-0"
        >
          <Smartphone className="w-4 h-4 text-amber-400 shrink-0" />
          <span>{compact ? 'Instalar' : 'Instalar iOS'}</span>
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
            <div className="w-full max-w-sm rounded-2xl bg-[#141418] text-white p-6 shadow-2xl border border-[#27272E]">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-poster text-xl font-extrabold text-white tracking-wide">
                  INSTALAR EN IPHONE / IPAD
                </h3>
                <button
                  type="button"
                  aria-label="Cerrar guía de instalación"
                  onClick={() => setShowIOSGuide(false)}
                  className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-zinc-400 hover:bg-[#1C1C22]"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <ol className="space-y-3 text-sm text-zinc-300">
                <li className="flex items-start gap-2.5">
                  <span className="font-mono font-bold text-amber-400">1.</span>
                  <span>
                    En Safari, toca el botón <strong>Compartir</strong>{' '}
                    <Share className="w-4 h-4 inline text-zinc-300" /> en la barra inferior.
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="font-mono font-bold text-amber-400">2.</span>
                  <span>
                    Desliza hacia abajo y selecciona <strong>Agregar a inicio</strong>.
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="font-mono font-bold text-amber-400">3.</span>
                  <span>
                    Confirma en <strong>Agregar</strong> para abrir O&apos;NDE LUIGI a pantalla completa.
                  </span>
                </li>
              </ol>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="mt-5 w-full min-h-[44px] rounded-xl bg-amber-500 text-black text-sm font-bold hover:bg-amber-400 transition-colors"
              >
                Entendido
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};
