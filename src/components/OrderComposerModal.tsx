import React, { useEffect, useMemo, useState } from 'react';
import { Check, ShoppingBag, UserCheck, X } from 'lucide-react';
import { usePosStore } from '../services/posStore';
import type { Order, OrderItem, Product } from '../types/pos';
import {
  addOrMergeCartItem,
  adjustCartLineQuantity,
  buildOrderItem,
  calculateOrderTotals,
  formatCurrency,
  splitCartLineUnit,
  validateOrderItemsSauces,
} from '../utils/orderMath';
import { OrderCartItemsList, ProductCatalogPanel } from './OrderMenuAndCart';
import { RecipeCustomizeModal } from './RecipeCustomizeModal';

interface Props {
  open: boolean;
  editingOrder: Order;
  onClose: () => void;
  onOpenWaiterPicker: () => void;
}

const QUICK_REFS = ['Mesa 1', 'Mesa 2', 'Mesa 3', 'Mesa 4', 'Barra', 'Para llevar'];

export const OrderComposerModal: React.FC<Props> = ({
  open,
  editingOrder,
  onClose,
  onOpenWaiterPicker,
}) => {
  const { products, activeWaiter, updateOrderItems } = usePosStore();

  const [reference, setReference] = useState(editingOrder.reference);
  const [notes, setNotes] = useState(editingOrder.notes);
  const [items, setItems] = useState<OrderItem[]>([...editingOrder.items]);
  const [selectedCategory, setSelectedCategory] = useState('Todas');
  const [searchTerm, setSearchTerm] = useState('');
  const [customizingProduct, setCustomizingProduct] = useState<Product | null>(null);
  const [editingLineItem, setEditingLineItem] = useState<OrderItem | null>(null);
  const [mobileCartExpanded, setMobileCartExpanded] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const activeProducts = useMemo(() => products.filter((p) => p.active), [products]);
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

  useEffect(() => {
    if (!open) return;
    const handleBackIntercept = (e: Event) => {
      if (customizingProduct) {
        e.preventDefault();
        setCustomizingProduct(null);
        setEditingLineItem(null);
      } else if (mobileCartExpanded) {
        e.preventDefault();
        setMobileCartExpanded(false);
      }
    };
    window.addEventListener('ondeluigi:back-intercept', handleBackIntercept);
    return () => window.removeEventListener('ondeluigi:back-intercept', handleBackIntercept);
  }, [open, customizingProduct, mobileCartExpanded]);

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
    setItems((prev) => addOrMergeCartItem(prev, candidate));
  };

  const handleConfirmCustomized = (built: OrderItem) => {
    setErrorMsg(null);
    if (editingLineItem) {
      setItems((prev) => prev.map((i) => (i.lineId === built.lineId ? built : i)));
      setEditingLineItem(null);
      setCustomizingProduct(null);
      return;
    }
    setItems((prev) => addOrMergeCartItem(prev, built));
    setCustomizingProduct(null);
  };

  const handleSubmit = async () => {
    setErrorMsg(null);
    if (!activeWaiter) {
      setErrorMsg('Selecciona tu nombre de mesero o encargado antes de guardar.');
      onOpenWaiterPicker();
      return;
    }
    if (items.length === 0) {
      setErrorMsg('Agrega al menos un producto al pedido.');
      return;
    }
    if (!sauceValidation.valid) {
      setErrorMsg(
        sauceValidation.message || 'Elige entre 1 y 4 salsas en cada producto que lo requiera.'
      );
      setMobileCartExpanded(true);
      return;
    }

    setSubmitting(true);
    try {
      await updateOrderItems(
        editingOrder.id,
        items,
        reference.trim() || editingOrder.reference,
        notes
      );
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'No se pudo guardar el pedido.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-40 flex flex-col bg-[#0A0A0A] lg:bg-black/75 lg:backdrop-blur-sm lg:p-6 lg:items-center lg:justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="order-composer-title"
    >
      <div className="w-full h-full lg:max-w-6xl lg:max-h-[92vh] bg-[#141418] text-white lg:rounded-2xl lg:border lg:border-[#27272E] lg:shadow-2xl flex flex-col overflow-hidden">
        <div className="px-4 sm:px-6 py-3.5 border-b border-[#27272E] flex items-center justify-between gap-3 bg-[#101014] shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <h2 id="order-composer-title" className="font-poster text-xl font-extrabold text-white tracking-wide truncate">
              EDITAR PEDIDO #{editingOrder.orderNumber}
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

        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 overflow-hidden">
          <div className="lg:col-span-7 flex flex-col min-h-0 border-b lg:border-b-0 lg:border-r border-[#27272E] overflow-hidden">
            <div className="p-4 sm:p-5 border-b border-[#27272E] shrink-0 bg-[#141418]">
              <label
                htmlFor="order-reference-input"
                className="block text-xs font-semibold text-zinc-300 mb-1.5"
              >
                Mesa / Cliente / Referencia{' '}
                <span className="text-zinc-400 font-normal">(opcional · auto #1–#99)</span>
              </label>
              <input
                id="order-reference-input"
                type="text"
                maxLength={100}
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="Ej. Mesa 4"
                className="w-full min-h-[42px] rounded-xl border border-[#27272E] bg-[#0A0A0A] px-3.5 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
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

            <div className="flex-1 overflow-y-auto p-4 sm:p-5 bg-[#0A0A0A]">
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
                compactHeader
              />
            </div>
          </div>

          <div
            className={`lg:col-span-5 flex flex-col bg-[#141418] min-h-0 ${
              mobileCartExpanded ? 'fixed inset-x-0 bottom-0 top-14 z-30 lg:static' : 'hidden lg:flex'
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
                  + Productos
                </button>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-3">
              <OrderCartItemsList
                items={items}
                productMap={productMap}
                onUpdateQty={(id, delta) => setItems((prev) => adjustCartLineQuantity(prev, id, delta))}
                onSplitUnit={(id) => setItems((prev) => splitCartLineUnit(prev, id))}
                onEditItem={(item) => {
                  const prod = productMap.get(item.productId);
                  if (!prod) return;
                  setEditingLineItem(item);
                  setCustomizingProduct(prod);
                }}
                onRemoveItem={(id) => setItems((prev) => prev.filter((i) => i.lineId !== id))}
              />

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
                <span>{submitting ? 'Guardando...' : 'Guardar cambios del pedido'}</span>
              </button>
            </div>
          </div>
        </div>

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
