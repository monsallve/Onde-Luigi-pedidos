import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera,
  Check,
  CheckCircle2,
  Image as ImageIcon,
  Lock,
  ShoppingBag,
  X,
} from 'lucide-react';
import { usePosStore } from '../services/posStore';
import { ROLE_LABELS } from '../utils/rolePermissions';
import type {
  Order,
  OrderItem,
  PaymentMethod,
  PaymentStatus,
  Product,
} from '../types/pos';
import {
  addOrMergeCartItem,
  adjustCartLineQuantity,
  buildOrderItem,
  calculateOrderTotals,
  formatCurrency,
  splitCartLineUnit,
  validateOrderItemsSauces,
} from '../utils/orderMath';
import { OrderCartItemsList, ProductCatalogPanel } from '../components/OrderMenuAndCart';
import { RecipeCustomizeModal } from '../components/RecipeCustomizeModal';

interface Props {
  onOpenWaiterPicker: () => void;
  onGoToOrders: () => void;
}

const QUICK_REFS = ['Mesa 1', 'Mesa 2', 'Mesa 3', 'Mesa 4', 'Barra', 'Para llevar', 'Domicilio'];
export const ORDER_DRAFT_STORAGE_KEY = 'ondeluigi_order_draft_v1';

interface OrderDraftPayload {
  reference: string;
  notes: string;
  items: OrderItem[];
  paymentStatus: PaymentStatus;
  paymentMethod: PaymentMethod;
  receiptNotes: string;
}

function loadOrderDraft(): OrderDraftPayload | null {
  try {
    if (typeof window === 'undefined') return null;
    const raw = window.localStorage.getItem(ORDER_DRAFT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<OrderDraftPayload>;
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      reference: typeof parsed.reference === 'string' ? parsed.reference : '',
      notes: typeof parsed.notes === 'string' ? parsed.notes : '',
      items: Array.isArray(parsed.items) ? parsed.items : [],
      paymentStatus: parsed.paymentStatus === 'pagado' ? 'pagado' : 'pendiente',
      paymentMethod:
        parsed.paymentMethod === 'efectivo' ||
        parsed.paymentMethod === 'transferencia' ||
        parsed.paymentMethod === 'tarjeta' ||
        parsed.paymentMethod === 'otro'
          ? parsed.paymentMethod
          : 'transferencia',
      receiptNotes: typeof parsed.receiptNotes === 'string' ? parsed.receiptNotes : '',
    };
  } catch {
    return null;
  }
}

function clearOrderDraftStorage() {
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(ORDER_DRAFT_STORAGE_KEY);
    }
  } catch {
    // ignore storage errors
  }
}

export const PosOrderWorkspaceView: React.FC<Props> = ({
  onOpenWaiterPicker,
  onGoToOrders,
}) => {
  const { products, sauces, activeWaiter, effectiveRole, permissions, createOrder } = usePosStore();

  const initialDraft = useMemo(() => loadOrderDraft(), []);
  const [reference, setReference] = useState(initialDraft?.reference ?? '');
  const [notes, setNotes] = useState(initialDraft?.notes ?? '');
  const [items, setItems] = useState<OrderItem[]>(initialDraft?.items ?? []);

  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>(
    initialDraft?.paymentStatus ?? 'pendiente'
  );
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(
    initialDraft?.paymentMethod ?? 'transferencia'
  );
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [receiptPreview, setReceiptPreview] = useState('');
  const [receiptNotes, setReceiptNotes] = useState<string>(initialDraft?.receiptNotes ?? '');

  const [selectedCategory, setSelectedCategory] = useState('Todas');
  const [searchTerm, setSearchTerm] = useState('');
  const [customizingProduct, setCustomizingProduct] = useState<Product | null>(null);
  const [editingLineItem, setEditingLineItem] = useState<OrderItem | null>(null);
  const [mobileComandaOpen, setMobileComandaOpen] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [lastCreatedOrder, setLastCreatedOrder] = useState<Order | null>(null);

  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const hasDraft =
      items.length > 0 ||
      Boolean(reference.trim()) ||
      Boolean(notes.trim()) ||
      paymentStatus === 'pagado' ||
      Boolean(receiptNotes.trim());

    if (!hasDraft) {
      clearOrderDraftStorage();
      return;
    }

    try {
      const payload: OrderDraftPayload = {
        reference,
        notes,
        items,
        paymentStatus,
        paymentMethod,
        receiptNotes,
      };
      window.localStorage.setItem(ORDER_DRAFT_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // ignore quota/private-mode storage errors
    }
  }, [reference, notes, items, paymentStatus, paymentMethod, receiptNotes]);

  useEffect(() => {
    const handleBackIntercept = (e: Event) => {
      if (customizingProduct) {
        e.preventDefault();
        setCustomizingProduct(null);
        setEditingLineItem(null);
      } else if (mobileComandaOpen) {
        e.preventDefault();
        setMobileComandaOpen(false);
      }
    };
    window.addEventListener('ondeluigi:back-intercept', handleBackIntercept);
    return () => window.removeEventListener('ondeluigi:back-intercept', handleBackIntercept);
  }, [customizingProduct, mobileComandaOpen]);

  const activeProducts = useMemo(() => products.filter((p) => p.active), [products]);
  const activeSauceCount = useMemo(() => sauces.filter((s) => s.active).length, [sauces]);
  const productMap = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const categories = useMemo(
    () => ['Todas', ...Array.from(new Set(activeProducts.map((p) => p.category)))],
    [activeProducts]
  );

  const filteredProducts = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return activeProducts.filter((p) => {
      const catMatch = selectedCategory === 'Todas' || p.category === selectedCategory;
      const textMatch =
        !q || p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q);
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
    setItems((prev) => addOrMergeCartItem(prev, candidate));
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
    setItems((prev) => addOrMergeCartItem(prev, built));
    setCustomizingProduct(null);
  };

  const handleReceiptSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setReceiptFile(file);
    const reader = new FileReader();
    reader.onload = () => setReceiptPreview(String(reader.result));
    reader.readAsDataURL(file);
  };

  const handleClearDraft = () => {
    setReference('');
    setNotes('');
    setItems([]);
    setPaymentStatus('pendiente');
    setPaymentMethod('transferencia');
    setReceiptFile(null);
    setReceiptPreview('');
    setReceiptNotes('');
    setErrorMsg(null);
    clearOrderDraftStorage();
  };

  const handleSubmit = async () => {
    setErrorMsg(null);
    if (!activeWaiter) {
      setErrorMsg('Selecciona tu nombre de mesero o encargado antes de enviar el pedido.');
      onOpenWaiterPicker();
      return;
    }
    if (items.length === 0) {
      setErrorMsg('Agrega al menos un producto del menú.');
      return;
    }
    if (!sauceValidation.valid) {
      setErrorMsg(
        sauceValidation.message || 'Elige entre 1 y 4 salsas en cada producto que requiere salsas.'
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
      handleClearDraft();
      setMobileComandaOpen(false);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'No se pudo enviar el pedido.');
    } finally {
      setSubmitting(false);
    }
  };

  const openEditItemModal = (item: OrderItem) => {
    const prod = productMap.get(item.productId);
    if (!prod) return;
    setEditingLineItem(item);
    setCustomizingProduct(prod);
  };

  if (!permissions.canTakeOrders) {
    return (
      <div className="bg-[#141418] border border-[#27272E] rounded-2xl p-10 text-center max-w-lg mx-auto my-8 space-y-3">
        <Lock className="w-10 h-10 text-amber-400 mx-auto" />
        <h1 className="font-poster text-2xl font-extrabold text-white tracking-wide">
          TOMA DE PEDIDOS NO DISPONIBLE
        </h1>
        <p className="text-sm text-zinc-400">
          Tu rol actual (<strong className="text-white">{ROLE_LABELS[effectiveRole]}</strong>) no tiene permiso para registrar pedidos nuevos desde esta pantalla.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
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

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        <section className="lg:col-span-7">
          <ProductCatalogPanel
            products={filteredProducts}
            itemsInOrder={items}
            categories={categories}
            selectedCategory={selectedCategory}
            onSelectCategory={setSelectedCategory}
            searchTerm={searchTerm}
            onSearchChange={setSearchTerm}
            onQuickAdd={handleQuickAdd}
            onCustomize={(product) => {
              setEditingLineItem(null);
              setCustomizingProduct(product);
            }}
          />
        </section>

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
              {(items.length > 0 || reference.trim() || notes.trim()) && (
                <button
                  type="button"
                  onClick={handleClearDraft}
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

            <div>
              <label
                htmlFor="pos-reference-input"
                className="block text-xs font-bold text-zinc-300 mb-1.5"
              >
                Mesa o Nombre del Cliente{' '}
                <span className="text-zinc-400 font-normal">(opcional · auto #1–#99)</span>
              </label>
              <input
                id="pos-reference-input"
                type="text"
                maxLength={100}
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="Ej. Mesa 3 · Si lo dejas vacío asigna #1–#99 automático"
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

            <OrderCartItemsList
              items={items}
              productMap={productMap}
              onUpdateQty={(id, delta) => setItems((prev) => adjustCartLineQuantity(prev, id, delta))}
              onSplitUnit={(id) => setItems((prev) => splitCartLineUnit(prev, id))}
              onEditItem={openEditItemModal}
              onRemoveItem={(id) => setItems((prev) => prev.filter((i) => i.lineId !== id))}
            />

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
