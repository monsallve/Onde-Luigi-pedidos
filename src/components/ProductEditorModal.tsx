import React, { useState } from 'react';
import { Droplets, Plus, Trash2, X } from 'lucide-react';
import { usePosStore } from '../services/posStore';
import type { AddonOption, Product } from '../types/pos';
import { createSafeId, formatCurrency } from '../utils/orderMath';

interface Props {
  product?: Product | null;
  onClose: () => void;
}

const DEFAULT_CATEGORIES = ['Hamburguesas', 'Perros y Papas', 'Bebidas', 'Combos', 'Adicionales'];

export const ProductEditorModal: React.FC<Props> = ({ product, onClose }) => {
  const { saveProduct } = usePosStore();

  const [name, setName] = useState(product ? product.name : '');
  const [category, setCategory] = useState(product ? product.category : 'Hamburguesas');
  const [basePrice, setBasePrice] = useState(product ? String(product.basePrice) : '');
  const [imageUrl, setImageUrl] = useState(product ? product.imageUrl : '');
  const [active, setActive] = useState(product ? product.active : true);

  const [allowSauces, setAllowSauces] = useState(
    product ? product.allowSauces : true
  );
  const [minSauces, setMinSauces] = useState(
    product ? product.minSauces : 1
  );
  const [maxSauces, setMaxSauces] = useState(
    product ? product.maxSauces : 4
  );

  const [baseRecipe, setBaseRecipe] = useState<string[]>(product ? [...product.baseRecipe] : []);
  const [recipeInput, setRecipeInput] = useState('');

  const [removableOptions, setRemovableOptions] = useState<string[]>(
    product ? [...product.removableOptions] : []
  );
  const [removableInput, setRemovableInput] = useState('');

  const [addonOptions, setAddonOptions] = useState<AddonOption[]>(
    product ? [...product.addonOptions] : []
  );
  const [addonName, setAddonName] = useState('');
  const [addonPrice, setAddonPrice] = useState('');

  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const addBaseIngredient = () => {
    const val = recipeInput.trim();
    if (!val || baseRecipe.includes(val)) return;
    setBaseRecipe((prev) => [...prev, val]);
    setRecipeInput('');
  };

  const addRemovable = (valOverride?: string) => {
    const val = (valOverride ?? removableInput).trim();
    if (!val || removableOptions.includes(val)) return;
    setRemovableOptions((prev) => [...prev, val]);
    if (!valOverride) setRemovableInput('');
  };

  const addAddon = () => {
    const cleanName = addonName.trim();
    const priceNum = Number(addonPrice || 0);
    if (!cleanName || Number.isNaN(priceNum) || priceNum < 0) return;
    setAddonOptions((prev) => [
      ...prev,
      { id: createSafeId('ext'), name: cleanName, price: Math.round(priceNum) },
    ]);
    setAddonName('');
    setAddonPrice('');
  };

  const handleCategoryChange = (val: string) => {
    setCategory(val);
    if (val.toLowerCase().includes('bebida') && !product) {
      setAllowSauces(false);
      setMinSauces(0);
      setMaxSauces(0);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const numPrice = Number(basePrice);
    if (!name.trim()) {
      setErrorMsg('El nombre del producto es obligatorio.');
      return;
    }
    if (Number.isNaN(numPrice) || numPrice < 0) {
      setErrorMsg('Ingresa un precio base válido.');
      return;
    }

    setSaving(true);
    setErrorMsg(null);
    try {
      await saveProduct({
        id: product?.id,
        name,
        category,
        basePrice: numPrice,
        imageUrl,
        baseRecipe,
        removableOptions,
        addonOptions,
        allowSauces,
        minSauces: allowSauces ? minSauces : 0,
        maxSauces: allowSauces ? Math.max(minSauces, maxSauces) : 0,
        active,
      });
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Error al guardar el producto.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-sm sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="product-editor-title"
    >
      <form
        onSubmit={handleSubmit}
        className="w-full sm:max-w-2xl bg-[#141418] text-white rounded-t-3xl sm:rounded-2xl border border-[#27272E] shadow-2xl overflow-hidden max-h-[92vh] flex flex-col"
      >
        <div className="px-5 py-4 border-b border-[#27272E] flex items-center justify-between bg-[#101014]">
          <h2 id="product-editor-title" className="font-poster text-xl font-extrabold text-white tracking-wide">
            {product ? `EDITAR: ${product.name.toUpperCase()}` : 'NUEVO PRODUCTO / BEBIDA'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar editor de producto"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-zinc-400 hover:bg-[#1C1C22] hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-5">
          {errorMsg && (
            <div className="rounded-xl bg-red-950/60 border border-red-700 px-3.5 py-2.5 text-xs font-medium text-red-200">
              {errorMsg}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
            <div className="sm:col-span-6">
              <label htmlFor="prod-name" className="block text-xs font-semibold text-zinc-300 mb-1">
                Nombre del producto o bebida
              </label>
              <input
                id="prod-name"
                type="text"
                maxLength={100}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ej. Hamburguesa Mixta o Limonada"
                className="w-full min-h-[44px] rounded-xl border border-[#27272E] bg-[#0A0A0A] px-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>

            <div className="sm:col-span-3">
              <label htmlFor="prod-category" className="block text-xs font-semibold text-zinc-300 mb-1">
                Categoría
              </label>
              <input
                id="prod-category"
                list="prod-category-list"
                type="text"
                maxLength={60}
                value={category}
                onChange={(e) => handleCategoryChange(e.target.value)}
                className="w-full min-h-[44px] rounded-xl border border-[#27272E] bg-[#0A0A0A] px-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
              <datalist id="prod-category-list">
                {DEFAULT_CATEGORIES.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>

            <div className="sm:col-span-3">
              <label htmlFor="prod-price" className="block text-xs font-semibold text-zinc-300 mb-1">
                Precio base ($)
              </label>
              <input
                id="prod-price"
                type="number"
                min={0}
                step={100}
                value={basePrice}
                onChange={(e) => setBasePrice(e.target.value)}
                placeholder="26000"
                className="w-full min-h-[44px] rounded-xl border border-[#27272E] bg-[#0A0A0A] px-3 font-mono text-sm text-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>
          </div>

          {/* Sauces config (1-4 sauces or disabled for drinks) */}
          <section className="rounded-xl border border-[#27272E] bg-[#101014] p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Droplets className="w-4 h-4 text-amber-400 shrink-0" />
                <div>
                  <p className="text-xs font-bold text-white">Selección de salsas al tomar pedido</p>
                  <p className="text-[11px] text-zinc-400">
                    Actívalo para hamburguesas/perros/papas; desactívalo en bebidas.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  const next = !allowSauces;
                  setAllowSauces(next);
                  if (next && maxSauces === 0) {
                    setMinSauces(1);
                    setMaxSauces(4);
                  }
                }}
                className={`min-h-[38px] px-3.5 rounded-xl border text-xs font-bold whitespace-nowrap ${
                  allowSauces
                    ? 'bg-amber-500 border-amber-400 text-black'
                    : 'bg-[#1C1C22] border-[#27272E] text-zinc-300'
                }`}
              >
                {allowSauces ? 'Con salsas' : 'Sin salsas'}
              </button>
            </div>

            {allowSauces && (
              <div className="grid grid-cols-2 gap-3 pt-2 border-t border-[#27272E]">
                <div>
                  <label htmlFor="prod-min-sauces" className="block text-[11px] font-medium text-zinc-400 mb-1">
                    Mínimo de salsas
                  </label>
                  <select
                    id="prod-min-sauces"
                    value={minSauces}
                    onChange={(e) => setMinSauces(Number(e.target.value))}
                    className="w-full min-h-[40px] rounded-xl border border-[#27272E] bg-[#0A0A0A] px-3 text-sm text-white"
                  >
                    <option value={0}>0 (Opcional)</option>
                    <option value={1}>1 salsa</option>
                    <option value={2}>2 salsas</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="prod-max-sauces" className="block text-[11px] font-medium text-zinc-400 mb-1">
                    Máximo de salsas
                  </label>
                  <select
                    id="prod-max-sauces"
                    value={maxSauces}
                    onChange={(e) => setMaxSauces(Number(e.target.value))}
                    className="w-full min-h-[40px] rounded-xl border border-[#27272E] bg-[#0A0A0A] px-3 text-sm text-white"
                  >
                    <option value={1}>1 salsa</option>
                    <option value={2}>2 salsas</option>
                    <option value={3}>3 salsas</option>
                    <option value={4}>4 salsas</option>
                  </select>
                </div>
              </div>
            )}
          </section>

          {/* Base Recipe Ingredients */}
          <section className="space-y-2 border-t border-[#27272E] pt-4">
            <label htmlFor="recipe-ing-input" className="block text-xs font-semibold text-zinc-300">
              Receta / Ingredientes base
            </label>
            <div className="flex gap-2">
              <input
                id="recipe-ing-input"
                type="text"
                value={recipeInput}
                onChange={(e) => setRecipeInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addBaseIngredient();
                  }
                }}
                placeholder="Ej. Carne de res, Queso, Papitas ripio..."
                className="flex-1 min-h-[42px] rounded-xl border border-[#27272E] bg-[#0A0A0A] px-3 text-sm text-white placeholder:text-zinc-500"
              />
              <button
                type="button"
                onClick={addBaseIngredient}
                className="min-h-[42px] px-4 rounded-xl bg-amber-500 text-black text-xs font-bold hover:bg-amber-400 whitespace-nowrap shrink-0"
              >
                Añadir
              </button>
            </div>
            {baseRecipe.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {baseRecipe.map((ing) => (
                  <div
                    key={ing}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#1C1C22] border border-[#27272E] text-xs font-medium text-zinc-200"
                  >
                    <span>{ing}</span>
                    {!removableOptions.includes(ing) && (
                      <button
                        type="button"
                        onClick={() => addRemovable(ing)}
                        title="Permitir quitar este ingrediente al tomar pedidos"
                        className="text-[10px] text-amber-400 hover:underline font-bold"
                      >
                        +Quitable
                      </button>
                    )}
                    <button
                      type="button"
                      aria-label={`Quitar ingrediente ${ing} de receta`}
                      onClick={() => setBaseRecipe((p) => p.filter((x) => x !== ing))}
                      className="text-zinc-400 hover:text-red-400"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Removable options */}
          <section className="space-y-2 border-t border-[#27272E] pt-4">
            <label htmlFor="removable-ing-input" className="block text-xs font-semibold text-zinc-300">
              Ingredientes que el cliente puede QUITAR (Ej. Sin cebolla, Sin tomate)
            </label>
            <div className="flex gap-2">
              <input
                id="removable-ing-input"
                type="text"
                value={removableInput}
                onChange={(e) => setRemovableInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addRemovable();
                  }
                }}
                placeholder="Ej. Cebolla, Papitas ripio..."
                className="flex-1 min-h-[42px] rounded-xl border border-[#27272E] bg-[#0A0A0A] px-3 text-sm text-white placeholder:text-zinc-500"
              />
              <button
                type="button"
                onClick={() => addRemovable()}
                className="min-h-[42px] px-4 rounded-xl border border-[#27272E] bg-[#1C1C22] text-white text-xs font-semibold hover:border-zinc-500 whitespace-nowrap shrink-0"
              >
                Agregar opción
              </button>
            </div>
            {removableOptions.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {removableOptions.map((ing) => (
                  <div
                    key={ing}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-red-950/50 border border-red-700 text-xs font-medium text-red-200"
                  >
                    <span>Sin {ing}</span>
                    <button
                      type="button"
                      aria-label={`Eliminar opción Sin ${ing}`}
                      onClick={() => setRemovableOptions((p) => p.filter((x) => x !== ing))}
                      className="text-red-400 hover:text-red-200"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Add-on extras */}
          <section className="space-y-2 border-t border-[#27272E] pt-4">
            <p className="text-xs font-semibold text-zinc-300">
              Adiciones o extras que se pueden PONER (con precio adicional)
            </p>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                aria-label="Nombre del extra"
                value={addonName}
                onChange={(e) => setAddonName(e.target.value)}
                placeholder="Ej. Extra queso o Adición tocineta"
                className="flex-1 min-h-[42px] rounded-xl border border-[#27272E] bg-[#0A0A0A] px-3 text-sm text-white placeholder:text-zinc-500"
              />
              <input
                type="number"
                min={0}
                step={100}
                aria-label="Precio del extra"
                value={addonPrice}
                onChange={(e) => setAddonPrice(e.target.value)}
                placeholder="Precio ($)"
                className="sm:w-32 min-h-[42px] rounded-xl border border-[#27272E] bg-[#0A0A0A] px-3 font-mono text-sm text-amber-400 placeholder:text-zinc-500"
              />
              <button
                type="button"
                onClick={addAddon}
                className="min-h-[42px] px-4 rounded-xl border border-[#27272E] bg-[#1C1C22] text-white text-xs font-semibold hover:border-zinc-500 flex items-center justify-center gap-1 whitespace-nowrap shrink-0"
              >
                <Plus className="w-4 h-4 text-amber-400" />
                <span>Extra</span>
              </button>
            </div>

            {addonOptions.length > 0 && (
              <div className="divide-y divide-[#27272E] border border-[#27272E] rounded-xl overflow-hidden mt-2 bg-[#0A0A0A]">
                {addonOptions.map((ex) => (
                  <div
                    key={ex.id}
                    className="flex items-center justify-between px-3.5 py-2.5 text-sm"
                  >
                    <span className="font-medium text-zinc-200">{ex.name}</span>
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-xs font-semibold text-amber-400 tabular-nums">
                        +{formatCurrency(ex.price)}
                      </span>
                      <button
                        type="button"
                        aria-label={`Quitar extra ${ex.name}`}
                        onClick={() => setAddonOptions((p) => p.filter((x) => x.id !== ex.id))}
                        className="min-h-[34px] min-w-[34px] flex items-center justify-center text-red-400 hover:bg-red-950/60 rounded-lg"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 border-t border-[#27272E] pt-4">
            <div>
              <label htmlFor="prod-img" className="block text-xs font-semibold text-zinc-300 mb-1">
                Ruta de imagen (opcional)
              </label>
              <input
                id="prod-img"
                type="text"
                maxLength={500}
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                placeholder="/menu/mixta.jpg"
                className="w-full min-h-[42px] rounded-xl border border-[#27272E] bg-[#0A0A0A] px-3 font-mono text-xs text-zinc-200 placeholder:text-zinc-500"
              />
            </div>

            <div className="flex items-end justify-between gap-2">
              <span className="text-xs font-medium text-zinc-300 pb-2.5">
                Visible en pedidos
              </span>
              <button
                type="button"
                onClick={() => setActive((a) => !a)}
                className={`min-h-[42px] px-4 rounded-xl text-xs font-semibold border transition-colors ${
                  active
                    ? 'bg-emerald-950/60 border-emerald-700 text-emerald-300'
                    : 'bg-[#1C1C22] border-[#27272E] text-zinc-400'
                }`}
              >
                {active ? 'Activo en menú' : 'Desactivado'}
              </button>
            </div>
          </div>
        </div>

        <div className="px-5 py-4 border-t border-[#27272E] bg-[#101014] flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] px-4 rounded-xl border border-[#27272E] bg-[#1C1C22] text-sm font-medium text-zinc-300 hover:text-white"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={saving}
            className="min-h-[44px] px-6 rounded-xl bg-amber-500 text-black text-sm font-bold hover:bg-amber-400 disabled:opacity-60 transition-colors"
          >
            {saving ? 'Guardando...' : product ? 'Guardar cambios' : 'Crear producto'}
          </button>
        </div>
      </form>
    </div>
  );
};
