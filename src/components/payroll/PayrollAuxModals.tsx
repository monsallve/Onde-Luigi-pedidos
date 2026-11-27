import React, { useEffect, useState } from 'react';
import { AlertTriangle, Download, X } from 'lucide-react';
import { sanitizeExportFilename } from '../../utils/payrollMath';

interface PayrollExportModalProps {
  open: boolean;
  defaultFilename: string;
  onClose: () => void;
  onConfirm: (filename: string) => void;
}

export const PayrollExportModal: React.FC<PayrollExportModalProps> = ({
  open,
  defaultFilename,
  onClose,
  onConfirm,
}) => {
  const [filename, setFilename] = useState(defaultFilename);

  useEffect(() => {
    if (open) {
      setFilename(defaultFilename.replace(/\.json$/i, ''));
    }
  }, [open, defaultFilename]);

  if (!open) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onConfirm(sanitizeExportFilename(filename));
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-sm sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="payroll-export-modal-title"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-md bg-[#141418] text-white rounded-t-3xl sm:rounded-2xl border border-[#27272E] shadow-2xl overflow-hidden"
      >
        <div className="px-5 py-4 border-b border-[#27272E] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Download className="w-5 h-5 text-amber-400 shrink-0" />
            <h2
              id="payroll-export-modal-title"
              className="font-poster text-xl font-extrabold tracking-wide uppercase"
            >
              Exportar datos
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar modal de exportación"
            className="min-h-[36px] min-w-[36px] rounded-lg flex items-center justify-center text-zinc-400 hover:bg-[#1C1C22] hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <p className="text-xs text-zinc-300">
            Elige un nombre para diferenciar este respaldo de otros (por empresa, mes, etc.).
          </p>
          <div>
            <label
              htmlFor="payroll-export-filename"
              className="block text-xs font-semibold text-zinc-300 mb-1"
            >
              Nombre del archivo
            </label>
            <input
              id="payroll-export-filename"
              type="text"
              maxLength={100}
              value={filename}
              onChange={(e) => setFilename(e.target.value)}
              placeholder="ej: nomina_onde_luigi_nov2026"
              autoComplete="off"
              className="w-full min-h-[42px] px-3 rounded-xl border border-[#27272E] bg-[#0A0A0A] text-sm text-white placeholder:text-zinc-500 focus:border-amber-500 focus:outline-none"
            />
            <p className="text-[11px] text-zinc-400 mt-1">
              Se añadirá .json automáticamente si no lo escribes.
            </p>
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-[#27272E]">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[42px] px-4 rounded-xl border border-[#27272E] bg-[#1C1C22] text-xs font-semibold text-zinc-300 hover:border-zinc-500"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="min-h-[42px] px-5 rounded-xl bg-amber-500 text-black text-xs font-bold hover:bg-amber-400"
            >
              Descargar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

interface PayrollConfirmModalProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  loading?: boolean;
  onCancel: () => void;
  onConfirm: () => Promise<void> | void;
}

export const PayrollConfirmModal: React.FC<PayrollConfirmModalProps> = ({
  open,
  title,
  message,
  confirmLabel = 'Confirmar',
  danger = true,
  loading = false,
  onCancel,
  onConfirm,
}) => {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-sm sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="payroll-confirm-modal-title"
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-sm bg-[#141418] text-white rounded-t-3xl sm:rounded-2xl border border-[#27272E] shadow-2xl overflow-hidden p-5 space-y-4"
      >
        <div className="flex items-start gap-3">
          <div
            className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border ${
              danger
                ? 'bg-red-600/15 border-red-600/40 text-red-400'
                : 'bg-amber-500/15 border-amber-500/40 text-amber-400'
            }`}
          >
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div>
            <h2
              id="payroll-confirm-modal-title"
              className="font-poster text-lg font-extrabold tracking-wide uppercase"
            >
              {title}
            </h2>
            <p className="text-xs text-zinc-300 mt-1 whitespace-pre-line">{message}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <button
            type="button"
            disabled={loading}
            onClick={onCancel}
            className="min-h-[42px] rounded-xl border border-[#27272E] bg-[#1C1C22] text-xs font-semibold text-zinc-200 hover:border-zinc-500 disabled:opacity-60"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={() => void onConfirm()}
            className={`min-h-[42px] rounded-xl text-xs font-bold disabled:opacity-60 ${
              danger
                ? 'bg-red-600 text-white hover:bg-red-500'
                : 'bg-amber-500 text-black hover:bg-amber-400'
            }`}
          >
            {loading ? 'Procesando...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
