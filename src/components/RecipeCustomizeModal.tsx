import React, { useMemo, useState } from 'react';
import { Check, Droplets, Minus, Plus, X } from 'lucide-react';
import { usePosStore } from '../services/posStore';
import type { AddonOption, OrderItem, OrderItemAddon, Product } from '../types/pos';
import { assertSafeTextInput } from '../utils/inputSecurity';
import {
  buildOrderItem,
  calculateItemLineTotal,
  formatCurrency,
  formatWithoutIngredientLabel,
  getAddonQuantity,
  resolveAssetUrl,
  validateItemSauces,
} from '../utils/orderMath';

interface Props {
  product: Product;
  initialItem?: OrderItem | null;
  onClose: () => void;
  onConfirm: (item: OrderItem) => void;
}

export const RecipeCustomizeModal: React.FC<Props> = ({
  product,
  initialItem,
  onClose,
  onConfirm,
}) => {
  const { sauces } = usePosStore();
  const activeSauces = useMemo(() => sauces.filter((s) => s.active), [sauces]);

  const [removedIngredients, setRemovedIngredients] = useState<string[]>(
    initialItem ? [...initialItem.removedIngredients] : []
  );
  const [selectedSauces, setSelectedSauces] = useState<string[]>(
    initialItem ? [...(initialItem.selectedSauces || [])] : []
  );
  const [addedExtras, setAddedExtras] = useState<OrderItemAddon[]>(
    initialItem
      ? initialItem.addedExtras.map((ex) => ({ ...ex, quantity: getAddonQuantity(ex) }))
      : []
  );
  const [customNote, setCustomNote] = useState<string>(
    initialItem ? initialItem.customNote : ''
  );
  const [quantity, setQuantity] = useState<number>(
    initialItem ? initialItem.quantity : 1
  );
  const [sauceError, setSauceError] = useState<string | null>(null);

  const minSauces = product.allowSauces ? product.minSauces ?? 1 : 0;
  const maxSauces = product.allowSauces ? product.maxSauces ?? 4 : 0;

  const toggleRemovable = (ing: string) => {
    setRemovedIngredients((prev) =>
      prev.includes(ing) ? prev.filter((item) => item !== ing) : [...prev, ing]
    );
  };

  const toggleSauce = (sauceName: string) => {
    setSauceError(null);
    setSelectedSauces((prev) => {
      if (prev.includes(sauceName)) {
        return prev.filter((s) => s !== sauceName);
      }
      if (maxSauces > 0 && prev.length >= maxSauces) {
        setSauceError(`Máximo ${maxSauces} salsas por unidad. Desmarca una para cambiar.`);
        return prev;
      }
      return [...prev, sauceName];
    });
  };

  const setExtraQuantity = (extra: AddonOption, nextQty: number) => {
    const allowMulti = extra.allowMultiple !== false;
    const clamped = allowMulti ? Math.max(0, Math.min(20, nextQty)) : Math.max(0, Math.min(1, nextQty));
    setAddedExtras((prev) => {
      if (clamped <= 0) {
        return prev.filter((e) => e.id !== extra.id);
      }
      const exists = prev.some((e) => e.id === extra.id);
      if (exists) {
        return prev.map((e) =>
          e.id === extra.id ? { ...e, quantity: clamped } : e
        );
      }
      return [...prev, { id: extra.id, name: extra.name, price: extra.price, quantity: clamped }];
    });
  };

  const lineTotal = calculateItemLineTotal(product.basePrice, addedExtras, quantity);

  const handleSave = () => {
    const check = validateItemSauces(
      { productName: product.name, selectedSauces },
      product
    );
    if (!check.valid) {
      setSauceError(check.message || `Elige entre ${minSauces} y ${maxSauces} salsas.`);
      return;
    }

    let safeCustomNote = '';
    try {
      safeCustomNote = assertSafeTextInput(customNote, 'Nota para cocina', { maxLen: 200 });
    } catch (err) {
      setSauceError(
        err instanceof Error ? err.message : 'La nota contiene caracteres no permitidos.'
      );
      return;
    }

    const built = buildOrderItem({
      lineId: initialItem?.lineId,
      productId: product.id,
      productName: product.name,
      category: product.category,
      quantity,
      basePrice: product.basePrice,
      removedIngredients,
      addedExtras,
      selectedSauces: product.allowSauces ? selectedSauces : [],
      customNote: safeCustomNote,
    });
    onConfirm(built);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-sm sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="recipe-modal-title"
    >
      <div className="w-full sm:max-w-lg bg-[#141418] text-white rounded-t-3xl sm:rounded-2xl border border-[#27272E] shadow-2xl overflow-hidden max-h-[92vh] flex flex-col">
        <div className="px-5 pt-4 pb-3 border-b border-[#27272E] flex items-start justify-between gap-3 bg-[#101014]">
          <div className="flex items-center gap-3 min-w-0">
            {product.imageUrl && (
              <img
                src={resolveAssetUrl(product.imageUrl)}
                alt={product.name}
                className="w-14 h-14 rounded-xl object-cover object-top border border-[#27272E] shrink-0"
              />
            )}
            <div className="min-w-0">
              <p className="text-[11px] font-semibold text-amber-400 uppercase tracking-wider">
                {product.category}
              </p>
              <h2
                id="recipe-modal-title"
                className="font-poster text-xl font-extrabold text-white tracking-wide leading-tight"
              >
                {product.name}
              </h2>
              {product.baseRecipe.length > 0 && (
                <p className="text-xs text-zinc-400 mt-0.5 line-clamp-2">
                  Lleva: {product.baseRecipe.join(' · ')}
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar personalización de receta"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-zinc-400 hover:bg-[#1C1C22] hover:text-white shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-5">
          {/* 1. Sauce Selector (1 to 4 sauces) */}
          {product.allowSauces && (
            <section className="space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-xs font-bold text-white flex items-center gap-1.5 uppercase tracking-wide">
                  <Droplets className="w-4 h-4 text-amber-400" />
                  <span>Elige tus salsas ({minSauces} a {maxSauces})</span>
                </h3>
                <span
                  className={`font-mono text-xs font-bold tabular-nums px-2 py-0.5 rounded border ${
                    selectedSauces.length >= minSauces && selectedSauces.length <= maxSauces
                      ? 'bg-emerald-950/60 border-emerald-700 text-emerald-300'
                      : 'bg-amber-950/60 border-amber-700 text-amber-300'
                  }`}
                >
                  {selectedSauces.length} / {maxSauces}
                </span>
              </div>

              {sauceError && (
                <div
                  role="alert"
                  className="rounded-xl bg-red-950/60 border border-red-700 px-3 py-2 text-xs font-medium text-red-200"
                >
                  {sauceError}
                </div>
              )}

              {activeSauces.length === 0 ? (
                <p className="text-xs text-zinc-400">
                  No hay salsas activas en el sistema. El Administrador debe agregarlas en Menú.
                </p>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {activeSauces.map((sauce) => {
                    const isSelected = selectedSauces.includes(sauce.name);
                    return (
                      <button
                        key={sauce.id}
                        type="button"
                        onClick={() => toggleSauce(sauce.name)}
                        className={`min-h-[44px] px-3 py-2 rounded-xl border text-left text-xs font-semibold flex items-center justify-between gap-2 transition-colors ${
                          isSelected
                            ? 'bg-amber-500 border-amber-400 text-black font-bold'
                            : 'bg-[#1C1C22] border-[#27272E] text-zinc-200 hover:border-zinc-500'
                        }`}
                      >
                        <span className="truncate">{sauce.name}</span>
                        {isSelected && <Check className="w-4 h-4 text-black shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          {/* 2. Removable ingredients ("Lo que NO desea agregar") */}
          {product.removableOptions.length > 0 && (
            <section className="space-y-2 border-t border-[#27272E] pt-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-white uppercase tracking-wide">
                  ¿Qué NO lleva? (Quitar de la receta)
                </h3>
                {removedIngredients.length > 0 && (
                  <span className="font-mono text-xs font-semibold text-red-400 tabular-nums">
                    {removedIngredients.length} quitados
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {product.removableOptions.map((ing) => {
                  const isRemoved = removedIngredients.includes(ing);
                  return (
                    <button
                      key={ing}
                      type="button"
                      onClick={() => toggleRemovable(ing)}
                      className={`min-h-[44px] px-3 py-2 rounded-xl border text-left text-xs font-semibold flex items-center justify-between gap-2 transition-colors ${
                        isRemoved
                          ? 'bg-red-600/20 border-red-500 text-red-200'
                          : 'bg-[#1C1C22] border-[#27272E] text-zinc-200 hover:border-zinc-500'
                      }`}
                    >
                      <span className="truncate">{formatWithoutIngredientLabel(ing)}</span>
                      {isRemoved && <Check className="w-4 h-4 text-red-400 shrink-0" />}
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {/* 3. Add-on extras with counter for repeatable extras and single toggle for 1-time-only */}
          {product.addonOptions.length > 0 && (
            <section className="space-y-2 border-t border-[#27272E] pt-4">
              <h3 className="text-xs font-bold text-white uppercase tracking-wide">
                Adiciones extras (opcional)
              </h3>
              <div className="space-y-2">
                {product.addonOptions.map((extra) => {
                  const existing = addedExtras.find((e) => e.id === extra.id);
                  const qty = existing ? getAddonQuantity(existing) : 0;
                  const allowMulti = extra.allowMultiple !== false;

                  if (!allowMulti) {
                    const isSelected = qty > 0;
                    return (
                      <button
                        key={extra.id}
                        type="button"
                        onClick={() => setExtraQuantity(extra, isSelected ? 0 : 1)}
                        className={`w-full min-h-[46px] px-3.5 py-2 rounded-xl border flex items-center justify-between gap-3 transition-colors ${
                          isSelected
                            ? 'bg-emerald-950/50 border-emerald-500 text-white'
                            : 'bg-[#1C1C22] border-[#27272E] text-zinc-200 hover:border-zinc-500'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span
                            className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 ${
                              isSelected
                                ? 'bg-emerald-500 border-emerald-400 text-black'
                                : 'border-zinc-600 bg-[#0A0A0A]'
                            }`}
                          >
                            {isSelected && <Check className="w-3.5 h-3.5" />}
                          </span>
                          <div className="min-w-0 text-left">
                            <span className="text-sm font-medium truncate block">{extra.name}</span>
                            <span className="text-[10px] text-zinc-400">Máximo 1 por unidad</span>
                          </div>
                        </div>
                        <span className="font-mono text-xs font-bold text-amber-400 tabular-nums shrink-0">
                          {extra.price > 0 ? `+${formatCurrency(extra.price)}` : 'Gratis'}
                        </span>
                      </button>
                    );
                  }

                  return (
                    <div
                      key={extra.id}
                      className={`w-full min-h-[48px] px-3.5 py-2 rounded-xl border flex items-center justify-between gap-3 transition-colors ${
                        qty > 0
                          ? 'bg-emerald-950/50 border-emerald-500 text-white'
                          : 'bg-[#1C1C22] border-[#27272E] text-zinc-200'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{extra.name}</p>
                        <p className="font-mono text-xs font-bold text-amber-400 tabular-nums">
                          {extra.price > 0 ? `+${formatCurrency(extra.price)} c/u` : 'Gratis'}
                          {qty > 1 && extra.price > 0
                            ? ` (${formatCurrency(extra.price * qty)})`
                            : ''}
                        </p>
                      </div>
                      <div className="flex items-center border border-[#27272E] bg-[#0A0A0A] rounded-xl overflow-hidden shrink-0">
                        <button
                          type="button"
                          aria-label={`Quitar una adición de ${extra.name}`}
                          onClick={() => setExtraQuantity(extra, qty - 1)}
                          disabled={qty === 0}
                          className="min-h-[38px] min-w-[38px] flex items-center justify-center text-zinc-300 hover:bg-[#1C1C22] disabled:opacity-35"
                        >
                          <Minus className="w-3.5 h-3.5" />
                        </button>
                        <span className="w-8 text-center font-mono text-xs font-bold text-white tabular-nums">
                          {qty}
                        </span>
                        <button
                          type="button"
                          aria-label={`Agregar una adición de ${extra.name}`}
                          onClick={() => setExtraQuantity(extra, qty + 1)}
                          className="min-h-[38px] min-w-[38px] flex items-center justify-center text-amber-400 hover:bg-[#1C1C22]"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* 4. Custom free-text note */}
          <section className="border-t border-[#27272E] pt-4">
            <label
              htmlFor="custom-recipe-note"
              className="block text-xs font-bold text-zinc-300 mb-1.5"
            >
              Nota para cocina / plancha (opcional)
            </label>
            <input
              id="custom-recipe-note"
              type="text"
              maxLength={160}
              value={customNote}
              onChange={(e) => setCustomNote(e.target.value)}
              placeholder="Ej. Carne bien asada, salsas aparte..."
              className="w-full min-h-[44px] rounded-xl border border-[#27272E] bg-[#0A0A0A] px-3 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </section>
        </div>

        {/* Sticky Error & Footer with Quantity + Confirm */}
        {sauceError && (
          <div
            role="alert"
            className="mx-5 mt-3 rounded-xl bg-red-950/80 border border-red-600 px-3.5 py-2 text-xs font-semibold text-red-100"
          >
            {sauceError}
          </div>
        )}
        <div className="px-5 py-4 border-t border-[#27272E] bg-[#101014] flex items-center gap-3">
          <div className="flex items-center border border-[#27272E] bg-[#1C1C22] rounded-xl overflow-hidden">
            <button
              type="button"
              aria-label="Disminuir cantidad"
              onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              className="min-h-[44px] min-w-[44px] flex items-center justify-center text-zinc-300 hover:bg-[#27272E]"
            >
              <Minus className="w-4 h-4" />
            </button>
            <span className="w-9 text-center font-mono text-sm font-bold text-white tabular-nums">
              {quantity}
            </span>
            <button
              type="button"
              aria-label="Aumentar cantidad"
              onClick={() => setQuantity((q) => Math.min(50, q + 1))}
              className="min-h-[44px] min-w-[44px] flex items-center justify-center text-zinc-300 hover:bg-[#27272E]"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>

          <button
            type="button"
            onClick={handleSave}
            className="flex-1 min-h-[46px] rounded-xl bg-amber-500 text-black text-sm font-bold hover:bg-amber-400 transition-colors flex items-center justify-center gap-2 px-4 shadow-sm"
          >
            <span>{initialItem ? 'Guardar receta' : 'Agregar al pedido'}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">{formatCurrency(lineTotal)}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
