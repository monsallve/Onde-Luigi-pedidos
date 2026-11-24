import React, { useEffect } from 'react';
import { Clock, X } from 'lucide-react';
import { ShiftsView } from '../views/ShiftsView';

interface Props {
  open: boolean;
  onClose: () => void;
}

export const ShiftModal: React.FC<Props> = ({ open, onClose }) => {
  useEffect(() => {
    if (!open) return;
    const handleBackIntercept = (e: Event) => {
      e.preventDefault();
      onClose();
    };
    window.addEventListener('ondeluigi:back-intercept', handleBackIntercept);
    return () => window.removeEventListener('ondeluigi:back-intercept', handleBackIntercept);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-sm sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="shift-modal-title"
    >
      <div className="w-full sm:max-w-3xl bg-[#141418] text-white rounded-t-3xl sm:rounded-2xl border border-[#27272E] shadow-2xl overflow-hidden max-h-[92vh] flex flex-col">
        <div className="px-5 py-4 border-b border-[#27272E] flex items-center justify-between bg-[#101014] shrink-0">
          <div className="flex items-center gap-2.5">
            <Clock className="w-5 h-5 text-amber-400 shrink-0" />
            <h2
              id="shift-modal-title"
              className="font-poster text-xl font-extrabold text-white tracking-wide uppercase"
            >
              CONTROL DE TURNO Y CAJA
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar control de turno"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-zinc-400 hover:bg-[#1C1C22] hover:text-white shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto flex-1 bg-[#0A0A0A]">
          <ShiftsView embeddedInModal />
        </div>
      </div>
    </div>
  );
};
