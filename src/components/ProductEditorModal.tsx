import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, Droplets, Image as ImageIcon, Plus, Trash2, Upload, X } from 'lucide-react';
import { usePosStore } from '../services/posStore';
import type { AddonOption, Product } from '../types/pos';
import {
  collectMenuCategories,
  createSafeId,
  formatCurrency,
  formatWithoutIngredientLabel,
  hasDuplicateProductName,
  mergeProductIngredientsForEditor,
  normalizeProductNameKey,
  PRODUCT_IMAGE_MAX_URL_LENGTH,
  type RecipeIngredientDraft,
  resolveAssetUrl,
  splitProductIngredientsFromEditor,
  suggestCopyProductName,
  validateImageFileCandidate,
} from '../utils/orderMath';

interface Props {
  product?: Product | null;
  copySource?: Product | null;
  onClose: () => void;
}

export const ProductEditorModal: React.FC<Props> = ({ product, copySource, onClose }) => {
  const { products, saveProduct } = usePosStore();

  const existingCategories = useMemo(() => collectMenuCategories(products), [products]);
  const initialTemplate = product || copySource || null;
  const isEditingExisting = Boolean(product?.id);

  const [name, setName] = useState(() => {
    if (product) return product.name;
    if (copySource) return suggestCopyProductName(copySource.name, products);
    return '';
  });
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(copySource?.id || '');
  const [category, setCategory] = useState(() => {
    const initialCat = initialTemplate?.category?.trim();
    if (initialCat) return initialCat;
    return existingCategories[0] || 'Hamburguesas';
  });
  const [customCategoryMode, setCustomCategoryMode] = useState(false);

  const [basePrice, setBasePrice] = useState(
    initialTemplate ? String(initialTemplate.basePrice) : ''
  );
  const [imageUrl, setImageUrl] = useState(initialTemplate ? initialTemplate.imageUrl : '');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState('');
  const [active, setActive] = useState(initialTemplate ? initialTemplate.active : true);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const [allowSauces, setAllowSauces] = useState(
    initialTemplate ? initialTemplate.allowSauces : true
  );
  const [minSauces, setMinSauces] = useState(
    initialTemplate ? initialTemplate.minSauces : 1
  );
  const [maxSauces, setMaxSauces] = useState(
    initialTemplate ? initialTemplate.maxSauces : 4
  );

  const [ingredients, setIngredients] = useState<RecipeIngredientDraft[]>(() =>
    initialTemplate
      ? mergeProductIngredientsForEditor(
          initialTemplate.baseRecipe,
          initialTemplate.removableOptions
        )
      : []
  );
  const [ingredientInput, setIngredientInput] = useState('');
  const [newIngredientRemovable, setNewIngredientRemovable] = useState(true);

  const [addonOptions, setAddonOptions] = useState<AddonOption[]>(() =>
    initialTemplate
      ? initialTemplate.addonOptions.map((a) => ({
          ...a,
          id: isEditingExisting ? a.id : createSafeId('ext'),
          allowMultiple: a.allowMultiple !== false,
        }))
      : []
  );
  const [addonName, setAddonName] = useState('');
  const [addonPrice, setAddonPrice] = useState('');
  const [addonAllowMultiple, setAddonAllowMultiple] = useState(true);

  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (copySource && nameInputRef.current) {
      nameInputRef.current.focus();
      nameInputRef.current.select();
    }
  }, [copySource]);

  const isDuplicateName = useMemo(
    () => hasDuplicateProductName(name, products, product?.id),
    [name, products, product?.id]
  );

  const applyTemplateToForm = (templateId: string) => {
    setSelectedTemplateId(templateId);
    setErrorMsg(null);
    if (!templateId) return;
    const source = products.find((p) => p.id === templateId);
    if (!source) return;

    setName(suggestCopyProductName(source.name, products));
    setCategory(source.category.trim() || existingCategories[0] || 'Hamburguesas');
    setCustomCategoryMode(false);
    setBasePrice(String(source.basePrice));
    setImageUrl(source.imageUrl || '');
    setImageFile(null);
    setImagePreviewUrl('');
    setActive(source.active);
    setAllowSauces(source.allowSauces);
    setMinSauces(source.minSauces);
    setMaxSauces(source.maxSauces);
    setIngredients(
      mergeProductIngredientsForEditor(source.baseRecipe, source.removableOptions)
    );
    setAddonOptions(
      source.addonOptions.map((a) => ({
        ...a,
        id: createSafeId('ext'),
        allowMultiple: a.allowMultiple !== false,
      }))
    );
  };

  const addIngredient = () => {
    const clean = ingredientInput.trim().replace(/\s+/g, ' ').slice(0, 80);
    if (!clean) return;
    const key = normalizeProductNameKey(clean);
    if (ingredients.some((item) => normalizeProductNameKey(item.name) === key)) {
      setErrorMsg(`El ingrediente "${clean}" ya está en la receta.`);
      return;
    }
    setErrorMsg(null);
    setIngredients((prev) => [...prev, { name: clean, removable: newIngredientRemovable }]);
    setIngredientInput('');
  };

  const toggleIngredientRemovable = (nameKey: string) => {
    setIngredients((prev) =>
      prev.map((item) =>
        normalizeProductNameKey(item.name) === nameKey
          ? { ...item, removable: !item.removable }
          : item
      )
    );
  };

  const removeIngredient = (nameKey: string) => {
    setIngredients((prev) =>
      prev.filter((item) => normalizeProductNameKey(item.name) !== nameKey)
    );
  };

  const addAddon = () => {
    const cleanName = addonName.trim();
    const priceNum = Number(addonPrice || 0);
    if (!cleanName || Number.isNaN(priceNum) || priceNum < 0) return;
    setAddonOptions((prev) => [
      ...prev,
      {
        id: createSafeId('ext'),
        name: cleanName,
        price: Math.round(priceNum),
        allowMultiple: addonAllowMultiple,
      },
    ]);
    setAddonName('');
    setAddonPrice('');
    setAddonAllowMultiple(true);
  };

  const handleCategoryChange = (val: string) => {
    setCategory(val);
    if (val.toLowerCase().includes('bebida') && !isEditingExisting) {
      setAllowSauces(false);
      setMinSauces(0);
      setMaxSauces(0);
    }
  };

  const handleGalleryFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const validation = validateImageFileCandidate(file);
    if (!validation.ok) {
      setErrorMsg(validation.error);
      return;
    }

    setErrorMsg(null);
    setImageFile(file);
    const reader = new FileReader();
    reader.onload = () => setImagePreviewUrl(String(reader.result || ''));
    reader.onerror = () => setErrorMsg('No se pudo generar la vista previa de la imagen.');
    reader.readAsDataURL(file);
  };

  const handleClearPhoto = () => {
    setImageFile(null);
    setImagePreviewUrl('');
    setImageUrl('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = name.trim().replace(/\s+/g, ' ');
    const cleanCategory = category.trim().replace(/\s+/g, ' ');
    const numPrice = Number(basePrice);

    if (!cleanName) {
      setErrorMsg('El nombre del producto es obligatorio.');
      return;
    }
    if (hasDuplicateProductName(cleanName, products, product?.id)) {
      setErrorMsg(
        `Ya existe un producto llamado "${cleanName}". Usa un nombre distinto para este producto.`
      );
      return;
    }
    if (!cleanCategory) {
      setErrorMsg('Selecciona o escribe una categoría.');
      return;
    }
    if (Number.isNaN(numPrice) || numPrice < 0) {
      setErrorMsg('Ingresa un precio base válido.');
      return;
    }

    const { baseRecipe, removableOptions } = splitProductIngredientsFromEditor(ingredients);

    setSaving(true);
    setErrorMsg(null);
    try {
      await saveProduct({
        id: product?.id,
        name: cleanName,
        category: cleanCategory,
        basePrice: numPrice,
        imageUrl,
        imageFile,
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

  const categoryMatchesExisting = existingCategories.some(
    (c) => c.toLowerCase() === category.trim().toLowerCase()
  );

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
            {product
              ? `EDITAR: ${product.name.toUpperCase()}`
              : copySource
                ? `COPIAR RECETA DE ${copySource.name.toUpperCase()}`
                : 'NUEVO PRODUCTO / BEBIDA'}
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

          {/* Copy from existing product template (shown when creating/copying) */}
          {!isEditingExisting && products.length > 0 && (
            <div className="rounded-xl border border-amber-500/40 bg-[#101014] p-3.5 space-y-1.5">
              <label
                htmlFor="copy-template-select"
                className="flex items-center gap-1.5 text-xs font-bold text-amber-400"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>Copiar receta de otro producto existente (opcional)</span>
              </label>
              <select
                id="copy-template-select"
                value={selectedTemplateId}
                onChange={(e) => applyTemplateToForm(e.target.value)}
                className="w-full min-h-[40px] rounded-xl border border-[#27272E] bg-[#0A0A0A] px-3 text-xs sm:text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
              >
                <option value="">-- Empezar desde cero --</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {p.category} ({formatCurrency(p.basePrice)})
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-zinc-400">
                Clona ingredientes, opciones quitables, adiciones, salsas, categoría y foto; luego cambia el nombre y ajusta lo que necesites.
              </p>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
            <div className="sm:col-span-6">
              <label htmlFor="prod-name" className="block text-xs font-semibold text-zinc-300 mb-1">
                Nombre del producto o bebida
              </label>
              <input
                ref={nameInputRef}
                id="prod-name"
                type="text"
                maxLength={100}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ej. Hamburguesa Mixta o Limonada"
                className={`w-full min-h-[44px] rounded-xl border bg-[#0A0A0A] px-3 text-sm text-white focus:outline-none focus:ring-2 ${
                  isDuplicateName
                    ? 'border-red-500 focus:ring-red-500'
                    : 'border-[#27272E] focus:ring-amber-500'
                }`}
              />
              {isDuplicateName && (
                <p className="text-[11px] text-red-400 font-medium mt-1">
                  Ya existe un producto con este nombre. Escribe uno diferente.
                </p>
              )}
            </div>

            <div className="sm:col-span-3">
              <div className="flex items-center justify-between mb-1">
                <label htmlFor="prod-category" className="block text-xs font-semibold text-zinc-300">
                  Categoría
                </label>
                {customCategoryMode && (
                  <button
                    type="button"
                    onClick={() => {
                      setCustomCategoryMode(false);
                      if (!categoryMatchesExisting && existingCategories[0]) {
                        handleCategoryChange(existingCategories[0]);
                      }
                    }}
                    className="text-[10px] font-semibold text-amber-400 hover:underline"
                  >
                    Ver lista
                  </button>
                )}
              </div>

              {!customCategoryMode ? (
                <select
                  id="prod-category"
                  value={
                    categoryMatchesExisting
                      ? existingCategories.find(
                          (c) => c.toLowerCase() === category.trim().toLowerCase()
                        ) || category
                      : '__new__'
                  }
                  onChange={(e) => {
                    if (e.target.value === '__new__') {
                      setCustomCategoryMode(true);
                      setCategory('');
                    } else {
                      handleCategoryChange(e.target.value);
                    }
                  }}
                  className="w-full min-h-[44px] rounded-xl border border-[#27272E] bg-[#0A0A0A] px-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                >
                  {existingCategories.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                  {!categoryMatchesExisting && category.trim() && (
                    <option value={category.trim()}>{category.trim()}</option>
                  )}
                  <option value="__new__">+ Nueva categoría...</option>
                </select>
              ) : (
                <input
                  id="prod-category"
                  type="text"
                  maxLength={60}
                  autoFocus
                  value={category}
                  onChange={(e) => handleCategoryChange(e.target.value)}
                  placeholder="Ej. Salchipapas"
                  className="w-full min-h-[44px] rounded-xl border border-amber-500 bg-[#0A0A0A] px-3 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              )}
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

          {/* Unified Recipe Ingredients with per-ingredient Quitable / Fijo selection */}
          <section className="space-y-3 border-t border-[#27272E] pt-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
              <label htmlFor="recipe-ing-input" className="block text-xs font-semibold text-zinc-300">
                Ingredientes de la receta (elige cuáles se pueden quitar al tomar pedidos)
              </label>
              <span className="text-[11px] text-zinc-400 tabular-nums">
                {ingredients.filter((i) => i.removable).length} quitables ·{' '}
                {ingredients.filter((i) => !i.removable).length} fijos
              </span>
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
              <input
                id="recipe-ing-input"
                type="text"
                maxLength={80}
                value={ingredientInput}
                onChange={(e) => setIngredientInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addIngredient();
                  }
                }}
                placeholder="Ej. Carne de res, Queso, Papa ripio..."
                className="flex-1 min-h-[42px] rounded-xl border border-[#27272E] bg-[#0A0A0A] px-3 text-sm text-white placeholder:text-zinc-500"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setNewIngredientRemovable((v) => !v)}
                  title="Define si este ingrediente se podrá quitar al tomar el pedido"
                  className={`min-h-[42px] px-3 rounded-xl border text-xs font-bold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors ${
                    newIngredientRemovable
                      ? 'border-red-600/80 bg-red-950/50 text-red-200'
                      : 'border-[#27272E] bg-[#1C1C22] text-zinc-300'
                  }`}
                >
                  {newIngredientRemovable && <Check className="w-3.5 h-3.5 text-red-400 shrink-0" />}
                  <span>{newIngredientRemovable ? 'Quitable' : 'Fijo'}</span>
                </button>
                <button
                  type="button"
                  onClick={addIngredient}
                  className="min-h-[42px] px-4 rounded-xl bg-amber-500 text-black text-xs font-bold hover:bg-amber-400 whitespace-nowrap shrink-0"
                >
                  Añadir
                </button>
              </div>
            </div>

            {ingredients.length > 0 && (
              <div className="divide-y divide-[#27272E] border border-[#27272E] rounded-xl overflow-hidden bg-[#0A0A0A]">
                {ingredients.map((ing) => {
                  const key = normalizeProductNameKey(ing.name);
                  return (
                    <div
                      key={key}
                      className="px-3 py-2 flex items-center justify-between gap-2 text-xs"
                    >
                      <span className="font-semibold text-white truncate">{ing.name}</span>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => toggleIngredientRemovable(key)}
                          aria-pressed={ing.removable}
                          className={`min-h-[32px] px-2.5 rounded-lg border text-[11px] font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap ${
                            ing.removable
                              ? 'border-red-700 bg-red-950/50 text-red-200 hover:bg-red-950'
                              : 'border-[#27272E] bg-[#1C1C22] text-zinc-300 hover:border-zinc-500'
                          }`}
                        >
                          {ing.removable && <Check className="w-3 h-3 text-red-400 shrink-0" />}
                          <span>
                            {ing.removable
                              ? `Quitable (${formatWithoutIngredientLabel(ing.name)})`
                              : 'Fijo (no quitable)'}
                          </span>
                        </button>
                        <button
                          type="button"
                          aria-label={`Eliminar ingrediente ${ing.name} de receta`}
                          onClick={() => removeIngredient(key)}
                          className="min-h-[32px] min-w-[32px] flex items-center justify-center rounded-lg text-zinc-400 hover:text-red-400 hover:bg-red-950/40"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Add-on extras */}
          <section className="space-y-2 border-t border-[#27272E] pt-4">
            <p className="text-xs font-semibold text-zinc-300">
              Adiciones o extras que se pueden PONER (con precio adicional y cantidad)
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
                className="sm:w-28 min-h-[42px] rounded-xl border border-[#27272E] bg-[#0A0A0A] px-3 font-mono text-sm text-amber-400 placeholder:text-zinc-500"
              />
              <button
                type="button"
                onClick={() => setAddonAllowMultiple((v) => !v)}
                title="Alternar si el cliente puede repetir esta adición varias veces"
                className={`min-h-[42px] px-3 rounded-xl border text-xs font-bold whitespace-nowrap shrink-0 transition-colors ${
                  addonAllowMultiple
                    ? 'border-emerald-700 bg-emerald-950/60 text-emerald-300'
                    : 'border-[#27272E] bg-[#1C1C22] text-zinc-300'
                }`}
              >
                {addonAllowMultiple ? 'Varias veces' : 'Solo 1 vez'}
              </button>
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
                {addonOptions.map((ex) => {
                  const multi = ex.allowMultiple !== false;
                  return (
                    <div
                      key={ex.id}
                      className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 text-sm"
                    >
                      <span className="font-medium text-zinc-200">{ex.name}</span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            setAddonOptions((p) =>
                              p.map((x) =>
                                x.id === ex.id ? { ...x, allowMultiple: !multi } : x
                              )
                            )
                          }
                          className={`min-h-[30px] px-2.5 rounded-lg border text-[11px] font-semibold transition-colors ${
                            multi
                              ? 'border-emerald-700 bg-emerald-950/50 text-emerald-300'
                              : 'border-[#27272E] bg-[#1C1C22] text-zinc-300'
                          }`}
                        >
                          {multi ? 'Múltiple' : 'Solo 1 vez'}
                        </button>
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
                  );
                })}
              </div>
            )}
          </section>

          {/* Product photo picker from gallery + optional path */}
          <section className="rounded-xl border border-[#27272E] bg-[#101014] p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <ImageIcon className="w-4 h-4 text-amber-400 shrink-0" />
                <div>
                  <p className="text-xs font-bold text-white">Foto del producto (opcional)</p>
                  <p className="text-[11px] text-zinc-400">
                    Elige una imagen de tu galería para mostrarla en el menú y al tomar pedidos.
                  </p>
                </div>
              </div>
              <span className="text-[11px] text-zinc-400 hidden sm:inline">
                Compresión automática
              </span>
            </div>

            <input
              ref={galleryInputRef}
              type="file"
              accept="image/*"
              onChange={handleGalleryFileChange}
              aria-label="Seleccionar foto del producto desde galería"
              className="hidden"
            />

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              <div className="w-full sm:w-28 h-28 rounded-xl border border-[#27272E] bg-[#0A0A0A] overflow-hidden flex items-center justify-center shrink-0">
                {imagePreviewUrl || imageUrl ? (
                  <img
                    src={imagePreviewUrl || resolveAssetUrl(imageUrl)}
                    alt={name || 'Vista previa del producto'}
                    className="w-full h-full object-cover object-center"
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center gap-1 text-zinc-500 px-2 text-center">
                    <ImageIcon className="w-6 h-6" />
                    <span className="text-[10px]">Sin foto</span>
                  </div>
                )}
              </div>

              <div className="flex-1 space-y-2.5 min-w-0">
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => galleryInputRef.current?.click()}
                    className="min-h-[42px] px-4 rounded-xl bg-amber-500 text-black text-xs font-bold hover:bg-amber-400 flex items-center gap-2 transition-colors"
                  >
                    <Upload className="w-4 h-4" />
                    <span>
                      {imagePreviewUrl || imageUrl ? 'Cambiar foto de galería' : 'Elegir foto de galería'}
                    </span>
                  </button>

                  {(imagePreviewUrl || imageUrl) && (
                    <button
                      type="button"
                      onClick={handleClearPhoto}
                      className="min-h-[42px] px-3 rounded-xl border border-red-900/70 bg-red-950/40 text-xs font-semibold text-red-300 hover:bg-red-950 flex items-center gap-1.5"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Quitar foto</span>
                    </button>
                  )}
                </div>

                {imageFile ? (
                  <p className="text-[11px] text-emerald-300 font-medium truncate">
                    Archivo listo: {imageFile.name}
                  </p>
                ) : (
                  <div>
                    <label htmlFor="prod-img" className="block text-[11px] font-medium text-zinc-400 mb-1">
                      O pegar URL / ruta de imagen
                    </label>
                    <input
                      id="prod-img"
                      type="text"
                      maxLength={PRODUCT_IMAGE_MAX_URL_LENGTH}
                      value={imageUrl}
                      onChange={(e) => {
                        setImageFile(null);
                        setImagePreviewUrl('');
                        setImageUrl(e.target.value);
                      }}
                      placeholder="/menu/mixta.jpg o https://..."
                      className="w-full min-h-[38px] rounded-xl border border-[#27272E] bg-[#0A0A0A] px-3 font-mono text-xs text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
                    />
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 pt-2 border-t border-[#27272E]">
              <span className="text-xs font-medium text-zinc-300">
                Visible en pedidos
              </span>
              <button
                type="button"
                onClick={() => setActive((a) => !a)}
                className={`min-h-[40px] px-4 rounded-xl text-xs font-semibold border transition-colors ${
                  active
                    ? 'bg-emerald-950/60 border-emerald-700 text-emerald-300'
                    : 'bg-[#1C1C22] border-[#27272E] text-zinc-400'
                }`}
              >
                {active ? 'Activo en menú' : 'Desactivado'}
              </button>
            </div>
          </section>
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
            disabled={saving || isDuplicateName}
            className="min-h-[44px] px-6 rounded-xl bg-amber-500 text-black text-sm font-bold hover:bg-amber-400 disabled:opacity-60 transition-colors"
          >
            {saving
              ? 'Guardando...'
              : product
                ? 'Guardar cambios'
                : copySource
                  ? 'Crear producto copiado'
                  : 'Crear producto'}
          </button>
        </div>
      </form>
    </div>
  );
};
