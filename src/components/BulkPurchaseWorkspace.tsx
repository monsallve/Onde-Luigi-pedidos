import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Boxes,
  CheckCircle2,
  Plus,
  Receipt,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { usePosStore } from '../services/posStore';
import type {
  Customer,
  ExpenseLineKind,
  InventoryItem,
  InventoryUnit,
} from '../types/pos';
import {
  DEFAULT_CUSTOMER_DOCUMENT,
  DEFAULT_CUSTOMER_NAME,
  isDefaultFinalConsumer,
} from '../utils/billingUtils';
import {
  calculatePurchaseUnitCost,
  formatInventoryQuantity,
  formatUnitCost,
} from '../utils/inventoryMath';
import { createSafeId, formatCurrency, formatDateTimeShort } from '../utils/orderMath';
import {
  buildAutoReceiptCode,
  calculateInvoiceTotals,
  EXPENSE_LINE_KIND_LABELS,
  normalizeInvoiceLine,
  PURCHASE_PAYMENT_METHOD_LABELS,
} from '../utils/purchaseExpenseMath';

interface DraftPurchaseRow {
  id: string;
  kind: ExpenseLineKind;
  inventoryItemId?: string;
  unit?: InventoryUnit;
  description: string;
  quantityStr: string;
  totalCostStr: string;
}

interface Props {
  mode: 'entrada' | 'historial';
  onChangeMode: (mode: 'entrada' | 'historial') => void;
  onBackToStock: () => void;
  onOpenNewIngredientModal: () => void;
  statusNotice: string | null;
  onDismissNotice: () => void;
  onSuccessNotice: (message: string) => void;
}

export const BulkPurchaseWorkspace: React.FC<Props> = ({
  mode,
  onChangeMode,
  onBackToStock,
  onOpenNewIngredientModal,
  statusNotice,
  onDismissNotice,
  onSuccessNotice,
}) => {
  const {
    inventory,
    customers,
    purchaseInvoices,
    registerBulkPurchaseInvoice,
    deletePurchaseInvoice,
  } = usePosStore();

  // Combined Receipt + Supplier (synced with Customers directory)
  const [receiptCode, setReceiptCode] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('efectivo');
  const [invoiceNotes, setInvoiceNotes] = useState('');

  const [supplierPickerSearch, setSupplierPickerSearch] = useState('');
  const [showSupplierSuggestions, setShowSupplierSuggestions] = useState(false);
  const [supplierId, setSupplierId] = useState<string | undefined>(undefined);
  const [supplierDoc, setSupplierDoc] = useState(DEFAULT_CUSTOMER_DOCUMENT);
  const [supplierName, setSupplierName] = useState(DEFAULT_CUSTOMER_NAME);
  const [supplierPhone, setSupplierPhone] = useState('');
  const [supplierEmail, setSupplierEmail] = useState('');

  // Single-line items list (Inventoriable + Services/Expenses/Investments)
  const [ingredientSearch, setIngredientSearch] = useState('');
  const [rows, setRows] = useState<DraftPurchaseRow[]>([]);
  const [pendingFocusRowId, setPendingFocusRowId] = useState<string | null>(null);
  const qtyInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const descInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // Saving & history filters
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [historySearch, setHistorySearch] = useState('');
  const [confirmDeleteInvoiceId, setConfirmDeleteInvoiceId] = useState<string | null>(null);

  const isFinalConsumer = isDefaultFinalConsumer(supplierDoc);

  useEffect(() => {
    if (!pendingFocusRowId) return;
    const row = rows.find((r) => r.id === pendingFocusRowId);
    if (!row) return;
    const target =
      row.kind === 'inventariable'
        ? qtyInputRefs.current[pendingFocusRowId]
        : descInputRefs.current[pendingFocusRowId];
    if (target) {
      target.focus();
      setPendingFocusRowId(null);
    }
  }, [pendingFocusRowId, rows]);

  const sortedInventory = useMemo(
    () => [...inventory].sort((a, b) => a.name.localeCompare(b.name, 'es')),
    [inventory]
  );

  const inventoryById = useMemo(
    () => new Map(inventory.map((i) => [i.id, i])),
    [inventory]
  );

  const matchingSuppliers = useMemo(() => {
    const q = supplierPickerSearch.trim().toLowerCase();
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
      })
      .slice(0, 6);
  }, [customers, supplierPickerSearch]);

  const matchingIngredients = useMemo(() => {
    const q = ingredientSearch.trim().toLowerCase();
    if (!q) return sortedInventory.slice(0, 10);
    return sortedInventory.filter((item) => item.name.toLowerCase().includes(q)).slice(0, 14);
  }, [sortedInventory, ingredientSearch]);

  const normalizedDraftSummary = useMemo(() => {
    const normalizedLines = rows.map((r) =>
      normalizeInvoiceLine({
        id: r.id,
        kind: r.kind,
        description: r.description,
        inventoryItemId: r.inventoryItemId,
        unit: r.unit,
        quantity: Number(r.quantityStr) || 0,
        totalCost: Number(r.totalCostStr) || 0,
      })
    );
    return calculateInvoiceTotals(normalizedLines);
  }, [rows]);

  const filteredInvoices = useMemo(() => {
    const q = historySearch.trim().toLowerCase();
    if (!q) return purchaseInvoices;
    return purchaseInvoices.filter(
      (inv) =>
        inv.receiptCode.toLowerCase().includes(q) ||
        inv.supplierDocument.toLowerCase().includes(q) ||
        inv.supplierName.toLowerCase().includes(q) ||
        inv.notes.toLowerCase().includes(q) ||
        inv.lines.some((l) => l.description.toLowerCase().includes(q))
    );
  }, [purchaseInvoices, historySearch]);

  const selectSavedSupplier = (cust: Customer) => {
    setSupplierId(cust.id);
    setSupplierDoc(cust.documentNumber);
    setSupplierName(cust.name);
    setSupplierPhone(cust.phone);
    setSupplierEmail(cust.email);
    setSupplierPickerSearch('');
    setShowSupplierSuggestions(false);
  };

  const resetSupplierToFinalConsumer = () => {
    setSupplierId(undefined);
    setSupplierDoc(DEFAULT_CUSTOMER_DOCUMENT);
    setSupplierName(DEFAULT_CUSTOMER_NAME);
    setSupplierPhone('');
    setSupplierEmail('');
    setSupplierPickerSearch('');
    setShowSupplierSuggestions(false);
  };

  const addInventoriableRow = (item?: InventoryItem) => {
    setFormError(null);
    const chosen = item || sortedInventory[0];
    if (!chosen) {
      onOpenNewIngredientModal();
      return;
    }
    const id = createSafeId('prow');
    setRows((prev) => [
      ...prev,
      {
        id,
        kind: 'inventariable',
        inventoryItemId: chosen.id,
        unit: chosen.unit,
        description: chosen.name,
        quantityStr: '',
        totalCostStr: '',
      },
    ]);
    setIngredientSearch('');
    setPendingFocusRowId(id);
  };

  const addExpenseRow = (kind: Exclude<ExpenseLineKind, 'inventariable'>) => {
    setFormError(null);
    const id = createSafeId('prow');
    setRows((prev) => [
      ...prev,
      {
        id,
        kind,
        description: '',
        quantityStr: '1',
        totalCostStr: '',
      },
    ]);
    setPendingFocusRowId(id);
  };

  const changeRowInventoryItem = (rowId: string, nextItemId: string) => {
    const item = inventoryById.get(nextItemId);
    if (!item) return;
    setRows((prev) =>
      prev.map((r) =>
        r.id === rowId
          ? {
              ...r,
              inventoryItemId: item.id,
              unit: item.unit,
              description: item.name,
            }
          : r
      )
    );
  };

  const updateRow = (rowId: string, patch: Partial<DraftPurchaseRow>) => {
    setRows((prev) => prev.map((r) => (r.id === rowId ? { ...r, ...patch } : r)));
  };

  const removeRow = (rowId: string) => {
    setRows((prev) => prev.filter((r) => r.id !== rowId));
  };

  const handleSaveInvoice = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!receiptCode.trim()) {
      setFormError('Escribe el código o número de la colilla de compra.');
      return;
    }
    if (rows.length === 0) {
      setFormError('Agrega al menos un producto o gasto a la lista.');
      return;
    }

    setSubmitting(true);
    try {
      const saved = await registerBulkPurchaseInvoice({
        receiptCode,
        supplier: {
          id: supplierId,
          documentNumber: supplierDoc,
          name: supplierName,
          phone: supplierPhone,
          email: supplierEmail,
        },
        paymentMethod,
        notes: invoiceNotes,
        lines: rows.map((r) => ({
          id: r.id,
          kind: r.kind,
          description: r.description,
          inventoryItemId: r.inventoryItemId,
          unit: r.unit,
          quantity: Number(r.quantityStr),
          totalCost: Number(r.totalCostStr || 0),
        })),
      });

      const invLinesCount = saved.lines.filter((l) => l.kind === 'inventariable').length;
      const expLinesCount = saved.lines.length - invLinesCount;
      onSuccessNotice(
        `Colilla ${saved.receiptCode} guardada (${formatCurrency(saved.grandTotal)}) · ${invLinesCount} insumos y ${expLinesCount} gastos.`
      );

      setReceiptCode('');
      setInvoiceNotes('');
      setRows([]);
      setIngredientSearch('');
      resetSupplierToFinalConsumer();
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : 'No se pudo guardar la colilla de compra.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Dedicated Separate Screen Top Bar */}
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#27272E]">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onBackToStock}
            className="min-h-[40px] px-3 rounded-xl border border-[#27272E] bg-[#141418] hover:border-amber-500 text-xs sm:text-sm font-bold text-zinc-200 inline-flex items-center gap-1.5 shrink-0"
          >
            <ArrowLeft className="w-4 h-4 text-amber-400" />
            <span>Volver a Stock</span>
          </button>

          <div className="min-w-0">
            <h1 className="font-poster text-2xl sm:text-3xl font-extrabold tracking-wide text-white leading-none truncate">
              {mode === 'entrada' ? 'INGRESO MASIVO Y GASTOS' : 'COLILLAS REGISTRADAS'}
            </h1>
            <p className="text-[11px] text-zinc-400 mt-0.5 truncate">
              {mode === 'entrada'
                ? 'Colilla + proveedor y listado rápido por cantidad y precio'
                : 'Historial de facturas de compra, insumos y servicios'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <div className="inline-flex p-1 rounded-xl bg-[#141418] border border-[#27272E]">
            <button
              type="button"
              onClick={() => onChangeMode('entrada')}
              className={`min-h-[34px] px-3 rounded-lg text-xs font-bold transition-colors ${
                mode === 'entrada'
                  ? 'bg-amber-500 text-black'
                  : 'text-zinc-300 hover:text-white'
              }`}
            >
              Nueva colilla
            </button>
            <button
              type="button"
              onClick={() => onChangeMode('historial')}
              className={`min-h-[34px] px-3 rounded-lg text-xs font-bold transition-colors inline-flex items-center gap-1.5 ${
                mode === 'historial'
                  ? 'bg-amber-500 text-black'
                  : 'text-zinc-300 hover:text-white'
              }`}
            >
              <Receipt className="w-3.5 h-3.5" />
              <span>Colillas ({purchaseInvoices.length})</span>
            </button>
          </div>

          <button
            type="button"
            onClick={onOpenNewIngredientModal}
            className="min-h-[40px] px-3.5 rounded-xl border border-amber-500/60 bg-[#1C1C22] text-amber-300 text-xs font-bold hover:bg-amber-500/15 inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Crear ingrediente</span>
          </button>
        </div>
      </header>

      {statusNotice && (
        <div
          role="status"
          className="rounded-xl bg-emerald-950/60 border border-emerald-700 px-3.5 py-2 text-xs font-medium text-emerald-200 flex items-center justify-between gap-2"
        >
          <span>{statusNotice}</span>
          <button
            type="button"
            onClick={onDismissNotice}
            aria-label="Cerrar aviso"
            className="text-emerald-300 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {mode === 'historial' ? (
        <section className="space-y-3">
          <div className="bg-[#141418] border border-[#27272E] rounded-2xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="search"
                aria-label="Buscar colilla de compra o proveedor"
                value={historySearch}
                onChange={(e) => setHistorySearch(e.target.value)}
                placeholder="Buscar por código de colilla, NIT/cédula, proveedor o producto..."
                className="w-full min-h-[40px] pl-9 pr-3 rounded-xl border border-[#27272E] bg-[#0A0A0A] text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>
            <div className="text-xs text-zinc-400 shrink-0 font-mono px-1">
              {filteredInvoices.length} {filteredInvoices.length === 1 ? 'colilla' : 'colillas'}
            </div>
          </div>

          {filteredInvoices.length === 0 ? (
            <div className="bg-[#141418] border border-[#27272E] rounded-2xl p-8 text-center space-y-2">
              <Receipt className="w-8 h-8 text-zinc-500 mx-auto" />
              <p className="text-sm font-bold text-white">
                {purchaseInvoices.length === 0
                  ? 'Aún no hay colillas de compra ni gastos registrados.'
                  : 'Ninguna colilla coincide con la búsqueda.'}
              </p>
              <button
                type="button"
                onClick={() => onChangeMode('entrada')}
                className="min-h-[38px] px-4 rounded-xl bg-amber-500 text-black text-xs font-bold hover:bg-amber-400"
              >
                Registrar primera colilla
              </button>
            </div>
          ) : (
            <div className="space-y-2.5">
              {filteredInvoices.map((inv) => {
                const confirmingDelete = confirmDeleteInvoiceId === inv.id;

                return (
                  <article
                    key={inv.id}
                    className="bg-[#141418] border border-[#27272E] rounded-2xl p-3.5 space-y-2.5"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div className="min-w-0 space-y-0.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-mono text-xs font-extrabold px-2 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/50 text-amber-300">
                            {inv.receiptCode}
                          </span>
                          <span className="text-[11px] px-2 py-0.5 rounded bg-[#1C1C22] border border-[#27272E] text-zinc-300">
                            {PURCHASE_PAYMENT_METHOD_LABELS[inv.paymentMethod] ||
                              inv.paymentMethod ||
                              'Efectivo'}
                          </span>
                          <span className="text-xs font-bold text-white truncate">
                            {inv.supplierName}
                          </span>
                          <span className="font-mono text-[11px] text-zinc-400">
                            ({inv.supplierDocument})
                          </span>
                        </div>
                        <p className="text-[11px] text-zinc-500">
                          {formatDateTimeShort(inv.createdAtMs)} · Por {inv.actorName}
                          {inv.supplierPhone ? ` · ${inv.supplierPhone}` : ''}
                          {inv.notes ? ` · ${inv.notes}` : ''}
                        </p>
                      </div>

                      <div className="flex items-center gap-3 shrink-0">
                        <p className="font-mono text-lg font-extrabold text-emerald-400 tabular-nums">
                          {formatCurrency(inv.grandTotal)}
                        </p>

                        {confirmingDelete ? (
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={async () => {
                                await deletePurchaseInvoice(inv.id);
                                setConfirmDeleteInvoiceId(null);
                                onSuccessNotice(`Colilla ${inv.receiptCode} eliminada.`);
                              }}
                              className="min-h-[30px] px-2.5 rounded-lg bg-red-600 text-white text-xs font-bold"
                            >
                              Borrar
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteInvoiceId(null)}
                              className="min-h-[30px] px-2 rounded-lg border border-[#27272E] bg-[#1C1C22] text-xs text-zinc-300"
                            >
                              No
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteInvoiceId(inv.id)}
                            aria-label={`Eliminar colilla ${inv.receiptCode}`}
                            className="min-h-[30px] min-w-[30px] flex items-center justify-center rounded-lg border border-red-900/60 bg-red-950/30 text-red-400 hover:bg-red-950/60"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="rounded-xl border border-[#27272E] bg-[#0A0A0A] divide-y divide-[#27272E]">
                      {inv.lines.map((line) => (
                        <div
                          key={line.id}
                          className="px-3 py-1.5 flex items-center justify-between gap-2 text-xs"
                        >
                          <div className="min-w-0 flex items-center gap-2">
                            <span
                              className={`text-[10px] font-bold px-1.5 py-0.5 rounded border shrink-0 ${
                                line.kind === 'inventariable'
                                  ? 'bg-amber-500/15 border-amber-500/40 text-amber-300'
                                  : 'bg-sky-950/60 border-sky-700/60 text-sky-300'
                              }`}
                            >
                              {EXPENSE_LINE_KIND_LABELS[line.kind]}
                            </span>
                            <span className="font-medium text-white truncate">
                              {line.description}
                            </span>
                          </div>
                          <div className="font-mono text-xs text-zinc-300 tabular-nums shrink-0">
                            {line.unit
                              ? formatInventoryQuantity(line.quantity, line.unit)
                              : `${line.quantity}x`}{' '}
                            · <strong className="text-white">{formatCurrency(line.totalCost)}</strong>
                            {line.unit && line.calculatedUnitCost > 0
                              ? ` (${formatUnitCost(line.calculatedUnitCost, line.unit)})`
                              : ''}
                          </div>
                        </div>
                      ))}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      ) : (
        <form onSubmit={handleSaveInvoice} className="space-y-3.5">
          {formError && (
            <div
              role="alert"
              className="rounded-xl bg-red-950/60 border border-red-700 px-3.5 py-2.5 text-xs font-medium text-red-200"
            >
              {formError}
            </div>
          )}

          {/* BLOCK 1: Colilla + Proveedor juntos en un bloque compacto */}
          <section className="bg-[#141418] border border-[#27272E] rounded-2xl p-3.5 sm:p-4 space-y-2.5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <span className="text-xs font-extrabold uppercase tracking-wide text-amber-400">
                Colilla y proveedor
              </span>

              <div className="flex flex-wrap items-center gap-2 flex-1 sm:justify-end">
                {customers.length > 0 && (
                  <div className="relative w-full sm:w-72">
                    <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="search"
                      aria-label="Buscar proveedor guardado por NIT o nombre"
                      value={supplierPickerSearch}
                      onFocus={() => setShowSupplierSuggestions(true)}
                      onBlur={() => setTimeout(() => setShowSupplierSuggestions(false), 160)}
                      onChange={(e) => {
                        setSupplierPickerSearch(e.target.value);
                        setShowSupplierSuggestions(true);
                      }}
                      placeholder={`Buscar proveedor guardado (${customers.length})...`}
                      className="w-full min-h-[34px] pl-8 pr-2.5 rounded-lg border border-[#27272E] bg-[#0A0A0A] text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
                    />

                    {showSupplierSuggestions && matchingSuppliers.length > 0 && (
                      <div className="absolute z-30 left-0 right-0 mt-1 rounded-xl border border-[#27272E] bg-[#141418] shadow-2xl divide-y divide-[#27272E] max-h-52 overflow-y-auto">
                        {matchingSuppliers.map((cust) => (
                          <button
                            key={cust.id}
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              selectSavedSupplier(cust);
                            }}
                            className="w-full px-3 py-2 text-left text-xs hover:bg-[#1C1C22] flex items-center justify-between gap-2"
                          >
                            <span className="font-semibold text-white truncate">{cust.name}</span>
                            <span className="font-mono text-[11px] text-amber-400 shrink-0">
                              {cust.documentNumber}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {!isFinalConsumer && (
                  <button
                    type="button"
                    onClick={resetSupplierToFinalConsumer}
                    className="min-h-[34px] px-2.5 rounded-lg border border-[#27272E] bg-[#1C1C22] text-[11px] font-semibold text-zinc-200 hover:border-amber-500 inline-flex items-center gap-1 shrink-0"
                  >
                    <RotateCcw className="w-3 h-3 text-amber-400" />
                    <span>222222222 Consumidor Final</span>
                  </button>
                )}
              </div>
            </div>

            {/* Row 1: Código colilla, Pago, NIT/Cédula, Razón social */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
              <div>
                <label
                  htmlFor="bulk-receipt-code"
                  className="block text-[11px] font-semibold text-zinc-300 mb-1"
                >
                  Código colilla *
                </label>
                <div className="flex gap-1">
                  <input
                    id="bulk-receipt-code"
                    type="text"
                    maxLength={60}
                    value={receiptCode}
                    onChange={(e) => setReceiptCode(e.target.value)}
                    placeholder="FEV-0412 / POS-88"
                    className="flex-1 min-w-0 min-h-[38px] rounded-lg border border-[#27272E] bg-[#0A0A0A] px-2.5 font-mono text-xs uppercase text-white placeholder:text-zinc-500 placeholder:normal-case focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                  <button
                    type="button"
                    onClick={() => setReceiptCode(buildAutoReceiptCode())}
                    title="Generar código automático"
                    className="min-h-[38px] px-2 rounded-lg border border-[#27272E] bg-[#1C1C22] text-[11px] font-semibold text-amber-300 hover:border-amber-500 shrink-0 inline-flex items-center gap-1"
                  >
                    <Sparkles className="w-3 h-3" />
                    <span>Auto</span>
                  </button>
                </div>
              </div>

              <div>
                <label
                  htmlFor="bulk-payment-method"
                  className="block text-[11px] font-semibold text-zinc-300 mb-1"
                >
                  Medio de pago
                </label>
                <select
                  id="bulk-payment-method"
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                  className="w-full min-h-[38px] rounded-lg border border-[#27272E] bg-[#0A0A0A] px-2.5 text-xs text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                >
                  {Object.entries(PURCHASE_PAYMENT_METHOD_LABELS).map(([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="bulk-supplier-doc"
                  className="block text-[11px] font-semibold text-zinc-300 mb-1"
                >
                  NIT / Cédula
                </label>
                <input
                  id="bulk-supplier-doc"
                  type="text"
                  maxLength={40}
                  value={supplierDoc}
                  onChange={(e) => {
                    setSupplierId(undefined);
                    setSupplierDoc(e.target.value);
                  }}
                  placeholder="222222222"
                  className="w-full min-h-[38px] rounded-lg border border-[#27272E] bg-[#0A0A0A] px-2.5 font-mono text-xs text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>

              <div>
                <label
                  htmlFor="bulk-supplier-name"
                  className="block text-[11px] font-semibold text-zinc-300 mb-1"
                >
                  Nombre / Razón social
                </label>
                <input
                  id="bulk-supplier-name"
                  type="text"
                  maxLength={120}
                  value={supplierName}
                  onChange={(e) => setSupplierName(e.target.value)}
                  placeholder="Consumidor Final o Proveedor"
                  className="w-full min-h-[38px] rounded-lg border border-[#27272E] bg-[#0A0A0A] px-2.5 text-xs text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>
            </div>

            {/* Row 2: Optional contact + observation */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <input
                id="bulk-supplier-phone"
                type="text"
                aria-label="Teléfono del proveedor (opcional)"
                maxLength={40}
                value={supplierPhone}
                onChange={(e) => setSupplierPhone(e.target.value)}
                placeholder="Teléfono / WhatsApp (opc.)"
                className="w-full min-h-[36px] rounded-lg border border-[#27272E] bg-[#0A0A0A] px-2.5 text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
              <input
                id="bulk-supplier-email"
                type="email"
                aria-label="Correo del proveedor (opcional)"
                maxLength={160}
                value={supplierEmail}
                onChange={(e) => setSupplierEmail(e.target.value)}
                placeholder="Correo electrónico (opc.)"
                className="w-full min-h-[36px] rounded-lg border border-[#27272E] bg-[#0A0A0A] px-2.5 text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
              <input
                id="bulk-invoice-notes"
                type="text"
                aria-label="Observación de la colilla (opcional)"
                maxLength={300}
                value={invoiceNotes}
                onChange={(e) => setInvoiceNotes(e.target.value)}
                placeholder="Observación o dirección (opc.)"
                className="w-full min-h-[36px] rounded-lg border border-[#27272E] bg-[#0A0A0A] px-2.5 text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>
          </section>

          {/* BLOCK 2: Materia prima + Gastos en un solo bloque con listado de 1 renglón */}
          <section className="bg-[#141418] border border-[#27272E] rounded-2xl p-3.5 sm:p-4 space-y-3">
            {/* Compact Top Picker Strip */}
            <div className="flex flex-col lg:flex-row lg:items-center gap-2">
              <div className="relative flex-1">
                <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="search"
                  aria-label="Buscar producto creado para agregar"
                  value={ingredientSearch}
                  onChange={(e) => setIngredientSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      if (matchingIngredients.length > 0 && ingredientSearch.trim()) {
                        addInventoriableRow(matchingIngredients[0]);
                      }
                    }
                  }}
                  placeholder="Buscar materia prima creada (Carne, Pan, Queso...) o elige abajo..."
                  className="w-full min-h-[38px] pl-9 pr-3 rounded-lg border border-[#27272E] bg-[#0A0A0A] text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>

              <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => addInventoriableRow()}
                  className="min-h-[36px] px-2.5 rounded-lg bg-amber-500/15 border border-amber-500/60 text-amber-300 text-xs font-bold hover:bg-amber-500/25 inline-flex items-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Producto</span>
                </button>
                <button
                  type="button"
                  onClick={() => addExpenseRow('servicio')}
                  className="min-h-[36px] px-2.5 rounded-lg border border-[#27272E] bg-[#0A0A0A] hover:border-sky-500 text-xs font-semibold text-sky-300 inline-flex items-center gap-1"
                >
                  <Plus className="w-3 h-3" />
                  <span>Servicio</span>
                </button>
                <button
                  type="button"
                  onClick={() => addExpenseRow('gasto')}
                  className="min-h-[36px] px-2.5 rounded-lg border border-[#27272E] bg-[#0A0A0A] hover:border-sky-500 text-xs font-semibold text-sky-300 inline-flex items-center gap-1"
                >
                  <Plus className="w-3 h-3" />
                  <span>Gasto</span>
                </button>
                <button
                  type="button"
                  onClick={() => addExpenseRow('no_inventariable')}
                  className="min-h-[36px] px-2.5 rounded-lg border border-[#27272E] bg-[#0A0A0A] hover:border-sky-500 text-xs font-semibold text-sky-300 inline-flex items-center gap-1"
                >
                  <Plus className="w-3 h-3" />
                  <span>No inv.</span>
                </button>
                <button
                  type="button"
                  onClick={() => addExpenseRow('inversion')}
                  className="min-h-[36px] px-2.5 rounded-lg border border-[#27272E] bg-[#0A0A0A] hover:border-sky-500 text-xs font-semibold text-sky-300 inline-flex items-center gap-1"
                >
                  <Plus className="w-3 h-3" />
                  <span>Inversión</span>
                </button>
              </div>
            </div>

            {/* Compact Quick-Pick Strip of Created Ingredients */}
            {sortedInventory.length > 0 && (
              <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
                {matchingIngredients.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => addInventoriableRow(item)}
                    className="min-h-[30px] px-2.5 py-1 rounded-lg border border-[#27272E] bg-[#0A0A0A] hover:border-amber-500 text-xs whitespace-nowrap shrink-0 inline-flex items-center gap-1.5 transition-colors"
                  >
                    <Plus className="w-3 h-3 text-amber-400 shrink-0" />
                    <span className="font-semibold text-white">{item.name}</span>
                    <span className="font-mono text-[10px] text-zinc-400">({item.unit})</span>
                  </button>
                ))}
              </div>
            )}

            {/* Single-Line Rows Table */}
            {rows.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[#27272E] bg-[#0A0A0A] py-5 px-4 text-center">
                <Boxes className="w-6 h-6 text-zinc-500 mx-auto mb-1" />
                <p className="text-xs text-zinc-300 font-semibold">
                  Toca un producto arriba o pulsa &quot;+ Producto&quot;, &quot;+ Servicio&quot; o &quot;+ Gasto&quot;
                </p>
                <p className="text-[11px] text-zinc-500 mt-0.5">
                  Solo eliges el producto y escribes cantidad y precio; el valor por g/ud se calcula solo.
                </p>
              </div>
            ) : (
              <div className="rounded-xl border border-[#27272E] bg-[#0A0A0A] overflow-hidden">
                {/* Desktop single-line column headers */}
                <div className="hidden md:grid md:grid-cols-12 gap-2 px-3 py-2 border-b border-[#27272E] bg-[#101014] text-[10px] font-bold uppercase tracking-wide text-zinc-400">
                  <div className="col-span-5">Producto / Concepto</div>
                  <div className="col-span-2">Cantidad</div>
                  <div className="col-span-2">Precio ($)</div>
                  <div className="col-span-2 text-right">Precio unidad</div>
                  <div className="col-span-1 text-right">Quitar</div>
                </div>

                <div className="divide-y divide-[#27272E]">
                  {rows.map((row, idx) => {
                    const isInv = row.kind === 'inventariable';
                    const qtyNum = Number(row.quantityStr);
                    const costNum = Number(row.totalCostStr);
                    const unitCostPreview =
                      isInv &&
                      Number.isFinite(qtyNum) &&
                      qtyNum > 0 &&
                      Number.isFinite(costNum) &&
                      costNum >= 0
                        ? calculatePurchaseUnitCost(qtyNum, costNum)
                        : 0;

                    return (
                      <div
                        key={row.id}
                        className="px-3 py-2 grid grid-cols-12 gap-2 items-center"
                      >
                        {/* Product or Expense Selector + Description */}
                        {isInv ? (
                          <div className="col-span-10 md:col-span-5 flex items-center gap-1.5 min-w-0">
                            <span className="font-mono text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-amber-500/15 border border-amber-500/40 text-amber-300 shrink-0">
                              {row.unit || 'g'}
                            </span>
                            <select
                              aria-label={`Producto inventariable fila ${idx + 1}`}
                              value={row.inventoryItemId || ''}
                              onChange={(e) => changeRowInventoryItem(row.id, e.target.value)}
                              className="flex-1 min-w-0 min-h-[36px] rounded-lg border border-[#27272E] bg-[#141418] px-2 text-xs font-semibold text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                            >
                              {sortedInventory.map((item) => (
                                <option key={item.id} value={item.id}>
                                  {item.name} ({item.unit})
                                </option>
                              ))}
                            </select>
                          </div>
                        ) : (
                          <div className="col-span-10 md:col-span-5 flex items-center gap-1.5 min-w-0">
                            <select
                              aria-label={`Tipo de gasto fila ${idx + 1}`}
                              value={row.kind}
                              onChange={(e) =>
                                updateRow(row.id, {
                                  kind: e.target.value as Exclude<
                                    ExpenseLineKind,
                                    'inventariable'
                                  >,
                                })
                              }
                              className="w-28 shrink-0 min-h-[36px] rounded-lg border border-sky-700/60 bg-sky-950/40 px-2 text-[11px] font-bold text-sky-200 focus:outline-none focus:ring-2 focus:ring-sky-500"
                            >
                              <option value="servicio">Servicio</option>
                              <option value="gasto">Gasto</option>
                              <option value="no_inventariable">No inv.</option>
                              <option value="inversion">Inversión</option>
                            </select>
                            <input
                              ref={(el) => {
                                descInputRefs.current[row.id] = el;
                              }}
                              type="text"
                              aria-label={`Descripción gasto fila ${idx + 1}`}
                              maxLength={120}
                              value={row.description}
                              onChange={(e) => updateRow(row.id, { description: e.target.value })}
                              placeholder="Ej. Recibo luz, Gas, Bolsas..."
                              className="flex-1 min-w-0 min-h-[36px] rounded-lg border border-[#27272E] bg-[#141418] px-2.5 text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-sky-500"
                            />
                          </div>
                        )}

                        {/* Mobile delete button on top row */}
                        <div className="col-span-2 flex justify-end md:hidden">
                          <button
                            type="button"
                            onClick={() => removeRow(row.id)}
                            aria-label={`Quitar fila ${row.description || idx + 1}`}
                            className="min-h-[34px] min-w-[34px] flex items-center justify-center rounded-lg text-red-400 hover:bg-red-950/50"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>

                        {/* Quantity */}
                        <div className="col-span-5 md:col-span-2">
                          <div className="relative">
                            <input
                              ref={(el) => {
                                qtyInputRefs.current[row.id] = el;
                              }}
                              type="number"
                              aria-label={`Cantidad fila ${idx + 1}`}
                              min={0.01}
                              step="any"
                              value={row.quantityStr}
                              onChange={(e) => updateRow(row.id, { quantityStr: e.target.value })}
                              placeholder={isInv ? (row.unit === 'g' ? 'Ej. 2000' : 'Ej. 24') : '1'}
                              className="w-full min-h-[36px] rounded-lg border border-[#27272E] bg-[#141418] pl-2.5 pr-8 font-mono text-xs text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                            />
                            <span className="absolute right-2 top-1/2 -translate-y-1/2 font-mono text-[10px] text-zinc-400 pointer-events-none">
                              {isInv ? row.unit || 'g' : 'x'}
                            </span>
                          </div>
                        </div>

                        {/* Total Cost ($) */}
                        <div className="col-span-5 md:col-span-2">
                          <div className="relative">
                            <span className="absolute left-2 top-1/2 -translate-y-1/2 font-mono text-[11px] text-zinc-500 pointer-events-none">
                              $
                            </span>
                            <input
                              type="number"
                              aria-label={`Precio total fila ${idx + 1}`}
                              min={0}
                              step={100}
                              value={row.totalCostStr}
                              onChange={(e) => updateRow(row.id, { totalCostStr: e.target.value })}
                              placeholder="Precio"
                              className="w-full min-h-[36px] rounded-lg border border-[#27272E] bg-[#141418] pl-5 pr-2 font-mono text-xs text-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-500"
                            />
                          </div>
                        </div>

                        {/* Auto-calculated Unit Price */}
                        <div className="col-span-2 md:col-span-2 text-right font-mono text-xs font-bold tabular-nums">
                          {isInv ? (
                            <span className={qtyNum > 0 ? 'text-emerald-400' : 'text-zinc-500'}>
                              {qtyNum > 0
                                ? formatUnitCost(unitCostPreview, row.unit || 'g')
                                : '--'}
                            </span>
                          ) : (
                            <span className="text-[10px] text-zinc-500 font-sans font-normal">
                              No inv.
                            </span>
                          )}
                        </div>

                        {/* Desktop delete button */}
                        <div className="hidden md:flex md:col-span-1 justify-end">
                          <button
                            type="button"
                            onClick={() => removeRow(row.id)}
                            aria-label={`Quitar fila ${row.description || idx + 1}`}
                            className="min-h-[34px] min-w-[34px] flex items-center justify-center rounded-lg text-red-400 hover:bg-red-950/50"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </section>

          {/* Compact Summary & Save Bar */}
          <section className="bg-[#141418] border border-amber-500/40 rounded-2xl p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-4 text-xs">
              <div>
                <span className="text-zinc-400">Inventariables: </span>
                <strong className="font-mono text-amber-400 tabular-nums">
                  {formatCurrency(normalizedDraftSummary.inventoriableTotal)}
                </strong>
              </div>
              <div>
                <span className="text-zinc-400">Gastos/Servicios: </span>
                <strong className="font-mono text-sky-400 tabular-nums">
                  {formatCurrency(normalizedDraftSummary.expensesTotal)}
                </strong>
              </div>
              <div>
                <span className="text-zinc-400">Total colilla: </span>
                <strong className="font-mono text-base text-emerald-400 tabular-nums">
                  {formatCurrency(normalizedDraftSummary.grandTotal)}
                </strong>
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="min-h-[42px] px-5 rounded-xl bg-amber-500 text-black text-sm font-extrabold hover:bg-amber-400 inline-flex items-center justify-center gap-2 whitespace-nowrap shadow-md disabled:opacity-60"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>{submitting ? 'Guardando...' : 'Guardar colilla'}</span>
            </button>
          </section>
        </form>
      )}
    </div>
  );
};
