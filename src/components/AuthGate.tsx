import React, { useState } from 'react';
import { Cloud, Lock, Mail, Play, ShieldCheck, UserCheck } from 'lucide-react';
import { usePosStore } from '../services/posStore';
import { PWAInstallButton } from './PWAInstallBanner';
import { resolveAssetUrl } from '../utils/assetPath';

export const AuthGate: React.FC = () => {
  const {
    isFirebaseConfigured,
    configSource,
    projectId,
    signInWithGoogle,
    signInWithEmail,
    enterDemoMode,
  } = usePosStore();

  const [showEmailForm, setShowEmailForm] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleGoogleLogin = async () => {
    setBusy(true);
    setErrorMsg(null);
    try {
      await signInWithGoogle();
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'No se pudo iniciar sesión con Google.'
      );
    } finally {
      setBusy(false);
    }
  };

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      setErrorMsg('Ingresa correo y contraseña del personal.');
      return;
    }
    setBusy(true);
    setErrorMsg(null);
    try {
      await signInWithEmail(email, password);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('operation-not-allowed')) {
        setErrorMsg(
          'El inicio con correo/contraseña aún no está habilitado en Firebase Console. Usa Google o entra en Modo Demo.'
        );
      } else if (msg.includes('invalid-credential') || msg.includes('wrong-password')) {
        setErrorMsg('Correo o contraseña incorrectos.');
      } else {
        setErrorMsg(msg);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white flex flex-col justify-between p-4 sm:p-6 lg:p-10">
      <header className="max-w-5xl w-full mx-auto flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <img
            src={resolveAssetUrl('/onde-luigi-logo.png')}
            alt="Logo O'NDE LUIGI"
            className="w-11 h-11 rounded-full border-2 border-red-600 object-cover shrink-0"
          />
          <div>
            <span className="font-poster text-2xl font-extrabold tracking-wide text-white block leading-none">
              O&apos;NDE LUIGI
            </span>
            <span className="text-[11px] font-medium text-amber-400">
              Sistema Interno · Pedidos y Caja
            </span>
          </div>
        </div>
        <PWAInstallButton />
      </header>

      <main className="max-w-5xl w-full mx-auto my-auto py-8 grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
        <div className="lg:col-span-6 space-y-5">
          <div className="overflow-hidden rounded-2xl border border-[#27272E] bg-black">
            <img
              src={resolveAssetUrl('/onde-luigi-banner.jpg')}
              alt="O'NDE LUIGI Hamburguesas y Comida Rápida"
              className="w-full aspect-[2.15/1] object-contain bg-black"
            />
          </div>

          <div className="flex items-center gap-2 text-xs font-semibold text-amber-400">
            <Lock className="w-3.5 h-3.5 text-red-500" />
            <span>Uso Exclusivo del Personal</span>
            <span aria-hidden="true">·</span>
            <span>Android, iPhone y PC</span>
          </div>

          <h1
            className="font-poster text-4xl sm:text-5xl font-extrabold tracking-tight text-white leading-[1.02]"
            style={{ textWrap: 'balance' }}
          >
            TOMA DE PEDIDOS ÁGIL, RECETAS Y SALSAS EN VIVO
          </h1>

          <p className="text-sm sm:text-base text-zinc-300 leading-relaxed max-w-xl">
            Elige varios productos al instante, retira ingredientes no deseados unidad por unidad,
            selecciona de 1 a 4 salsas y controla pagos, comprobantes e inventario desde un solo lugar.
          </p>
        </div>

        <div className="lg:col-span-6">
          <div className="bg-[#141418] border border-[#27272E] rounded-2xl p-6 sm:p-8 shadow-2xl max-w-md mx-auto w-full space-y-5">
            <div>
              <h2 className="font-poster text-2xl font-extrabold text-white tracking-wide">
                ACCESO DEL EQUIPO
              </h2>
              <p className="text-xs sm:text-sm text-zinc-400 mt-1">
                Solo la cuenta Administradora edita recetas, salsas y bebidas. Los meseros toman pedidos y confirman pagos o cancelaciones.
              </p>
            </div>

            {errorMsg && (
              <div
                role="alert"
                className="rounded-xl bg-red-950/60 border border-red-700/70 px-3.5 py-2.5 text-xs font-medium text-red-200"
              >
                {errorMsg}
              </div>
            )}

            <div className="space-y-3">
              {isFirebaseConfigured && (
                <>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleGoogleLogin}
                    className="w-full min-h-[48px] flex items-center justify-center gap-2.5 rounded-xl bg-amber-500 text-black text-sm font-bold hover:bg-amber-400 disabled:opacity-60 transition-colors"
                  >
                    <ShieldCheck className="w-4 h-4" />
                    <span>{busy ? 'Conectando...' : 'Ingresar con Google (Nube Firebase)'}</span>
                  </button>

                  {!showEmailForm ? (
                    <button
                      type="button"
                      onClick={() => setShowEmailForm(true)}
                      className="w-full min-h-[44px] flex items-center justify-center gap-2 rounded-xl border border-[#27272E] bg-[#1C1C22] text-zinc-200 text-sm font-medium hover:bg-[#23232B] transition-colors"
                    >
                      <Mail className="w-4 h-4 text-amber-400" />
                      <span>Ingresar con correo y contraseña</span>
                    </button>
                  ) : (
                    <form onSubmit={handleEmailLogin} className="space-y-3 pt-2 border-t border-[#27272E]">
                      <div>
                        <label
                          htmlFor="staff-email"
                          className="block text-xs font-medium text-zinc-300 mb-1"
                        >
                          Correo del personal
                        </label>
                        <input
                          id="staff-email"
                          type="email"
                          autoComplete="email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          placeholder="mesero@ondeluigi.com"
                          className="w-full min-h-[44px] rounded-xl border border-[#27272E] bg-[#0A0A0A] px-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                        />
                      </div>
                      <div>
                        <label
                          htmlFor="staff-password"
                          className="block text-xs font-medium text-zinc-300 mb-1"
                        >
                          Contraseña
                        </label>
                        <input
                          id="staff-password"
                          type="password"
                          autoComplete="current-password"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          placeholder="••••••••"
                          className="w-full min-h-[44px] rounded-xl border border-[#27272E] bg-[#0A0A0A] px-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="submit"
                          disabled={busy}
                          className="flex-1 min-h-[44px] rounded-xl bg-amber-500 text-black text-sm font-bold hover:bg-amber-400 disabled:opacity-60 transition-colors"
                        >
                          Iniciar sesión
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowEmailForm(false)}
                          className="min-h-[44px] px-3 rounded-xl border border-[#27272E] text-xs font-medium text-zinc-300 hover:bg-[#1C1C22]"
                        >
                          Volver
                        </button>
                      </div>
                    </form>
                  )}
                </>
              )}

              <div className="relative flex py-1 items-center">
                <div className="flex-grow border-t border-[#27272E]" />
                <span className="shrink mx-3 text-xs text-zinc-400">o prueba inmediata local</span>
                <div className="flex-grow border-t border-[#27272E]" />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={() => enterDemoMode('admin')}
                  className="min-h-[48px] px-3 flex items-center justify-center gap-2 rounded-xl bg-red-600 text-white text-xs font-bold hover:bg-red-500 transition-colors"
                >
                  <Play className="w-4 h-4 fill-current shrink-0" />
                  <span>Demo Administrador</span>
                </button>
                <button
                  type="button"
                  onClick={() => enterDemoMode('mesero')}
                  className="min-h-[48px] px-3 flex items-center justify-center gap-2 rounded-xl border border-[#27272E] bg-[#1C1C22] text-zinc-100 text-xs font-bold hover:bg-[#27272F] transition-colors"
                >
                  <UserCheck className="w-4 h-4 text-amber-400 shrink-0" />
                  <span>Demo Mesero</span>
                </button>
              </div>
            </div>

            <div className="pt-3 border-t border-[#27272E] flex items-center justify-between text-xs text-zinc-400">
              <span className="flex items-center gap-1.5">
                <Cloud className="w-3.5 h-3.5 text-amber-400" />
                {isFirebaseConfigured
                  ? `Firebase (${configSource === 'env' ? '.env' : projectId})`
                  : 'Firebase sin claves (.env)'}
              </span>
              <span>O&apos;NDE LUIGI POS</span>
            </div>
          </div>
        </div>
      </main>

      <footer className="max-w-5xl w-full mx-auto text-center text-xs text-zinc-500">
        O&apos;NDE LUIGI · Operación interna de pedidos, recetas, salsas y ventas
      </footer>
    </div>
  );
};
