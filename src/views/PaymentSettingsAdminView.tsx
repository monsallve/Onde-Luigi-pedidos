import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  Landmark,
  Lock,
  QrCode,
  RefreshCw,
  Save,
  ShieldAlert,
  Trash2,
  Upload,
} from 'lucide-react';
import { SelfServiceQrCard } from '../components/SelfServiceQrCard';
import { usePosStore } from '../services/posStore';
import type { SelfServicePaymentConfig } from '../types/pos';
import { ROLE_LABELS } from '../utils/rolePermissions';

export const PaymentSettingsAdminView: React.FC = () => {
  const {
    effectiveRole,
    isAdmin,
    permissions,
    selfServiceConfig,
    saveSelfServiceConfig,
    uploadPaymentQrImage,
  } = usePosStore();

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [draft, setDraft] = useState<SelfServicePaymentConfig>(selfServiceConfig);
  const [qrFile, setQrFile] = useState<File | null>(null);
  const [qrPreviewUrl, setQrPreviewUrl] = useState<string>(selfServiceConfig.qrImageUrl || '');
  const [isDirty, setIsDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);

  // Sync live Firestore changes into the form when the admin isn't actively editing unsaved changes
  useEffect(() => {
    if (!isDirty) {
      setDraft(selfServiceConfig);
      setQrPreviewUrl(selfServiceConfig.qrImageUrl || '');
      setQrFile(null);
    }
  }, [selfServiceConfig, isDirty]);

  const canAccessModule = isAdmin && permissions.canManagePaymentSettings;

  const publicUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}${window.location.pathname}?autoservicio=1`
      : '?autoservicio=1';

  const previewConfig = useMemo<SelfServicePaymentConfig>(
    () => ({
      ...draft,
      qrImageUrl: qrPreviewUrl,
      brebKey: draft.brebKey.trim() || '@ONDELUIGI',
      accountHolder: draft.accountHolder.trim() || "O'NDE LUIGI",
      bankName: draft.bankName.trim() || 'Bre-B / Nequi / Bancolombia',
    }),
    [draft, qrPreviewUrl]
  );

  if (!canAccessModule) {
    return (
      <div
        role="alert"
        className="max-w-xl mx-auto my-8 rounded-2xl border border-red-800 bg-red-950/35 p-6 text-center space-y-3"
      >
        <div className="w-12 h-12 rounded-2xl bg-red-900/50 border border-red-700/60 flex items-center justify-center mx-auto">
          <Lock className="w-6 h-6 text-red-300" />
        </div>
        <h1 className="font-poster text-xl font-extrabold text-white tracking-wide uppercase">
          Acceso restringido a Administradores
        </h1>
        <p className="text-sm text-zinc-300 leading-relaxed">
          Tu rol actual ({ROLE_LABELS[effectiveRole]}) no tiene permisos para ver ni modificar la
          configuración de pagos y código QR del Autoservicio.
        </p>
      </div>
    );
  }

  const updateDraft = (patch: Partial<SelfServicePaymentConfig>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
    setIsDirty(true);
    setStatus(null);
  };

  const handleSelectQrFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setStatus({ type: 'err', text: 'Selecciona un archivo de imagen válido (PNG, JPG o WEBP).' });
      return;
    }
    setQrFile(file);
    setIsDirty(true);
    setStatus(null);
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setQrPreviewUrl(reader.result);
      }
    };
    reader.onerror = () => {
      setStatus({ type: 'err', text: 'No se pudo leer la imagen seleccionada para vista previa.' });
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveQrImage = () => {
    setQrFile(null);
    setQrPreviewUrl('');
    setDraft((prev) => ({ ...prev, qrImageUrl: '' }));
    setIsDirty(true);
    setStatus(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleDiscardChanges = () => {
    setDraft(selfServiceConfig);
    setQrFile(null);
    setQrPreviewUrl(selfServiceConfig.qrImageUrl || '');
    setIsDirty(false);
    setStatus(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus(null);

    if (!draft.brebKey.trim()) {
      setStatus({ type: 'err', text: 'La llave de Bre-B es obligatoria.' });
      return;
    }
    if (!draft.accountHolder.trim()) {
      setStatus({ type: 'err', text: 'El nombre del titular es obligatorio.' });
      return;
    }
    if (!draft.bankName.trim()) {
      setStatus({ type: 'err', text: 'El banco o billetera es obligatorio.' });
      return;
    }

    setSaving(true);
    try {
      let nextQrUrl = draft.qrImageUrl;
      let uploadedViaFallback = false;

      if (qrFile) {
        const uploadResult = await uploadPaymentQrImage(qrFile);
        nextQrUrl = uploadResult.imageUrl;
        uploadedViaFallback = uploadResult.usedFallbackInline;
      }

      const nextConfig: SelfServicePaymentConfig = {
        ...draft,
        qrImageUrl: nextQrUrl,
        brebKey: draft.brebKey.trim(),
        accountHolder: draft.accountHolder.trim(),
        bankName: draft.bankName.trim(),
        paymentInstructions: draft.paymentInstructions.trim(),
        deliveryInstructions: draft.deliveryInstructions.trim(),
      };

      await saveSelfServiceConfig(nextConfig);
      setDraft(nextConfig);
      setQrFile(null);
      setQrPreviewUrl(nextConfig.qrImageUrl);
      setIsDirty(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      setStatus({
        type: 'ok',
        text: qrFile
          ? uploadedViaFallback
            ? 'Datos de pago y QR guardados y sincronizados en tiempo real con Autoservicio.'
            : 'Datos de pago e imagen QR subidos a Firebase Storage y sincronizados en tiempo real.'
          : 'Datos de pago guardados y sincronizados en tiempo real con el Autoservicio.',
      });
    } catch (err) {
      setStatus({
        type: 'err',
        text: err instanceof Error ? err.message : 'No se pudieron guardar los datos de pago.',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleCopyPublicLink = async () => {
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopiedLink(true);
      window.setTimeout(() => setCopiedLink(false), 2400);
    } catch {
      setCopiedLink(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 border-b border-[#27272E]">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <QrCode className="w-5 h-5 text-amber-400 shrink-0" />
            <h1 className="font-poster text-xl sm:text-2xl font-extrabold text-white tracking-wide uppercase">
              Datos de Pago y QR (Autoservicio)
            </h1>
          </div>
          <p className="text-xs text-zinc-400">
            Administra el código QR, la llave Bre-B y el titular que ven tus clientes en tiempo real.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleCopyPublicLink}
            className="min-h-[38px] px-3 rounded-xl border border-[#27272E] bg-[#141418] text-xs font-semibold text-zinc-200 hover:border-amber-500 inline-flex items-center gap-1.5"
          >
            {copiedLink ? (
              <Check className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <Copy className="w-3.5 h-3.5 text-amber-400" />
            )}
            <span>{copiedLink ? 'Enlace copiado' : 'Copiar enlace público'}</span>
          </button>

          <a
            href="?autoservicio=1"
            target="_blank"
            rel="noopener noreferrer"
            className="min-h-[38px] px-3 rounded-xl border border-amber-700/70 bg-amber-950/30 text-amber-300 text-xs font-bold hover:bg-amber-950/60 inline-flex items-center gap-1.5"
          >
            <span>Abrir vista cliente</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>

      {/* Main Grid: Form + Live Customer Preview */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        <form
          onSubmit={handleSubmit}
          className="lg:col-span-7 rounded-2xl border border-[#27272E] bg-[#141418] p-4 sm:p-5 space-y-4"
        >
          {/* Active Toggle */}
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[#27272E]">
            <div>
              <p className="text-sm font-bold text-white">Portal público de Autoservicio</p>
              <p className="text-xs text-zinc-400">
                {draft.enabled
                  ? 'Activo: los clientes pueden ver el QR, pagar y enviar pedidos.'
                  : 'Pausado: la carta pública muestra aviso de pedidos pausados.'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => updateDraft({ enabled: !draft.enabled })}
              className={`min-h-[38px] px-4 rounded-xl text-xs font-extrabold border transition-colors ${
                draft.enabled
                  ? 'bg-emerald-950/60 text-emerald-300 border-emerald-700 hover:bg-emerald-950'
                  : 'bg-[#1C1C22] text-zinc-300 border-[#27272E] hover:border-zinc-500'
              }`}
            >
              {draft.enabled ? 'Activo' : 'Pausado'}
            </button>
          </div>

          {status && (
            <div
              role={status.type === 'ok' ? 'status' : 'alert'}
              className={`rounded-xl border px-3.5 py-2.5 text-xs font-semibold flex items-start gap-2 ${
                status.type === 'ok'
                  ? 'bg-emerald-950/60 border-emerald-700 text-emerald-200'
                  : 'bg-red-950/60 border-red-700 text-red-200'
              }`}
            >
              {status.type === 'ok' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              ) : (
                <ShieldAlert className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              )}
              <span>{status.text}</span>
            </div>
          )}

          {/* QR Image Upload + Immediate Preview */}
          <div className="rounded-xl border border-[#27272E] bg-[#0A0A0A] p-3.5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-amber-400">
                Imagen del Código QR
              </span>
              {qrFile ? (
                <span className="px-2 py-0.5 rounded bg-amber-500/15 border border-amber-500/40 text-[11px] font-semibold text-amber-300">
                  Vista previa sin guardar
                </span>
              ) : qrPreviewUrl ? (
                <span className="px-2 py-0.5 rounded bg-emerald-950/60 border border-emerald-700/70 text-[11px] font-semibold text-emerald-300">
                  Imagen publicada
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded bg-[#1C1C22] border border-[#27272E] text-[11px] font-semibold text-zinc-400">
                  QR automático con llave
                </span>
              )}
            </div>

            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3.5">
              <div className="w-28 h-28 rounded-xl bg-white border border-zinc-200 p-1.5 flex items-center justify-center shrink-0 overflow-hidden">
                {qrPreviewUrl ? (
                  <img
                    src={qrPreviewUrl}
                    alt="Vista previa del código QR de pago"
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center text-center text-zinc-500 px-1">
                    <QrCode className="w-10 h-10 text-zinc-700 mb-1" />
                    <span className="text-[10px] font-semibold leading-tight">
                      Sin imagen subida
                    </span>
                  </div>
                )}
              </div>

              <div className="flex-1 min-w-0 space-y-2">
                <p className="text-xs text-zinc-300 leading-relaxed">
                  Sube o reemplaza la imagen oficial del QR de tu cuenta (Nequi, Nu, Bancolombia o
                  Bre-B). Verás la vista previa de inmediato antes y después de guardar.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <label
                    htmlFor="admin-qr-file"
                    className="min-h-[38px] px-3.5 rounded-xl bg-[#1C1C22] border border-[#27272E] text-xs font-bold text-amber-300 hover:border-amber-500 inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span>{qrPreviewUrl ? 'Reemplazar imagen QR' : 'Subir imagen QR'}</span>
                    <input
                      ref={fileInputRef}
                      id="admin-qr-file"
                      type="file"
                      accept="image/*"
                      onChange={handleSelectQrFile}
                      className="sr-only"
                    />
                  </label>

                  {qrPreviewUrl && (
                    <button
                      type="button"
                      onClick={handleRemoveQrImage}
                      className="min-h-[38px] px-3 rounded-xl border border-red-800/80 bg-red-950/40 text-red-300 text-xs font-semibold hover:bg-red-950 inline-flex items-center gap-1.5"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Quitar imagen QR</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Payment Metadata Fields */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="admin-breb-key"
                className="block text-xs font-semibold text-zinc-200 mb-1"
              >
                Llave de Bre-B *
              </label>
              <input
                id="admin-breb-key"
                type="text"
                required
                maxLength={100}
                value={draft.brebKey}
                onChange={(e) => updateDraft({ brebKey: e.target.value })}
                placeholder="Ej. @ONDELUIGI o 300 000 0000"
                className="w-full min-h-[42px] rounded-xl border border-[#27272E] bg-[#0A0A0A] px-3 font-mono text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>

            <div>
              <label
                htmlFor="admin-account-holder"
                className="block text-xs font-semibold text-zinc-200 mb-1"
              >
                Nombre del Titular *
              </label>
              <input
                id="admin-account-holder"
                type="text"
                required
                maxLength={120}
                value={draft.accountHolder}
                onChange={(e) => updateDraft({ accountHolder: e.target.value })}
                placeholder="Nombre completo o comercio"
                className="w-full min-h-[42px] rounded-xl border border-[#27272E] bg-[#0A0A0A] px-3 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>

            <div className="sm:col-span-2">
              <label
                htmlFor="admin-bank-name"
                className="block text-xs font-semibold text-zinc-200 mb-1"
              >
                Banco o Billetera *
              </label>
              <div className="relative">
                <Landmark className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="admin-bank-name"
                  type="text"
                  required
                  maxLength={120}
                  value={draft.bankName}
                  onChange={(e) => updateDraft({ bankName: e.target.value })}
                  placeholder="Ej. Nu, Nequi, Bancolombia, Davivienda"
                  className="w-full min-h-[42px] rounded-xl border border-[#27272E] bg-[#0A0A0A] pl-9 pr-3 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>
            </div>

            <div className="sm:col-span-2">
              <label
                htmlFor="admin-payment-instructions"
                className="block text-xs font-semibold text-zinc-200 mb-1"
              >
                Nota o instrucción opcional de pago
              </label>
              <textarea
                id="admin-payment-instructions"
                rows={2}
                maxLength={400}
                value={draft.paymentInstructions}
                onChange={(e) => updateDraft({ paymentInstructions: e.target.value })}
                placeholder="Ej. Transfiere el valor exacto y adjunta el comprobante para pasar tu pedido a cocina."
                className="w-full rounded-xl border border-[#27272E] bg-[#0A0A0A] p-3 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500 resize-none"
              />
            </div>

            <div className="sm:col-span-2">
              <label
                htmlFor="admin-delivery-instructions"
                className="block text-xs font-semibold text-zinc-200 mb-1"
              >
                Nota opcional de entrega o domicilio
              </label>
              <textarea
                id="admin-delivery-instructions"
                rows={2}
                maxLength={400}
                value={draft.deliveryInstructions}
                onChange={(e) => updateDraft({ deliveryInstructions: e.target.value })}
                placeholder="Ej. Domicilios en zona urbana. El costo de envío se confirma al validar el pedido."
                className="w-full rounded-xl border border-[#27272E] bg-[#0A0A0A] p-3 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500 resize-none"
              />
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[#27272E]">
            <div className="text-[11px] text-zinc-400">
              {isDirty ? (
                <span className="text-amber-300 font-semibold">
                  Tienes cambios pendientes por guardar.
                </span>
              ) : (
                <span>Sincronizado con Autoservicio en tiempo real.</span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {isDirty && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={handleDiscardChanges}
                  className="min-h-[42px] px-3.5 rounded-xl border border-[#27272E] bg-[#1C1C22] text-xs font-semibold text-zinc-300 hover:border-zinc-500 inline-flex items-center gap-1.5 disabled:opacity-50"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Descartar</span>
                </button>
              )}

              <button
                type="submit"
                disabled={saving}
                className="min-h-[42px] px-5 rounded-xl bg-amber-500 text-black text-xs sm:text-sm font-extrabold hover:bg-amber-400 inline-flex items-center gap-2 disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                <span>{saving ? 'Guardando...' : 'Guardar datos de pago'}</span>
              </button>
            </div>
          </div>
        </form>

        {/* Real-Time Customer View Preview */}
        <aside className="lg:col-span-5 rounded-2xl border border-[#27272E] bg-[#141418] p-4 sm:p-5 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-xs font-extrabold uppercase tracking-wider text-amber-400">
                Vista previa del cliente
              </h2>
              <p className="text-[11px] text-zinc-400">
                Así verá el cliente tu QR y los datos para transferir al confirmar su pedido.
              </p>
            </div>
            <span
              className={`px-2 py-0.5 rounded text-[11px] font-bold border ${
                draft.enabled
                  ? 'bg-emerald-950/60 border-emerald-700 text-emerald-300'
                  : 'bg-[#1C1C22] border-[#27272E] text-zinc-400'
              }`}
            >
              {draft.enabled ? 'Visible' : 'Pausado'}
            </span>
          </div>

          <SelfServiceQrCard config={previewConfig} amount={24000} />

          {draft.deliveryInstructions.trim() && (
            <div className="rounded-xl border border-[#27272E] bg-[#0A0A0A] px-3 py-2 text-xs text-zinc-300">
              <span className="block text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-0.5">
                Nota de entrega en checkout
              </span>
              {draft.deliveryInstructions}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
};
