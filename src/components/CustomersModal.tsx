import React, { useEffect, useMemo, useState } from 'react';
import {
  Edit3,
  FileDown,
  Plus,
  Search,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { usePosStore } from '../services/posStore';
import type { Customer, Order, PurchaseInvoice } from '../types/pos';
import {
  DEFAULT_CUSTOMER_DOCUMENT,
  isDefaultFinalConsumer,
} from '../utils/billingUtils';
import { formatCurrency, formatDateTimeShort } from '../utils/orderMath';
import { downloadOrderReceiptPdf } from '../utils/receiptPdf';

interface Props {
  open: boolean;
  onClose: () => void;
}

export const CustomersModal: React.FC<Props> = ({ open, onClose }) => {
  const {
    customers,
    orders,
    purchaseInvoices,
    billingConfig,
    isAdmin,
    upsertCustomer,
    deleteCustomerRecord,
  } = usePosStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [showForm, setShowForm] = useState(false);

  const [docInput, setDocInput] = useState('');
  const [nameInput, setNameInput] = useState('');
  const [phoneInput, setPhoneInput] = useState('');
  const [emailInput, setEmailInput] = useState('');
  const [notesInput, setNotesInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [expandedCustomerId, setExpandedCustomerId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [downloadingOrderId, setDownloadingOrderId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const handleBackIntercept = (e: Event) => {
      e.preventDefault();
      if (showForm) {
        setShowForm(false);
        setEditingCustomer(null);
      } else {
        onClose();
      }
    };
    window.addEventListener('ondeluigi:back-intercept', handleBackIntercept);
    return () => window.removeEventListener('ondeluigi:back-intercept', handleBackIntercept);
  }, [open, showForm, onClose]);

  const ordersByDoc = useMemo(() => {
    const map = new Map<string, Order[]>();
    for (const o of orders) {
      const docKey = (o.customerDocument || DEFAULT_CUSTOMER_DOCUMENT).trim().toLowerCase();
      const list = map.get(docKey) || [];
      list.push(o);
      map.set(docKey, list);
    }
    return map;
  }, [orders]);

  const invoicesByDoc = useMemo(() => {
    const map = new Map<string, PurchaseInvoice[]>();
    for (const inv of purchaseInvoices) {
      const docKey = (inv.supplierDocument || DEFAULT_CUSTOMER_DOCUMENT).trim().toLowerCase();
      const list = map.get(docKey) || [];
      list.push(inv);
      map.set(docKey, list);
    }
    return map;
  }, [purchaseInvoices]);

  const filteredCustomers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return [...customers]
      .sort((a, b) => (b.updatedAtMs || 0) - (a.updatedAtMs || 0))
      .filter((c) => {
        if (!q) return true;
        return (
          c.documentNumber.toLowerCase().includes(q) ||
          c.name.toLowerCase().includes(q) ||
          c.phone.toLowerCase().includes(q) ||
          c.email.toLowerCase().includes(q)
        );
      });
  }, [customers, searchQuery]);

  if (!open) return null;

  const openCreateForm = () => {
    setEditingCustomer(null);
    setDocInput('');
    setNameInput('');
    setPhoneInput('');
    setEmailInput('');
    setNotesInput('');
    setFormError(null);
    setShowForm(true);
  };

  const openEditForm = (cust: Customer) => {
    setEditingCustomer(cust);
    setDocInput(cust.documentNumber);
    setNameInput(cust.name);
    setPhoneInput(cust.phone);
    setEmailInput(cust.email);
    setNotesInput(cust.notes);
    setFormError(null);
    setShowForm(true);
  };

  const handleSaveCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const cleanDoc = docInput.trim();
    const cleanName = nameInput.trim();
    if (!cleanDoc) {
      setFormError('Ingresa el NIT o número de cédula del cliente.');
      return;
    }
    if (isDefaultFinalConsumer(cleanDoc)) {
      setFormError('222222222 ya está reservado por defecto para Consumidor Final.');
      return;
    }
    if (!cleanName) {
      setFormError('Ingresa el nombre o razón social del cliente.');
      return;
    }

    setSaving(true);
    try {
      await upsertCustomer({
        id: editingCustomer?.id,
        documentNumber: cleanDoc,
        name: cleanName,
        phone: phoneInput,
        email: emailInput,
        notes: notesInput,
      });
      setShowForm(false);
      setEditingCustomer(null);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'No se pudo guardar el cliente.');
    } finally {
      setSaving(false);
    }
  };

  const handleDownloadPdf = async (order: Order) => {
    setDownloadingOrderId(order.id);
    try {
      await downloadOrderReceiptPdf(order, billingConfig);
    } finally {
      setDownloadingOrderId(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-sm sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="customers-modal-title"
    >
      <div className="w-full sm:max-w-2xl bg-[#141418] text-white rounded-t-3xl sm:rounded-2xl border border-[#27272E] shadow-2xl overflow-hidden max-h-[92vh] flex flex-col">
        <div className="px-5 py-4 border-b border-[#27272E] flex items-center justify-between bg-[#101014] shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <Users className="w-5 h-5 text-amber-400 shrink-0" />
            <div className="min-w-0">
              <h2
                id="customers-modal-title"
                className="font-poster text-xl font-extrabold text-white tracking-wide uppercase truncate"
              >
                REGISTRO DE CLIENTES Y PROVEEDORES ({customers.length})
              </h2>
              <p className="text-[11px] text-zinc-400 truncate">
                NIT o cédula para ventas y colillas de compra · 222222222 por defecto para Consumidor Final
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar registro de clientes"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-zinc-400 hover:bg-[#1C1C22] hover:text-white shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-4 flex-1">
          <div className="flex flex-col sm:flex-row gap-2.5">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="search"
                aria-label="Buscar cliente registrado"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar por NIT, cédula, nombre o teléfono..."
                className="w-full min-h-[42px] pl-9 pr-3 rounded-xl border border-[#27272E] bg-[#0A0A0A] text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>
            <button
              type="button"
              onClick={openCreateForm}
              className="min-h-[42px] px-4 rounded-xl bg-amber-500 text-black text-xs font-bold hover:bg-amber-400 flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <UserPlus className="w-4 h-4" />
              <span>Nuevo cliente</span>
            </button>
          </div>

          {showForm && (
            <form
              onSubmit={handleSaveCustomer}
              className="rounded-2xl border border-amber-500/50 bg-[#0A0A0A] p-4 space-y-3"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-amber-400 uppercase tracking-wide flex items-center gap-1.5">
                  <Plus className="w-3.5 h-3.5" />
                  <span>{editingCustomer ? 'Editar cliente' : 'Registrar cliente'}</span>
                </h3>
                <button
                  type="button"
                  onClick={() => {
                    setShowForm(false);
                    setEditingCustomer(null);
                  }}
                  className="text-xs text-zinc-400 hover:text-white"
                >
                  Cancelar
                </button>
              </div>

              {formError && (
                <div className="rounded-xl bg-red-950/60 border border-red-700 px-3 py-2 text-xs font-medium text-red-200">
                  {formError}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="cust-form-doc"
                    className="block text-[11px] font-semibold text-zinc-300 mb-1"
                  >
                    NIT o Cédula *
                  </label>
                  <input
                    id="cust-form-doc"
                    type="text"
                    maxLength={40}
                    value={docInput}
                    onChange={(e) => setDocInput(e.target.value)}
                    placeholder="Ej. 1098765432 o 900123456-1"
                    className="w-full min-h-[40px] rounded-xl border border-[#27272E] bg-[#141418] px-3 font-mono text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>
                <div>
                  <label
                    htmlFor="cust-form-name"
                    className="block text-[11px] font-semibold text-zinc-300 mb-1"
                  >
                    Nombre o Razón Social *
                  </label>
                  <input
                    id="cust-form-name"
                    type="text"
                    maxLength={120}
                    value={nameInput}
                    onChange={(e) => setNameInput(e.target.value)}
                    placeholder="Nombre completo o empresa"
                    className="w-full min-h-[40px] rounded-xl border border-[#27272E] bg-[#141418] px-3 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>
                <div>
                  <label
                    htmlFor="cust-form-phone"
                    className="block text-[11px] font-semibold text-zinc-300 mb-1"
                  >
                    Teléfono (opcional)
                  </label>
                  <input
                    id="cust-form-phone"
                    type="text"
                    maxLength={40}
                    value={phoneInput}
                    onChange={(e) => setPhoneInput(e.target.value)}
                    placeholder="Ej. 300 123 4567"
                    className="w-full min-h-[40px] rounded-xl border border-[#27272E] bg-[#141418] px-3 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>
                <div>
                  <label
                    htmlFor="cust-form-email"
                    className="block text-[11px] font-semibold text-zinc-300 mb-1"
                  >
                    Correo electrónico (opcional)
                  </label>
                  <input
                    id="cust-form-email"
                    type="email"
                    maxLength={160}
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    placeholder="cliente@correo.com"
                    className="w-full min-h-[40px] rounded-xl border border-[#27272E] bg-[#141418] px-3 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="cust-form-notes"
                  className="block text-[11px] font-semibold text-zinc-300 mb-1"
                >
                  Nota o dirección (opcional)
                </label>
                <input
                  id="cust-form-notes"
                  type="text"
                  maxLength={300}
                  value={notesInput}
                  onChange={(e) => setNotesInput(e.target.value)}
                  placeholder="Ej. Solicita factura con correo..."
                  className="w-full min-h-[40px] rounded-xl border border-[#27272E] bg-[#141418] px-3 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>

              <button
                type="submit"
                disabled={saving}
                className="min-h-[42px] px-5 rounded-xl bg-amber-500 text-black text-xs font-bold hover:bg-amber-400 disabled:opacity-50"
              >
                {saving ? 'Guardando...' : editingCustomer ? 'Guardar cambios' : 'Guardar cliente'}
              </button>
            </form>
          )}

          {filteredCustomers.length === 0 ? (
            <div className="rounded-2xl border border-[#27272E] bg-[#0A0A0A] p-8 text-center space-y-2">
              <p className="text-sm font-bold text-white">
                {customers.length === 0
                  ? 'Aún no hay clientes guardados'
                  : 'No se encontraron clientes con esa búsqueda'}
              </p>
              <p className="text-xs text-zinc-400 max-w-md mx-auto">
                Cuando ingreses un NIT o cédula distinto a 222222222 en un pedido, o registres un cliente aquí, aparecerá guardado para futuras compras.
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {filteredCustomers.map((cust) => {
                const docKey = cust.documentNumber.trim().toLowerCase();
                const customerOrders = ordersByDoc.get(docKey) || [];
                const supplierInvoices = invoicesByDoc.get(docKey) || [];
                const activeOrders = customerOrders.filter((o) => o.status !== 'cancelado');
                const totalSpent = activeOrders.reduce((s, o) => s + o.total, 0);
                const totalSupplied = supplierInvoices.reduce((s, inv) => s + inv.grandTotal, 0);
                const hasMovements = customerOrders.length > 0 || supplierInvoices.length > 0;
                const isExpanded = expandedCustomerId === cust.id;
                const confirmingDelete = confirmDeleteId === cust.id;

                return (
                  <div
                    key={cust.id}
                    className="rounded-xl border border-[#27272E] bg-[#0A0A0A] overflow-hidden"
                  >
                    <div className="p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-amber-500/15 border border-amber-500/40 text-amber-300">
                            {cust.documentNumber}
                          </span>
                          <p className="text-sm font-bold text-white truncate">{cust.name}</p>
                        </div>
                        <p className="text-[11px] text-zinc-400 mt-1">
                          {activeOrders.length}{' '}
                          {activeOrders.length === 1 ? 'venta' : 'ventas'} (
                          <span className="font-mono text-zinc-200">
                            {formatCurrency(totalSpent)}
                          </span>
                          )
                          {supplierInvoices.length > 0 && (
                            <>
                              {' · '}
                              {supplierInvoices.length}{' '}
                              {supplierInvoices.length === 1 ? 'colilla compra' : 'colillas compra'} (
                              <span className="font-mono text-emerald-300">
                                {formatCurrency(totalSupplied)}
                              </span>
                              )
                            </>
                          )}
                          {cust.phone ? ` · Tel: ${cust.phone}` : ''}
                          {cust.email ? ` · ${cust.email}` : ''}
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                        {hasMovements && (
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedCustomerId(isExpanded ? null : cust.id)
                            }
                            className="min-h-[34px] px-2.5 rounded-lg border border-[#27272E] bg-[#141418] text-xs font-semibold text-zinc-200 hover:border-amber-500"
                          >
                            {isExpanded
                              ? 'Ocultar'
                              : `Movimientos (${customerOrders.length + supplierInvoices.length})`}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => openEditForm(cust)}
                          aria-label={`Editar cliente ${cust.name}`}
                          className="min-h-[34px] min-w-[34px] px-2 rounded-lg border border-[#27272E] bg-[#141418] text-zinc-300 hover:text-white flex items-center justify-center"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        {isAdmin &&
                          (confirmingDelete ? (
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={async () => {
                                  await deleteCustomerRecord(cust.id);
                                  setConfirmDeleteId(null);
                                }}
                                className="min-h-[34px] px-2.5 rounded-lg bg-red-600 text-white text-xs font-bold"
                              >
                                Borrar
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteId(null)}
                                className="min-h-[34px] px-2 rounded-lg border border-[#27272E] bg-[#141418] text-xs text-zinc-300"
                              >
                                No
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(cust.id)}
                              aria-label={`Eliminar cliente ${cust.name}`}
                              className="min-h-[34px] min-w-[34px] flex items-center justify-center rounded-lg border border-[#27272E] bg-[#141418] text-red-400 hover:border-red-700"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          ))}
                      </div>
                    </div>

                    {isExpanded && hasMovements && (
                      <div className="border-t border-[#27272E] bg-[#101014] px-3.5 py-2.5 space-y-2">
                        {customerOrders.slice(0, 8).map((o) => (
                          <div
                            key={o.id}
                            className="flex flex-wrap items-center justify-between gap-2 text-xs py-1 border-b border-[#27272E]/60 last:border-b-0"
                          >
                            <div className="min-w-0">
                              <span className="font-mono font-bold text-amber-400">
                                Venta #{o.orderNumber}
                              </span>{' '}
                              <span className="text-zinc-300">{o.reference}</span>{' '}
                              <span className="text-zinc-500">
                                · {formatDateTimeShort(o.createdAtMs)}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className="font-mono font-bold text-white">
                                {formatCurrency(o.total)}
                              </span>
                              <button
                                type="button"
                                disabled={downloadingOrderId === o.id}
                                onClick={() => void handleDownloadPdf(o)}
                                className="min-h-[30px] px-2.5 rounded-lg bg-amber-500 text-black text-[11px] font-bold hover:bg-amber-400 inline-flex items-center gap-1"
                              >
                                <FileDown className="w-3 h-3" />
                                <span>Colilla PDF</span>
                              </button>
                            </div>
                          </div>
                        ))}
                        {supplierInvoices.slice(0, 8).map((inv) => (
                          <div
                            key={inv.id}
                            className="flex flex-wrap items-center justify-between gap-2 text-xs py-1 border-b border-[#27272E]/60 last:border-b-0"
                          >
                            <div className="min-w-0">
                              <span className="font-mono font-bold text-emerald-400">
                                Colilla compra {inv.receiptCode}
                              </span>{' '}
                              <span className="text-zinc-300">
                                ({inv.lines.length} ítems)
                              </span>{' '}
                              <span className="text-zinc-500">
                                · {formatDateTimeShort(inv.createdAtMs)}
                              </span>
                            </div>
                            <span className="font-mono font-bold text-emerald-300 shrink-0">
                              {formatCurrency(inv.grandTotal)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
