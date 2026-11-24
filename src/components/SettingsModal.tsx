import React, { useEffect, useState } from 'react';
import { Check, Cloud, Code2, Copy, Lock, LogOut, MailCheck, MailPlus, Plus, Receipt, Shield, Trash2, Users, X } from 'lucide-react';
import { usePosStore } from '../services/posStore';
import { ADMIN_BOOTSTRAP_EMAIL } from '../data/initialCatalog';
import type { BusinessBillingConfig, StaffRole } from '../types/pos';
import { resolveAssetUrl } from '../utils/orderMath';
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from '../utils/rolePermissions';
import { buildBrandVerificationEmailHtml } from '../utils/verificationEmailTemplate';
import { PWAInstallButton } from './PWAInstallBanner';

interface Props {
  open: boolean;
  onClose: () => void;
  onOpenVerifyEmail?: () => void;
}

export const SettingsModal: React.FC<Props> = ({ open, onClose, onOpenVerifyEmail }) => {
  const {
    firebaseUser,
    emailVerified,
    configSource,
    effectiveRole,
    isAdmin,
    isPrimaryAdmin,
    isRealPrimaryAdmin,
    myLinkedStaff,
    authorizedEmails,
    allowSelfRegistration,
    billingConfig,
    saveBillingConfig,
    updateAuthorizedEmails,
    updateAllowSelfRegistration,
    staff,
    saveStaffMember,
    updateStaffRole,
    toggleStaffActive,
    deleteStaffMember,
    signOutSession,
  } = usePosStore();

  const [newWaiterEmail, setNewWaiterEmail] = useState('');
  const [savingEmails, setSavingEmails] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);

  const [newStaffName, setNewStaffName] = useState('');
  const [newStaffRole, setNewStaffRole] = useState<StaffRole>('mesero');
  const [savingStaff, setSavingStaff] = useState(false);
  const [staffError, setStaffError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [copiedHtml, setCopiedHtml] = useState(false);

  const [billingDraft, setBillingDraft] = useState<BusinessBillingConfig>(billingConfig);
  const [savingBilling, setSavingBilling] = useState(false);
  const [billingStatus, setBillingStatus] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    if (open) {
      setBillingDraft(billingConfig);
      setBillingStatus(null);
    }
  }, [open, billingConfig]);

  if (!open) return null;

  const handleSaveBilling = async (e: React.FormEvent) => {
    e.preventDefault();
    setBillingStatus(null);
    if (!billingDraft.businessName.trim()) {
      setBillingStatus({ type: 'err', text: 'El nombre comercial del negocio es obligatorio.' });
      return;
    }
    setSavingBilling(true);
    try {
      await saveBillingConfig(billingDraft);
      setBillingStatus({
        type: 'ok',
        text: 'Datos del negocio guardados para todas las colillas PDF.',
      });
    } catch (err) {
      setBillingStatus({
        type: 'err',
        text: err instanceof Error ? err.message : 'No se pudieron guardar los datos.',
      });
    } finally {
      setSavingBilling(false);
    }
  };

  const handleCopyBrandEmailHtml = async () => {
    const logoAbsolute =
      typeof window !== 'undefined'
        ? new URL(resolveAssetUrl('/onde-luigi-logo.png'), window.location.href).toString()
        : 'https://monsallve.github.io/Onde-Luigi-pedidos/onde-luigi-logo.png';
    const html = buildBrandVerificationEmailHtml({
      recipientName: 'Nombre del usuario',
      recipientEmail: 'usuario@correo.com',
      logoUrl: logoAbsolute,
      actionUrl: '%LINK%',
    });
    try {
      await navigator.clipboard.writeText(html);
      setCopiedHtml(true);
      window.setTimeout(() => setCopiedHtml(false), 2500);
    } catch {
      setCopiedHtml(false);
    }
  };

  const handleAddAuthorizedEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = newWaiterEmail.trim().toLowerCase();
    if (!clean || !clean.includes('@')) {
      setEmailError('Ingresa un correo electrónico válido.');
      return;
    }
    if (authorizedEmails.includes(clean)) {
      setEmailError('Ese correo ya está autorizado.');
      return;
    }
    setSavingEmails(true);
    setEmailError(null);
    try {
      await updateAuthorizedEmails([...authorizedEmails, clean]);
      setNewWaiterEmail('');
    } catch (err) {
      setEmailError(err instanceof Error ? err.message : 'No se pudo autorizar el correo.');
    } finally {
      setSavingEmails(false);
    }
  };

  const handleRemoveAuthorizedEmail = async (email: string) => {
    if (email === ADMIN_BOOTSTRAP_EMAIL) return;
    setSavingEmails(true);
    setEmailError(null);
    try {
      await updateAuthorizedEmails(authorizedEmails.filter((e) => e !== email));
    } catch (err) {
      setEmailError(err instanceof Error ? err.message : 'Error al quitar correo.');
    } finally {
      setSavingEmails(false);
    }
  };

  const handleAddStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newStaffName.trim()) {
      setStaffError('Escribe el nombre del mesero o integrante.');
      return;
    }
    setSavingStaff(true);
    setStaffError(null);
    try {
      await saveStaffMember(newStaffName, newStaffRole);
      setNewStaffName('');
      setNewStaffRole('mesero');
    } catch (err) {
      setStaffError(err instanceof Error ? err.message : 'No se pudo agregar el usuario.');
    } finally {
      setSavingStaff(false);
    }
  };

  const handleRoleChange = async (staffId: string, role: StaffRole) => {
    setStaffError(null);
    try {
      await updateStaffRole(staffId, role);
    } catch (err) {
      setStaffError(err instanceof Error ? err.message : 'No se pudo cambiar el rol.');
    }
  };

  const handleDeleteStaff = async (staffId: string) => {
    setSavingStaff(true);
    setStaffError(null);
    try {
      await deleteStaffMember(staffId);
      setConfirmDeleteId(null);
    } catch (err) {
      setStaffError(err instanceof Error ? err.message : 'No se pudo eliminar.');
    } finally {
      setSavingStaff(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-sm sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-modal-title"
    >
      <div className="w-full sm:max-w-lg bg-[#141418] text-white rounded-t-3xl sm:rounded-2xl border border-[#27272E] shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
        <div className="px-5 py-4 border-b border-[#27272E] flex items-center justify-between bg-[#101014]">
          <h2 id="settings-modal-title" className="font-poster text-xl font-extrabold text-white tracking-wide">
            AJUSTES, PERMISOS Y EQUIPO
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar ajustes"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-zinc-400 hover:bg-[#1C1C22] hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-6">
          {/* Account Role & Connection */}
          <section className="space-y-2">
            <h3 className="text-xs font-bold text-amber-400 uppercase tracking-wide flex items-center gap-1.5">
              <Cloud className="w-4 h-4" />
              <span>Sesión y rol de acceso</span>
            </h3>
            <div className="rounded-xl border border-[#27272E] p-4 space-y-2.5 bg-[#0A0A0A]">
              <div className="flex items-center justify-between text-sm">
                <span className="text-zinc-400">Nivel de cuenta</span>
                <span
                  className={`px-2.5 py-0.5 rounded font-mono text-xs font-bold uppercase ${
                    isAdmin
                      ? 'bg-amber-500 text-black'
                      : 'bg-[#1C1C22] border border-[#27272E] text-zinc-200'
                  }`}
                >
                  {isRealPrimaryAdmin && effectiveRole === 'admin'
                    ? 'ADMINISTRADOR PRINCIPAL'
                    : ROLE_LABELS[effectiveRole]}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-zinc-400">Modo actual</span>
                <span className="font-semibold text-white">Sincronizado en la Nube</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-zinc-400">Conexión</span>
                <span className="font-mono text-xs text-zinc-300">
                  {configSource === 'env' || configSource === 'applet-config'
                    ? 'Activa'
                    : 'Sin configurar'}
                </span>
              </div>
              <p className="text-[11px] text-zinc-400 leading-relaxed pt-1 border-t border-[#27272E]">
                {ROLE_DESCRIPTIONS[effectiveRole]}
              </p>
              {firebaseUser && (
                <>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-zinc-400">Cuenta conectada</span>
                    <span className="text-white font-medium truncate max-w-[220px]">
                      {firebaseUser.email}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-zinc-400">Estado del correo</span>
                    {emailVerified ? (
                      <span className="text-xs font-bold text-emerald-400">Verificado</span>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-amber-400">Sin verificar</span>
                        {onOpenVerifyEmail && (
                          <button
                            type="button"
                            onClick={() => {
                              onClose();
                              onOpenVerifyEmail();
                            }}
                            className="min-h-[30px] px-2.5 rounded-lg bg-amber-500 text-black text-[11px] font-bold hover:bg-amber-400 inline-flex items-center gap-1"
                          >
                            <MailCheck className="w-3.5 h-3.5" />
                            <span>Verificar</span>
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </section>

          {/* Admin-only Business Billing Data (Colillas PDF & future DIAN) */}
          {isAdmin && (
            <section className="space-y-2.5">
              <h3 className="text-xs font-bold text-amber-400 uppercase tracking-wide flex items-center gap-1.5">
                <Receipt className="w-4 h-4" />
                <span>Datos del negocio y facturación (Colillas PDF / DIAN)</span>
              </h3>

              <form
                onSubmit={handleSaveBilling}
                className="rounded-xl border border-[#27272E] bg-[#0A0A0A] p-4 space-y-3"
              >
                <p className="text-[11px] text-zinc-400 leading-relaxed">
                  Esta información aparecerá en el encabezado de cada colilla de compra PDF y prepara el formato para futura facturación electrónica ante la DIAN.
                </p>

                {billingStatus && (
                  <div
                    className={`rounded-xl border px-3 py-2 text-xs font-medium ${
                      billingStatus.type === 'ok'
                        ? 'bg-emerald-950/60 border-emerald-700 text-emerald-200'
                        : 'bg-red-950/60 border-red-700 text-red-200'
                    }`}
                  >
                    {billingStatus.text}
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label htmlFor="bill-biz-name" className="block text-[11px] font-semibold text-zinc-300 mb-1">
                      Nombre comercial *
                    </label>
                    <input
                      id="bill-biz-name"
                      type="text"
                      maxLength={120}
                      value={billingDraft.businessName}
                      onChange={(e) => setBillingDraft({ ...billingDraft, businessName: e.target.value })}
                      placeholder="O'NDE LUIGI"
                      className="w-full min-h-[38px] rounded-lg border border-[#27272E] bg-[#141418] px-2.5 text-xs text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                    />
                  </div>
                  <div>
                    <label htmlFor="bill-legal-name" className="block text-[11px] font-semibold text-zinc-300 mb-1">
                      Razón social / Propietario
                    </label>
                    <input
                      id="bill-legal-name"
                      type="text"
                      maxLength={120}
                      value={billingDraft.legalName}
                      onChange={(e) => setBillingDraft({ ...billingDraft, legalName: e.target.value })}
                      placeholder="Ej. Luigi S.A.S. o Persona Natural"
                      className="w-full min-h-[38px] rounded-lg border border-[#27272E] bg-[#141418] px-2.5 text-xs text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                    />
                  </div>
                  <div>
                    <label htmlFor="bill-nit" className="block text-[11px] font-semibold text-zinc-300 mb-1">
                      NIT o Cédula del comercio
                    </label>
                    <input
                      id="bill-nit"
                      type="text"
                      maxLength={40}
                      value={billingDraft.nit}
                      onChange={(e) => setBillingDraft({ ...billingDraft, nit: e.target.value })}
                      placeholder="Ej. 900.123.456-7"
                      className="w-full min-h-[38px] rounded-lg border border-[#27272E] bg-[#141418] px-2.5 font-mono text-xs text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                    />
                  </div>
                  <div>
                    <label htmlFor="bill-regime" className="block text-[11px] font-semibold text-zinc-300 mb-1">
                      Régimen tributario (DIAN)
                    </label>
                    <input
                      id="bill-regime"
                      type="text"
                      maxLength={80}
                      value={billingDraft.regime}
                      onChange={(e) => setBillingDraft({ ...billingDraft, regime: e.target.value })}
                      placeholder="No responsable de IVA / Régimen Simple"
                      className="w-full min-h-[38px] rounded-lg border border-[#27272E] bg-[#141418] px-2.5 text-xs text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                    />
                  </div>
                  <div>
                    <label htmlFor="bill-address" className="block text-[11px] font-semibold text-zinc-300 mb-1">
                      Dirección del local
                    </label>
                    <input
                      id="bill-address"
                      type="text"
                      maxLength={160}
                      value={billingDraft.address}
                      onChange={(e) => setBillingDraft({ ...billingDraft, address: e.target.value })}
                      placeholder="Ej. Calle 10 # 25-30"
                      className="w-full min-h-[38px] rounded-lg border border-[#27272E] bg-[#141418] px-2.5 text-xs text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                    />
                  </div>
                  <div>
                    <label htmlFor="bill-city" className="block text-[11px] font-semibold text-zinc-300 mb-1">
                      Ciudad / Municipio
                    </label>
                    <input
                      id="bill-city"
                      type="text"
                      maxLength={80}
                      value={billingDraft.city}
                      onChange={(e) => setBillingDraft({ ...billingDraft, city: e.target.value })}
                      placeholder="Colombia"
                      className="w-full min-h-[38px] rounded-lg border border-[#27272E] bg-[#141418] px-2.5 text-xs text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                    />
                  </div>
                  <div>
                    <label htmlFor="bill-phone" className="block text-[11px] font-semibold text-zinc-300 mb-1">
                      Teléfono / WhatsApp
                    </label>
                    <input
                      id="bill-phone"
                      type="text"
                      maxLength={40}
                      value={billingDraft.phone}
                      onChange={(e) => setBillingDraft({ ...billingDraft, phone: e.target.value })}
                      placeholder="Ej. 300 000 0000"
                      className="w-full min-h-[38px] rounded-lg border border-[#27272E] bg-[#141418] px-2.5 text-xs text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                    />
                  </div>
                  <div>
                    <label htmlFor="bill-email" className="block text-[11px] font-semibold text-zinc-300 mb-1">
                      Correo del negocio
                    </label>
                    <input
                      id="bill-email"
                      type="email"
                      maxLength={160}
                      value={billingDraft.email}
                      onChange={(e) => setBillingDraft({ ...billingDraft, email: e.target.value })}
                      placeholder="facturacion@ondeluigi.com"
                      className="w-full min-h-[38px] rounded-lg border border-[#27272E] bg-[#141418] px-2.5 text-xs text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                    />
                  </div>
                  <div>
                    <label htmlFor="bill-prefix" className="block text-[11px] font-semibold text-zinc-300 mb-1">
                      Prefijo de colilla
                    </label>
                    <input
                      id="bill-prefix"
                      type="text"
                      maxLength={12}
                      value={billingDraft.receiptPrefix}
                      onChange={(e) => setBillingDraft({ ...billingDraft, receiptPrefix: e.target.value.toUpperCase() })}
                      placeholder="COL"
                      className="w-full min-h-[38px] rounded-lg border border-[#27272E] bg-[#141418] px-2.5 font-mono text-xs text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                    />
                  </div>
                  <div>
                    <label htmlFor="bill-footer" className="block text-[11px] font-semibold text-zinc-300 mb-1">
                      Pie de colilla
                    </label>
                    <input
                      id="bill-footer"
                      type="text"
                      maxLength={280}
                      value={billingDraft.footerNote}
                      onChange={(e) => setBillingDraft({ ...billingDraft, footerNote: e.target.value })}
                      placeholder="Gracias por su compra..."
                      className="w-full min-h-[38px] rounded-lg border border-[#27272E] bg-[#141418] px-2.5 text-xs text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={savingBilling}
                  className="min-h-[40px] px-4 rounded-xl bg-amber-500 text-black text-xs font-bold hover:bg-amber-400 disabled:opacity-50"
                >
                  {savingBilling ? 'Guardando datos...' : 'Guardar datos de facturación'}
                </button>
              </form>
            </section>
          )}

          {/* Admin-only Authorized Waiter Emails & Open Link Registration */}
          {isAdmin && (
            <section className="space-y-2.5">
              <h3 className="text-xs font-bold text-amber-400 uppercase tracking-wide flex items-center gap-1.5">
                <Shield className="w-4 h-4" />
                <span>Acceso de equipo (Administradores)</span>
              </h3>

              <div className="rounded-xl border border-[#27272E] bg-[#0A0A0A] p-3.5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-bold text-white">
                    Registro abierto con enlace
                  </p>
                  <p className="text-[11px] text-zinc-400 mt-0.5">
                    {allowSelfRegistration
                      ? 'Activo: cualquier mesero que entre con Google o correo puede asociar su nombre (rol inicial Mesero).'
                      : 'Cerrado: solo los correos agregados abajo pueden entrar.'}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={savingEmails}
                  onClick={async () => {
                    setSavingEmails(true);
                    setEmailError(null);
                    try {
                      await updateAllowSelfRegistration(!allowSelfRegistration);
                    } catch (err) {
                      setEmailError(err instanceof Error ? err.message : 'No se pudo cambiar el registro abierto.');
                    } finally {
                      setSavingEmails(false);
                    }
                  }}
                  className={`min-h-[36px] px-3 rounded-lg text-xs font-bold whitespace-nowrap shrink-0 transition-colors ${
                    allowSelfRegistration
                      ? 'bg-emerald-950/60 text-emerald-300 border border-emerald-700'
                      : 'bg-[#1C1C22] text-zinc-300 border border-[#27272E]'
                  }`}
                >
                  {allowSelfRegistration ? 'Abierto' : 'Solo lista'}
                </button>
              </div>

              <p className="text-xs text-zinc-400">
                Correos pre-autorizados (opcional si el registro abierto está activo):
              </p>

              {emailError && (
                <div className="rounded-xl bg-red-950/60 border border-red-700 px-3 py-2 text-xs font-medium text-red-200">
                  {emailError}
                </div>
              )}

              <form onSubmit={handleAddAuthorizedEmail} className="flex gap-2">
                <input
                  type="email"
                  value={newWaiterEmail}
                  onChange={(e) => setNewWaiterEmail(e.target.value)}
                  placeholder="correo.mesero@gmail.com"
                  className="flex-1 min-h-[42px] rounded-xl border border-[#27272E] bg-[#0A0A0A] px-3 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
                <button
                  type="submit"
                  disabled={savingEmails}
                  className="min-h-[42px] px-4 rounded-xl bg-amber-500 text-black text-xs font-bold hover:bg-amber-400 flex items-center gap-1.5 whitespace-nowrap shrink-0"
                >
                  <MailPlus className="w-4 h-4" />
                  <span>Autorizar</span>
                </button>
              </form>

              <div className="divide-y divide-[#27272E] border border-[#27272E] rounded-xl overflow-hidden bg-[#0A0A0A]">
                {authorizedEmails.map((em) => {
                  const isMainAdmin = em === ADMIN_BOOTSTRAP_EMAIL;
                  return (
                    <div key={em} className="flex items-center justify-between px-3.5 py-2.5 text-xs">
                      <div className="min-w-0">
                        <p className="font-mono text-zinc-200 truncate">{em}</p>
                        <p className="text-[11px] text-zinc-400">
                          {isMainAdmin ? 'Administrador principal' : 'Mesero autorizado'}
                        </p>
                      </div>
                      {!isMainAdmin && (
                        <button
                          type="button"
                          disabled={savingEmails}
                          onClick={() => handleRemoveAuthorizedEmail(em)}
                          aria-label={`Revocar acceso a ${em}`}
                          className="min-h-[34px] min-w-[34px] flex items-center justify-center rounded-lg text-red-400 hover:bg-red-950/60"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="rounded-xl border border-[#27272E] bg-[#0A0A0A] p-3.5 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Code2 className="w-4 h-4 text-amber-400 shrink-0" />
                    <p className="text-xs font-bold text-white truncate">
                      Correo de verificación con logo (O&apos;NDE LUIGI)
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleCopyBrandEmailHtml}
                    className="min-h-[34px] px-3 rounded-lg border border-[#27272E] bg-[#1C1C22] text-[11px] font-bold text-amber-400 hover:border-amber-500 flex items-center gap-1.5 shrink-0"
                  >
                    {copiedHtml ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedHtml ? 'HTML copiado' : 'Copiar HTML'}</span>
                  </button>
                </div>
                <p className="text-[11px] text-zinc-400 leading-relaxed">
                  Plantilla HTML personalizada con el logo oficial de O&apos;NDE LUIGI para configurar remitente o SMTP corporativo en Firebase Authentication.
                </p>
              </div>
            </section>
          )}

          {/* Team Roster management */}
          <section className="space-y-2.5">
            <h3 className="text-xs font-bold text-amber-400 uppercase tracking-wide flex items-center gap-1.5">
              <Users className="w-4 h-4" />
              <span>Personal y roles en turno</span>
            </h3>

            {staffError && (
              <div className="rounded-xl bg-red-950/60 border border-red-700 px-3 py-2 text-xs font-medium text-red-200">
                {staffError}
              </div>
            )}

            {!isAdmin && (
              <p className="text-[11px] text-zinc-400 flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                <span>
                  {isRealPrimaryAdmin
                    ? 'Estás operando con otro rol. Cambia tu propio rol a Administrador en tu fila para volver a gestionar al equipo.'
                    : 'Solamente los usuarios con rol Administrador pueden cambiar roles o administrar el equipo.'}
                </span>
              </p>
            )}

            {isAdmin && (
              <form onSubmit={handleAddStaff} className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  value={newStaffName}
                  onChange={(e) => setNewStaffName(e.target.value)}
                  placeholder="Nombre nuevo mesero..."
                  className="flex-1 min-h-[42px] rounded-xl border border-[#27272E] bg-[#0A0A0A] px-3 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
                <div className="flex gap-2">
                  <select
                    aria-label="Rol del nuevo integrante"
                    value={newStaffRole}
                    onChange={(e) => setNewStaffRole(e.target.value as StaffRole)}
                    className="min-h-[42px] rounded-xl border border-[#27272E] bg-[#0A0A0A] px-2.5 text-xs font-semibold text-zinc-200 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  >
                    <option value="mesero">Mesero</option>
                    <option value="cajero">Caja</option>
                    <option value="cocina">Cocina</option>
                    <option value="admin">Administrador</option>
                  </select>
                  <button
                    type="submit"
                    disabled={savingStaff}
                    className="min-h-[42px] px-4 rounded-xl bg-amber-500 text-black text-xs font-bold hover:bg-amber-400 flex items-center gap-1.5 whitespace-nowrap shrink-0"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Agregar</span>
                  </button>
                </div>
              </form>
            )}

            <div className="divide-y divide-[#27272E] border border-[#27272E] rounded-xl overflow-hidden bg-[#0A0A0A]">
              {staff.length === 0 && (
                <p className="px-4 py-4 text-xs text-zinc-400 text-center">
                  No hay usuarios registrados en el equipo.
                </p>
              )}
              {staff.map((member) => {
                const confirming = confirmDeleteId === member.id;
                const isMainAdminRow =
                  (member.id === myLinkedStaff?.id && isRealPrimaryAdmin) ||
                  (member.linkedEmail || '').toLowerCase() === ADMIN_BOOTSTRAP_EMAIL ||
                  (Boolean(member.linkedUid) && member.linkedUid === member.ownerUid);
                const isOwnRow = Boolean(myLinkedStaff && member.id === myLinkedStaff.id);
                const canChangeThisRole = isMainAdminRow
                  ? isRealPrimaryAdmin
                  : isAdmin && !isOwnRow;
                const canManageOtherActions = isAdmin && !isMainAdminRow && !isOwnRow;

                return (
                  <div
                    key={member.id}
                    className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-white truncate">
                        {member.name}
                        {isMainAdminRow && (
                          <span className="ml-2 text-[10px] font-bold uppercase text-amber-400">
                            · Admin Principal
                          </span>
                        )}
                      </p>
                      <p className="text-[11px] text-zinc-400 truncate">
                        {member.linkedEmail ? `Cuenta: ${member.linkedEmail}` : 'Creado por administrador'}
                      </p>
                    </div>
                    {canChangeThisRole ? (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <select
                          aria-label={`Rol de ${member.name}`}
                          value={member.role}
                          onChange={(e) => handleRoleChange(member.id, e.target.value as StaffRole)}
                          className="min-h-[34px] rounded-lg border border-[#27272E] bg-[#141418] px-2 text-xs font-semibold text-zinc-200 focus:outline-none focus:ring-2 focus:ring-amber-500"
                        >
                          <option value="mesero">Mesero</option>
                          <option value="cajero">Caja</option>
                          <option value="cocina">Cocina</option>
                          <option value="admin">Administrador</option>
                        </select>

                        {canManageOtherActions ? (
                          <>
                            <button
                              type="button"
                              onClick={() => toggleStaffActive(member.id, !member.active)}
                              className={`min-h-[34px] px-2.5 rounded-lg text-xs font-semibold transition-colors ${
                                member.active
                                  ? 'bg-emerald-950/60 text-emerald-300 border border-emerald-700'
                                  : 'bg-[#1C1C22] text-zinc-400 border border-[#27272E]'
                              }`}
                            >
                              {member.active ? 'Activo' : 'Inactivo'}
                            </button>

                            {!confirming ? (
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteId(member.id)}
                                aria-label={`Eliminar usuario ${member.name}`}
                                className="min-h-[34px] min-w-[34px] flex items-center justify-center rounded-lg text-red-400 hover:bg-red-950/60"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            ) : (
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  disabled={savingStaff}
                                  onClick={() => handleDeleteStaff(member.id)}
                                  className="min-h-[34px] px-2 rounded-lg bg-red-600 text-white text-xs font-bold hover:bg-red-500"
                                >
                                  Borrar
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteId(null)}
                                  className="min-h-[34px] px-2 rounded-lg border border-[#27272E] bg-[#1C1C22] text-xs text-zinc-300"
                                >
                                  No
                                </button>
                              </div>
                            )}
                          </>
                        ) : (
                          <span className="px-2.5 py-1 rounded-lg bg-emerald-950/60 text-emerald-300 border border-emerald-700 text-xs font-semibold">
                            Activo
                          </span>
                        )}
                      </div>
                    ) : (
                      <div className="text-right text-xs">
                        <span className={isMainAdminRow ? 'text-amber-400 font-bold' : 'text-zinc-300'}>
                          {ROLE_LABELS[member.role]}
                        </span>
                        <span className="text-zinc-500 mx-1">·</span>
                        <span className="text-zinc-400">
                          {member.active ? 'Activo' : 'Inactivo'}
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-[#27272E]">
            <PWAInstallButton />

            <button
              type="button"
              onClick={async () => {
                await signOutSession();
                onClose();
              }}
              className="ml-auto min-h-[44px] flex items-center gap-2 px-4 rounded-xl bg-red-600/20 text-red-200 border border-red-700 text-xs font-semibold hover:bg-red-600/30"
            >
              <LogOut className="w-4 h-4" />
              <span>Cambiar sesión</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
