import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Ban,
  BellRing,
  CheckCircle2,
  ChefHat,
  Clock,
  Edit3,
  MapPin,
  Minus,
  Plus,
  Receipt,
  Search,
  ShoppingBag,
  Sparkles,
  Store,
  Trash2,
  Truck,
  Upload,
  X,
} from 'lucide-react';
import { buildInitialCatalogSeed } from '../data/initialCatalog';
import {
  persistTrackingOrderId,
  readStoredTrackingOrderId,
  submitSelfServiceOrder,
  subscribePublicCatalog,
  subscribePublicQueueTickets,
  subscribePublicStorefront,
  subscribeSelfOrderById,
} from '../services/selfServiceService';
import type {
  DeliveryType,
  Order,
  OrderItem,
  OrderStatus,
  Product,
  PublicQueueTicket,
  PublicStorefrontConfig,
  Sauce,
} from '../types/pos';
import {
  addOrMergeCartItem,
  adjustCartLineQuantity,
  calculateOrderTotals,
  formatCurrency,
  formatCustomizationSummary,
  formatDateTimeShort,
  resolveAssetUrl,
} from '../utils/orderMath';
import {
  computeOrdersAheadCount,
  DEFAULT_SELF_SERVICE_CONFIG,
  getSelfServiceStepIndex,
  validateSelfServiceCheckout,
} from '../utils/selfServiceMath';
import { SelfServiceCustomizeModal } from '../components/SelfServiceCustomizeModal';
import { SelfServiceQrCard } from '../components/SelfServiceQrCard';

interface Props {
  initialOrderId?: string;
}

const PREVIEW_SEED = buildInitialCatalogSeed('preview');

const TRACKER_STEPS: Array<{
  key: OrderStatus;
  label: string;
  description: string;
  icon: React.ReactNode;
}> = [
  {
    key: 'pendiente_validacion',
    label: 'Validando pago',
    description: 'Revisamos tu comprobante en caja.',
    icon: <Clock className="w-4 h-4" />,
  },
  {
    key: 'tomado',
    label: 'Confirmado',
    description: 'Tu pedido entró a la fila oficial.',
    icon: <CheckCircle2 className="w-4 h-4" />,
  },
  {
    key: 'preparacion',
    label: 'En preparación',
    description: 'Nuestro equipo está preparando tu comida.',
    icon: <ChefHat className="w-4 h-4" />,
  },
  {
    key: 'listo',
    label: '¡Listo!',
    description: 'Listo para entregar o despachar.',
    icon: <BellRing className="w-4 h-4" />,
  },
  {
    key: 'entregado',
    label: 'Entregado',
    description: '¡Buen provecho!',
    icon: <Sparkles className="w-4 h-4" />,
  },
];

function playOrderReadyChime(): void {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const notes = [587.33, 783.99, 1046.5];
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      const start = ctx.currentTime + idx * 0.14;
      gain.gain.setValueAtTime(0.001, start);
      gain.gain.exponentialRampToValueAtTime(0.22, start + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.35);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.36);
    });
  } catch {
    // ignore browser audio autoplay restrictions
  }
}

function updateUrlOrderParam(orderId: string): void {
  if (typeof window === 'undefined') return;
  try {
    const url = new URL(window.location.href);
    url.searchParams.set('autoservicio', '1');
    if (orderId) {
      url.searchParams.set('pedido', orderId);
    } else {
      url.searchParams.delete('pedido');
    }
    window.history.replaceState({}, '', url.pathname + url.search + url.hash);
  } catch {
    // ignore URL errors
  }
}

export const SelfServiceView: React.FC<Props> = ({ initialOrderId }) => {
  const [storefront, setStorefront] = useState<PublicStorefrontConfig | null>(null);
  const [hasCloudStorefront, setHasCloudStorefront] = useState(false);
  const [cloudProducts, setCloudProducts] = useState<Product[]>([]);
  const [hasCloudProducts, setHasCloudProducts] = useState(false);
  const [cloudSauces, setCloudSauces] = useState<Sauce[]>([]);
  const [hasCloudSauces, setHasCloudSauces] = useState(false);
  const [queueTickets, setQueueTickets] = useState<PublicQueueTicket[]>([]);
  const [cloudLoading, setCloudLoading] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  const [activeOrderId, setActiveOrderId] = useState<string>(() => {
    const cleanInit = (initialOrderId || '').trim();
    return cleanInit || readStoredTrackingOrderId();
  });
  const [viewMode, setViewMode] = useState<'menu' | 'tracker'>(() =>
    (initialOrderId || '').trim() || readStoredTrackingOrderId() ? 'tracker' : 'menu'
  );
  const [trackedOrder, setTrackedOrder] = useState<Order | null>(null);
  const [trackerLoading, setTrackerLoading] = useState(false);

  const [selectedCategory, setSelectedCategory] = useState('Todas');
  const [searchTerm, setSearchTerm] = useState('');
  const [customizingProduct, setCustomizingProduct] = useState<Product | null>(null);
  const [editingCartLine, setEditingCartLine] = useState<OrderItem | null>(null);
  const [cartOpen, setCartOpen] = useState(false);

  const [cartItems, setCartItems] = useState<OrderItem[]>([]);
  const [deliveryType, setDeliveryType] = useState<DeliveryType | ''>('');
  const [customerName, setCustomerName] = useState('');
  const [deliveryPhone, setDeliveryPhone] = useState('');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [deliveryNeighborhood, setDeliveryNeighborhood] = useState('');
  const [deliveryNotes, setDeliveryNotes] = useState('');
  const [orderNotes, setOrderNotes] = useState('');
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [receiptPreviewUrl, setReceiptPreviewUrl] = useState('');
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const readyNotifiedOrderRef = useRef<string>('');
  const receiptInputRef = useRef<HTMLInputElement>(null);

  // Subscribe to public storefront, live menu/sauces, and queue tickets
  useEffect(() => {
    let mounted = true;
    const unsubStore = subscribePublicStorefront(
      (cfg, exists) => {
        if (!mounted) return;
        setStorefront(cfg);
        setHasCloudStorefront(exists);
        setCloudLoading(false);
      },
      () => {
        if (!mounted) return;
        setCloudLoading(false);
      }
    );

    const unsubCat = subscribePublicCatalog(
      (prods, hasRows) => {
        if (!mounted) return;
        setCloudProducts(prods);
        setHasCloudProducts(hasRows);
        setCatalogError(null);
        setCloudLoading(false);
      },
      (saucesList, hasRows) => {
        if (!mounted) return;
        setCloudSauces(saucesList);
        setHasCloudSauces(hasRows);
        setCatalogError(null);
      },
      (err) => {
        if (!mounted) return;
        setCatalogError(err.message);
      }
    );

    const unsubQueue = subscribePublicQueueTickets((tickets) => {
      if (!mounted) return;
      setQueueTickets(tickets);
    });

    return () => {
      mounted = false;
      unsubStore();
      unsubCat();
      unsubQueue();
    };
  }, []);

  // Subscribe to the active tracked customer order
  useEffect(() => {
    if (!activeOrderId) {
      setTrackedOrder(null);
      setTrackerLoading(false);
      return;
    }
    setTrackerLoading(true);
    const unsub = subscribeSelfOrderById(
      activeOrderId,
      (order) => {
        setTrackedOrder(order);
        setTrackerLoading(false);
      },
      () => {
        setTrackerLoading(false);
      }
    );
    return () => unsub();
  }, [activeOrderId]);

  // Trigger celebratory visual + sound + vibration alert when tracked order turns 'listo'
  useEffect(() => {
    if (
      trackedOrder &&
      trackedOrder.status === 'listo' &&
      readyNotifiedOrderRef.current !== trackedOrder.id
    ) {
      readyNotifiedOrderRef.current = trackedOrder.id;
      playOrderReadyChime();
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        navigator.vibrate([220, 110, 220]);
      }
    }
  }, [trackedOrder]);

  const effectivePaymentConfig = storefront || DEFAULT_SELF_SERVICE_CONFIG;
  const businessTitle = storefront?.businessName || "O'NDE LUIGI";
  const isPaused = hasCloudStorefront && storefront?.enabled === false;

  const catalogProducts = useMemo(() => {
    const sourceList = hasCloudProducts ? cloudProducts : PREVIEW_SEED.products;
    return sourceList.filter((p) => p.active);
  }, [hasCloudProducts, cloudProducts]);

  const catalogSauces = useMemo(() => {
    const sourceList = hasCloudSauces ? cloudSauces : PREVIEW_SEED.sauces;
    return sourceList.filter((s) => s.active);
  }, [hasCloudSauces, cloudSauces]);

  const categories = useMemo(() => {
    const unique = Array.from(new Set(catalogProducts.map((p) => p.category).filter(Boolean)));
    return ['Todas', ...unique];
  }, [catalogProducts]);

  const filteredProducts = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return catalogProducts.filter((p) => {
      if (selectedCategory !== 'Todas' && p.category !== selectedCategory) return false;
      if (q) {
        return (
          p.name.toLowerCase().includes(q) ||
          p.category.toLowerCase().includes(q) ||
          p.baseRecipe.some((r) => r.toLowerCase().includes(q))
        );
      }
      return true;
    });
  }, [catalogProducts, selectedCategory, searchTerm]);

  const { subtotal, total } = useMemo(() => calculateOrderTotals(cartItems), [cartItems]);
  const totalCartUnits = useMemo(
    () => cartItems.reduce((sum, item) => sum + item.quantity, 0),
    [cartItems]
  );

  const ordersAhead = useMemo(() => {
    if (!trackedOrder) return 0;
    return computeOrdersAheadCount(queueTickets, trackedOrder.id);
  }, [queueTickets, trackedOrder]);

  const handleConfirmCustomizedItem = (built: OrderItem) => {
    if (editingCartLine) {
      setCartItems((prev) =>
        prev.map((item) => (item.lineId === editingCartLine.lineId ? built : item))
      );
      setEditingCartLine(null);
      setCustomizingProduct(null);
      return;
    }
    setCartItems((prev) => addOrMergeCartItem(prev, built));
    setCustomizingProduct(null);
  };

  const handleEditCartLine = (line: OrderItem) => {
    const prod = catalogProducts.find((p) => p.id === line.productId);
    if (!prod) return;
    setEditingCartLine(line);
    setCustomizingProduct(prod);
  };

  const handleReceiptSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setReceiptFile(file);
    setCheckoutError(null);
    setFieldErrors((prev) => {
      const next = { ...prev };
      delete next.receipt;
      return next;
    });
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setReceiptPreviewUrl(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleClearReceipt = () => {
    setReceiptFile(null);
    setReceiptPreviewUrl('');
    if (receiptInputRef.current) receiptInputRef.current.value = '';
  };

  const handleSubmitOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    setCheckoutError(null);
    const check = validateSelfServiceCheckout({
      deliveryType,
      customerName,
      deliveryPhone,
      deliveryAddress,
      deliveryNeighborhood,
      deliveryNotes,
      paymentMethod: 'transferencia',
      hasReceiptFile: Boolean(receiptFile),
      items: cartItems,
    });

    if (!check.valid) {
      setFieldErrors(check.errors);
      setCheckoutError(check.firstError);
      return;
    }

    setFieldErrors({});
    setSubmitting(true);
    try {
      const created = await submitSelfServiceOrder({
        storefront,
        queueTickets,
        items: cartItems,
        deliveryType,
        customerName,
        deliveryPhone,
        deliveryAddress,
        deliveryNeighborhood,
        deliveryNotes,
        notes: orderNotes,
        receiptFile,
      });

      setTrackedOrder(created);
      setActiveOrderId(created.id);
      updateUrlOrderParam(created.id);
      setCartItems([]);
      setOrderNotes('');
      handleClearReceipt();
      setCartOpen(false);
      setViewMode('tracker');
    } catch (err) {
      setCheckoutError(
        err instanceof Error ? err.message : 'No se pudo enviar el pedido. Intenta nuevamente.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleStartAnotherOrder = () => {
    persistTrackingOrderId('');
    updateUrlOrderParam('');
    setActiveOrderId('');
    setTrackedOrder(null);
    setViewMode('menu');
  };

  const renderCheckoutForm = () => (
    <form onSubmit={handleSubmitOrder} className="space-y-4">
      {checkoutError && (
        <div
          role="alert"
          className="rounded-xl bg-red-950/75 border border-red-600 px-3.5 py-2.5 text-xs font-semibold text-red-100 flex items-start gap-2"
        >
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          <span>{checkoutError}</span>
        </div>
      )}

      {/* Cart Items */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-extrabold uppercase tracking-wider text-amber-400">
            Tu carrito ({totalCartUnits} uds)
          </h3>
          {cartItems.length > 0 && (
            <button
              type="button"
              onClick={() => setCartItems([])}
              className="text-[11px] font-semibold text-zinc-400 hover:text-red-300"
            >
              Vaciar
            </button>
          )}
        </div>

        {cartItems.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[#27272E] bg-[#0A0A0A] p-6 text-center space-y-1.5">
            <ShoppingBag className="w-7 h-7 text-zinc-600 mx-auto" />
            <p className="text-xs font-bold text-zinc-300">Tu carrito está vacío</p>
            <p className="text-[11px] text-zinc-500">
              Selecciona productos de la carta para personalizar salsas, extras o ingredientes.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-[#27272E] rounded-xl border border-[#27272E] bg-[#0A0A0A] px-3">
            {cartItems.map((line) => {
              const summary = formatCustomizationSummary(line);
              return (
                <li key={line.lineId} className="py-3 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-white leading-snug">
                        {line.productName}
                      </p>
                      {summary && (
                        <p className="text-[11px] text-amber-300 mt-0.5 leading-snug">
                          {summary}
                        </p>
                      )}
                    </div>
                    <span className="font-mono text-sm font-extrabold text-amber-400 tabular-nums shrink-0">
                      {formatCurrency(line.lineTotal)}
                    </span>
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center border border-[#27272E] bg-[#141418] rounded-lg overflow-hidden">
                      <button
                        type="button"
                        aria-label={`Disminuir ${line.productName}`}
                        onClick={() =>
                          setCartItems((prev) => adjustCartLineQuantity(prev, line.lineId, -1))
                        }
                        className="min-h-[32px] min-w-[32px] flex items-center justify-center text-zinc-300 hover:bg-[#1C1C22]"
                      >
                        <Minus className="w-3.5 h-3.5" />
                      </button>
                      <span className="w-7 text-center font-mono text-xs font-bold tabular-nums">
                        {line.quantity}
                      </span>
                      <button
                        type="button"
                        aria-label={`Aumentar ${line.productName}`}
                        onClick={() =>
                          setCartItems((prev) => adjustCartLineQuantity(prev, line.lineId, 1))
                        }
                        className="min-h-[32px] min-w-[32px] flex items-center justify-center text-zinc-300 hover:bg-[#1C1C22]"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleEditCartLine(line)}
                        className="min-h-[32px] px-2.5 rounded-lg border border-[#27272E] bg-[#141418] text-[11px] font-semibold text-zinc-200 hover:border-amber-500 inline-flex items-center gap-1"
                      >
                        <Edit3 className="w-3 h-3 text-amber-400" />
                        <span>Editar</span>
                      </button>
                      <button
                        type="button"
                        aria-label={`Eliminar ${line.productName}`}
                        onClick={() =>
                          setCartItems((prev) => prev.filter((item) => item.lineId !== line.lineId))
                        }
                        className="min-h-[32px] min-w-[32px] flex items-center justify-center rounded-lg border border-red-900/60 bg-red-950/30 text-red-400 hover:bg-red-950/70"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Subtotal / Total breakdown */}
      {cartItems.length > 0 && (
        <div className="rounded-xl border border-[#27272E] bg-[#0A0A0A] p-3 space-y-1.5">
          <div className="flex items-center justify-between text-xs text-zinc-400">
            <span>Subtotal productos</span>
            <span className="font-mono tabular-nums">{formatCurrency(subtotal)}</span>
          </div>
          <div className="flex items-center justify-between text-sm font-extrabold text-white pt-1.5 border-t border-[#27272E]">
            <span>TOTAL A PAGAR</span>
            <span className="font-mono text-lg text-amber-400 tabular-nums">
              {formatCurrency(total)}
            </span>
          </div>
        </div>
      )}

      {/* Mandatory Delivery Mode */}
      <div className="space-y-2.5 pt-1 border-t border-[#27272E]">
        <div className="flex items-center justify-between gap-2">
          <label className="text-xs font-extrabold uppercase tracking-wider text-amber-400">
            1. Modalidad de entrega *
          </label>
          {fieldErrors.deliveryType && (
            <span className="text-[11px] font-bold text-red-400">Obligatorio</span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={() => {
              setDeliveryType('local');
              setFieldErrors((prev) => {
                const next = { ...prev };
                delete next.deliveryType;
                delete next.deliveryAddress;
                delete next.deliveryNeighborhood;
                delete next.deliveryPhone;
                return next;
              });
            }}
            className={`min-h-[58px] px-3 py-2.5 rounded-xl border text-left transition-all flex items-center gap-2.5 ${
              deliveryType === 'local'
                ? 'bg-emerald-950/70 border-emerald-500 text-white shadow-sm'
                : 'bg-[#0A0A0A] border-[#27272E] text-zinc-300 hover:border-zinc-500'
            }`}
          >
            <Store
              className={`w-5 h-5 shrink-0 ${
                deliveryType === 'local' ? 'text-emerald-400' : 'text-zinc-400'
              }`}
            />
            <div className="min-w-0">
              <p className="text-xs font-extrabold leading-tight">Recoger en local</p>
              <p className="text-[10px] text-zinc-400 leading-tight mt-0.5">Sin fila en barra</p>
            </div>
          </button>

          <button
            type="button"
            onClick={() => {
              setDeliveryType('domicilio');
              setFieldErrors((prev) => {
                const next = { ...prev };
                delete next.deliveryType;
                return next;
              });
            }}
            className={`min-h-[58px] px-3 py-2.5 rounded-xl border text-left transition-all flex items-center gap-2.5 ${
              deliveryType === 'domicilio'
                ? 'bg-sky-950/70 border-sky-500 text-white shadow-sm'
                : 'bg-[#0A0A0A] border-[#27272E] text-zinc-300 hover:border-zinc-500'
            }`}
          >
            <Truck
              className={`w-5 h-5 shrink-0 ${
                deliveryType === 'domicilio' ? 'text-sky-400' : 'text-zinc-400'
              }`}
            />
            <div className="min-w-0">
              <p className="text-xs font-extrabold leading-tight">Domicilio</p>
              <p className="text-[10px] text-zinc-400 leading-tight mt-0.5">Envío a tu dirección</p>
            </div>
          </button>
        </div>

        {effectivePaymentConfig.deliveryInstructions && (
          <p className="text-[11px] text-zinc-400 leading-relaxed">
            {effectivePaymentConfig.deliveryInstructions}
          </p>
        )}

        <div className="space-y-2.5">
          <div>
            <label htmlFor="self-customer-name" className="block text-xs font-semibold text-zinc-300 mb-1">
              Tu nombre completo *
            </label>
            <input
              id="self-customer-name"
              type="text"
              maxLength={120}
              value={customerName}
              onChange={(e) => {
                setCustomerName(e.target.value);
                if (fieldErrors.customerName) {
                  setFieldErrors((prev) => ({ ...prev, customerName: '' }));
                }
              }}
              placeholder="Ej. Laura Gómez"
              className={`w-full min-h-[42px] rounded-xl border bg-[#0A0A0A] px-3 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500 ${
                fieldErrors.customerName ? 'border-red-500' : 'border-[#27272E]'
              }`}
            />
          </div>

          <div>
            <label htmlFor="self-customer-phone" className="block text-xs font-semibold text-zinc-300 mb-1">
              Teléfono / WhatsApp {deliveryType === 'domicilio' ? '*' : '(opcional)'}
            </label>
            <input
              id="self-customer-phone"
              type="tel"
              maxLength={40}
              value={deliveryPhone}
              onChange={(e) => {
                setDeliveryPhone(e.target.value);
                if (fieldErrors.deliveryPhone) {
                  setFieldErrors((prev) => ({ ...prev, deliveryPhone: '' }));
                }
              }}
              placeholder="Ej. 300 123 4567"
              className={`w-full min-h-[42px] rounded-xl border bg-[#0A0A0A] px-3 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500 ${
                fieldErrors.deliveryPhone ? 'border-red-500' : 'border-[#27272E]'
              }`}
            />
          </div>

          {deliveryType === 'domicilio' && (
            <div className="space-y-2.5 rounded-xl border border-sky-800/60 bg-sky-950/20 p-3">
              <div>
                <label htmlFor="self-address" className="block text-xs font-semibold text-sky-200 mb-1">
                  Dirección exacta de entrega *
                </label>
                <input
                  id="self-address"
                  type="text"
                  maxLength={220}
                  value={deliveryAddress}
                  onChange={(e) => {
                    setDeliveryAddress(e.target.value);
                    if (fieldErrors.deliveryAddress) {
                      setFieldErrors((prev) => ({ ...prev, deliveryAddress: '' }));
                    }
                  }}
                  placeholder="Ej. Calle 15 # 12-40"
                  className={`w-full min-h-[42px] rounded-xl border bg-[#0A0A0A] px-3 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-sky-500 ${
                    fieldErrors.deliveryAddress ? 'border-red-500' : 'border-[#27272E]'
                  }`}
                />
              </div>

              <div>
                <label htmlFor="self-neighborhood" className="block text-xs font-semibold text-sky-200 mb-1">
                  Barrio / Sector *
                </label>
                <input
                  id="self-neighborhood"
                  type="text"
                  maxLength={100}
                  value={deliveryNeighborhood}
                  onChange={(e) => {
                    setDeliveryNeighborhood(e.target.value);
                    if (fieldErrors.deliveryNeighborhood) {
                      setFieldErrors((prev) => ({ ...prev, deliveryNeighborhood: '' }));
                    }
                  }}
                  placeholder="Ej. Centro / El Prado"
                  className={`w-full min-h-[42px] rounded-xl border bg-[#0A0A0A] px-3 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-sky-500 ${
                    fieldErrors.deliveryNeighborhood ? 'border-red-500' : 'border-[#27272E]'
                  }`}
                />
              </div>

              <div>
                <label htmlFor="self-delivery-notes" className="block text-xs font-semibold text-zinc-300 mb-1">
                  Indicaciones de llegada (opcional)
                </label>
                <input
                  id="self-delivery-notes"
                  type="text"
                  maxLength={240}
                  value={deliveryNotes}
                  onChange={(e) => setDeliveryNotes(e.target.value)}
                  placeholder="Ej. Casa esquinera portón blanco, Apto 302..."
                  className="w-full min-h-[40px] rounded-xl border border-[#27272E] bg-[#0A0A0A] px-3 text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>
            </div>
          )}

          <div>
            <label htmlFor="self-order-notes" className="block text-xs font-semibold text-zinc-300 mb-1">
              Nota general del pedido (opcional)
            </label>
            <input
              id="self-order-notes"
              type="text"
              maxLength={300}
              value={orderNotes}
              onChange={(e) => setOrderNotes(e.target.value)}
              placeholder="Ej. Cubiertos o servilletas extra..."
              className="w-full min-h-[40px] rounded-xl border border-[#27272E] bg-[#0A0A0A] px-3 text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>
        </div>
      </div>

      {/* Digital-Only Payment & Mandatory Receipt */}
      <div className="space-y-3 pt-2 border-t border-[#27272E]">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span className="text-xs font-extrabold uppercase tracking-wider text-amber-400">
            2. Pago digital y comprobante *
          </span>
          <span className="px-2 py-0.5 rounded bg-[#1C1C22] border border-[#27272E] text-[10px] font-bold text-zinc-300 uppercase whitespace-nowrap shrink-0">
            Solo transferencia
          </span>
        </div>

        <SelfServiceQrCard config={effectivePaymentConfig} amount={total} />

        <div
          className={`rounded-2xl border p-3.5 space-y-2.5 ${
            fieldErrors.receipt
              ? 'border-red-500 bg-red-950/20'
              : 'border-[#27272E] bg-[#0A0A0A]'
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="self-receipt-input" className="text-xs font-bold text-white flex items-center gap-1.5">
              <Receipt className="w-4 h-4 text-amber-400" />
              <span>Comprobante de transferencia *</span>
            </label>
            {receiptFile && (
              <span className="text-[11px] font-bold text-emerald-400">Listo</span>
            )}
          </div>

          <input
            ref={receiptInputRef}
            id="self-receipt-input"
            type="file"
            accept="image/*"
            onChange={handleReceiptSelect}
            className="sr-only"
          />

          {receiptPreviewUrl ? (
            <div className="flex items-center gap-3 p-2.5 rounded-xl border border-emerald-700/60 bg-emerald-950/20">
              <img
                src={receiptPreviewUrl}
                alt="Vista previa del comprobante de pago"
                className="w-14 h-14 rounded-lg object-cover border border-[#27272E] shrink-0"
              />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-white truncate">
                  {receiptFile?.name || 'Comprobante adjunto'}
                </p>
                <p className="text-[11px] text-emerald-300">
                  Imagen verificada para envío
                </p>
              </div>
              <button
                type="button"
                onClick={handleClearReceipt}
                aria-label="Quitar comprobante"
                className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg border border-red-800 bg-red-950/50 text-red-300 hover:bg-red-950"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <label
              htmlFor="self-receipt-input"
              className="w-full min-h-[54px] px-4 py-3 rounded-xl border border-dashed border-amber-500/60 bg-amber-500/10 text-amber-300 text-xs font-bold hover:bg-amber-500/20 flex items-center justify-center gap-2 cursor-pointer transition-colors"
            >
              <Upload className="w-4 h-4" />
              <span>Subir captura o foto del comprobante *</span>
            </label>
          )}
        </div>
      </div>

      <button
        type="submit"
        disabled={submitting || isPaused}
        className="w-full min-h-[50px] px-5 rounded-xl bg-amber-500 text-black text-sm font-extrabold hover:bg-amber-400 disabled:opacity-50 flex items-center justify-center gap-2 shadow-lg transition-colors"
      >
        <span>
          {submitting
            ? 'Enviando pedido...'
            : isPaused
              ? 'Autoservicio pausado'
              : `Confirmar pedido · ${formatCurrency(total)}`}
        </span>
        {!submitting && !isPaused && <ArrowRight className="w-4 h-4" />}
      </button>
    </form>
  );

  const renderTracker = () => {
    if (trackerLoading && !trackedOrder) {
      return (
        <div className="max-w-2xl mx-auto py-16 text-center space-y-3">
          <div className="w-10 h-10 rounded-full border-4 border-[#27272E] border-t-amber-500 animate-spin mx-auto" />
          <p className="text-sm text-zinc-300 font-medium">Conectando estado de tu pedido en vivo...</p>
        </div>
      );
    }

    if (!trackedOrder) {
      return (
        <div className="max-w-lg mx-auto bg-[#141418] border border-[#27272E] rounded-2xl p-8 text-center space-y-4">
          <AlertCircle className="w-10 h-10 text-amber-400 mx-auto" />
          <div className="space-y-1">
            <h2 className="font-poster text-2xl font-extrabold text-white uppercase">
              No encontramos ese pedido
            </h2>
            <p className="text-xs text-zinc-400">
              Es posible que el enlace haya expirado o el pedido ya haya sido archivado.
            </p>
          </div>
          <button
            type="button"
            onClick={handleStartAnotherOrder}
            className="min-h-[44px] px-5 rounded-xl bg-amber-500 text-black text-sm font-bold hover:bg-amber-400"
          >
            Volver a la carta
          </button>
        </div>
      );
    }

    const currentStepIdx = getSelfServiceStepIndex(trackedOrder.status);
    const isVoided = trackedOrder.status === 'cancelado';
    const isReady = trackedOrder.status === 'listo';

    return (
      <div className="max-w-2xl mx-auto space-y-4">
        {isReady && (
          <div
            role="status"
            className="rounded-2xl border-2 border-emerald-400 bg-emerald-950/75 p-4 flex items-center gap-3 shadow-xl animate-pulse"
          >
            <BellRing className="w-7 h-7 text-emerald-300 shrink-0" />
            <div>
              <p className="font-poster text-xl font-extrabold text-white uppercase leading-tight">
                ¡TU PEDIDO #{trackedOrder.orderNumber} ESTÁ LISTO!
              </p>
              <p className="text-xs text-emerald-200 mt-0.5">
                {trackedOrder.deliveryType === 'domicilio'
                  ? 'Acaba de salir o está listo para despacho hacia tu domicilio.'
                  : 'Ya puedes pasar por la barra presentando este número de pedido.'}
              </p>
            </div>
          </div>
        )}

        {isVoided && (
          <div
            role="alert"
            className="rounded-2xl border border-red-700 bg-red-950/60 p-4 flex items-start gap-3"
          >
            <Ban className="w-6 h-6 text-red-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-poster text-lg font-extrabold text-red-200 uppercase">
                Pedido anulado
              </p>
              <p className="text-xs text-red-200/90 mt-0.5">
                {trackedOrder.voidReason
                  ? `Motivo: ${trackedOrder.voidReason}`
                  : 'Este pedido fue anulado por caja. Acércate al punto o contáctanos si necesitas ayuda.'}
              </p>
            </div>
          </div>
        )}

        <div className="bg-[#141418] border border-[#27272E] rounded-2xl p-5 space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-3 pb-4 border-b border-[#27272E]">
            <div>
              <p className="text-xs font-mono font-bold text-amber-400 tabular-nums">
                PEDIDO #{trackedOrder.orderNumber} · {formatDateTimeShort(trackedOrder.createdAtMs)}
              </p>
              <h2 className="font-poster text-2xl sm:text-3xl font-extrabold text-white uppercase mt-0.5">
                {trackedOrder.customerName || 'Cliente'}
              </h2>
              <div className="flex flex-wrap items-center gap-2 mt-1.5 text-xs">
                <span
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border font-bold ${
                    trackedOrder.deliveryType === 'domicilio'
                      ? 'bg-sky-950/60 border-sky-700 text-sky-300'
                      : 'bg-emerald-950/60 border-emerald-700 text-emerald-300'
                  }`}
                >
                  {trackedOrder.deliveryType === 'domicilio' ? (
                    <>
                      <Truck className="w-3.5 h-3.5" />
                      <span>Domicilio</span>
                    </>
                  ) : (
                    <>
                      <Store className="w-3.5 h-3.5" />
                      <span>Recoger en local</span>
                    </>
                  )}
                </span>
                <span className="px-2.5 py-1 rounded-lg border border-[#27272E] bg-[#0A0A0A] text-zinc-300 font-semibold">
                  {trackedOrder.paymentStatus === 'pagado' ? 'Pago verificado' : 'Comprobante enviado'}
                </span>
              </div>
            </div>

            {!isVoided && trackedOrder.status !== 'entregado' && !isReady && (
              <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-center shrink-0">
                <p className="font-mono text-2xl font-extrabold text-amber-400 tabular-nums leading-none">
                  {ordersAhead}
                </p>
                <p className="text-[11px] font-semibold text-amber-200 mt-1">
                  {ordersAhead === 1 ? 'pedido delante' : 'pedidos delante'}
                </p>
              </div>
            )}
          </div>

          {!isVoided && (
            <div className="space-y-2.5">
              {TRACKER_STEPS.map((step, idx) => {
                const done = currentStepIdx >= idx;
                const isCurrent = currentStepIdx === idx;
                return (
                  <div
                    key={step.key}
                    className={`flex items-center gap-3 p-3 rounded-xl border transition-colors ${
                      isCurrent
                        ? 'bg-amber-500/15 border-amber-500 text-white'
                        : done
                          ? 'bg-emerald-950/30 border-emerald-800/70 text-emerald-200'
                          : 'bg-[#0A0A0A] border-[#27272E] text-zinc-500'
                    }`}
                  >
                    <div
                      className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                        isCurrent
                          ? 'bg-amber-500 text-black'
                          : done
                            ? 'bg-emerald-500/20 text-emerald-300'
                            : 'bg-[#1C1C22] text-zinc-500'
                      }`}
                    >
                      {step.icon}
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-extrabold uppercase tracking-wide">{step.label}</p>
                      <p className="text-[11px] opacity-85">{step.description}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {trackedOrder.deliveryType === 'domicilio' && trackedOrder.deliveryAddress && (
            <div className="rounded-xl border border-[#27272E] bg-[#0A0A0A] p-3 text-xs space-y-1">
              <p className="font-bold text-sky-300 flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 shrink-0" />
                <span>
                  {trackedOrder.deliveryAddress}
                  {trackedOrder.deliveryNeighborhood ? ` · ${trackedOrder.deliveryNeighborhood}` : ''}
                </span>
              </p>
              {trackedOrder.deliveryPhone && (
                <p className="text-zinc-300 font-mono">Tel: {trackedOrder.deliveryPhone}</p>
              )}
              {trackedOrder.deliveryNotes && (
                <p className="text-zinc-400">Ref: {trackedOrder.deliveryNotes}</p>
              )}
            </div>
          )}

          <div className="space-y-2 border-t border-[#27272E] pt-3">
            <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-wider">
              Resumen de tu pedido
            </h3>
            <ul className="divide-y divide-[#27272E]">
              {trackedOrder.items.map((item) => {
                const custom = formatCustomizationSummary(item);
                return (
                  <li key={item.lineId} className="py-2 flex items-start justify-between gap-2 text-xs">
                    <div>
                      <p className="font-bold text-white">
                        <span className="font-mono text-amber-400">{item.quantity}x</span>{' '}
                        {item.productName}
                      </p>
                      {custom && <p className="text-[11px] text-amber-300 mt-0.5">{custom}</p>}
                    </div>
                    <span className="font-mono font-bold text-zinc-200 tabular-nums shrink-0">
                      {formatCurrency(item.lineTotal)}
                    </span>
                  </li>
                );
              })}
            </ul>
            <div className="flex items-center justify-between pt-2 border-t border-[#27272E] text-sm font-extrabold">
              <span className="text-zinc-300">Total transferido</span>
              <span className="font-mono text-lg text-amber-400 tabular-nums">
                {formatCurrency(trackedOrder.total)}
              </span>
            </div>
          </div>

          {trackedOrder.latestReceiptUrl && (
            <div className="flex items-center gap-3 rounded-xl border border-[#27272E] bg-[#0A0A0A] p-3">
              <img
                src={trackedOrder.latestReceiptUrl}
                alt="Comprobante enviado"
                className="w-12 h-12 rounded-lg object-cover border border-[#27272E] shrink-0"
              />
              <div className="min-w-0">
                <p className="text-xs font-bold text-white">Comprobante de pago adjunto</p>
                <p className="text-[11px] text-zinc-400">
                  Recibido en caja para validación en tiempo real.
                </p>
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2.5 pt-2">
            <button
              type="button"
              onClick={() => setViewMode('menu')}
              className="flex-1 min-h-[44px] px-4 rounded-xl border border-[#27272E] bg-[#1C1C22] text-xs font-bold text-zinc-200 hover:border-amber-500"
            >
              Ver carta
            </button>
            <button
              type="button"
              onClick={handleStartAnotherOrder}
              className="flex-1 min-h-[44px] px-4 rounded-xl bg-amber-500 text-black text-xs font-extrabold hover:bg-amber-400"
            >
              Hacer otro pedido
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white flex flex-col">
      {/* Public Customer Header (No POS/Admin routes) */}
      <header className="sticky top-0 z-30 bg-[#101014]/95 backdrop-blur-md border-b border-[#27272E]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <img
              src={resolveAssetUrl('/onde-luigi-logo.png')}
              alt={businessTitle}
              className="w-9 h-9 rounded-full border border-red-600 object-cover shrink-0"
            />
            <div className="min-w-0">
              <p className="font-poster text-lg sm:text-xl font-extrabold tracking-wide text-white leading-none truncate">
                {businessTitle}
              </p>
              <p className="text-[10px] font-bold uppercase tracking-wider text-amber-400 mt-0.5">
                Autoservicio Digital
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {activeOrderId && (
              <button
                type="button"
                onClick={() => setViewMode((m) => (m === 'tracker' ? 'menu' : 'tracker'))}
                className={`min-h-[40px] px-3 rounded-xl border text-xs font-bold flex items-center gap-1.5 transition-colors ${
                  viewMode === 'tracker'
                    ? 'bg-amber-500 border-amber-400 text-black'
                    : 'bg-[#1C1C22] border-amber-500/60 text-amber-300 hover:bg-amber-500/15'
                }`}
              >
                <Clock className="w-3.5 h-3.5" />
                <span>
                  {viewMode === 'tracker'
                    ? 'Volver a carta'
                    : trackedOrder
                      ? `Pedido #${trackedOrder.orderNumber}`
                      : 'Mi pedido'}
                </span>
              </button>
            )}

            {viewMode === 'menu' && (
              <button
                type="button"
                onClick={() => setCartOpen(true)}
                className="lg:hidden min-h-[40px] px-3.5 rounded-xl bg-amber-500 text-black text-xs font-extrabold hover:bg-amber-400 flex items-center gap-2"
              >
                <ShoppingBag className="w-4 h-4" />
                <span className="font-mono tabular-nums">
                  {totalCartUnits} · {formatCurrency(total)}
                </span>
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-5 pb-28 lg:pb-10">
        {isPaused && (
          <div
            role="status"
            className="mb-4 rounded-2xl border border-amber-700 bg-amber-950/40 px-4 py-3 text-xs text-amber-200 flex items-center gap-2.5"
          >
            <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
            <span>
              El autoservicio está pausado temporalmente por el restaurante. Puedes consultar la carta pero no enviar pedidos ahora mismo.
            </span>
          </div>
        )}

        {catalogError && (
          <div
            role="alert"
            className="mb-4 rounded-2xl border border-red-700 bg-red-950/50 px-4 py-3 text-xs text-red-200"
          >
            {catalogError}
          </div>
        )}

        {viewMode === 'tracker' ? (
          renderTracker()
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Catalog Column */}
            <div className="lg:col-span-7 xl:col-span-8 space-y-4">
              <div className="bg-[#141418] border border-[#27272E] rounded-2xl p-3 space-y-3">
                <div className="relative">
                  <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="search"
                    aria-label="Buscar en la carta"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Buscar perros, salchipapas, hamburguesas, bebidas..."
                    className="w-full min-h-[42px] pl-9 pr-3 rounded-xl border border-[#27272E] bg-[#0A0A0A] text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>

                <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
                  {categories.map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setSelectedCategory(cat)}
                      className={`min-h-[36px] px-3.5 rounded-lg text-xs font-bold border whitespace-nowrap shrink-0 transition-colors ${
                        selectedCategory === cat
                          ? 'bg-red-600 border-red-500 text-white'
                          : 'bg-[#1C1C22] border-[#27272E] text-zinc-300 hover:border-zinc-500'
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </div>

              {cloudLoading && !hasCloudProducts && catalogProducts.length === 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  {[1, 2, 3, 4].map((n) => (
                    <div key={n} className="h-36 rounded-2xl bg-[#141418] border border-[#27272E] animate-pulse" />
                  ))}
                </div>
              ) : filteredProducts.length === 0 ? (
                <div className="bg-[#141418] border border-[#27272E] rounded-2xl p-10 text-center space-y-2">
                  <p className="text-base font-bold text-white">No encontramos productos con ese filtro</p>
                  <p className="text-xs text-zinc-400">Prueba seleccionando otra categoría o limpiando el buscador.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  {filteredProducts.map((product) => (
                    <article
                      key={product.id}
                      className="bg-[#141418] border border-[#27272E] hover:border-amber-500/60 rounded-2xl p-3.5 flex gap-3.5 transition-colors"
                    >
                      {product.imageUrl && (
                        <img
                          src={resolveAssetUrl(product.imageUrl)}
                          alt={product.name}
                          className="w-24 h-24 rounded-xl object-cover object-top border border-[#27272E] shrink-0"
                        />
                      )}
                      <div className="flex-1 min-w-0 flex flex-col justify-between gap-2">
                        <div>
                          <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400">
                            {product.category}
                          </span>
                          <h2 className="font-poster text-lg font-extrabold text-white leading-tight mt-0.5 truncate">
                            {product.name}
                          </h2>
                          {product.baseRecipe.length > 0 && (
                            <p className="text-[11px] text-zinc-400 mt-1 line-clamp-2 leading-snug">
                              {product.baseRecipe.join(' · ')}
                            </p>
                          )}
                        </div>

                        <div className="flex items-center justify-between gap-2 pt-1">
                          <span className="font-mono text-base font-extrabold text-amber-400 tabular-nums">
                            {formatCurrency(product.basePrice)}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingCartLine(null);
                              setCustomizingProduct(product);
                            }}
                            className="min-h-[36px] px-3 rounded-xl bg-amber-500 text-black text-xs font-extrabold hover:bg-amber-400 inline-flex items-center gap-1 shrink-0"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            <span>Pedir</span>
                          </button>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>

            {/* Desktop Sticky Checkout Panel */}
            <aside className="hidden lg:block lg:col-span-5 xl:col-span-4 sticky top-20 bg-[#141418] border border-[#27272E] rounded-2xl p-4 max-h-[calc(100vh-6rem)] overflow-y-auto">
              <div className="flex items-center justify-between pb-3 mb-3 border-b border-[#27272E]">
                <h2 className="font-poster text-xl font-extrabold text-white tracking-wide uppercase">
                  TU PEDIDO EN LÍNEA
                </h2>
                <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30">
                  {totalCartUnits} uds
                </span>
              </div>
              {renderCheckoutForm()}
            </aside>
          </div>
        )}
      </main>

      {/* Mobile Sticky Cart Bar */}
      {viewMode === 'menu' && totalCartUnits > 0 && !cartOpen && (
        <div className="lg:hidden fixed bottom-0 left-0 right-0 z-30 p-3 bg-[#101014]/95 backdrop-blur-md border-t border-[#27272E]">
          <button
            type="button"
            onClick={() => setCartOpen(true)}
            className="w-full min-h-[48px] px-4 rounded-xl bg-amber-500 text-black text-sm font-extrabold hover:bg-amber-400 flex items-center justify-between shadow-xl"
          >
            <span className="flex items-center gap-2">
              <ShoppingBag className="w-4 h-4" />
              <span>Ver carrito y pagar ({totalCartUnits})</span>
            </span>
            <span className="font-mono text-base tabular-nums">{formatCurrency(total)}</span>
          </button>
        </div>
      )}

      {/* Mobile Cart & Checkout Drawer */}
      {cartOpen && (
        <div
          className="lg:hidden fixed inset-0 z-50 flex items-end justify-center bg-black/80 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="self-mobile-cart-title"
        >
          <div className="w-full bg-[#141418] text-white rounded-t-3xl border-t border-[#27272E] shadow-2xl max-h-[92vh] flex flex-col overflow-hidden">
            <div className="px-5 py-3.5 border-b border-[#27272E] bg-[#101014] flex items-center justify-between">
              <h2
                id="self-mobile-cart-title"
                className="font-poster text-xl font-extrabold text-white uppercase tracking-wide"
              >
                FINALIZAR PEDIDO
              </h2>
              <button
                type="button"
                onClick={() => setCartOpen(false)}
                aria-label="Cerrar carrito"
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-zinc-400 hover:bg-[#1C1C22] hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 overflow-y-auto">{renderCheckoutForm()}</div>
          </div>
        </div>
      )}

      {/* Customization Modal */}
      {customizingProduct && (
        <SelfServiceCustomizeModal
          product={customizingProduct}
          sauces={catalogSauces}
          initialItem={editingCartLine}
          onClose={() => {
            setCustomizingProduct(null);
            setEditingCartLine(null);
          }}
          onConfirm={handleConfirmCustomizedItem}
        />
      )}
    </div>
  );
};
