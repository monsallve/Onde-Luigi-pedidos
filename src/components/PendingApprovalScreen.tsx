import React, { useEffect, useState } from 'react';
import {
  Ban,
  Clock,
  Lock,
  LogOut,
  MailCheck,
  RefreshCw,
  ShieldAlert,
  UserCheck,
} from 'lucide-react';
import { usePosStore } from '../services/posStore';
import { assertSafeTextInput } from '../utils/inputSecurity';
import { resolveAssetUrl } from '../utils/orderMath';

export const PendingApprovalScreen: React.FC = () => {
  const {
    accessStatus,
    accessRequest,
    firebaseUser,
    emailVerified,
    sendVerificationEmail,
    refreshEmailVerification,
    updatePendingRequestedName,
    refreshAccessApprovalStatus,
    signOutSession,
  } = usePosStore();

  const [nameDraft, setNameDraft] = useState(
    accessRequest?.requestedName || firebaseUser?.displayName || ''
  );
  const [savingName, setSavingName] = useState(false);
  const [checking, setChecking] = useState(false);
  const [verifyingEmail, setVerifyingEmail] = useState(false);
  const [statusNotice, setStatusNotice] = useState<{ type: 'ok' | 'err'; text: string } | null>(
    null
  );

  useEffect(() => {
    if (accessRequest?.requestedName) {
      setNameDraft(accessRequest.requestedName);
    } else if (firebaseUser?.displayName) {
      setNameDraft(firebaseUser.displayName);
    }
  }, [accessRequest?.requestedName, firebaseUser?.displayName]);

  const handleSaveName = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatusNotice(null);
    setSavingName(true);
    try {
      const cleanName = assertSafeTextInput(nameDraft, 'Nombre completo', {
        maxLen: 80,
        required: true,
      });
      await updatePendingRequestedName(cleanName);
      setStatusNotice({
        type: 'ok',
        text: 'Tu nombre fue actualizado para que el administrador revise tu solicitud.',
      });
    } catch (err) {
      setStatusNotice({
        type: 'err',
        text: err instanceof Error ? err.message : 'No se pudo actualizar tu nombre.',
      });
    } finally {
      setSavingName(false);
    }
  };

  const handleCheckApproval = async () => {
    setChecking(true);
    setStatusNotice(null);
    try {
      await refreshEmailVerification().catch(() => false);
      refreshAccessApprovalStatus();
      setStatusNotice({
        type: 'ok',
        text: 'Estado actualizado. Si el administrador ya te asignó un rol, entrarás automáticamente.',
      });
    } finally {
      window.setTimeout(() => setChecking(false), 600);
    }
  };

  const handleSendVerifyEmail = async () => {
    setVerifyingEmail(true);
    setStatusNotice(null);
    try {
      await sendVerificationEmail();
      setStatusNotice({
        type: 'ok',
        text: 'Te enviamos un correo de verificación. Ábrelo y luego pulsa "Comprobar aprobación".',
      });
    } catch (err) {
      setStatusNotice({
        type: 'err',
        text: err instanceof Error ? err.message : 'No se pudo enviar el correo de verificación.',
      });
    } finally {
      setVerifyingEmail(false);
    }
  };

  const isRejected = accessStatus === 'rejected';
  const isDeactivated = accessStatus === 'deactivated';

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white flex flex-col justify-between p-4 sm:p-6">
      <header className="max-w-3xl w-full mx-auto flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <img
            src={resolveAssetUrl('/onde-luigi-logo.webp')}
            alt="Logo O'NDE LUIGI"
            className="w-10 h-10 rounded-full border-2 border-red-600 object-cover shrink-0"
          />
          <div>
            <span className="font-poster text-xl font-extrabold tracking-wide text-white block leading-none">
              O&apos;NDE LUIGI
            </span>
            <span className="text-[11px] font-medium text-amber-400">
              Control de Acceso · POS
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={() => void signOutSession()}
          className="min-h-[40px] px-3.5 rounded-xl border border-[#27272E] bg-[#141418] text-xs font-semibold text-zinc-200 hover:border-red-500/60 hover:text-white inline-flex items-center gap-1.5"
        >
          <LogOut className="w-3.5 h-3.5 text-red-400" />
          <span>Cambiar cuenta</span>
        </button>
      </header>

      <main className="max-w-lg w-full mx-auto my-auto py-8">
        <div className="rounded-2xl border border-[#27272E] bg-[#141418] p-6 sm:p-8 shadow-2xl space-y-5">
          <div className="flex items-start gap-3.5">
            <div
              className={`w-12 h-12 rounded-2xl border flex items-center justify-center shrink-0 ${
                isRejected
                  ? 'bg-red-950/60 border-red-700 text-red-400'
                  : isDeactivated
                    ? 'bg-zinc-900 border-zinc-700 text-zinc-300'
                    : 'bg-amber-500/15 border-amber-500/50 text-amber-400'
              }`}
            >
              {isRejected ? (
                <Ban className="w-6 h-6" />
              ) : isDeactivated ? (
                <Lock className="w-6 h-6" />
              ) : (
                <Clock className="w-6 h-6" />
              )}
            </div>

            <div className="min-w-0">
              <span
                className={`inline-block text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded border mb-1.5 ${
                  isRejected
                    ? 'bg-red-950/60 border-red-700 text-red-300'
                    : isDeactivated
                      ? 'bg-zinc-900 border-zinc-700 text-zinc-300'
                      : 'bg-amber-500/15 border-amber-500/50 text-amber-300'
                }`}
              >
                {isRejected
                  ? 'Solicitud rechazada'
                  : isDeactivated
                    ? 'Cuenta desactivada'
                    : 'En espera de rol'}
              </span>
              <h1 className="font-poster text-2xl font-extrabold tracking-wide text-white uppercase">
                {isRejected
                  ? 'ACCESO NO AUTORIZADO'
                  : isDeactivated
                    ? 'ACCESO SUSPENDIDO'
                    : 'ESPERANDO ASIGNACIÓN DE ROL'}
              </h1>
              <p className="text-xs sm:text-sm text-zinc-300 mt-1 leading-relaxed">
                {isRejected
                  ? 'Un administrador rechazó esta solicitud de acceso al sistema POS.'
                  : isDeactivated
                    ? 'Tu usuario fue desactivado por un administrador. Comunícate con el encargado del local para reactivarlo.'
                    : 'Tu cuenta fue registrada correctamente. Por seguridad, debes esperar en esta pantalla hasta que un administrador apruebe tu acceso y te asigne tu rol (Mesero, Caja, Cocina o Administrador).'}
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-[#27272E] bg-[#0A0A0A] p-3.5 space-y-1.5 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="text-zinc-400">Cuenta conectada</span>
              <span className="font-mono text-zinc-100 truncate">
                {firebaseUser?.email || accessRequest?.email || 'Sin correo'}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-zinc-400">Estado de correo</span>
              <span className={emailVerified ? 'text-emerald-400 font-bold' : 'text-amber-400 font-bold'}>
                {emailVerified ? 'Verificado' : 'Sin verificar'}
              </span>
            </div>
            {isRejected && accessRequest?.rejectionReason && (
              <div className="pt-2 mt-1 border-t border-[#27272E] text-red-300">
                <strong className="block text-[11px] uppercase text-red-400">Motivo:</strong>
                <span>{accessRequest.rejectionReason}</span>
              </div>
            )}
          </div>

          {statusNotice && (
            <div
              role="status"
              className={`rounded-xl border px-3.5 py-2.5 text-xs font-medium ${
                statusNotice.type === 'ok'
                  ? 'bg-emerald-950/60 border-emerald-700 text-emerald-200'
                  : 'bg-red-950/60 border-red-700 text-red-200'
              }`}
            >
              {statusNotice.text}
            </div>
          )}

          {!isRejected && !isDeactivated && (
            <form onSubmit={handleSaveName} className="space-y-2.5 rounded-xl border border-[#27272E] bg-[#0A0A0A] p-4">
              <label
                htmlFor="pending-requested-name"
                className="block text-xs font-semibold text-zinc-200"
              >
                Nombre para identificar tu solicitud
              </label>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  id="pending-requested-name"
                  type="text"
                  maxLength={80}
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  placeholder="Ej. Gabriela Cárdenas"
                  className="flex-1 min-h-[42px] rounded-xl border border-[#27272E] bg-[#141418] px-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
                <button
                  type="submit"
                  disabled={savingName}
                  className="min-h-[42px] px-4 rounded-xl border border-amber-500/60 bg-amber-500/15 text-amber-300 text-xs font-bold hover:bg-amber-500/25 whitespace-nowrap disabled:opacity-60 inline-flex items-center justify-center gap-1.5"
                >
                  <UserCheck className="w-4 h-4" />
                  <span>{savingName ? 'Guardando...' : 'Guardar nombre'}</span>
                </button>
              </div>
              <p className="text-[11px] text-zinc-400 leading-relaxed">
                Las notificaciones del sistema y el acceso al POS se activarán automáticamente apenas un administrador apruebe tu cuenta.
              </p>
            </form>
          )}

          {!emailVerified && !isRejected && !isDeactivated && (
            <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 flex items-center justify-between gap-2.5">
              <div className="flex items-center gap-2 min-w-0">
                <MailCheck className="w-4 h-4 text-amber-400 shrink-0" />
                <span className="text-xs text-amber-200">
                  Verifica tu correo electrónico mientras esperas aprobación.
                </span>
              </div>
              <button
                type="button"
                disabled={verifyingEmail}
                onClick={() => void handleSendVerifyEmail()}
                className="min-h-[34px] px-3 rounded-lg bg-amber-500 text-black text-[11px] font-bold hover:bg-amber-400 shrink-0 disabled:opacity-60"
              >
                {verifyingEmail ? 'Enviando...' : 'Verificar'}
              </button>
            </div>
          )}

          <div className="rounded-xl border border-[#27272E] bg-[#101014] px-3.5 py-2.5 flex items-start gap-2 text-[11px] text-zinc-400">
            <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <span>
              Esta pantalla bloquea el acceso de cuentas sin rol aprobado y evita la recepción de notificaciones internas hasta que estés activo.
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
            <button
              type="button"
              disabled={checking}
              onClick={() => void handleCheckApproval()}
              className="min-h-[44px] px-4 rounded-xl bg-amber-500 text-black text-xs sm:text-sm font-bold hover:bg-amber-400 disabled:opacity-60 inline-flex items-center justify-center gap-2"
            >
              <RefreshCw className={`w-4 h-4 ${checking ? 'animate-spin' : ''}`} />
              <span>{checking ? 'Comprobando...' : 'Comprobar aprobación'}</span>
            </button>

            <button
              type="button"
              onClick={() => void signOutSession()}
              className="min-h-[44px] px-4 rounded-xl border border-[#27272E] bg-[#1C1C22] text-xs sm:text-sm font-semibold text-zinc-200 hover:border-zinc-500 inline-flex items-center justify-center gap-2"
            >
              <LogOut className="w-4 h-4" />
              <span>Cerrar sesión</span>
            </button>
          </div>
        </div>
      </main>

      <footer className="max-w-3xl w-full mx-auto text-center text-[11px] text-zinc-500">
        O&apos;NDE LUIGI · Seguridad por aprobación y asignación de roles
      </footer>
    </div>
  );
};
