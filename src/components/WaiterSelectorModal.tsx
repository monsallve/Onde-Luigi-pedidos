import React, { useEffect, useState } from 'react';
import { Check, Lock, LogOut, MailCheck, Plus, Trash2, UserCheck, X } from 'lucide-react';
import { ADMIN_BOOTSTRAP_EMAIL } from '../data/demoSeed';
import { usePosStore } from '../services/posStore';
import type { StaffRole } from '../types/pos';

interface Props {
  open: boolean;
  onClose: () => void;
  required?: boolean;
  onPermanentNameConfirmed?: () => void;
  onOpenVerifyEmail?: () => void;
}

const ROLE_LABELS: Record<StaffRole, string> = {
  admin: 'Administrador',
  mesero: 'Mesero',
  cajero: 'Caja',
  cocina: 'Cocina',
};

export const WaiterSelectorModal: React.FC<Props> = ({
  open,
  onClose,
  required = false,
  onPermanentNameConfirmed,
  onOpenVerifyEmail,
}) => {
  const {
    staff,
    activeWaiterId,
    myLinkedStaff,
    firebaseUser,
    emailVerified,
    isPrimaryAdmin,
    setActiveWaiterId,
    saveStaffMember,
    updateStaffRole,
    deleteStaffMember,
    signOutSession,
  } = usePosStore();

  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState<StaffRole>('mesero');
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // One-time permanent name selection for registered users
  const [selfName, setSelfName] = useState('');

  useEffect(() => {
    if (!open) {
      setConfirmDeleteId(null);
      setErrorMsg(null);
      return;
    }
    if (!isPrimaryAdmin) {
      if (myLinkedStaff) {
        setSelfName(myLinkedStaff.name);
      } else {
        setSelfName(firebaseUser?.displayName || '');
      }
    }
  }, [open, isPrimaryAdmin, myLinkedStaff, firebaseUser]);

  if (!open) return null;

  const activeStaff = staff.filter((s) => s.active);

  const handleSelect = (id: string) => {
    setActiveWaiterId(id);
    onClose();
  };

  const handlePrimaryAdminAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) {
      setErrorMsg('Escribe el nombre del mesero o encargado.');
      return;
    }
    setSaving(true);
    setErrorMsg(null);
    try {
      await saveStaffMember(newName, newRole);
      setNewName('');
      setNewRole('mesero');
      setShowAdd(false);
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'No se pudo guardar.');
    } finally {
      setSaving(false);
    }
  };

  const handleOneTimeAssociate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selfName.trim()) {
      setErrorMsg('Escribe el nombre permanente con el que aparecerás en el sistema.');
      return;
    }
    setSaving(true);
    setErrorMsg(null);
    try {
      await saveStaffMember(selfName, 'mesero');
      onClose();
      if (!emailVerified) {
        onPermanentNameConfirmed?.();
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'No se pudo guardar tu usuario.');
    } finally {
      setSaving(false);
    }
  };

  const handleRoleChange = async (staffId: string, role: StaffRole) => {
    setErrorMsg(null);
    try {
      await updateStaffRole(staffId, role);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'No se pudo cambiar el rol.');
    }
  };

  const handleDelete = async (staffId: string) => {
    setSaving(true);
    setErrorMsg(null);
    try {
      await deleteStaffMember(staffId);
      setConfirmDeleteId(null);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'No se pudo eliminar.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-sm sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="waiter-modal-title"
    >
      <div className="w-full sm:max-w-md bg-[#141418] text-white rounded-t-3xl sm:rounded-2xl border border-[#27272E] shadow-2xl overflow-hidden max-h-[88vh] flex flex-col">
        <div className="px-5 pt-4 pb-3 border-b border-[#27272E] flex items-center justify-between bg-[#101014]">
          <div className="flex items-center gap-2.5">
            <UserCheck className="w-5 h-5 text-amber-400 shrink-0" />
            <div>
              <h2 id="waiter-modal-title" className="font-poster text-xl font-extrabold text-white tracking-wide">
                {isPrimaryAdmin ? '¿QUIÉN ATIENDE ESTE TURNO?' : 'MI PERFIL PERMANENTE'}
              </h2>
              <p className="text-xs text-zinc-400">
                {isPrimaryAdmin
                  ? 'Administrador principal: selecciona turno o cambia los roles de los usuarios.'
                  : 'Tu nombre y rol quedan asignados permanentemente a este correo.'}
              </p>
            </div>
          </div>
          {!required && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar selector de personal"
              className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-zinc-400 hover:bg-[#1C1C22] hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        <div className="p-5 overflow-y-auto space-y-3">
          {errorMsg && (
            <div className="rounded-xl bg-red-950/60 border border-red-700 px-3 py-2 text-xs font-medium text-red-200">
              {errorMsg}
            </div>
          )}

          {isPrimaryAdmin ? (
            <>
              <div className="space-y-2">
                {activeStaff.length === 0 && (
                  <p className="text-xs text-zinc-400 text-center py-4">
                    No hay personal activo. Agrega un mesero o administrador abajo.
                  </p>
                )}
                {activeStaff.map((member) => {
                  const selected = member.id === activeWaiterId;
                  const confirmingDelete = confirmDeleteId === member.id;
                  const isMainAdminRow =
                    (member.linkedEmail || '').toLowerCase() === ADMIN_BOOTSTRAP_EMAIL ||
                    (Boolean(member.linkedUid) && member.linkedUid === member.ownerUid);

                  return (
                    <div
                      key={member.id}
                      className={`rounded-xl border transition-colors ${
                        selected
                          ? 'border-amber-500 bg-amber-500/15'
                          : 'border-[#27272E] bg-[#1C1C22]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 px-3.5 py-2.5">
                        <button
                          type="button"
                          onClick={() => handleSelect(member.id)}
                          className="flex-1 min-w-0 text-left py-1 flex items-center gap-2"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-bold text-white truncate">{member.name}</p>
                            <p className="text-[11px] text-zinc-400 truncate">
                              {isMainAdminRow ? 'Administrador principal' : ROLE_LABELS[member.role]}
                              {member.linkedEmail ? ` · ${member.linkedEmail}` : ''}
                            </p>
                          </div>
                          {selected && <Check className="w-4 h-4 text-amber-400 shrink-0" />}
                        </button>

                        {isMainAdminRow ? (
                          <span className="px-2.5 py-1 rounded-lg bg-amber-500/20 border border-amber-500/40 text-amber-300 text-[11px] font-bold shrink-0">
                            Principal
                          </span>
                        ) : (
                          <div className="flex items-center gap-1.5 shrink-0">
                            <select
                              aria-label={`Cambiar rol de ${member.name}`}
                              value={member.role}
                              onChange={(e) => handleRoleChange(member.id, e.target.value as StaffRole)}
                              className="min-h-[34px] rounded-lg border border-[#27272E] bg-[#0A0A0A] px-2 text-[11px] font-semibold text-zinc-200 focus:outline-none focus:ring-2 focus:ring-amber-500"
                            >
                              <option value="mesero">Mesero</option>
                              <option value="cajero">Caja</option>
                              <option value="cocina">Cocina</option>
                              <option value="admin">Administrador</option>
                            </select>

                            {!confirmingDelete ? (
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteId(member.id)}
                                aria-label={`Eliminar a ${member.name}`}
                                className="min-h-[34px] min-w-[34px] flex items-center justify-center rounded-lg border border-[#27272E] bg-[#0A0A0A] text-red-400 hover:bg-red-950/60"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            ) : (
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  disabled={saving}
                                  onClick={() => handleDelete(member.id)}
                                  className="min-h-[34px] px-2 rounded-lg bg-red-600 text-white text-[11px] font-bold hover:bg-red-500"
                                >
                                  Borrar
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteId(null)}
                                  className="min-h-[34px] px-2 rounded-lg border border-[#27272E] bg-[#0A0A0A] text-[11px] text-zinc-300"
                                >
                                  No
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {!showAdd ? (
                <button
                  type="button"
                  onClick={() => setShowAdd(true)}
                  className="w-full min-h-[44px] flex items-center justify-center gap-2 rounded-xl border border-dashed border-[#3F3F46] text-sm font-semibold text-amber-400 hover:bg-[#1C1C22] transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  <span>Agregar nuevo mesero / integrante</span>
                </button>
              ) : (
                <form onSubmit={handlePrimaryAdminAdd} className="border border-[#27272E] rounded-xl p-4 space-y-3 bg-[#101014]">
                  <div>
                    <label htmlFor="new-staff-name" className="block text-xs font-medium text-zinc-300 mb-1">
                      Nombre completo
                    </label>
                    <input
                      id="new-staff-name"
                      type="text"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      placeholder="Ej. Andrés Pardo"
                      className="w-full min-h-[44px] rounded-xl border border-[#27272E] bg-[#0A0A0A] px-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                    />
                  </div>
                  <div>
                    <label htmlFor="new-staff-role" className="block text-xs font-medium text-zinc-300 mb-1">
                      Rol operativo
                    </label>
                    <select
                      id="new-staff-role"
                      value={newRole}
                      onChange={(e) => setNewRole(e.target.value as StaffRole)}
                      className="w-full min-h-[44px] rounded-xl border border-[#27272E] bg-[#0A0A0A] px-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                    >
                      <option value="mesero">Mesero</option>
                      <option value="cajero">Caja</option>
                      <option value="cocina">Cocina</option>
                      <option value="admin">Administrador</option>
                    </select>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="submit"
                      disabled={saving}
                      className="flex-1 min-h-[44px] rounded-xl bg-amber-500 text-black text-sm font-bold hover:bg-amber-400 disabled:opacity-60"
                    >
                      {saving ? 'Guardando...' : 'Guardar y seleccionar'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowAdd(false)}
                      className="min-h-[44px] px-3 rounded-xl border border-[#27272E] bg-[#1C1C22] text-xs font-medium text-zinc-300"
                    >
                      Cancelar
                    </button>
                  </div>
                </form>
              )}
            </>
          ) : (
            /* Registered users (Waiters AND Promoted Admins): permanent name & role locked to account */
            <div className="space-y-3">
              {myLinkedStaff && !myLinkedStaff.active && (
                <div className="rounded-xl bg-red-950/60 border border-red-700 p-4 text-xs text-red-200">
                  Tu usuario ({myLinkedStaff.name}) fue desactivado por el administrador principal.
                </div>
              )}

              {myLinkedStaff && myLinkedStaff.active && (
                <div className="rounded-xl border border-amber-500 bg-amber-500/10 p-4 space-y-3">
                  <div>
                    <p className="text-xs font-semibold text-amber-400 flex items-center gap-1.5">
                      <Lock className="w-3.5 h-3.5" />
                      <span>Nombre y rol asignados permanentemente</span>
                    </p>
                    <p className="text-lg font-bold text-white mt-1">{myLinkedStaff.name}</p>
                    <p className="text-xs text-zinc-300 mt-0.5">
                      Rol actual: <strong className="text-white">{ROLE_LABELS[myLinkedStaff.role]}</strong>
                    </p>
                    {myLinkedStaff.linkedEmail && (
                      <p className="text-[11px] font-mono text-zinc-400 mt-0.5">
                        {myLinkedStaff.linkedEmail}
                      </p>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => handleSelect(myLinkedStaff.id)}
                    className="w-full min-h-[44px] rounded-xl bg-amber-500 text-black text-sm font-bold hover:bg-amber-400"
                  >
                    Continuar como {myLinkedStaff.name}
                  </button>

                  {!emailVerified && onOpenVerifyEmail && (
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onOpenVerifyEmail();
                      }}
                      className="w-full min-h-[42px] rounded-xl border border-amber-500/60 bg-[#141418] text-amber-300 text-xs font-bold hover:bg-[#1C1C22] flex items-center justify-center gap-1.5"
                    >
                      <MailCheck className="w-4 h-4" />
                      <span>Verificar correo electrónico</span>
                    </button>
                  )}
                </div>
              )}

              {!myLinkedStaff && (
                <form onSubmit={handleOneTimeAssociate} className="border border-[#27272E] rounded-xl p-4 space-y-3 bg-[#101014]">
                  <div>
                    <label htmlFor="self-staff-name" className="block text-xs font-medium text-zinc-300 mb-1">
                      Elige tu nombre permanente (solo se configura una vez)
                    </label>
                    <input
                      id="self-staff-name"
                      type="text"
                      value={selfName}
                      onChange={(e) => setSelfName(e.target.value)}
                      placeholder="Ej. Gabriela Cárdenas"
                      className="w-full min-h-[44px] rounded-xl border border-[#27272E] bg-[#0A0A0A] px-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                    />
                  </div>

                  <div className="rounded-xl border border-[#27272E] bg-[#0A0A0A] px-3 py-2.5 flex items-center justify-between text-xs">
                    <span className="text-zinc-400">Rol inicial asignado</span>
                    <span className="font-bold text-amber-400 flex items-center gap-1.5">
                      <Lock className="w-3.5 h-3.5" />
                      <span>Mesero</span>
                    </span>
                  </div>

                  <p className="text-[11px] text-zinc-400 leading-relaxed">
                    Al guardar, este nombre y tu rol quedarán vinculados de forma permanente a tu correo ({firebaseUser?.email || 'cuenta actual'}).
                  </p>

                  <button
                    type="submit"
                    disabled={saving}
                    className="w-full min-h-[44px] rounded-xl bg-amber-500 text-black text-sm font-bold hover:bg-amber-400 disabled:opacity-60"
                  >
                    {saving ? 'Guardando...' : 'Confirmar nombre permanente'}
                  </button>

                  {required && (
                    <button
                      type="button"
                      onClick={() => void signOutSession()}
                      className="w-full min-h-[40px] rounded-xl border border-[#27272E] bg-[#1C1C22] text-xs font-semibold text-zinc-300 hover:text-white flex items-center justify-center gap-1.5"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      <span>Cambiar de cuenta</span>
                    </button>
                  )}
                </form>
              )}

              <p className="text-[11px] text-zinc-400 flex items-center gap-1.5 pt-1">
                <Lock className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                <span>Solamente el administrador principal puede cambiar los roles de los usuarios.</span>
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

