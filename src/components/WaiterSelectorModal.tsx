import React, { useState } from 'react';
import { Check, Lock, Plus, UserCheck, X } from 'lucide-react';
import { usePosStore } from '../services/posStore';
import type { StaffRole } from '../types/pos';

interface Props {
  open: boolean;
  onClose: () => void;
  required?: boolean;
}

const ROLE_LABELS: Record<StaffRole, string> = {
  admin: 'Administrador',
  mesero: 'Mesero',
  cajero: 'Caja',
  cocina: 'Cocina',
};

export const WaiterSelectorModal: React.FC<Props> = ({ open, onClose, required = false }) => {
  const { staff, activeWaiterId, setActiveWaiterId, saveStaffMember, isAdmin } = usePosStore();
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState<StaffRole>('mesero');
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!open) return null;

  const activeStaff = staff.filter((s) => s.active);

  const handleSelect = (id: string) => {
    setActiveWaiterId(id);
    onClose();
  };

  const handleAdd = async (e: React.FormEvent) => {
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
      setShowAdd(false);
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'No se pudo guardar.');
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
      <div className="w-full sm:max-w-md bg-[#141418] text-white rounded-t-3xl sm:rounded-2xl border border-[#27272E] shadow-2xl overflow-hidden max-h-[85vh] flex flex-col">
        <div className="px-5 pt-4 pb-3 border-b border-[#27272E] flex items-center justify-between bg-[#101014]">
          <div className="flex items-center gap-2.5">
            <UserCheck className="w-5 h-5 text-amber-400" />
            <div>
              <h2 id="waiter-modal-title" className="font-poster text-xl font-extrabold text-white tracking-wide">
                ¿QUIÉN ATIENDE ESTE TURNO?
              </h2>
              <p className="text-xs text-zinc-400">
                Cada pedido y modificación quedará registrado a tu nombre.
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

          <div className="space-y-2">
            {activeStaff.map((member) => {
              const selected = member.id === activeWaiterId;
              return (
                <button
                  key={member.id}
                  type="button"
                  onClick={() => handleSelect(member.id)}
                  className={`w-full min-h-[52px] flex items-center justify-between px-4 py-3 rounded-xl border text-left transition-colors ${
                    selected
                      ? 'border-amber-500 bg-amber-500/15 text-white'
                      : 'border-[#27272E] bg-[#1C1C22] text-zinc-200 hover:border-zinc-500'
                  }`}
                >
                  <div>
                    <p className="text-sm font-bold">{member.name}</p>
                    <p className="text-xs text-zinc-400">{ROLE_LABELS[member.role]}</p>
                  </div>
                  {selected && <Check className="w-5 h-5 text-amber-400 shrink-0" />}
                </button>
              );
            })}
          </div>

          {isAdmin ? (
            !showAdd ? (
              <button
                type="button"
                onClick={() => setShowAdd(true)}
                className="w-full min-h-[44px] flex items-center justify-center gap-2 rounded-xl border border-dashed border-[#3F3F46] text-sm font-semibold text-amber-400 hover:bg-[#1C1C22] transition-colors"
              >
                <Plus className="w-4 h-4" />
                <span>Agregar nuevo mesero / encargado</span>
              </button>
            ) : (
              <form onSubmit={handleAdd} className="border border-[#27272E] rounded-xl p-4 space-y-3 bg-[#101014]">
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
            )
          ) : (
            <p className="text-[11px] text-zinc-400 flex items-center gap-1.5 pt-1">
              <Lock className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
              <span>Solo la cuenta Administradora puede crear o desactivar personal.</span>
            </p>
          )}
        </div>
      </div>
    </div>
  );
};
