import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Boxes,
  Calculator,
  Edit3,
  GitMerge,
  History,
  Lock,
  Plus,
  Receipt,
  Search,
  ShoppingBag,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react';
import { BulkPurchaseWorkspace } from '../components/BulkPurchaseWorkspace';
import { usePosStore } from '../services/posStore';
import type { InventoryItem, InventoryMovementType, InventoryUnit } from '../types/pos';
import {
  calculatePurchaseUnitCost,
  formatInventoryNumber,
  formatInventoryQuantity,
  formatUnitCost,
  hasDuplicateInventoryName,
  isRecipeSpecInventoriable,
  roundStockQty,
} from '../utils/inventoryMath';
import { formatCurrency } from '../utils/orderMath';
import { ROLE_LABELS } from '../utils/rolePermissions';

type InventoryFilter = 'todos' | 'negativo' | 'bajo' | 'gramos' | 'unidades';
type InventoryScreenView = 'stock' | 'entrada' | 'colillas';

const MOVEMENT_LABELS: Record<InventoryMovementType, { label: string; tone: string }> = {
  compra: { label: 'Compra', tone: 'bg-emerald-950/70 text-emerald-300 border-emerald-700/70' },
  consumo_pedido: { label: 'Venta / Pedido', tone: 'bg-red-950/60 text-red-300 border-red-800/70' },
  edicion_pedido: { label: 'Edición pedido', tone: 'bg-amber-950/60 text-amber-300 border-amber-700/70' },
  anulacion_pedido: { label: 'Anulación pedido', tone: 'bg-sky-950/60 text-sky-300 border-sky-700/70' },
  ajuste_manual: { label: 'Ajuste manual', tone: 'bg-zinc-900 text-zinc-200 border-zinc-700' },
  fusion: { label: 'Fusión', tone: 'bg-purple-950/60 text-purple-300 border-purple-700/70' },
};

export const InventoryView: React.FC = () => {
  const {
    inventory,
    inventoryMovements,
    products,
    effectiveRole,
    permissions,
    saveInventoryItem,
    registerInventoryPurchase,
    adjustInventoryStock,
    deleteInventoryItem,
    mergeInventoryItems,
  } = usePosStore();

  const [screenView, setScreenView] = useState<InventoryScreenView>('stock');
  const [searchTerm, setSearchTerm] = useState('');
  const [filter, setFilter] = useState<InventoryFilter>('todos');
  const [showMovements, setShowMovements] = useState(false);

  // Create / Edit modal state
  const [itemModal, setItemModal] = useState<{
    open: boolean;
    editing: InventoryItem | null;
  }>({ open: false, editing: null });
  const [formName, setFormName] = useState('');
  const [formUnit, setFormUnit] = useState<InventoryUnit>('g');
  const [formMinStock, setFormMinStock] = useState('0');
  const [formInitQty, setFormInitQty] = useState('');
  const [formInitCost, setFormInitCost] = useState('');
  const [mergeTargetId, setMergeTargetId] = useState('');

  // Purchase modal state
  const [purchaseItem, setPurchaseItem] = useState<InventoryItem | null>(null);
  const [purchaseQty, setPurchaseQty] = useState('');
  const [purchaseCost, setPurchaseCost] = useState('');
  const [purchaseNotes, setPurchaseNotes] = useState('');

  // Adjust modal state
  const [adjustItem, setAdjustItem] = useState<InventoryItem | null>(null);
  const [adjustNewStock, setAdjustNewStock] = useState('');
  const [adjustNotes, setAdjustNotes] = useState('');

  // Delete confirmation modal
  const [deleteTarget, setDeleteTarget] = useState<InventoryItem | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);

  useEffect(() => {
    const handleBackIntercept = (e: Event) => {
      if (deleteTarget) {
        e.preventDefault();
        if (!submitting) setDeleteTarget(null);
      } else if (purchaseItem) {
        e.preventDefault();
        if (!submitting) setPurchaseItem(null);
      } else if (adjustItem) {
        e.preventDefault();
        if (!submitting) setAdjustItem(null);
      } else if (itemModal.open) {
        e.preventDefault();
        if (!submitting) setItemModal({ open: false, editing: null });
      } else if (screenView !== 'stock') {
        e.preventDefault();
        setScreenView('stock');
      }
    };
    window.addEventListener('ondeluigi:back-intercept', handleBackIntercept);
    return () => window.removeEventListener('ondeluigi:back-intercept', handleBackIntercept);
  }, [deleteTarget, purchaseItem, adjustItem, itemModal.open, screenView, submitting]);

  const sortedInventory = useMemo(
    () => [...inventory].sort((a, b) => a.name.localeCompare(b.name, 'es')),
    [inventory]
  );

  // Map each inventory item to products using it (with gramaje/cantidad)
  const usageByInventoryId = useMemo(() => {
    const map = new Map<
      string,
      Array<{ productId: string; productName: string; quantity: number; unit: InventoryUnit }>
    >();
    for (const prod of products) {
      for (const spec of prod.recipeIngredients || []) {
        if (!isRecipeSpecInventoriable(spec)) continue;
        const list = map.get(spec.inventoryItemId) || [];
        list.push({
          productId: prod.id,
          productName: prod.name,
          quantity: spec.quantity,
          unit: spec.unit,
        });
        map.set(spec.inventoryItemId, list);
      }
    }
    return map;
  }, [products]);

  const stats = useMemo(() => {
    let negativeCount = 0;
    let lowOrZeroCount = 0;
    let totalValuation = 0;
    for (const item of inventory) {
      if (item.currentStock < 0) {
        negativeCount += 1;
      } else if (item.currentStock === 0 || (item.minStock > 0 && item.currentStock <= item.minStock)) {
        lowOrZeroCount += 1;
      }
      if (item.currentStock > 0 && item.unitCost > 0) {
        totalValuation += item.currentStock * item.unitCost;
      }
    }
    return {
      total: inventory.length,
      negativeCount,
      lowOrZeroCount,
      totalValuation: Math.round(totalValuation),
    };
  }, [inventory]);

  const filteredInventory = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return sortedInventory.filter((item) => {
      if (q && !item.name.toLowerCase().includes(q)) return false;
      if (filter === 'negativo') return item.currentStock < 0;
      if (filter === 'bajo')
        return item.currentStock < 0 || item.currentStock === 0 || (item.minStock > 0 && item.currentStock <= item.minStock);
      if (filter === 'gramos') return item.unit === 'g';
      if (filter === 'unidades') return item.unit === 'ud';
      return true;
    });
  }, [sortedInventory, searchTerm, filter]);

  const isDuplicateFormName = useMemo(
    () => hasDuplicateInventoryName(formName, inventory, itemModal.editing?.id),
    [formName, inventory, itemModal.editing?.id]
  );

  const previewInitUnitCost = useMemo(() => {
    const q = Number(formInitQty);
    const c = Number(formInitCost);
    if (!Number.isFinite(q) || q <= 0 || !Number.isFinite(c) || c < 0) return 0;
    return calculatePurchaseUnitCost(q, c);
  }, [formInitQty, formInitCost]);

  const previewPurchaseUnitCost = useMemo(() => {
    const q = Number(purchaseQty);
    const c = Number(purchaseCost);
    if (!Number.isFinite(q) || q <= 0 || !Number.isFinite(c) || c < 0) return 0;
    return calculatePurchaseUnitCost(q, c);
  }, [purchaseQty, purchaseCost]);

  if (!permissions.canManageInventory) {
    return (
      <div className="bg-[#141418] border border-[#27272E] rounded-2xl p-10 text-center max-w-lg mx-auto my-8 space-y-3">
        <Lock className="w-10 h-10 text-amber-400 mx-auto" />
        <h1 className="font-poster text-2xl font-extrabold text-white tracking-wide">
          ACCESO ADMINISTRATIVO REQUERIDO
        </h1>
        <p className="text-sm text-zinc-400">
          Solo las cuentas Administradoras pueden ver y gestionar el inventario de ingredientes y costos. Tu rol actual es{' '}
          <strong className="text-white">{ROLE_LABELS[effectiveRole]}</strong>.
        </p>
      </div>
    );
  }

  const openCreateModal = () => {
    setActionError(null);
    setFormName('');
    setFormUnit('g');
    setFormMinStock('0');
    setFormInitQty('');
    setFormInitCost('');
    setMergeTargetId('');
    setItemModal({ open: true, editing: null });
  };

  const openEditModal = (item: InventoryItem) => {
    setActionError(null);
    setFormName(item.name);
    setFormUnit(item.unit);
    setFormMinStock(String(item.minStock || 0));
    setFormInitQty('');
    setFormInitCost('');
    setMergeTargetId('');
    setItemModal({ open: true, editing: item });
  };

  const openPurchaseModal = (item: InventoryItem) => {
    setActionError(null);
    setPurchaseQty('');
    setPurchaseCost('');
    setPurchaseNotes('');
    setPurchaseItem(item);
  };

  const openAdjustModal = (item: InventoryItem) => {
    setActionError(null);
    setAdjustNewStock(String(roundStockQty(item.currentStock)));
    setAdjustNotes('');
    setAdjustItem(item);
  };

  const handleSaveItemSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = formName.trim().replace(/\s+/g, ' ');
    if (!cleanName) {
      setActionError('Escribe el nombre del ingrediente.');
      return;
    }
    if (isDuplicateFormName) {
      setActionError(`Ya existe un ingrediente llamado "${cleanName}" en el inventario.`);
      return;
    }

    const minStockNum = Number(formMinStock || 0);
    if (Number.isNaN(minStockNum) || minStockNum < 0) {
      setActionError('Ingresa un stock mínimo válido.');
      return;
    }

    const initQtyNum = formInitQty.trim() ? Number(formInitQty) : 0;
    const initCostNum = formInitCost.trim() ? Number(formInitCost) : 0;
    if (!itemModal.editing && formInitQty.trim() && (Number.isNaN(initQtyNum) || initQtyNum < 0)) {
      setActionError('Ingresa una cantidad inicial válida.');
      return;
    }
    if (!itemModal.editing && formInitCost.trim() && (Number.isNaN(initCostNum) || initCostNum < 0)) {
      setActionError('Ingresa un costo total inicial válido.');
      return;
    }

    setSubmitting(true);
    setActionError(null);
    try {
      await saveInventoryItem({
        id: itemModal.editing?.id,
        name: cleanName,
        unit: formUnit,
        minStock: minStockNum,
        initialQuantity: !itemModal.editing ? initQtyNum : undefined,
        initialTotalCost: !itemModal.editing ? initCostNum : undefined,
      });
      setStatusNotice(
        itemModal.editing
          ? `Ingrediente "${cleanName}" actualizado.`
          : `Ingrediente "${cleanName}" agregado al inventario.`
      );
      setItemModal({ open: false, editing: null });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'No se pudo guardar el ingrediente.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleMergeSubmit = async () => {
    if (!itemModal.editing || !mergeTargetId) return;
    setSubmitting(true);
    setActionError(null);
    try {
      const sourceName = itemModal.editing.name;
      const targetName = inventory.find((i) => i.id === mergeTargetId)?.name || 'destino';
      await mergeInventoryItems(itemModal.editing.id, mergeTargetId);
      setStatusNotice(`"${sourceName}" se fusionó correctamente con "${targetName}".`);
      setItemModal({ open: false, editing: null });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'No se pudo fusionar el ingrediente.');
    } finally {
      setSubmitting(false);
    }
  };

  const handlePurchaseSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!purchaseItem) return;
    const qty = Number(purchaseQty);
    const cost = Number(purchaseCost || 0);
    if (!Number.isFinite(qty) || qty <= 0) {
      setActionError(`Ingresa una cantidad comprada mayor a 0 (${purchaseItem.unit}).`);
      return;
    }
    if (!Number.isFinite(cost) || cost < 0) {
      setActionError('Ingresa el costo total pagado.');
      return;
    }

    setSubmitting(true);
    setActionError(null);
    try {
      await registerInventoryPurchase({
        inventoryItemId: purchaseItem.id,
        quantity: qty,
        totalCost: cost,
        notes: purchaseNotes,
      });
      const unitCostCalc = calculatePurchaseUnitCost(qty, cost);
      setStatusNotice(
        `Compra registrada: +${formatInventoryQuantity(qty, purchaseItem.unit)} de ${purchaseItem.name} (${formatUnitCost(unitCostCalc, purchaseItem.unit)}).`
      );
      setPurchaseItem(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Error al registrar compra.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleAdjustSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjustItem) return;
    const nextVal = Number(adjustNewStock);
    if (!Number.isFinite(nextVal)) {
      setActionError('Ingresa un número válido para el inventario actual.');
      return;
    }

    setSubmitting(true);
    setActionError(null);
    try {
      await adjustInventoryStock({
        inventoryItemId: adjustItem.id,
        newStock: nextVal,
        notes: adjustNotes,
      });
      setStatusNotice(
        `Stock de ${adjustItem.name} ajustado a ${formatInventoryQuantity(nextVal, adjustItem.unit)}.`
      );
      setAdjustItem(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Error al ajustar el inventario.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    setSubmitting(true);
    setActionError(null);
    try {
      await deleteInventoryItem(deleteTarget.id);
      setStatusNotice(`Ingrediente "${deleteTarget.name}" eliminado del inventario.`);
      setDeleteTarget(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Error al eliminar ingrediente.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      {screenView !== 'stock' ? (
        <BulkPurchaseWorkspace
          mode={screenView === 'entrada' ? 'entrada' : 'historial'}
          onChangeMode={(nextMode) => setScreenView(nextMode === 'entrada' ? 'entrada' : 'colillas')}
          onBackToStock={() => setScreenView('stock')}
          onOpenNewIngredientModal={openCreateModal}
          statusNotice={statusNotice}
          onDismissNotice={() => setStatusNotice(null)}
          onSuccessNotice={(msg) => setStatusNotice(msg)}
        />
      ) : (
        <>
          {/* Compact Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
            <h1 className="font-poster text-3xl sm:text-4xl font-extrabold tracking-wide text-white leading-none">
              INVENTARIO
            </h1>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setScreenView('entrada')}
                className="min-h-[42px] px-4 rounded-xl border border-amber-500/70 bg-[#1C1C22] text-amber-300 text-xs sm:text-sm font-bold hover:bg-amber-500/15 flex items-center justify-center gap-2 whitespace-nowrap"
              >
                <Receipt className="w-4 h-4 text-amber-400 shrink-0" />
                <span>Registro de colillas</span>
              </button>
              <button
                type="button"
                onClick={openCreateModal}
                className="min-h-[42px] px-4 rounded-xl bg-amber-500 text-black text-xs sm:text-sm font-bold hover:bg-amber-400 flex items-center justify-center gap-1.5 whitespace-nowrap shadow-sm"
              >
                <Plus className="w-4 h-4 shrink-0" />
                <span>Nuevo ingrediente</span>
              </button>
            </div>
          </div>

          {statusNotice && (
            <div
              role="status"
              className="rounded-xl bg-emerald-950/60 border border-emerald-700 px-3.5 py-2 text-xs font-medium text-emerald-200 flex items-center justify-between gap-2"
            >
              <span>{statusNotice}</span>
              <button
                type="button"
                onClick={() => setStatusNotice(null)}
                aria-label="Cerrar aviso"
                className="text-emerald-300 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

      {/* Compact KPIs */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        <div className="bg-[#141418] border border-[#27272E] rounded-xl px-3.5 py-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
            Ingredientes
          </p>
          <p className="font-mono text-xl font-extrabold text-white mt-0.5 tabular-nums">
            {stats.total}
          </p>
        </div>

        <div
          className={`rounded-xl px-3.5 py-2.5 border ${
            stats.negativeCount > 0
              ? 'bg-red-950/35 border-red-700/70'
              : 'bg-[#141418] border-[#27272E]'
          }`}
        >
          <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
            En negativo
          </p>
          <p
            className={`font-mono text-xl font-extrabold mt-0.5 tabular-nums ${
              stats.negativeCount > 0 ? 'text-red-400' : 'text-emerald-400'
            }`}
          >
            {stats.negativeCount}
          </p>
        </div>

        <div className="bg-[#141418] border border-[#27272E] rounded-xl px-3.5 py-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
            Cero / stock bajo
          </p>
          <p className="font-mono text-xl font-extrabold text-amber-400 mt-0.5 tabular-nums">
            {stats.lowOrZeroCount}
          </p>
        </div>

        <div className="bg-[#141418] border border-[#27272E] rounded-xl px-3.5 py-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
            Valor en stock
          </p>
          <p className="font-mono text-xl font-extrabold text-emerald-400 mt-0.5 tabular-nums">
            {formatCurrency(stats.totalValuation)}
          </p>
        </div>
      </section>

      {/* Search & Filters */}
      <div className="bg-[#141418] border border-[#27272E] rounded-xl p-2.5 flex flex-col md:flex-row gap-2.5">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="search"
            aria-label="Buscar ingrediente en inventario"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Buscar ingrediente..."
            className="w-full min-h-[38px] pl-9 pr-3 rounded-lg border border-[#27272E] bg-[#0A0A0A] text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
          />
        </div>

        <div className="flex items-center gap-1 p-1 bg-[#0A0A0A] border border-[#27272E] rounded-lg overflow-x-auto">
          {(
            [
              { id: 'todos', label: 'Todos' },
              { id: 'negativo', label: `Negativos (${stats.negativeCount})` },
              { id: 'bajo', label: 'Cero / Bajo' },
              { id: 'gramos', label: 'Gramos (g)' },
              { id: 'unidades', label: 'Unidades (ud)' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setFilter(tab.id)}
              className={`min-h-[32px] px-2.5 rounded-md text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
                filter === tab.id
                  ? 'bg-amber-500 text-black font-bold'
                  : 'text-zinc-300 hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Inventory Cards */}
      {filteredInventory.length === 0 ? (
        <div className="bg-[#141418] border border-[#27272E] rounded-2xl p-8 text-center space-y-2">
          <Boxes className="w-8 h-8 text-zinc-500 mx-auto" />
          <p className="text-sm font-semibold text-zinc-200">
            {inventory.length === 0
              ? 'No hay ingredientes registrados todavía.'
              : 'Ningún ingrediente coincide con el filtro actual.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 items-stretch">
          {filteredInventory.map((item) => {
            const usedIn = usageByInventoryId.get(item.id) || [];
            const isNegative = item.currentStock < 0;
            const isZero = item.currentStock === 0;
            const isLow = item.minStock > 0 && item.currentStock > 0 && item.currentStock <= item.minStock;
            const pendingGramajeCount = usedIn.filter((u) => u.quantity <= 0).length;

            return (
              <article
                key={item.id}
                className={`bg-[#141418] border rounded-xl p-3 flex flex-col justify-between gap-2.5 ${
                  isNegative
                    ? 'border-red-700/80'
                    : isZero || isLow
                      ? 'border-amber-500/60'
                      : 'border-[#27272E]'
                }`}
              >
                <div className="space-y-2">
                  {/* Name + Stock badge */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-mono font-bold uppercase px-1.5 py-0.5 rounded bg-[#1C1C22] border border-[#27272E] text-amber-400">
                          {item.unit === 'g' ? 'Gramos (g)' : 'Unidad (ud)'}
                        </span>
                        {isNegative && (
                          <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-red-950 border border-red-700 text-red-300">
                            En negativo
                          </span>
                        )}
                        {isZero && (
                          <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-amber-950 border border-amber-700 text-amber-300">
                            En cero
                          </span>
                        )}
                        {isLow && (
                          <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-amber-950 border border-amber-700 text-amber-300">
                            Stock bajo
                          </span>
                        )}
                      </div>
                      <h2 className="font-poster text-xl font-extrabold text-white mt-1 uppercase leading-tight truncate">
                        {item.name}
                      </h2>
                    </div>

                    <div className="text-right shrink-0">
                      <p className="text-[10px] text-zinc-400 uppercase font-semibold">Contador</p>
                      <p
                        className={`font-mono text-xl font-extrabold tabular-nums leading-tight ${
                          isNegative
                            ? 'text-red-400'
                            : isZero || isLow
                              ? 'text-amber-400'
                              : 'text-emerald-400'
                        }`}
                      >
                        {formatInventoryQuantity(item.currentStock, item.unit)}
                      </p>
                    </div>
                  </div>

                  {/* Unit Cost + Last Purchase */}
                  <div className="rounded-xl bg-[#0A0A0A] border border-[#27272E] p-2.5 flex items-center justify-between gap-2 text-xs">
                    <div>
                      <p className="text-[10px] text-zinc-400 uppercase font-semibold">
                        Valor por {item.unit === 'g' ? 'gramo' : 'unidad'}
                      </p>
                      <p className="font-mono font-bold text-amber-400 tabular-nums mt-0.5">
                        {item.unitCost > 0
                          ? formatUnitCost(item.unitCost, item.unit)
                          : 'Sin costo aún'}
                      </p>
                    </div>
                    {item.lastPurchaseQuantity > 0 && (
                      <div className="text-right">
                        <p className="text-[10px] text-zinc-500">Última compra</p>
                        <p className="font-mono text-[11px] text-zinc-300 tabular-nums">
                          {formatInventoryQuantity(item.lastPurchaseQuantity, item.unit)} ·{' '}
                          {formatCurrency(item.lastPurchaseTotalCost)}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Used in recipes */}
                  <div className="text-xs space-y-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-semibold text-zinc-300">
                        Recetas ({usedIn.length})
                      </span>
                      {pendingGramajeCount > 0 && (
                        <span className="text-amber-400 font-medium">
                          {pendingGramajeCount} sin gramaje
                        </span>
                      )}
                    </div>
                    {usedIn.length === 0 ? (
                      <p className="text-[11px] text-zinc-500">
                        Aún no está asignado en ningún producto.
                      </p>
                    ) : (
                      <p className="text-[11px] text-zinc-400 leading-relaxed line-clamp-2">
                        {usedIn
                          .map(
                            (u) =>
                              `${u.productName} (${
                                u.quantity > 0
                                  ? formatInventoryQuantity(u.quantity, u.unit)
                                  : `0 ${u.unit}`
                              })`
                          )
                          .join(' · ')}
                      </p>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-[#27272E]">
                  <button
                    type="button"
                    onClick={() => openPurchaseModal(item)}
                    className="flex-1 min-h-[38px] px-3 rounded-xl bg-amber-500 text-black text-xs font-bold hover:bg-amber-400 flex items-center justify-center gap-1.5 whitespace-nowrap"
                  >
                    <ShoppingBag className="w-3.5 h-3.5" />
                    <span>+ Comprar</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => openAdjustModal(item)}
                    aria-label={`Ajustar contador de ${item.name}`}
                    className="min-h-[38px] px-2.5 rounded-xl border border-[#27272E] bg-[#1C1C22] text-xs font-semibold text-zinc-200 hover:border-amber-500 flex items-center gap-1 whitespace-nowrap"
                  >
                    <SlidersHorizontal className="w-3.5 h-3.5 text-amber-400" />
                    <span>Ajustar</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => openEditModal(item)}
                    aria-label={`Editar ingrediente ${item.name}`}
                    className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl border border-[#27272E] bg-[#1C1C22] text-zinc-200 hover:border-amber-500"
                  >
                    <Edit3 className="w-3.5 h-3.5 text-amber-400" />
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setActionError(null);
                      setDeleteTarget(item);
                    }}
                    aria-label={`Eliminar ingrediente ${item.name}`}
                    className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl border border-red-900/70 bg-red-950/40 text-red-400 hover:bg-red-950"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Inventory Movements Ledger */}
      <section className="bg-[#141418] border border-[#27272E] rounded-xl overflow-hidden">
        <button
          type="button"
          onClick={() => setShowMovements((v) => !v)}
          className="w-full px-4 py-3 flex items-center justify-between gap-3 text-left hover:bg-[#1C1C22]/50 transition-colors"
        >
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-amber-400 shrink-0" />
            <h2 className="font-poster text-base sm:text-lg font-extrabold tracking-wide text-white uppercase leading-none">
              MOVIMIENTOS DE INVENTARIO ({inventoryMovements.length})
            </h2>
          </div>
          <span className="text-xs font-bold text-amber-400 whitespace-nowrap">
            {showMovements ? 'Ocultar' : 'Ver historial'}
          </span>
        </button>

        {showMovements && (
          <div className="border-t border-[#27272E] divide-y divide-[#27272E] max-h-96 overflow-y-auto">
            {inventoryMovements.length === 0 ? (
              <p className="p-5 text-xs text-zinc-400 text-center">
                Aún no hay movimientos de inventario registrados.
              </p>
            ) : (
              inventoryMovements.slice(0, 80).map((mov) => {
                const meta = MOVEMENT_LABELS[mov.type] || MOVEMENT_LABELS.ajuste_manual;
                const isPositive = mov.quantityDelta > 0;
                return (
                  <div
                    key={mov.id}
                    className="px-4 sm:px-5 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                  >
                    <div className="space-y-0.5 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${meta.tone}`}>
                          {meta.label}
                        </span>
                        <span className="font-bold text-white">{mov.ingredientName}</span>
                        {mov.orderNumber > 0 && (
                          <span className="font-mono text-[11px] text-zinc-400">
                            Pedido #{mov.orderNumber}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-zinc-400 truncate">
                        {mov.notes || 'Movimiento registrado'} · Por {mov.actorName} ·{' '}
                        {new Date(mov.createdAtMs).toLocaleString('es-CO', {
                          dateStyle: 'short',
                          timeStyle: 'short',
                        })}
                      </p>
                    </div>

                    <div className="flex items-center gap-3 shrink-0 sm:text-right">
                      {mov.type === 'compra' && mov.purchaseTotalCost > 0 && (
                        <span className="font-mono text-[11px] text-zinc-300 tabular-nums">
                          {formatCurrency(mov.purchaseTotalCost)} ({formatUnitCost(mov.calculatedUnitCost, mov.unit)})
                        </span>
                      )}
                      <span
                        className={`font-mono text-sm font-extrabold tabular-nums inline-flex items-center gap-0.5 ${
                          isPositive ? 'text-emerald-400' : 'text-red-400'
                        }`}
                      >
                        {isPositive ? (
                          <ArrowUpRight className="w-3.5 h-3.5" />
                        ) : (
                          <ArrowDownRight className="w-3.5 h-3.5" />
                        )}
                        {isPositive ? '+' : ''}
                        {formatInventoryQuantity(mov.quantityDelta, mov.unit)}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </section>
      </>
      )}

      {/* Modal: Create / Edit Ingredient */}
      {itemModal.open && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-sm sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="inv-item-modal-title"
        >
          <form
            onSubmit={handleSaveItemSubmit}
            className="w-full sm:max-w-lg bg-[#141418] text-white rounded-t-3xl sm:rounded-2xl border border-[#27272E] shadow-2xl overflow-hidden max-h-[92vh] flex flex-col"
          >
            <div className="px-5 py-4 border-b border-[#27272E] flex items-center justify-between bg-[#101014]">
              <h2 id="inv-item-modal-title" className="font-poster text-xl font-extrabold tracking-wide uppercase">
                {itemModal.editing
                  ? `EDITAR: ${itemModal.editing.name}`
                  : 'NUEVO INGREDIENTE DE INVENTARIO'}
              </h2>
              <button
                type="button"
                disabled={submitting}
                onClick={() => setItemModal({ open: false, editing: null })}
                aria-label="Cerrar modal de ingrediente"
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-zinc-400 hover:bg-[#1C1C22]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-4">
              {actionError && (
                <div className="rounded-xl bg-red-950/60 border border-red-700 px-3.5 py-2.5 text-xs font-medium text-red-200">
                  {actionError}
                </div>
              )}

              <div>
                <label htmlFor="inv-form-name" className="block text-xs font-semibold text-zinc-300 mb-1">
                  Nombre del ingrediente
                </label>
                <input
                  id="inv-form-name"
                  type="text"
                  maxLength={80}
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="Ej. Ensalada, Carne de res, Queso, Pan brioche..."
                  className={`w-full min-h-[44px] rounded-xl border bg-[#0A0A0A] px-3 text-sm text-white focus:outline-none focus:ring-2 ${
                    isDuplicateFormName
                      ? 'border-red-500 focus:ring-red-500'
                      : 'border-[#27272E] focus:ring-amber-500'
                  }`}
                />
                {isDuplicateFormName && (
                  <p className="text-[11px] text-red-400 font-medium mt-1">
                    Este ingrediente ya existe. Usa el ingrediente existente para inventariar todas las recetas juntas.
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-zinc-300 mb-1">
                    Medida en inventario
                  </label>
                  <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl border border-[#27272E] bg-[#0A0A0A]">
                    <button
                      type="button"
                      onClick={() => setFormUnit('g')}
                      className={`min-h-[36px] rounded-lg text-xs font-bold transition-colors ${
                        formUnit === 'g'
                          ? 'bg-amber-500 text-black'
                          : 'text-zinc-300 hover:text-white'
                      }`}
                    >
                      Gramos (g)
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormUnit('ud')}
                      className={`min-h-[36px] rounded-lg text-xs font-bold transition-colors ${
                        formUnit === 'ud'
                          ? 'bg-amber-500 text-black'
                          : 'text-zinc-300 hover:text-white'
                      }`}
                    >
                      Unidades (ud)
                    </button>
                  </div>
                </div>

                <div>
                  <label htmlFor="inv-form-min" className="block text-xs font-semibold text-zinc-300 mb-1">
                    Alerta stock bajo ({formUnit})
                  </label>
                  <input
                    id="inv-form-min"
                    type="number"
                    min={0}
                    step="any"
                    value={formMinStock}
                    onChange={(e) => setFormMinStock(e.target.value)}
                    className="w-full min-h-[44px] rounded-xl border border-[#27272E] bg-[#0A0A0A] px-3 font-mono text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>
              </div>

              {/* Optional initial purchase with automatic unit cost calculation */}
              {!itemModal.editing && (
                <div className="rounded-xl border border-amber-500/40 bg-[#101014] p-3.5 space-y-3">
                  <div className="flex items-center gap-2">
                    <Calculator className="w-4 h-4 text-amber-400 shrink-0" />
                    <div>
                      <p className="text-xs font-bold text-white">
                        Compra inicial (opcional · calcula el valor por {formUnit === 'g' ? 'gramo' : 'unidad'})
                      </p>
                      <p className="text-[11px] text-zinc-400">
                        Ingresa cuánto compraste y cuánto te costó; el sistema calcula el precio por {formUnit}.
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="inv-init-qty" className="block text-[11px] font-semibold text-zinc-300 mb-1">
                        Cantidad comprada ({formUnit})
                      </label>
                      <input
                        id="inv-init-qty"
                        type="number"
                        min={0}
                        step="any"
                        value={formInitQty}
                        onChange={(e) => setFormInitQty(e.target.value)}
                        placeholder={formUnit === 'g' ? 'Ej. 1000' : 'Ej. 24'}
                        className="w-full min-h-[42px] rounded-xl border border-[#27272E] bg-[#0A0A0A] px-3 font-mono text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                      />
                    </div>
                    <div>
                      <label htmlFor="inv-init-cost" className="block text-[11px] font-semibold text-zinc-300 mb-1">
                        Costo total pagado ($)
                      </label>
                      <input
                        id="inv-init-cost"
                        type="number"
                        min={0}
                        step={100}
                        value={formInitCost}
                        onChange={(e) => setFormInitCost(e.target.value)}
                        placeholder="Ej. 18000"
                        className="w-full min-h-[42px] rounded-xl border border-[#27272E] bg-[#0A0A0A] px-3 font-mono text-sm text-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-500"
                      />
                    </div>
                  </div>

                  {Number(formInitQty) > 0 && (
                    <div className="rounded-lg bg-[#0A0A0A] border border-[#27272E] px-3 py-2 flex items-center justify-between text-xs">
                      <span className="text-zinc-400">
                        Valor calculado por {formUnit === 'g' ? 'gramo' : 'unidad'}:
                      </span>
                      <span className="font-mono font-extrabold text-emerald-400 tabular-nums">
                        {formatUnitCost(previewInitUnitCost, formUnit)}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Optional merge duplicate into another existing ingredient */}
              {itemModal.editing && sortedInventory.length > 1 && (
                <div className="rounded-xl border border-[#27272E] bg-[#101014] p-3.5 space-y-2.5">
                  <div className="flex items-center gap-2">
                    <GitMerge className="w-4 h-4 text-amber-400 shrink-0" />
                    <div>
                      <p className="text-xs font-bold text-white">
                        Unificar / Fusionar con otro ingrediente
                      </p>
                      <p className="text-[11px] text-zinc-400">
                        Si dos nombres representan el mismo ingrediente, muévelos todos al ingrediente destino.
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <select
                      aria-label="Ingrediente destino para fusionar"
                      value={mergeTargetId}
                      onChange={(e) => setMergeTargetId(e.target.value)}
                      className="flex-1 min-h-[40px] rounded-xl border border-[#27272E] bg-[#0A0A0A] px-3 text-xs text-white"
                    >
                      <option value="">-- Elegir ingrediente destino --</option>
                      {sortedInventory
                        .filter((i) => i.id !== itemModal.editing?.id)
                        .map((i) => (
                          <option key={i.id} value={i.id}>
                            {i.name} ({formatInventoryQuantity(i.currentStock, i.unit)})
                          </option>
                        ))}
                    </select>
                    <button
                      type="button"
                      disabled={!mergeTargetId || submitting}
                      onClick={handleMergeSubmit}
                      className="min-h-[40px] px-3 rounded-xl border border-amber-500/60 bg-amber-500/15 text-amber-300 text-xs font-bold hover:bg-amber-500/25 disabled:opacity-40 whitespace-nowrap"
                    >
                      Fusionar aquí
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="px-5 py-4 border-t border-[#27272E] bg-[#101014] flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={submitting}
                onClick={() => setItemModal({ open: false, editing: null })}
                className="min-h-[44px] px-4 rounded-xl border border-[#27272E] bg-[#1C1C22] text-sm font-medium text-zinc-300"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={submitting || isDuplicateFormName}
                className="min-h-[44px] px-6 rounded-xl bg-amber-500 text-black text-sm font-bold hover:bg-amber-400 disabled:opacity-60"
              >
                {submitting
                  ? 'Guardando...'
                  : itemModal.editing
                    ? 'Guardar cambios'
                    : 'Crear ingrediente'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal: Register Purchase (+ Comprar) with automatic unit/gram cost calculation */}
      {purchaseItem && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-sm sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="purchase-modal-title"
        >
          <form
            onSubmit={handlePurchaseSubmit}
            className="w-full sm:max-w-md bg-[#141418] text-white rounded-t-3xl sm:rounded-2xl border border-[#27272E] shadow-2xl overflow-hidden"
          >
            <div className="px-5 py-4 border-b border-[#27272E] flex items-center justify-between bg-[#101014]">
              <div>
                <h2 id="purchase-modal-title" className="font-poster text-xl font-extrabold tracking-wide uppercase">
                  COMPRAR: {purchaseItem.name}
                </h2>
                <p className="text-[11px] text-zinc-400">
                  Stock actual:{' '}
                  <strong className={purchaseItem.currentStock < 0 ? 'text-red-400' : 'text-emerald-400'}>
                    {formatInventoryQuantity(purchaseItem.currentStock, purchaseItem.unit)}
                  </strong>
                </p>
              </div>
              <button
                type="button"
                disabled={submitting}
                onClick={() => setPurchaseItem(null)}
                aria-label="Cerrar compra de inventario"
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-zinc-400 hover:bg-[#1C1C22]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {actionError && (
                <div className="rounded-xl bg-red-950/60 border border-red-700 px-3.5 py-2.5 text-xs font-medium text-red-200">
                  {actionError}
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="buy-qty" className="block text-xs font-semibold text-zinc-300 mb-1">
                    Cantidad comprada ({purchaseItem.unit})
                  </label>
                  <input
                    id="buy-qty"
                    type="number"
                    min={0.001}
                    step="any"
                    autoFocus
                    value={purchaseQty}
                    onChange={(e) => setPurchaseQty(e.target.value)}
                    placeholder={purchaseItem.unit === 'g' ? 'Ej. 1000' : 'Ej. 24'}
                    className="w-full min-h-[44px] rounded-xl border border-[#27272E] bg-[#0A0A0A] px-3 font-mono text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>

                <div>
                  <label htmlFor="buy-cost" className="block text-xs font-semibold text-zinc-300 mb-1">
                    Cuánto costó en total ($)
                  </label>
                  <input
                    id="buy-cost"
                    type="number"
                    min={0}
                    step={100}
                    value={purchaseCost}
                    onChange={(e) => setPurchaseCost(e.target.value)}
                    placeholder="Ej. 15000"
                    className="w-full min-h-[44px] rounded-xl border border-[#27272E] bg-[#0A0A0A] px-3 font-mono text-sm text-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>
              </div>

              {/* Automatic unit/gram cost calculation preview */}
              <div className="rounded-xl border border-amber-500/40 bg-[#101014] p-3.5 grid grid-cols-2 gap-3 text-xs">
                <div>
                  <p className="text-[11px] text-zinc-400">
                    Valor calculado por {purchaseItem.unit === 'g' ? 'gramo' : 'unidad'}
                  </p>
                  <p className="font-mono text-base font-extrabold text-amber-400 tabular-nums mt-0.5">
                    {formatUnitCost(previewPurchaseUnitCost, purchaseItem.unit)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[11px] text-zinc-400">Nuevo stock resultante</p>
                  <p className="font-mono text-base font-extrabold text-emerald-400 tabular-nums mt-0.5">
                    {formatInventoryQuantity(
                      purchaseItem.currentStock + (Number(purchaseQty) > 0 ? Number(purchaseQty) : 0),
                      purchaseItem.unit
                    )}
                  </p>
                </div>
              </div>

              <div>
                <label htmlFor="buy-notes" className="block text-xs font-semibold text-zinc-300 mb-1">
                  Nota o proveedor (opcional)
                </label>
                <input
                  id="buy-notes"
                  type="text"
                  maxLength={200}
                  value={purchaseNotes}
                  onChange={(e) => setPurchaseNotes(e.target.value)}
                  placeholder="Ej. Compra mercado central"
                  className="w-full min-h-[42px] rounded-xl border border-[#27272E] bg-[#0A0A0A] px-3 text-sm text-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-2.5 pt-1">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => setPurchaseItem(null)}
                  className="min-h-[44px] rounded-xl border border-[#27272E] bg-[#1C1C22] text-sm font-semibold text-zinc-200"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submitting || !(Number(purchaseQty) > 0)}
                  className="min-h-[44px] rounded-xl bg-amber-500 text-black text-sm font-bold hover:bg-amber-400 disabled:opacity-50"
                >
                  {submitting ? 'Registrando...' : 'Confirmar compra'}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* Modal: Manual Counter Adjustment */}
      {adjustItem && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-sm sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="adjust-modal-title"
        >
          <form
            onSubmit={handleAdjustSubmit}
            className="w-full sm:max-w-md bg-[#141418] text-white rounded-t-3xl sm:rounded-2xl border border-[#27272E] shadow-2xl overflow-hidden"
          >
            <div className="px-5 py-4 border-b border-[#27272E] flex items-center justify-between bg-[#101014]">
              <h2 id="adjust-modal-title" className="font-poster text-xl font-extrabold tracking-wide uppercase">
                AJUSTAR CONTADOR: {adjustItem.name}
              </h2>
              <button
                type="button"
                disabled={submitting}
                onClick={() => setAdjustItem(null)}
                aria-label="Cerrar ajuste de inventario"
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-zinc-400 hover:bg-[#1C1C22]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {actionError && (
                <div className="rounded-xl bg-red-950/60 border border-red-700 px-3.5 py-2.5 text-xs font-medium text-red-200">
                  {actionError}
                </div>
              )}

              <div>
                <label htmlFor="adj-stock" className="block text-xs font-semibold text-zinc-300 mb-1">
                  Nuevo contador exacto en {adjustItem.unit === 'g' ? 'gramos (g)' : 'unidades (ud)'}
                </label>
                <input
                  id="adj-stock"
                  type="number"
                  step="any"
                  autoFocus
                  value={adjustNewStock}
                  onChange={(e) => setAdjustNewStock(e.target.value)}
                  className="w-full min-h-[44px] rounded-xl border border-[#27272E] bg-[#0A0A0A] px-3 font-mono text-base text-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
                <p className="text-[11px] text-zinc-400 mt-1">
                  Actual: {formatInventoryNumber(adjustItem.currentStock)} {adjustItem.unit} (admite números negativos o cero).
                </p>
              </div>

              <div>
                <label htmlFor="adj-notes" className="block text-xs font-semibold text-zinc-300 mb-1">
                  Motivo del ajuste (opcional)
                </label>
                <input
                  id="adj-notes"
                  type="text"
                  maxLength={200}
                  value={adjustNotes}
                  onChange={(e) => setAdjustNotes(e.target.value)}
                  placeholder="Ej. Conteo físico de cierre o merma"
                  className="w-full min-h-[42px] rounded-xl border border-[#27272E] bg-[#0A0A0A] px-3 text-sm text-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-2.5 pt-1">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => setAdjustItem(null)}
                  className="min-h-[44px] rounded-xl border border-[#27272E] bg-[#1C1C22] text-sm font-semibold text-zinc-200"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="min-h-[44px] rounded-xl bg-amber-500 text-black text-sm font-bold hover:bg-amber-400 disabled:opacity-50"
                >
                  {submitting ? 'Guardando...' : 'Aplicar ajuste'}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* Modal: Delete Confirmation */}
      {deleteTarget && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-sm sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-inv-title"
        >
          <div className="w-full sm:max-w-md bg-[#141418] text-white rounded-t-3xl sm:rounded-2xl border border-[#27272E] shadow-2xl overflow-hidden p-5 space-y-4">
            <div className="flex items-center gap-2.5">
              <AlertTriangle className="w-5 h-5 text-red-400 shrink-0" />
              <h2 id="delete-inv-title" className="font-poster text-xl font-extrabold uppercase">
                ELIMINAR INGREDIENTE
              </h2>
            </div>

            {actionError && (
              <div className="rounded-xl bg-red-950/60 border border-red-700 px-3 py-2 text-xs text-red-200">
                {actionError}
              </div>
            )}

            <p className="text-sm text-zinc-200 leading-relaxed">
              ¿Seguro que deseas eliminar <strong className="text-amber-400">{deleteTarget.name}</strong> del inventario? También se desvinculará de las recetas que lo usen.
            </p>

            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                disabled={submitting}
                onClick={() => setDeleteTarget(null)}
                className="min-h-[44px] rounded-xl border border-[#27272E] bg-[#1C1C22] text-sm font-semibold text-zinc-200"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={handleDeleteConfirm}
                className="min-h-[44px] rounded-xl bg-red-600 text-white text-sm font-bold hover:bg-red-500 disabled:opacity-50"
              >
                {submitting ? 'Eliminando...' : 'Sí, eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
