import React, { useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Camera,
  Check,
  CheckCircle2,
  Droplets,
  Edit3,
  Image as ImageIcon,
  Minus,
  Plus,
  Search,
  ShoppingBag,
  SlidersHorizontal,
  Split,
  Trash2,
  X,
} from 'lucide-react';
import { usePosStore } from '../services/posStore';
import { resolveAssetUrl } from '../utils/assetPath';
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
import { RecipeCustomizeModal } from '../components/RecipeCustomizeModal';

interface Props {
  onOpenWaiterPicker: () => void;
  onGoToOrders: () => void;
}

const QUICK_REFS = ['Mesa 1', 'Mesa 2', 'Mesa 3', 'Mesa 4', 'Barra', 'Para llevar', 'Domicilio'];

export const PosOrderWorkspaceView: React.FC<Props> = ({
  onOpenWaiterPicker,
  onGoToOrders,
}) => {
  const { products, sauces, activeWaiter, createOrder } = usePosStore();

  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<OrderItem[]>([]);

  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>('pendiente');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('transferencia');
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [receiptPreview, setReceiptPreview] = useState<string>('');
  const [receiptNotes, setReceiptNotes] = useState<string>('');

  const [selectedCategory, setSelectedCategory] = useState<string>('Todas');
  const [searchTerm, setSearchTerm] = useState('');
  const [customizingProduct, setCustomizingProduct] = useState<Product | null>(null);
  const [editingLineItem, setEditingLineItem] = useState<OrderItem | null>(null);
  const [mobileComandaOpen, setMobileComandaOpen] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [lastCreatedOrder, setLastCreatedOrder] = useState<Order | null>(null);

  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  const activeProducts = useMemo(() => products.filter((p) => p.active), [products]);
  const activeSauceCount = useMemo(() => sauces.filter((s) => s.active).length, [sauces]);
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

  const handleQuickAdd = (product: Product) => {
    setErrorMsg(null);
    setLastCreatedOrder(null);
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
    setLastCreatedOrder(null);
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
      setErrorMsg('Selecciona tu nombre de mesero o encargado antes de enviar el pedido.');
      onOpenWaiterPicker();
      return;
    }
    if (!reference.trim()) {
      setErrorMsg('Indica la mesa, cliente o referencia del pedido.');
      setMobileComandaOpen(true);
      return;
    }
    if (items.length === 0) {
      setErrorMsg('Agrega al menos un producto del menú.');
      return;
    }
    if (!sauceValidation.valid) {
      setErrorMsg(
        sauceValidation.message ||
          'Elige entre 1 y 4 salsas en cada producto que requiere salsas.'
      );
      setMobileComandaOpen(true);
      return;
    }

    setSubmitting(true);
    try {
      const created = await createOrder({
        reference,
        items,
        notes,
        paymentStatus,
        paymentMethod: paymentStatus === 'pagado' ? paymentMethod : '',
        receiptFile,
        receiptNotes,
      });
      setLastCreatedOrder(created);
      setReference('');
      setNotes('');
      setItems([]);
      setPaymentStatus('pendiente');
      setPaymentMethod('transferencia');
      setReceiptFile(null);
      setReceiptPreview('');
      setReceiptNotes('');
      setMobileComandaOpen(false);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'No se pudo enviar el pedido.');
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
    <div className="space-y-4">
      {/* Compact Branded Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="font-poster text-3xl sm:text-4xl font-extrabold tracking-wide text-white leading-none">
            TOMAR PEDIDO
          </h1>
          <p className="text-xs text-zinc-400 mt-1">
            1. Elige varios productos · 2. Ajusta lo que no lleva y elige de 1 a 4 salsas ({activeSauceCount} disponibles)
          </p>
        </div>

        {lastCreatedOrder && (
          <div className="flex items-center gap-3 rounded-xl bg-emerald-950/70 border border-emerald-700 px-3.5 py-2 text-xs text-emerald-200">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>
              Pedido <strong>#{lastCreatedOrder.orderNumber}</strong> ({lastCreatedOrder.reference}) enviado
            </span>
            <button
              type="button"
              onClick={onGoToOrders}
              className="font-bold text-amber-400 hover:underline whitespace-nowrap"
            >
              Ver Comandas
            </button>
          </div>
        )}
      </div>

      {/* Main Split Layout: Menu Catalog (Left) + Live Comanda (Right on Desktop / Drawer on Mobile) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left: Product Picker */}
        <section className="lg:col-span-7 space-y-3.5">
          {/* Search + Category Filter */}
          <div className="bg-[#141418] border border-[#27272E] rounded-2xl p-3 space-y-2.5">
            <div className="relative">
              <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="search"
                aria-label="Buscar producto en el menú"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Buscar hamburguesa, perro, papas o bebida..."
                className="w-full min-h-[42px] pl-9 pr-3 rounded-xl border border-[#27272E] bg-[#0A0A0A] text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {categories.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setSelectedCategory(cat)}
                  className={`min-h-[36px] px-3.5 rounded-xl text-xs font-bold border whitespace-nowrap shrink-0 transition-colors ${
                    selectedCategory === cat
                      ? 'bg-amber-500 text-black border-amber-400'
                      : 'bg-[#1C1C22] text-zinc-300 border-[#27272E] hover:border-zinc-500'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          {/* Menu Grid */}
          {filteredProducts.length === 0 ? (
            <div className="bg-[#141418] border border-[#27272E] rounded-2xl p-10 text-center text-sm text-zinc-400">
              No hay productos activos que coincidan con tu búsqueda.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {filteredProducts.map((product) => {
                const countInOrder = items
                  .filter((i) => i.productId === product.id)
                  .reduce((s, i) => s + i.quantity, 0);

                return (
                  <article
                    key={product.id}
                    className={`bg-[#141418] border rounded-2xl overflow-hidden flex flex-col justify-between transition-colors ${
                      countInOrder > 0 ? 'border-amber-500/80' : 'border-[#27272E]'
                    }`}
                  >
                    {product.imageUrl && (
                      <div className="relative h-36 bg-[#0A0A0A] overflow-hidden border-b border-[#27272E]">
                        <img
                          src={resolveAssetUrl(product.imageUrl)}
                          alt={product.name}
                          className="w-full h-full object-cover object-top"
                        />
                        {countInOrder > 0 && (
                          <span className="absolute top-2.5 right-2.5 px-2.5 py-1 rounded-lg bg-amber-500 text-black font-mono text-xs font-extrabold tabular-nums shadow">
                            {countInOrder} en pedido
                          </span>
                        )}
                      </div>
                    )}

                    <div className="p-3.5 flex-1 flex flex-col justify-between gap-3">
                      <div>
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wide">
                              {product.category}
                              {!product.imageUrl && countInOrder > 0 ? ` · ${countInOrder} en pedido` : ''}
                            </p>
                            <h2 className="font-poster text-xl font-extrabold text-white leading-tight uppercase mt-0.5">
                              {product.name}
                            </h2>
                          </div>
                          <span className="font-mono text-base font-bold text-amber-400 tabular-nums shrink-0">
                            {formatCurrency(product.basePrice)}
                          </span>
                        </div>

                        {product.baseRecipe.length > 0 && (
                          <p className="text-xs text-zinc-400 mt-1.5 line-clamp-2 leading-relaxed">
                            {product.baseRecipe.join(' · ')}
                          </p>
                        )}
                      </div>

                      <div className="flex items-center gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => handleQuickAdd(product)}
                          className="flex-1 min-h-[44px] rounded-xl bg-amber-500 text-black text-xs font-bold hover:bg-amber-400 transition-colors flex items-center justify-center gap-1.5"
                        >
                          <Plus className="w-4 h-4" />
                          <span>Agregar</span>
                        </button>

                        {(product.allowSauces ||
                          product.removableOptions.length > 0 ||
                          product.addonOptions.length > 0) && (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingLineItem(null);
                              setCustomizingProduct(product);
                            }}
                            aria-label={`Personalizar ${product.name}`}
                            className="min-h-[44px] px-3 rounded-xl border border-[#27272E] bg-[#1C1C22] text-zinc-200 text-xs font-semibold hover:border-zinc-500 flex items-center gap-1.5 whitespace-nowrap shrink-0"
                          >
                            <SlidersHorizontal className="w-3.5 h-3.5 text-amber-400" />
                            <span>Receta</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        {/* Right: Live Comanda Builder (Desktop Sticky Panel + Mobile Full-screen Sheet) */}
        <aside
          className={`lg:col-span-5 lg:sticky lg:top-28 bg-[#141418] border border-[#27272E] rounded-2xl overflow-hidden flex flex-col ${
            mobileComandaOpen
              ? 'fixed inset-x-0 bottom-0 top-14 z-40 rounded-none border-x-0 border-b-0 lg:static lg:rounded-2xl lg:border'
              : 'hidden lg:flex'
          } lg:max-h-[calc(100vh-8.5rem)]`}
        >
          <div className="px-4 py-3 border-b border-[#27272E] bg-[#101014] flex items-center justify-between gap-2 shrink-0">
            <div className="flex items-center gap-2">
              <ShoppingBag className="w-4 h-4 text-amber-400" />
              <h2 className="font-poster text-lg font-extrabold text-white tracking-wide">
                PEDIDO ACTUAL ({totalUnits} {totalUnits === 1 ? 'UD' : 'UDS'})
              </h2>
            </div>
            <div className="flex items-center gap-2">
              {items.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setItems([]);
                    setErrorMsg(null);
                  }}
                  className="text-xs font-medium text-zinc-400 hover:text-red-400"
                >
                  Limpiar
                </button>
              )}
              {mobileComandaOpen && (
                <button
                  type="button"
                  onClick={() => setMobileComandaOpen(false)}
                  className="lg:hidden min-h-[36px] px-3 rounded-lg border border-[#27272E] bg-[#1C1C22] text-xs font-semibold text-white"
                >
                  + Productos
                </button>
              )}
            </div>
          </div>

          <div className="p-4 overflow-y-auto space-y-4 flex-1">
            {errorMsg && (
              <div
                role="alert"
                className="rounded-xl bg-red-950/70 border border-red-600 px-3.5 py-2.5 text-xs font-medium text-red-100"
              >
                {errorMsg}
              </div>
            )}

            {/* Mesa / Cliente Reference */}
            <div>
              <label
                htmlFor="pos-reference-input"
                className="block text-xs font-bold text-zinc-300 mb-1.5"
              >
                Mesa o Nombre del Cliente
              </label>
              <input
                id="pos-reference-input"
                type="text"
                maxLength={100}
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="Ej. Mesa 3 o Laura Gómez"
                className="w-full min-h-[42px] rounded-xl border border-[#27272E] bg-[#0A0A0A] px-3 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
              <div className="flex flex-wrap items-center gap-1.5 pt-2">
                {QUICK_REFS.map((qr) => (
                  <button
                    key={qr}
                    type="button"
                    onClick={() => setReference(qr)}
                    className={`min-h-[32px] px-2.5 rounded-lg text-xs font-semibold border whitespace-nowrap shrink-0 transition-colors ${
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

            {/* Items List */}
            {items.length === 0 ? (
              <div className="text-center py-8 border border-dashed border-[#27272E] rounded-xl bg-[#0A0A0A]/60 px-4">
                <p className="text-sm font-semibold text-zinc-200">
                  Comanda vacía
                </p>
                <p className="text-xs text-zinc-400 mt-1">
                  Toca <strong>Agregar</strong> en los productos que quiera el cliente y luego ajusta lo que no lleva y sus salsas.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-[#27272E] border border-[#27272E] rounded-xl overflow-hidden bg-[#1C1C22]">
                {items.map((item) => {
                  const customSummary = formatCustomizationSummary(item);
                  const prod = productMap.get(item.productId);
                  const needsSauces =
                    Boolean(prod?.allowSauces) &&
                    (item.selectedSauces?.length || 0) < (prod?.minSauces ?? 1);

                  return (
                    <div key={item.lineId} className="p-3.5 space-y-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-white leading-snug">
                            {item.productName}
                          </p>
                          {item.removedIngredients.length > 0 && (
                            <p className="text-xs text-red-300 font-medium mt-0.5">
                              {item.removedIngredients.map((r) => `Sin ${r}`).join(', ')}
                            </p>
                          )}
                          {item.selectedSauces.length > 0 && (
                            <p className="text-xs text-amber-300 font-medium mt-0.5 flex items-center gap-1">
                              <Droplets className="w-3 h-3 shrink-0" />
                              <span>
                                Salsas ({item.selectedSauces.length}/4): {item.selectedSauces.join(', ')}
                              </span>
                            </p>
                          )}
                          {(item.addedExtras.length > 0 || item.customNote) && (
                            <p className="text-xs text-emerald-300 mt-0.5">
                              {[
                                ...item.addedExtras.map((e) => `+${e.name}`),
                                item.customNote ? `Nota: "${item.customNote}"` : '',
                              ]
                                .filter(Boolean)
                                .join(' · ')}
                            </p>
                          )}
                          {!customSummary && !needsSauces && (
                            <p className="text-[11px] text-zinc-400 mt-0.5">Receta estándar</p>
                          )}
                          {needsSauces && (
                            <p className="text-[11px] font-semibold text-amber-400 flex items-center gap-1 mt-1">
                              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                              <span>Elige de 1 a 4 salsas</span>
                            </p>
                          )}
                        </div>
                        <span className="font-mono text-sm font-bold text-amber-400 tabular-nums shrink-0">
                          {formatCurrency(item.lineTotal)}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                        <div className="flex items-center border border-[#27272E] bg-[#0A0A0A] rounded-lg overflow-hidden">
                          <button
                            type="button"
                            aria-label={`Restar 1 ${item.productName}`}
                            onClick={() => updateLineQuantity(item.lineId, -1)}
                            className="min-h-[34px] min-w-[34px] flex items-center justify-center text-zinc-300 hover:bg-[#1C1C22]"
                          >
                            <Minus className="w-3.5 h-3.5" />
                          </button>
                          <span className="w-7 text-center font-mono text-xs font-bold text-white tabular-nums">
                            {item.quantity}
                          </span>
                          <button
                            type="button"
                            aria-label={`Sumar 1 ${item.productName}`}
                            onClick={() => updateLineQuantity(item.lineId, 1)}
                            className="min-h-[34px] min-w-[34px] flex items-center justify-center text-zinc-300 hover:bg-[#1C1C22]"
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        <div className="flex items-center gap-1.5">
                          {item.quantity > 1 && (
                            <button
                              type="button"
                              onClick={() => handleSplitUnit(item.lineId)}
                              className="min-h-[34px] px-2 rounded-lg border border-[#27272E] bg-[#0A0A0A] text-[11px] font-semibold text-zinc-300 hover:text-white flex items-center gap-1"
                            >
                              <Split className="w-3 h-3" />
                              <span>Separar 1</span>
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => openEditItemModal(item)}
                            className={`min-h-[34px] px-2.5 rounded-lg border text-xs font-bold flex items-center gap-1 transition-colors ${
                              needsSauces
                                ? 'border-amber-400 bg-amber-500 text-black'
                                : 'border-[#27272E] bg-[#0A0A0A] text-white hover:border-amber-500'
                            }`}
                          >
                            <Edit3 className="w-3 h-3" />
                            <span>Receta / Salsas</span>
                          </button>
                          <button
                            type="button"
                            aria-label={`Quitar ${item.productName}`}
                            onClick={() =>
                              setItems((prev) => prev.filter((i) => i.lineId !== item.lineId))
                            }
                            className="min-h-[34px] min-w-[34px] flex items-center justify-center rounded-lg text-red-400 hover:bg-red-950/60"
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

            {/* General Notes */}
            <div>
              <label htmlFor="pos-order-notes" className="block text-xs font-semibold text-zinc-400 mb-1">
                Nota general (opcional)
              </label>
              <input
                id="pos-order-notes"
                type="text"
                maxLength={400}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Ej. Para llevar en cajas separadas..."
                className="w-full min-h-[40px] rounded-xl border border-[#27272E] bg-[#0A0A0A] px-3 text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>

            {/* Initial Payment State */}
            <div className="border border-[#27272E] rounded-xl p-3 space-y-2.5 bg-[#0A0A0A]">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-zinc-300">Pago inicial</span>
                <div className="flex items-center gap-1 p-1 bg-[#141418] border border-[#27272E] rounded-lg">
                  <button
                    type="button"
                    onClick={() => setPaymentStatus('pendiente')}
                    className={`min-h-[32px] px-2.5 rounded-md text-xs font-bold transition-colors ${
                      paymentStatus === 'pendiente'
                        ? 'bg-amber-500 text-black'
                        : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    Por cobrar
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaymentStatus('pagado')}
                    className={`min-h-[32px] px-2.5 rounded-md text-xs font-bold transition-colors ${
                      paymentStatus === 'pagado'
                        ? 'bg-emerald-600 text-white'
                        : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    Pagado
                  </button>
                </div>
              </div>

              {paymentStatus === 'pagado' && (
                <div className="space-y-2.5 pt-2 border-t border-[#27272E]">
                  <div className="grid grid-cols-3 gap-1.5">
                    {(['efectivo', 'transferencia', 'tarjeta'] as PaymentMethod[]).map((method) => (
                      <button
                        key={method}
                        type="button"
                        onClick={() => setPaymentMethod(method)}
                        className={`min-h-[36px] rounded-lg border text-xs font-bold capitalize transition-colors ${
                          paymentMethod === method
                            ? 'border-amber-400 bg-amber-500 text-black'
                            : 'border-[#27272E] bg-[#141418] text-zinc-300'
                        }`}
                      >
                        {method}
                      </button>
                    ))}
                  </div>

                  {paymentMethod === 'transferencia' && (
                    <div className="space-y-2">
                      <input
                        ref={cameraRef}
                        type="file"
                        accept="image/*"
                        capture="environment"
                        onChange={handleReceiptSelected}
                        className="hidden"
                      />
                      <input
                        ref={galleryRef}
                        type="file"
                        accept="image/*"
                        onChange={handleReceiptSelected}
                        className="hidden"
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => cameraRef.current?.click()}
                          className="min-h-[38px] rounded-lg border border-[#27272E] bg-[#141418] text-xs font-semibold text-white flex items-center justify-center gap-1.5"
                        >
                          <Camera className="w-3.5 h-3.5 text-amber-400" />
                          <span>Cámara</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => galleryRef.current?.click()}
                          className="min-h-[38px] rounded-lg border border-[#27272E] bg-[#141418] text-xs font-semibold text-white flex items-center justify-center gap-1.5"
                        >
                          <ImageIcon className="w-3.5 h-3.5 text-zinc-300" />
                          <span>Galería</span>
                        </button>
                      </div>
                      {receiptPreview && (
                        <div className="flex items-center gap-2 p-2 rounded-lg border border-[#27272E] bg-[#141418]">
                          <img
                            src={receiptPreview}
                            alt="Comprobante"
                            className="w-10 h-12 object-cover rounded border border-[#27272E]"
                          />
                          <input
                            type="text"
                            value={receiptNotes}
                            onChange={(e) => setReceiptNotes(e.target.value)}
                            placeholder="Ref. Nequi / Banco"
                            className="flex-1 min-w-0 text-xs bg-[#0A0A0A] border border-[#27272E] rounded px-2 py-1.5 text-white"
                          />
                          <button
                            type="button"
                            aria-label="Quitar foto"
                            onClick={() => {
                              setReceiptFile(null);
                              setReceiptPreview('');
                            }}
                            className="p-1.5 text-zinc-400 hover:text-red-400"
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
          </div>

          <div className="p-4 border-t border-[#27272E] bg-[#101014] space-y-2.5 shrink-0 pb-safe">
            <div className="flex items-center justify-between text-sm">
              <span className="text-zinc-300 font-semibold">Total del pedido</span>
              <span className="font-mono text-2xl font-extrabold text-amber-400 tabular-nums">
                {formatCurrency(totals.total)}
              </span>
            </div>
            <button
              type="button"
              disabled={submitting || items.length === 0}
              onClick={handleSubmit}
              className="w-full min-h-[48px] rounded-xl bg-red-600 text-white text-sm font-extrabold uppercase tracking-wide hover:bg-red-500 disabled:opacity-45 transition-colors flex items-center justify-center gap-2 shadow-lg"
            >
              <Check className="w-4 h-4" />
              <span>{submitting ? 'Enviando pedido...' : 'Confirmar y enviar pedido'}</span>
            </button>
          </div>
        </aside>
      </div>

      {/* Mobile Compact Floating Bar above Bottom Nav (strictly <= 15% height) */}
      {!mobileComandaOpen && items.length > 0 && (
        <div className="lg:hidden fixed bottom-16 left-0 right-0 z-30 px-3 pb-2 pointer-events-none">
          <button
            type="button"
            onClick={() => setMobileComandaOpen(true)}
            className="pointer-events-auto w-full min-h-[50px] rounded-xl bg-amber-500 text-black px-4 text-sm font-extrabold flex items-center justify-between shadow-2xl border border-amber-300"
          >
            <span className="flex items-center gap-2">
              <ShoppingBag className="w-4 h-4" />
              <span>
                Ver pedido ({totalUnits} {totalUnits === 1 ? 'ud' : 'uds'})
                {!sauceValidation.valid ? ' · Faltan salsas' : ''}
              </span>
            </span>
            <span className="font-mono font-extrabold tabular-nums">
              {formatCurrency(totals.total)}
            </span>
          </button>
        </div>
      )}

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
