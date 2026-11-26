import React, { useState } from 'react';
import { ArrowLeft, KeyRound, Lock, Mail, ShieldCheck, UserPlus } from 'lucide-react';
import { usePosStore } from '../services/posStore';
import { resolveAssetUrl } from '../utils/orderMath';

type AuthMode = 'login' | 'register' | 'reset';

function mapAuthError(err: unknown, fallback: string): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes('operation-not-allowed')) {
    return 'El acceso con correo y contraseña aún no está habilitado en el servidor. Inicia sesión con Google o pide al administrador habilitarlo.';
  }
  if (msg.includes('invalid-credential') || msg.includes('wrong-password') || msg.includes('user-not-found')) {
    return 'Correo o contraseña incorrectos.';
  }
  if (msg.includes('email-already-in-use')) {
    return 'Este correo ya está registrado. Inicia sesión o recupera tu contraseña.';
  }
  if (msg.includes('weak-password')) {
    return 'La contraseña debe tener al menos 6 caracteres.';
  }
  if (msg.includes('invalid-email')) {
    return 'Ingresa un correo electrónico válido.';
  }
  if (msg.includes('popup-closed-by-user')) {
    return 'Se cerró la ventana de acceso antes de completar el ingreso.';
  }
  return msg || fallback;
}

export const AuthGate: React.FC = () => {
  const {
    isFirebaseConfigured,
    signInWithGoogle,
    signInWithEmail,
    registerWithEmail,
    resetPassword,
  } = usePosStore();

  const [mode, setMode] = useState<AuthMode>('login');
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const switchMode = (next: AuthMode) => {
    setMode(next);
    setErrorMsg(null);
    setSuccessMsg(null);
    if (next !== 'login') {
      setShowEmailForm(true);
    }
  };

  const handleGoogleLogin = async () => {
    setBusy(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      await signInWithGoogle();
    } catch (err) {
      setErrorMsg(mapAuthError(err, 'No se pudo iniciar sesión con Google.'));
    } finally {
      setBusy(false);
    }
  };

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      setErrorMsg('Ingresa tu correo y contraseña.');
      return;
    }
    setBusy(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      await signInWithEmail(email, password);
    } catch (err) {
      setErrorMsg(mapAuthError(err, 'No se pudo iniciar sesión.'));
    } finally {
      setBusy(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim()) {
      setErrorMsg('Ingresa tu nombre completo.');
      return;
    }
    if (!email.trim() || !password) {
      setErrorMsg('Completa tu correo y una contraseña (mínimo 6 caracteres).');
      return;
    }
    if (password.length < 6) {
      setErrorMsg('La contraseña debe tener al menos 6 caracteres.');
      return;
    }
    if (password !== confirmPassword) {
      setErrorMsg('Las contraseñas no coinciden.');
      return;
    }
    setBusy(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      await registerWithEmail(fullName, email, password);
    } catch (err) {
      setErrorMsg(mapAuthError(err, 'No se pudo registrar la cuenta.'));
    } finally {
      setBusy(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      setErrorMsg('Ingresa el correo con el que te registraste.');
      return;
    }
    setBusy(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      await resetPassword(email);
      setSuccessMsg(
        'Te enviamos un enlace para restablecer tu contraseña. Revisa tu bandeja de entrada o spam.'
      );
    } catch (err) {
      setErrorMsg(mapAuthError(err, 'No se pudo enviar el correo de recuperación.'));
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
            Toma pedidos en segundos, personaliza recetas y salsas unidad por unidad,
            y lleva el control de comandas, pagos y comprobantes desde cualquier dispositivo.
          </p>
        </div>

        <div className="lg:col-span-6">
          <div className="bg-[#141418] border border-[#27272E] rounded-2xl p-6 sm:p-8 shadow-2xl max-w-md mx-auto w-full space-y-5">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="font-poster text-2xl font-extrabold text-white tracking-wide">
                  {mode === 'login'
                    ? 'INICIAR SESIÓN'
                    : mode === 'register'
                      ? 'CREAR CUENTA'
                      : 'RECUPERAR CONTRASEÑA'}
                </h2>
                <p className="text-xs sm:text-sm text-zinc-400 mt-1">
                  {mode === 'login'
                    ? 'Ingresa con tu cuenta de Google o con correo y contraseña.'
                    : mode === 'register'
                      ? 'Crea tu cuenta para entrar, elegir tu nombre permanente y verificar tu correo.'
                      : 'Te enviaremos un correo para definir una nueva contraseña.'}
                </p>
              </div>
              {mode !== 'login' && (
                <button
                  type="button"
                  onClick={() => switchMode('login')}
                  aria-label="Volver a iniciar sesión"
                  className="min-h-[38px] px-2.5 rounded-lg border border-[#27272E] bg-[#1C1C22] text-xs font-semibold text-zinc-200 hover:bg-[#23232B] flex items-center gap-1 shrink-0"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Volver</span>
                </button>
              )}
            </div>

            {errorMsg && (
              <div
                role="alert"
                className="rounded-xl bg-red-950/60 border border-red-700/70 px-3.5 py-2.5 text-xs font-medium text-red-200"
              >
                {errorMsg}
              </div>
            )}

            {successMsg && (
              <div
                role="status"
                className="rounded-xl bg-emerald-950/60 border border-emerald-700/70 px-3.5 py-2.5 text-xs font-medium text-emerald-200"
              >
                {successMsg}
              </div>
            )}

            {!isFirebaseConfigured ? (
              <div className="rounded-xl border border-red-700/60 bg-red-950/40 p-4 text-xs text-red-200">
                El servicio de acceso aún no está disponible. Contacta al administrador del local.
              </div>
            ) : mode === 'login' ? (
              <div className="space-y-3">
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleGoogleLogin}
                  className="w-full min-h-[48px] flex items-center justify-center gap-2.5 rounded-xl bg-amber-500 text-black text-sm font-bold hover:bg-amber-400 disabled:opacity-60 transition-colors"
                >
                  <ShieldCheck className="w-4 h-4" />
                  <span>{busy ? 'Conectando...' : 'Ingresar con Google'}</span>
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
                        Correo electrónico
                      </label>
                      <input
                        id="staff-email"
                        type="email"
                        autoComplete="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="tu.correo@gmail.com"
                        className="w-full min-h-[44px] rounded-xl border border-[#27272E] bg-[#0A0A0A] px-3 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
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
                        className="w-full min-h-[44px] rounded-xl border border-[#27272E] bg-[#0A0A0A] px-3 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
                      />
                    </div>
                    <div className="flex items-center justify-end">
                      <button
                        type="button"
                        onClick={() => switchMode('reset')}
                        className="text-xs font-semibold text-amber-400 hover:underline"
                      >
                        ¿Olvidaste tu contraseña?
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="submit"
                        disabled={busy}
                        className="flex-1 min-h-[44px] rounded-xl bg-amber-500 text-black text-sm font-bold hover:bg-amber-400 disabled:opacity-60 transition-colors"
                      >
                        {busy ? 'Ingresando...' : 'Iniciar sesión'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowEmailForm(false)}
                        className="min-h-[44px] px-3 rounded-xl border border-[#27272E] text-xs font-medium text-zinc-300 hover:bg-[#1C1C22]"
                      >
                        Cerrar
                      </button>
                    </div>
                  </form>
                )}

                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-[#27272E]">
                  <button
                    type="button"
                    onClick={() => switchMode('register')}
                    className="min-h-[42px] px-3 rounded-xl border border-[#27272E] bg-[#1C1C22] text-xs font-semibold text-zinc-200 hover:border-zinc-500 flex items-center justify-center gap-1.5"
                  >
                    <UserPlus className="w-3.5 h-3.5 text-amber-400" />
                    <span>Registrarse</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => switchMode('reset')}
                    className="min-h-[42px] px-3 rounded-xl border border-[#27272E] bg-[#1C1C22] text-xs font-semibold text-zinc-200 hover:border-zinc-500 flex items-center justify-center gap-1.5"
                  >
                    <KeyRound className="w-3.5 h-3.5 text-amber-400" />
                    <span>Recuperar clave</span>
                  </button>
                </div>
              </div>
            ) : mode === 'register' ? (
              <form onSubmit={handleRegister} className="space-y-3">
                <div>
                  <label htmlFor="reg-name" className="block text-xs font-medium text-zinc-300 mb-1">
                    Nombre completo
                  </label>
                  <input
                    id="reg-name"
                    type="text"
                    autoComplete="name"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Ej. Gabriela Cárdenas"
                    className="w-full min-h-[44px] rounded-xl border border-[#27272E] bg-[#0A0A0A] px-3 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>
                <div>
                  <label htmlFor="reg-email" className="block text-xs font-medium text-zinc-300 mb-1">
                    Correo electrónico
                  </label>
                  <input
                    id="reg-email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="tu.correo@gmail.com"
                    className="w-full min-h-[44px] rounded-xl border border-[#27272E] bg-[#0A0A0A] px-3 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>
                <div>
                  <label htmlFor="reg-password" className="block text-xs font-medium text-zinc-300 mb-1">
                    Contraseña (mínimo 6 caracteres)
                  </label>
                  <input
                    id="reg-password"
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full min-h-[44px] rounded-xl border border-[#27272E] bg-[#0A0A0A] px-3 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>
                <div>
                  <label htmlFor="reg-confirm" className="block text-xs font-medium text-zinc-300 mb-1">
                    Confirmar contraseña
                  </label>
                  <input
                    id="reg-confirm"
                    type="password"
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full min-h-[44px] rounded-xl border border-[#27272E] bg-[#0A0A0A] px-3 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>
                <button
                  type="submit"
                  disabled={busy}
                  className="w-full min-h-[46px] rounded-xl bg-amber-500 text-black text-sm font-bold hover:bg-amber-400 disabled:opacity-60 transition-colors"
                >
                  {busy ? 'Creando cuenta...' : 'Crear cuenta'}
                </button>
              </form>
            ) : (
              <form onSubmit={handleResetPassword} className="space-y-3">
                <div>
                  <label htmlFor="reset-email" className="block text-xs font-medium text-zinc-300 mb-1">
                    Correo electrónico registrado
                  </label>
                  <input
                    id="reset-email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="tu.correo@gmail.com"
                    className="w-full min-h-[44px] rounded-xl border border-[#27272E] bg-[#0A0A0A] px-3 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>
                <button
                  type="submit"
                  disabled={busy}
                  className="w-full min-h-[46px] rounded-xl bg-amber-500 text-black text-sm font-bold hover:bg-amber-400 disabled:opacity-60 transition-colors"
                >
                  {busy ? 'Enviando enlace...' : 'Enviar enlace de recuperación'}
                </button>
              </form>
            )}

            <div className="pt-3 border-t border-[#27272E] flex items-center justify-between text-xs text-zinc-400">
              <span>Acceso sincronizado en la nube</span>
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
