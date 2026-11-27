import React, { useEffect, useState } from 'react';
import { Building2, ImagePlus, Trash2, X } from 'lucide-react';
import { compressImageFile } from '../../services/storageService';
import type { PayrollCompany, PayrollCompanyInput } from '../../types/payroll';
import { assertSafeEmailInput, assertSafeTextInput } from '../../utils/inputSecurity';

interface PayrollCompanyModalProps {
  open: boolean;
  editingCompany: PayrollCompany | null;
  onClose: () => void;
  onSave: (input: PayrollCompanyInput) => Promise<void>;
}

export const PayrollCompanyModal: React.FC<PayrollCompanyModalProps> = ({
  open,
  editingCompany,
  onClose,
  onSave,
}) => {
  const [name, setName] = useState('');
  const [nit, setNit] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [rep, setRep] = useState('');
  const [legal, setLegal] = useState('');
  const [logo, setLogo] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(editingCompany?.name || '');
    setNit(editingCompany?.nit || '');
    setAddress(editingCompany?.address || '');
    setPhone(editingCompany?.phone || '');
    setEmail(editingCompany?.email || '');
    setRep(editingCompany?.rep || '');
    setLegal(editingCompany?.legal || '');
    setLogo(editingCompany?.logo || '');
    setError(null);
    setSubmitting(false);
  }, [open, editingCompany]);

  if (!open) return null;

  const handleLogoFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 2_000_000) {
      setError('La imagen es muy pesada (máx 2 MB).');
      return;
    }
    setError(null);
    try {
      const compressed = await compressImageFile(file, 600, 0.82, '#FFFFFF');
      setLogo(compressed.dataUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo procesar el logo.');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const safeName = assertSafeTextInput(name, 'Nombre / Razón social', {
        maxLen: 140,
        required: true,
      });
      const safeNit = assertSafeTextInput(nit, 'NIT', {
        maxLen: 40,
        required: true,
      });
      const safeAddress = assertSafeTextInput(address, 'Dirección', { maxLen: 160 });
      const safePhone = assertSafeTextInput(phone, 'Teléfono', { maxLen: 40 });
      const safeEmail = email.trim() ? assertSafeEmailInput(email, 'Email') : '';
      const safeRep = assertSafeTextInput(rep, 'Representante legal', { maxLen: 120 });
      const safeLegal = assertSafeTextInput(legal, 'Información legal adicional', {
        maxLen: 400,
        allowNewlines: true,
      });

      setSubmitting(true);
      await onSave({
        id: editingCompany?.id,
        name: safeName,
        nit: safeNit,
        address: safeAddress,
        phone: safePhone,
        email: safeEmail,
        rep: safeRep,
        legal: safeLegal,
        logo,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar la empresa.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-sm sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="payroll-company-modal-title"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-lg bg-[#141418] text-white rounded-t-3xl sm:rounded-2xl border border-[#27272E] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
      >
        <div className="px-5 py-4 border-b border-[#27272E] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Building2 className="w-5 h-5 text-amber-400 shrink-0" />
            <h2
              id="payroll-company-modal-title"
              className="font-poster text-xl font-extrabold tracking-wide uppercase"
            >
              {editingCompany ? 'Editar empresa' : 'Nueva empresa'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar modal de empresa"
            className="min-h-[36px] min-w-[36px] rounded-lg flex items-center justify-center text-zinc-400 hover:bg-[#1C1C22] hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 overflow-y-auto space-y-3.5">
          {error && (
            <div
              role="alert"
              className="rounded-xl bg-red-950/60 border border-red-700 px-3.5 py-2.5 text-xs text-red-200 font-medium"
            >
              {error}
            </div>
          )}

          <div>
            <label htmlFor="payroll-c-name" className="block text-xs font-semibold text-zinc-300 mb-1">
              Nombre / Razón social *
            </label>
            <input
              id="payroll-c-name"
              type="text"
              required
              maxLength={140}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej: O'NDE LUIGI S.A.S."
              className="w-full min-h-[42px] px-3 rounded-xl border border-[#27272E] bg-[#0A0A0A] text-sm text-white placeholder:text-zinc-500 focus:border-amber-500 focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="payroll-c-nit" className="block text-xs font-semibold text-zinc-300 mb-1">
              NIT *
            </label>
            <input
              id="payroll-c-nit"
              type="text"
              required
              maxLength={40}
              value={nit}
              onChange={(e) => setNit(e.target.value)}
              placeholder="Ej: 900.123.456-7"
              className="w-full min-h-[42px] px-3 rounded-xl border border-[#27272E] bg-[#0A0A0A] text-sm text-white placeholder:text-zinc-500 focus:border-amber-500 focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="payroll-c-address" className="block text-xs font-semibold text-zinc-300 mb-1">
              Dirección
            </label>
            <input
              id="payroll-c-address"
              type="text"
              maxLength={160}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Calle, ciudad"
              className="w-full min-h-[42px] px-3 rounded-xl border border-[#27272E] bg-[#0A0A0A] text-sm text-white placeholder:text-zinc-500 focus:border-amber-500 focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="payroll-c-phone" className="block text-xs font-semibold text-zinc-300 mb-1">
                Teléfono
              </label>
              <input
                id="payroll-c-phone"
                type="tel"
                maxLength={40}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full min-h-[42px] px-3 rounded-xl border border-[#27272E] bg-[#0A0A0A] text-sm text-white focus:border-amber-500 focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="payroll-c-email" className="block text-xs font-semibold text-zinc-300 mb-1">
                Email
              </label>
              <input
                id="payroll-c-email"
                type="email"
                maxLength={160}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full min-h-[42px] px-3 rounded-xl border border-[#27272E] bg-[#0A0A0A] text-sm text-white focus:border-amber-500 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label htmlFor="payroll-c-rep" className="block text-xs font-semibold text-zinc-300 mb-1">
              Representante legal
            </label>
            <input
              id="payroll-c-rep"
              type="text"
              maxLength={120}
              value={rep}
              onChange={(e) => setRep(e.target.value)}
              className="w-full min-h-[42px] px-3 rounded-xl border border-[#27272E] bg-[#0A0A0A] text-sm text-white focus:border-amber-500 focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="payroll-c-legal" className="block text-xs font-semibold text-zinc-300 mb-1">
              Información legal adicional
            </label>
            <textarea
              id="payroll-c-legal"
              rows={2}
              maxLength={400}
              value={legal}
              onChange={(e) => setLegal(e.target.value)}
              placeholder="Cámara de comercio, etc."
              className="w-full px-3 py-2 rounded-xl border border-[#27272E] bg-[#0A0A0A] text-sm text-white placeholder:text-zinc-500 focus:border-amber-500 focus:outline-none"
            />
          </div>

          <div>
            <span className="block text-xs font-semibold text-zinc-300 mb-1.5">
              Logo de la empresa
            </span>
            <div className="flex flex-wrap items-center gap-3">
              <label className="min-h-[40px] px-3.5 rounded-xl border border-[#27272E] bg-[#1C1C22] text-xs font-semibold text-zinc-200 hover:border-amber-500 cursor-pointer inline-flex items-center gap-2">
                <ImagePlus className="w-4 h-4 text-amber-400" />
                <span>Seleccionar imagen</span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleLogoFileChange}
                  className="hidden"
                />
              </label>

              {logo && (
                <div className="flex items-center gap-2">
                  <img
                    src={logo}
                    alt="Vista previa del logo"
                    className="h-12 w-12 rounded-xl object-contain bg-white p-1 border border-[#27272E]"
                  />
                  <button
                    type="button"
                    onClick={() => setLogo('')}
                    aria-label="Quitar logo de la empresa"
                    className="min-h-[34px] px-2.5 rounded-lg border border-red-800/70 bg-red-950/40 text-xs text-red-300 hover:bg-red-900/50 inline-flex items-center gap-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Quitar</span>
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="pt-2 flex items-center justify-end gap-2.5 border-t border-[#27272E]">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[42px] px-4 rounded-xl border border-[#27272E] bg-[#1C1C22] text-xs font-semibold text-zinc-300 hover:border-zinc-500"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="min-h-[42px] px-5 rounded-xl bg-amber-500 text-black text-xs font-bold hover:bg-amber-400 disabled:opacity-60"
            >
              {submitting ? 'Guardando...' : 'Guardar empresa'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
