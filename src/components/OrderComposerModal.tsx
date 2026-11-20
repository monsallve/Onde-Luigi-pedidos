import React, { useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Camera,
  Check,
  Edit3,
  Image as ImageIcon,
  Minus,
  Plus,
  Search,
  ShoppingBag,
  SlidersHorizontal,
  Split,
  Trash2,
  UserCheck,
  X,
} from 'lucide-react';
import { usePosStore } from '../services/posStore';
import type {
  Order,
  OrderItem,
  PaymentMethod,
  PaymentStatus,
  Product,
} from '../types/pos';
import {
  buildItemSignature,
  buildOrderItem,
  calculateOrderTotals,
  createSafeId,
  formatCurrency,
  formatCustomizationSummary,
  validateOrderItemsSauces,
} from '../utils/orderMath';
import { RecipeCustomizeModal } from './RecipeCustomizeModal';

interface Props {
  open: boolean;
  editingOrder?: Order | null;
  onClose: () => void;
  onOpenWaiterPicker: () => void;
}

const QUICK_REFS = ['Mesa 1', 'Mesa 2', 'Mesa 3', 'Mesa 4', 'Barra', 'Para llevar'];

export const OrderComposerModal: React.FC<Props> = ({
  open,
  editingOrder = null,
  onClose,
  onOpenWaiterPicker,
}) => {
  const { products, activeWaiter, createOrder, updateOrderItems } = usePosStore();

  const [reference, setReference] = useState(editingOrder ? editingOrder.reference : '');
  const [notes, setNotes] = useState(editingOrder ? editingOrder.notes : '');
  const [items, setItems] = useState<OrderItem[]>(editingOrder ? [...editingOrder.items] : []);

  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>(
    editingOrder ? editingOrder.paymentStatus : 'pendiente'
  );
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(
    editingOrder ? editingOrder.paymentMethod : 'transferencia'
  );
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [receiptPreview, setReceiptPreview] = useState<string>('');
  const [receiptNotes, setReceiptNotes] = useState<string>('');

  const [selectedCategory, setSelectedCategory] = useState<string>('Todas');
  const [searchTerm, setSearchTerm] = useState('');
  const [customizingProduct, setCustomizingProduct] = useState<Product | null>(null);
  const [editingLineItem, setEditingLineItem] = useState<OrderItem | null>(null);
  const [mobileCartExpanded, setMobileCartExpanded] = useState(Boolean(editingOrder));

  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  const activeProducts = useMemo(() => products.filter((p) => p.active), [products]);
  const productMap = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const categories = useMemo(() => {
    const set = new Set(activeProducts.map((p) => p.category));
    return ['Todas', ...Array.from(set)];
  }, [activeProducts]);

  const filteredProducts = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return activeProducts.filter((p) => {
      const catMatch = selectedCategory === 'Todas' || p.category === selectedCategory;
      const textMatch =
        !q ||
        p.name.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q);
      return catMatch && textMatch;
    });
  }, [activeProducts, selectedCategory, searchTerm]);

  const totals = useMemo(() => calculateOrderTotals(items), [items]);
  const totalUnits = useMemo(() => items.reduce((s, i) => s + i.quantity, 0), [items]);
  const sauceValidation = useMemo(() => validateOrderItemsSauces(items, products), [items, products]);

  if (!open) return null;

  const handleQuickAdd = (product: Product) => {
    setErrorMsg(null);
    const candidate = buildOrderItem({
      productId: product.id,
      productName: product.name,
      category: product.category,
      quantity: 1,
      basePrice: product.basePrice,
      removedIngredients: [],
      addedExtras: [],
      selectedSauces: [],
      customNote: '',
    });
    const sig = buildItemSignature(candidate);
    setItems((prev) => {
      const idx = prev.findIndex((i) => buildItemSignature(i) === sig);
      if (idx >= 0) {
        return prev.map((item, i) => {
          if (i !== idx) return item;
          const nextQty = item.quantity + 1;
          return {
            ...item,
            quantity: nextQty,
            lineTotal: item.unitPrice * nextQty,
          };
        });
      }
      return [...prev, candidate];
    });
  };

  const handleConfirmCustomized = (built: OrderItem) => {
    setErrorMsg(null);
    if (editingLineItem) {
      setItems((prev) => prev.map((i) => (i.lineId === built.lineId ? built : i)));
      setEditingLineItem(null);
      setCustomizingProduct(null);
      return;
    }

    const sig = buildItemSignature(built);
    setItems((prev) => {
      const idx = prev.findIndex((i) => buildItemSignature(i) === sig);
      if (idx >= 0) {
        return prev.map((item, i) => {
          if (i !== idx) return item;
          const nextQty = item.quantity + built.quantity;
          return {
            ...item,
            quantity: nextQty,
            lineTotal: item.unitPrice * nextQty,
          };
        });
      }
      return [...prev, built];
    });
    setCustomizingProduct(null);
  };

  const handleSplitUnit = (lineId: string) => {
    setItems((prev) => {
      const target = prev.find((i) => i.lineId === lineId);
      if (!target || target.quantity <= 1) return prev;
      const result: OrderItem[] = [];
      for (const item of prev) {
        if (item.lineId !== lineId) {
          result.push(item);
        } else {
          const reducedQty = item.quantity - 1;
          result.push({
            ...item,
            quantity: reducedQty,
            lineTotal: item.unitPrice * reducedQty,
          });
          result.push({
            ...item,
            lineId: createSafeId('item'),
            quantity: 1,
            lineTotal: item.unitPrice,
          });
        }
      }
      return result;
    });
  };

  const updateLineQuantity = (lineId: string, delta: number) => {
    setItems((prev) =>
      prev
        .map((item) => {
          if (item.lineId !== lineId) return item;
          const nextQty = item.quantity + delta;
          if (nextQty <= 0) return null;
          return {
            ...item,
            quantity: nextQty,
            lineTotal: item.unitPrice * nextQty,
          };
        })
        .filter((x): x is OrderItem => x !== null)
    );
  };

  const handleReceiptSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setReceiptFile(file);
    const reader = new FileReader();
    reader.onload = () => setReceiptPreview(String(reader.result));
    reader.readAsDataURL(file);
  };

  const handleSubmit = async () => {
    setErrorMsg(null);
    if (!activeWaiter) {
      setErrorMsg('Selecciona tu nombre de mesero o encargado antes de guardar.');
      onOpenWaiterPicker();
      return;
    }
    if (!reference.trim()) {
      setErrorMsg('Indica la mesa, cliente o referencia del pedido.');
      return;
    }
    if (items.length === 0) {
      setErrorMsg('Agrega al menos un producto al pedido.');
      return;
    }
    if (!sauceValidation.valid) {
      setErrorMsg(sauceValidation.message || 'Elige entre 1 y 4 salsas en cada producto que lo requiera.');
      setMobileCartExpanded(true);
      return;
    }

    setSubmitting(true);
    try {
      if (editingOrder) {
        await updateOrderItems(editingOrder.id, items, reference, notes);
      } else {
        await createOrder({
          reference,
          items,
          notes,
          paymentStatus,
          paymentMethod: paymentStatus === 'pagado' ? paymentMethod : '',
          receiptFile,
          receiptNotes,
        });
      }
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'No se pudo guardar el pedido.');
    } finally {
      setSubmitting(false);
    }
  };

  const openEditItemModal = (item: OrderItem) => {
    const prod = products.find((p) => p.id === item.productId);
    if (!prod) return;
    setEditingLineItem(item);
    setCustomizingProduct(prod);
  };

  return (
    <div
      className="fixed inset-0 z-40 flex flex-col bg-[#0A0A0A] lg:bg-black/75 lg:backdrop-blur-sm lg:p-6 lg:items-center lg:justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="order-composer-title"
    >
      <div className="w-full h-full lg:max-w-6xl lg:max-h-[92vh] bg-[#141418] text-white lg:rounded-2xl lg:border lg:border-[#27272E] lg:shadow-2xl flex flex-col overflow-hidden">
        {/* Top bar */}
        <div className="px-4 sm:px-6 py-3.5 border-b border-[#27272E] flex items-center justify-between gap-3 bg-[#101014] shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <h2 id="order-composer-title" className="font-poster text-xl font-extrabold text-white tracking-wide truncate">
              {editingOrder
                ? `EDITAR PEDIDO #${editingOrder.orderNumber}`
                : 'NUEVO PEDIDO'}
            </h2>
            <button
              type="button"
              onClick={onOpenWaiterPicker}
              className={`min-h-[38px] px-3 rounded-lg text-xs font-semibold flex items-center gap-1.5 border transition-colors whitespace-nowrap shrink-0 ${
                activeWaiter
                  ? 'border-[#27272E] bg-[#1C1C22] text-zinc-200 hover:bg-[#23232B]'
                  : 'border-amber-500 bg-amber-500/20 text-amber-300'
              }`}
            >
              <UserCheck className="w-3.5 h-3.5 text-amber-400" />
              <span>{activeWaiter ? activeWaiter.name : 'Elegir mesero'}</span>
            </button>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar ventana de pedido"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-zinc-400 hover:bg-[#1C1C22] hover:text-white shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {errorMsg && (
          <div
            role="alert"
            className="mx-4 sm:mx-6 mt-3 rounded-xl bg-red-950/60 border border-red-700 px-3.5 py-2.5 text-xs font-medium text-red-200 shrink-0"
          >
            {errorMsg}
          </div>
        )}

        {/* Main 2-column body */}
        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 overflow-hidden">
          {/* Left: Reference + Product Selector */}
          <div className="lg:col-span-7 flex flex-col min-h-0 border-b lg:border-b-0 lg:border-r border-[#27272E] overflow-hidden">
            <div className="p-4 sm:p-5 border-b border-[#27272E] space-y-3 shrink-0 bg-[#141418]">
              <div>
                <label
                  htmlFor="order-reference-input"
                  className="block text-xs font-semibold text-zinc-300 mb-1.5"
                >
                  Mesa / Cliente / Referencia
                </label>
                <input
                  id="order-reference-input"
                  type="text"
                  maxLength={100}
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  placeholder="Ej. Mesa 4 · Terraza o Juan Pérez"
                  className="w-full min-h-[44px] rounded-xl border border-[#27272E] bg-[#0A0A0A] px-3.5 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
                <div className="flex items-center gap-1.5 overflow-x-auto pt-2 pb-0.5">
                  {QUICK_REFS.map((qr) => (
                    <button
                      key={qr}
                      type="button"
                      onClick={() => setReference(qr)}
                      className={`min-h-[34px] px-2.5 rounded-lg text-xs font-semibold border whitespace-nowrap shrink-0 transition-colors ${
                        reference === qr
                          ? 'bg-amber-500 text-black border-amber-400 font-bold'
                          : 'bg-[#1C1C22] text-zinc-300 border-[#27272E] hover:border-zinc-500'
                      }`}
                    >
                      {qr}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-2">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="search"
                    aria-label="Buscar producto en el menú"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Buscar hamburguesa, perro o bebida..."
                    className="w-full min-h-[42px] pl-9 pr-3 rounded-xl border border-[#27272E] bg-[#0A0A0A] text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>
                <div className="flex items-center gap-1 overflow-x-auto p-1 bg-[#0A0A0A] border border-[#27272E] rounded-xl">
                  {categories.map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setSelectedCategory(cat)}
                      className={`min-h-[34px] px-3 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
                        selectedCategory === cat
                          ? 'bg-amber-500 text-black font-bold'
                          : 'text-zinc-300 hover:text-white'
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Product Grid */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-5 bg-[#0A0A0A]">
              {filteredProducts.length === 0 ? (
                <div className="text-center py-12 text-sm text-zinc-400">
                  No hay productos activos que coincidan con la búsqueda.
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {filteredProducts.map((product) => {
                    const hasCustom =
                      product.removableOptions.length > 0 ||
                      product.addonOptions.length > 0 ||
                      product.allowSauces;
                    return (
                      <div
                        key={product.id}
                        className="bg-[#141418] border border-[#27272E] rounded-xl p-3.5 flex flex-col justify-between gap-3"
                      >
                        <div className="flex items-start gap-3">
                          {product.imageUrl && (
                            <img
                              src={product.imageUrl}
                              alt={product.name}
                              className="w-16 h-16 rounded-lg object-cover object-top border border-[#27272E] shrink-0"
                            />
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-2">
                              <h3 className="font-poster text-base font-extrabold text-white leading-tight uppercase">
                                {product.name}
                              </h3>
                              <span className="font-mono text-sm font-bold text-amber-400 tabular-nums shrink-0">
                                {formatCurrency(product.basePrice)}
                              </span>
                            </div>
                            <p className="text-xs text-zinc-400 mt-1 line-clamp-2">
                              {product.baseRecipe.length > 0
                                ? product.baseRecipe.join(' · ')
                                : product.category}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleQuickAdd(product)}
                            className="flex-1 min-h-[42px] rounded-xl bg-amber-500 text-black text-xs font-bold hover:bg-amber-400 transition-colors flex items-center justify-center gap-1.5"
                          >
                            <Plus className="w-4 h-4" />
                            <span>Agregar</span>
                          </button>
                          {hasCustom && (
                            <button
                              type="button"
                              onClick={() => {
                                setEditingLineItem(null);
                                setCustomizingProduct(product);
                              }}
                              aria-label={`Personalizar ${product.name}`}
                              className="min-h-[42px] px-3 rounded-xl border border-[#27272E] bg-[#1C1C22] text-zinc-200 text-xs font-semibold hover:border-zinc-500 flex items-center gap-1.5 whitespace-nowrap shrink-0"
                            >
                              <SlidersHorizontal className="w-3.5 h-3.5 text-amber-400" />
                              <span>Receta</span>
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Right: Order Cart */}
          <div
            className={`lg:col-span-5 flex flex-col bg-[#141418] min-h-0 ${
              mobileCartExpanded
                ? 'fixed inset-x-0 bottom-0 top-14 z-30 lg:static'
                : 'hidden lg:flex'
            }`}
          >
            <div className="px-4 sm:px-5 py-3 border-b border-[#27272E] flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <ShoppingBag className="w-4 h-4 text-amber-400" />
                <h3 className="font-poster text-base font-extrabold text-white tracking-wide">
                  COMANDA ({totalUnits} {totalUnits === 1 ? 'UD' : 'UDS'})
                </h3>
              </div>
              {mobileCartExpanded && (
                <button
                  type="button"
                  onClick={() => setMobileCartExpanded(false)}
                  className="lg:hidden min-h-[38px] px-3 rounded-lg border border-[#27272E] bg-[#1C1C22] text-xs font-semibold text-zinc-200"
                >
                  Seguir agregando
                </button>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-3">
              {items.length === 0 ? (
                <div className="text-center py-10 border border-dashed border-[#27272E] rounded-xl">
                  <p className="text-sm font-semibold text-zinc-200">
                    Aún no hay productos en esta comanda
                  </p>
                  <p className="text-xs text-zinc-400 mt-1">
                    Toca “Agregar” o “Receta” en el menú para añadir ítems.
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-[#27272E] border border-[#27272E] rounded-xl overflow-hidden bg-[#1C1C22]">
                  {items.map((item) => {
                    const customSummary = formatCustomizationSummary(item);
                    const prod = productMap.get(item.productId);
                    const missingSauces =
                      Boolean(prod?.allowSauces) &&
                      (item.selectedSauces?.length || 0) < (prod?.minSauces ?? 1);

                    return (
                      <div key={item.lineId} className="p-3.5 space-y-2.5">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-bold text-white">
                              {item.productName}
                            </p>
                            {customSummary ? (
                              <p className="text-xs text-amber-300 font-medium mt-0.5">
                                {customSummary}
                              </p>
                            ) : (
                              <p className="text-xs text-zinc-400 mt-0.5">Receta completa</p>
                            )}
                            {missingSauces && (
                              <p className="text-[11px] font-semibold text-red-400 flex items-center gap-1 mt-1">
                                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                                <span>Falta elegir de 1 a 4 salsas</span>
                              </p>
                            )}
                          </div>
                          <span className="font-mono text-sm font-bold text-amber-400 tabular-nums shrink-0">
                            {formatCurrency(item.lineTotal)}
                          </span>
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                          <div className="flex items-center border border-[#27272E] bg-[#0A0A0A] rounded-lg overflow-hidden">
                            <button
                              type="button"
                              aria-label={`Quitar una unidad de ${item.productName}`}
                              onClick={() => updateLineQuantity(item.lineId, -1)}
                              className="min-h-[36px] min-w-[36px] flex items-center justify-center text-zinc-300 hover:bg-[#1C1C22]"
                            >
                              <Minus className="w-3.5 h-3.5" />
                            </button>
                            <span className="w-8 text-center font-mono text-xs font-bold text-white tabular-nums">
                              {item.quantity}
                            </span>
                            <button
                              type="button"
                              aria-label={`Sumar una unidad de ${item.productName}`}
                              onClick={() => updateLineQuantity(item.lineId, 1)}
                              className="min-h-[36px] min-w-[36px] flex items-center justify-center text-zinc-300 hover:bg-[#1C1C22]"
                            >
                              <Plus className="w-3.5 h-3.5" />
                            </button>
                          </div>

                          <div className="flex items-center gap-1.5">
                            {item.quantity > 1 && (
                              <button
                                type="button"
                                onClick={() => handleSplitUnit(item.lineId)}
                                title="Separar 1 unidad para personalizar diferente"
                                className="min-h-[36px] px-2.5 rounded-lg border border-[#27272E] bg-[#0A0A0A] text-xs font-medium text-zinc-300 hover:text-white flex items-center gap-1"
                              >
                                <Split className="w-3.5 h-3.5" />
                                <span>Separar 1</span>
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => openEditItemModal(item)}
                              className={`min-h-[36px] px-2.5 rounded-lg border text-xs font-semibold flex items-center gap-1 ${
                                missingSauces
                                  ? 'border-amber-500 bg-amber-500 text-black font-bold'
                                  : 'border-[#27272E] bg-[#0A0A0A] text-zinc-200 hover:border-zinc-500'
                              }`}
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                              <span>Receta y salsas</span>
                            </button>
                            <button
                              type="button"
                              aria-label={`Eliminar ${item.productName}`}
                              onClick={() =>
                                setItems((prev) =>
                                  prev.filter((i) => i.lineId !== item.lineId)
                                )
                              }
                              className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-red-400 hover:bg-red-950/60"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <div>
                <label
                  htmlFor="order-general-notes"
                  className="block text-xs font-semibold text-zinc-300 mb-1"
                >
                  Observaciones generales del pedido
                </label>
                <input
                  id="order-general-notes"
                  type="text"
                  maxLength={400}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Ej. Entregar todo junto, salsas aparte..."
                  className="w-full min-h-[42px] rounded-xl border border-[#27272E] bg-[#0A0A0A] px-3 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>

              {!editingOrder && (
                <div className="border border-[#27272E] rounded-xl p-3.5 space-y-3 bg-[#101014]">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-zinc-300">
                      Estado de pago inicial
                    </span>
                    <div className="flex items-center gap-1 p-1 bg-[#0A0A0A] border border-[#27272E] rounded-lg">
                      <button
                        type="button"
                        onClick={() => setPaymentStatus('pendiente')}
                        className={`min-h-[34px] px-3 rounded-md text-xs font-semibold transition-colors ${
                          paymentStatus === 'pendiente'
                            ? 'bg-amber-500 text-black font-bold'
                            : 'text-zinc-400 hover:text-white'
                        }`}
                      >
                        Por cobrar
                      </button>
                      <button
                        type="button"
                        onClick={() => setPaymentStatus('pagado')}
                        className={`min-h-[34px] px-3 rounded-md text-xs font-semibold transition-colors ${
                          paymentStatus === 'pagado'
                            ? 'bg-emerald-600 text-white font-bold'
                            : 'text-zinc-400 hover:text-white'
                        }`}
                      >
                        Pagado
                      </button>
                    </div>
                  </div>

                  {paymentStatus === 'pagado' && (
                    <div className="space-y-3 pt-2 border-t border-[#27272E]">
                      <div className="grid grid-cols-3 gap-2">
                        {(['efectivo', 'transferencia', 'tarjeta'] as PaymentMethod[]).map(
                          (method) => (
                            <button
                              key={method}
                              type="button"
                              onClick={() => setPaymentMethod(method)}
                              className={`min-h-[40px] rounded-xl border text-xs font-semibold capitalize transition-colors ${
                                paymentMethod === method
                                  ? 'border-amber-500 bg-amber-500 text-black font-bold'
                                  : 'border-[#27272E] bg-[#1C1C22] text-zinc-300 hover:border-zinc-500'
                              }`}
                            >
                              {method}
                            </button>
                          )
                        )}
                      </div>

                      {paymentMethod === 'transferencia' && (
                        <div className="space-y-2">
                          <p className="text-xs font-medium text-zinc-300">
                            Comprobante de transferencia (opcional ahora)
                          </p>
                          <div className="flex items-center gap-2">
                            <input
                              ref={cameraInputRef}
                              type="file"
                              accept="image/*"
                              capture="environment"
                              onChange={handleReceiptSelected}
                              className="hidden"
                            />
                            <input
                              ref={galleryInputRef}
                              type="file"
                              accept="image/*"
                              onChange={handleReceiptSelected}
                              className="hidden"
                            />
                            <button
                              type="button"
                              onClick={() => cameraInputRef.current?.click()}
                              className="flex-1 min-h-[42px] rounded-xl border border-[#27272E] bg-[#1C1C22] text-xs font-semibold text-white flex items-center justify-center gap-1.5 hover:border-zinc-500"
                            >
                              <Camera className="w-4 h-4 text-amber-400" />
                              <span>Cámara</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => galleryInputRef.current?.click()}
                              className="flex-1 min-h-[42px] rounded-xl border border-[#27272E] bg-[#1C1C22] text-xs font-semibold text-white flex items-center justify-center gap-1.5 hover:border-zinc-500"
                            >
                              <ImageIcon className="w-4 h-4 text-zinc-300" />
                              <span>Galería</span>
                            </button>
                          </div>
                          {receiptPreview && (
                            <div className="flex items-center gap-3 bg-[#0A0A0A] border border-[#27272E] rounded-xl p-2">
                              <img
                                src={receiptPreview}
                                alt="Vista previa comprobante"
                                className="w-12 h-14 object-cover rounded-lg border border-[#27272E]"
                              />
                              <div className="flex-1 min-w-0">
                                <input
                                  type="text"
                                  value={receiptNotes}
                                  onChange={(e) => setReceiptNotes(e.target.value)}
                                  placeholder="Ref. o nota del comprobante"
                                  className="w-full text-xs border border-[#27272E] bg-[#141418] text-white rounded-lg px-2.5 py-1.5"
                                />
                              </div>
                              <button
                                type="button"
                                aria-label="Quitar foto"
                                onClick={() => {
                                  setReceiptFile(null);
                                  setReceiptPreview('');
                                }}
                                className="min-h-[36px] min-w-[36px] flex items-center justify-center text-zinc-400 hover:text-red-400"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="p-4 sm:p-5 border-t border-[#27272E] bg-[#101014] space-y-3 shrink-0">
              <div className="flex items-center justify-between text-sm">
                <span className="text-zinc-300 font-medium">Total del pedido</span>
                <span className="font-mono text-xl font-bold text-amber-400 tabular-nums">
                  {formatCurrency(totals.total)}
                </span>
              </div>
              <button
                type="button"
                disabled={submitting || items.length === 0}
                onClick={handleSubmit}
                className="w-full min-h-[48px] rounded-xl bg-amber-500 text-black text-sm font-bold hover:bg-amber-400 disabled:opacity-50 transition-colors flex items-center justify-center gap-2 shadow-sm"
              >
                <Check className="w-4 h-4" />
                <span>
                  {submitting
                    ? 'Guardando...'
                    : editingOrder
                      ? 'Guardar cambios del pedido'
                      : 'Confirmar y enviar pedido'}
                </span>
              </button>
            </div>
          </div>
        </div>

        {/* Mobile Bottom Summary Bar when Cart is Collapsed */}
        {!mobileCartExpanded && (
          <div className="lg:hidden p-3.5 border-t border-[#27272E] bg-[#101014] flex items-center gap-3 shrink-0 pb-safe">
            <button
              type="button"
              onClick={() => setMobileCartExpanded(true)}
              className="flex-1 min-h-[48px] rounded-xl bg-amber-500 text-black px-4 text-sm font-bold flex items-center justify-between shadow-sm"
            >
              <span>
                Ver comanda ({totalUnits} {totalUnits === 1 ? 'ud' : 'uds'})
              </span>
              <span className="font-mono font-bold tabular-nums">
                {formatCurrency(totals.total)}
              </span>
            </button>
          </div>
        )}
      </div>

      {customizingProduct && (
        <RecipeCustomizeModal
          product={customizingProduct}
          initialItem={editingLineItem}
          onClose={() => {
            setCustomizingProduct(null);
            setEditingLineItem(null);
          }}
          onConfirm={handleConfirmCustomized}
        />
      )}
    </div>
  );
};
