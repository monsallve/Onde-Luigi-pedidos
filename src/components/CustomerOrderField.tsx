import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, RotateCcw, Search, UserCheck, Users } from 'lucide-react';
import type { Customer } from '../types/pos';
import {
  DEFAULT_CUSTOMER_DOCUMENT,
  DEFAULT_CUSTOMER_NAME,
  isDefaultFinalConsumer,
} from '../utils/billingUtils';

export interface CustomerOrderValue {
  id?: string;
  documentNumber: string;
  name: string;
  phone: string;
  email: string;
}

export function createDefaultCustomerOrderValue(): CustomerOrderValue {
  return {
    id: undefined,
    documentNumber: DEFAULT_CUSTOMER_DOCUMENT,
    name: DEFAULT_CUSTOMER_NAME,
    phone: '',
    email: '',
  };
}

interface Props {
  value: CustomerOrderValue;
  onChange: (next: CustomerOrderValue) => void;
  customers: Customer[];
  onOpenDirectory?: () => void;
  compact?: boolean;
}

export const CustomerOrderField: React.FC<Props> = ({
  value,
  onChange,
  customers,
  onOpenDirectory,
  compact = false,
}) => {
  const [expanded, setExpanded] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');

  const isFinalConsumer = isDefaultFinalConsumer(value.documentNumber);
  const displayDoc = (value.documentNumber || '').trim() || DEFAULT_CUSTOMER_DOCUMENT;
  const displayName =
    (value.name || '').trim() ||
    (isFinalConsumer ? DEFAULT_CUSTOMER_NAME : 'Cliente');

  const matchingCustomers = useMemo(() => {
    const q = pickerSearch.trim().toLowerCase();
    const list = customers.filter((c) => {
      if (!q) return true;
      return (
        c.documentNumber.toLowerCase().includes(q) ||
        c.name.toLowerCase().includes(q) ||
        c.phone.toLowerCase().includes(q)
      );
    });
    return list.slice(0, 6);
  }, [customers, pickerSearch]);

  const handleSelectSaved = (cust: Customer) => {
    onChange({
      id: cust.id,
      documentNumber: cust.documentNumber,
      name: cust.name,
      phone: cust.phone,
      email: cust.email,
    });
    setPickerSearch('');
  };

  const handleResetDefault = () => {
    onChange(createDefaultCustomerOrderValue());
    setPickerSearch('');
  };

  return (
    <div className="border border-[#27272E] rounded-xl bg-[#0A0A0A] overflow-hidden">
      <div className="px-3 py-2.5 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] font-bold text-zinc-400 uppercase tracking-wide flex items-center gap-1.5">
            <UserCheck className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span>Facturación / Colilla (Opcional)</span>
          </p>
          <p className="text-xs font-semibold text-white truncate mt-0.5">
            <span className="font-mono text-amber-400">{displayDoc}</span> · {displayName}
          </p>
        </div>

        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          aria-expanded={expanded}
          className="min-h-[34px] px-2.5 rounded-lg border border-[#27272E] bg-[#141418] text-[11px] font-bold text-amber-400 hover:border-amber-500 flex items-center gap-1 whitespace-nowrap shrink-0"
        >
          <span>{expanded ? 'Ocultar' : 'NIT / Cédula'}</span>
          {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
      </div>

      {expanded && (
        <div className="px-3 pb-3 pt-2 border-t border-[#27272E] space-y-2.5 bg-[#101014]">
          {customers.length > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <label
                  htmlFor="customer-quick-search"
                  className="text-[11px] font-semibold text-zinc-400"
                >
                  Buscar cliente guardado ({customers.length})
                </label>
                {onOpenDirectory && (
                  <button
                    type="button"
                    onClick={onOpenDirectory}
                    className="text-[11px] font-bold text-amber-400 hover:underline inline-flex items-center gap-1"
                  >
                    <Users className="w-3 h-3" />
                    <span>Ver registro</span>
                  </button>
                )}
              </div>
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  id="customer-quick-search"
                  type="search"
                  value={pickerSearch}
                  onChange={(e) => setPickerSearch(e.target.value)}
                  placeholder="Buscar por NIT, cédula o nombre..."
                  className="w-full min-h-[36px] pl-8 pr-2.5 rounded-lg border border-[#27272E] bg-[#0A0A0A] text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>
              {matchingCustomers.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-0.5">
                  {matchingCustomers.map((c) => {
                    const selected = value.documentNumber.trim() === c.documentNumber;
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => handleSelectSaved(c)}
                        className={`min-h-[30px] px-2 py-1 rounded-lg border text-[11px] font-semibold truncate max-w-full transition-colors ${
                          selected
                            ? 'bg-amber-500 text-black border-amber-400 font-bold'
                            : 'bg-[#141418] text-zinc-200 border-[#27272E] hover:border-amber-500/60'
                        }`}
                      >
                        <span className="font-mono">{c.documentNumber}</span> · {c.name}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <div className={`grid gap-2 ${compact ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2'}`}>
            <div>
              <label
                htmlFor="order-customer-doc"
                className="block text-[11px] font-semibold text-zinc-400 mb-1"
              >
                NIT o Cédula (por defecto 222222222)
              </label>
              <input
                id="order-customer-doc"
                type="text"
                maxLength={40}
                value={value.documentNumber}
                onChange={(e) =>
                  onChange({
                    ...value,
                    id: undefined,
                    documentNumber: e.target.value,
                  })
                }
                placeholder="222222222"
                className="w-full min-h-[38px] rounded-lg border border-[#27272E] bg-[#0A0A0A] px-2.5 font-mono text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>

            <div>
              <label
                htmlFor="order-customer-name"
                className="block text-[11px] font-semibold text-zinc-400 mb-1"
              >
                Nombre o Razón Social
              </label>
              <input
                id="order-customer-name"
                type="text"
                maxLength={120}
                value={value.name}
                onChange={(e) =>
                  onChange({
                    ...value,
                    name: e.target.value,
                  })
                }
                placeholder="Consumidor Final"
                className="w-full min-h-[38px] rounded-lg border border-[#27272E] bg-[#0A0A0A] px-2.5 text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>

            <div>
              <label
                htmlFor="order-customer-phone"
                className="block text-[11px] font-semibold text-zinc-400 mb-1"
              >
                Teléfono (opcional)
              </label>
              <input
                id="order-customer-phone"
                type="text"
                maxLength={40}
                value={value.phone}
                onChange={(e) =>
                  onChange({
                    ...value,
                    phone: e.target.value,
                  })
                }
                placeholder="Ej. 300 123 4567"
                className="w-full min-h-[38px] rounded-lg border border-[#27272E] bg-[#0A0A0A] px-2.5 text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>

            <div>
              <label
                htmlFor="order-customer-email"
                className="block text-[11px] font-semibold text-zinc-400 mb-1"
              >
                Correo para factura (opcional)
              </label>
              <input
                id="order-customer-email"
                type="email"
                maxLength={160}
                value={value.email}
                onChange={(e) =>
                  onChange({
                    ...value,
                    email: e.target.value,
                  })
                }
                placeholder="cliente@correo.com"
                className="w-full min-h-[38px] rounded-lg border border-[#27272E] bg-[#0A0A0A] px-2.5 text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <p className="text-[11px] text-zinc-400">
              {isFinalConsumer
                ? 'Se emitirá como Consumidor Final (222222222).'
                : 'Al guardar el pedido, este cliente quedará en el registro automáticamente.'}
            </p>
            {!isFinalConsumer && (
              <button
                type="button"
                onClick={handleResetDefault}
                className="min-h-[30px] px-2.5 rounded-lg border border-[#27272E] bg-[#141418] text-[11px] font-semibold text-zinc-300 hover:text-white inline-flex items-center gap-1"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Consumidor Final</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
