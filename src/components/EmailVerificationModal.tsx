import React, { useEffect, useState } from 'react';
import { CheckCircle2, Eye, MailCheck, RefreshCw, Send, X } from 'lucide-react';
import { usePosStore } from '../services/posStore';
import { resolveAssetUrl } from '../utils/orderMath';
import { EMAIL_VERIFICATION_COMPANY_NAME } from '../utils/verificationEmailTemplate';

interface Props {
  open: boolean;
  onClose: () => void;
}

export const EmailVerificationModal: React.FC<Props> = ({ open, onClose }) => {
  const {
    firebaseUser,
    myLinkedStaff,
    emailVerified,
    sendVerificationEmail,
    refreshEmailVerification,
  } = usePosStore();

  const [sending, setSending] = useState(false);
  const [checking, setChecking] = useState(false);
  const [sentSuccess, setSentSuccess] = useState(false);
  const [showTemplatePreview, setShowTemplatePreview] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setStatusMsg(null);
      setErrorMsg(null);
      setSentSuccess(false);
      return;
    }
    const handleBackIntercept = (e: Event) => {
      e.preventDefault();
      onClose();
    };
    window.addEventListener('ondeluigi:back-intercept', handleBackIntercept);
    return () => window.removeEventListener('ondeluigi:back-intercept', handleBackIntercept);
  }, [open, onClose]);

  if (!open) return null;

  const displayName = myLinkedStaff?.name || firebaseUser?.displayName || 'Usuario';
  const email = firebaseUser?.email || myLinkedStaff?.linkedEmail || '';

  const handleSend = async () => {
    setSending(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      await sendVerificationEmail();
      setSentSuccess(true);
      setStatusMsg(
        `Correo de verificación enviado${email ? ` a ${email}` : ''}. Revisa tu bandeja de entrada o carpeta de spam y haz clic en el enlace.`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('too-many-requests')) {
        setErrorMsg('Ya enviamos un correo hace un momento. Espera un minuto antes de reenviarlo.');
      } else {
        setErrorMsg(msg || 'No se pudo enviar el correo de verificación.');
      }
    } finally {
      setSending(false);
    }
  };

  const handleRefreshStatus = async () => {
    setChecking(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const verified = await refreshEmailVerification();
      if (verified) {
        setStatusMsg(`¡Correo verificado exitosamente para ${EMAIL_VERIFICATION_COMPANY_NAME}!`);
      } else {
        setErrorMsg('Aún aparece pendiente. Abre el enlace que llegó a tu correo e inténtalo de nuevo.');
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'No se pudo comprobar el estado.');
    } finally {
      setChecking(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-sm sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="verify-email-modal-title"
    >
      <div className="w-full sm:max-w-md bg-[#141418] text-white rounded-t-3xl sm:rounded-2xl border border-[#27272E] shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
        <div className="px-5 py-4 border-b border-[#27272E] flex items-center justify-between bg-[#101014]">
          <div className="flex items-center gap-3 min-w-0">
            <img
              src={resolveAssetUrl('/onde-luigi-logo.png')}
              alt="Logo O'NDE LUIGI"
              className="w-9 h-9 rounded-full border border-red-600 object-cover shrink-0"
            />
            <div className="min-w-0">
              <h2 id="verify-email-modal-title" className="font-poster text-xl font-extrabold tracking-wide uppercase truncate">
                VERIFICAR CORREO
              </h2>
              <p className="text-[11px] font-semibold text-amber-400">
                Verificación oficial · {EMAIL_VERIFICATION_COMPANY_NAME}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar verificación de correo"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-zinc-400 hover:bg-[#1C1C22] hover:text-white shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-4">
          {errorMsg && (
            <div role="alert" className="rounded-xl bg-red-950/60 border border-red-700 px-3.5 py-2.5 text-xs font-medium text-red-200">
              {errorMsg}
            </div>
          )}

          {statusMsg && (
            <div role="status" className="rounded-xl bg-emerald-950/60 border border-emerald-700 px-3.5 py-2.5 text-xs font-medium text-emerald-200">
              {statusMsg}
            </div>
          )}

          <div className="rounded-xl border border-[#27272E] bg-[#0A0A0A] p-4 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-zinc-400">Usuario</span>
              <span className="text-sm font-bold text-white truncate">{displayName}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-zinc-400">Correo</span>
              <span className="text-xs font-mono text-zinc-200 truncate">{email || 'Cuenta registrada'}</span>
            </div>
            <div className="flex items-center justify-between gap-2 pt-1 border-t border-[#27272E]">
              <span className="text-xs text-zinc-400">Estado</span>
              {emailVerified ? (
                <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-400">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Verificado</span>
                </span>
              ) : (
                <span className="text-xs font-bold text-amber-400">Pendiente de verificación</span>
              )}
            </div>
          </div>

          {!emailVerified ? (
            <>
              <p className="text-xs sm:text-sm text-zinc-300 leading-relaxed">
                Tu usuario permanente ya está guardado. Envía un enlace de verificación
                {email ? (
                  <>
                    {' '}a <strong className="text-white">{email}</strong>
                  </>
                ) : null}{' '}
                para confirmar que tu correo pertenece a{' '}
                <strong className="text-amber-400">{EMAIL_VERIFICATION_COMPANY_NAME}</strong>.
              </p>

              <div className="space-y-2.5">
                <button
                  type="button"
                  disabled={sending}
                  onClick={handleSend}
                  className="w-full min-h-[46px] rounded-xl bg-amber-500 text-black text-sm font-bold hover:bg-amber-400 disabled:opacity-60 flex items-center justify-center gap-2 transition-colors"
                >
                  <Send className="w-4 h-4" />
                  <span>
                    {sending
                      ? 'Enviando correo...'
                      : sentSuccess
                        ? 'Reenviar correo de verificación'
                        : 'Enviar correo de verificación'}
                  </span>
                </button>

                <button
                  type="button"
                  disabled={checking}
                  onClick={handleRefreshStatus}
                  className="w-full min-h-[44px] rounded-xl border border-[#27272E] bg-[#1C1C22] text-xs font-bold text-white hover:border-zinc-500 disabled:opacity-60 flex items-center justify-center gap-2 transition-colors"
                >
                  <RefreshCw className={`w-4 h-4 text-amber-400 ${checking ? 'animate-spin' : ''}`} />
                  <span>{checking ? 'Comprobando...' : 'Ya abrí el enlace · Comprobar estado'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setShowTemplatePreview((prev) => !prev)}
                  className="w-full min-h-[38px] rounded-xl border border-[#27272E] bg-[#0A0A0A] text-xs font-semibold text-zinc-300 hover:text-white flex items-center justify-center gap-1.5"
                >
                  <Eye className="w-3.5 h-3.5 text-amber-400" />
                  <span>
                    {showTemplatePreview
                      ? 'Ocultar vista previa del mensaje'
                      : `Vista previa de verificación (${EMAIL_VERIFICATION_COMPANY_NAME})`}
                  </span>
                </button>
              </div>

              {showTemplatePreview && (
                <div className="rounded-xl border border-[#27272E] bg-[#0A0A0A] overflow-hidden">
                  <div className="px-4 py-3 bg-[#101014] border-b-2 border-red-600 flex items-center gap-2.5">
                    <img
                      src={resolveAssetUrl('/onde-luigi-logo.png')}
                      alt="Logo O'NDE LUIGI"
                      className="w-8 h-8 rounded-full border border-red-600 object-cover shrink-0"
                    />
                    <div>
                      <p className="font-poster text-sm font-extrabold text-white tracking-wide leading-none">
                        {EMAIL_VERIFICATION_COMPANY_NAME}
                      </p>
                      <p className="text-[10px] font-bold text-amber-400 uppercase mt-0.5">
                        Verificación oficial de cuenta
                      </p>
                    </div>
                  </div>
                  <div className="p-4 space-y-2 text-xs text-zinc-300">
                    <p>
                      Hola <strong className="text-white">{displayName}</strong>,
                    </p>
                    <p>
                      Esta es la verificación de correo electrónico para{' '}
                      <strong className="text-amber-400">{EMAIL_VERIFICATION_COMPANY_NAME}</strong>.
                    </p>
                    <div className="pt-1">
                      <span className="inline-block px-3 py-1.5 rounded-lg bg-amber-500 text-black text-[11px] font-bold">
                        Verificar mi correo en {EMAIL_VERIFICATION_COMPANY_NAME}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              <button
                type="button"
                onClick={onClose}
                className="w-full min-h-[40px] rounded-xl text-xs font-semibold text-zinc-400 hover:text-white"
              >
                Verificar más tarde
              </button>
            </>
          ) : (
            <div className="space-y-3">
              <div className="rounded-xl border border-emerald-700/60 bg-emerald-950/30 p-3.5 text-xs text-emerald-200 flex items-center gap-2.5">
                <MailCheck className="w-5 h-5 text-emerald-400 shrink-0" />
                <span>Tu correo electrónico ya está verificado para {EMAIL_VERIFICATION_COMPANY_NAME}.</span>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="w-full min-h-[44px] rounded-xl bg-amber-500 text-black text-sm font-bold hover:bg-amber-400"
              >
                Continuar
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
