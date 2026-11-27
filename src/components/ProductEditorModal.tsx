import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Calculator,
  Check,
  Copy,
  Droplets,
  Image as ImageIcon,
  Plus,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { usePosStore } from '../services/posStore';
import type {
  AddonOption,
  InventoryItem,
  InventoryUnit,
  Product,
  RecipeIngredientSpec,
} from '../types/pos';
import {
  calculateProductRecipeCost,
  calculatePurchaseUnitCost,
  canonicalizeRecipeIngredient,
  formatInventoryQuantity,
  formatUnitCost,
  getRecipeSpecKey,
  hasDuplicateInventoryName,
  inferDefaultInventoryUnit,
  isRecipeSpecInventoriable,
  normalizeIngredientKey,
  resolveProductRecipeSpecs,
  roundStockQty,
  splitProductRecipeFromSpecs,
} from '../utils/inventoryMath';
import {
  collectMenuCategories,
  createSafeId,
  formatCurrency,
  formatWithoutIngredientLabel,
  hasDuplicateProductName,
  mergeProductIngredientsForEditor,
  PRODUCT_IMAGE_MAX_URL_LENGTH,
  resolveAssetUrl,
  suggestCopyProductName,
  validateImageFileCandidate,
} from '../utils/orderMath';

interface Props {
  product?: Product | null;
  copySource?: Product | null;
  onClose: () => void;
}

function buildInitialSpecs(
  template: Product | null,
  inventory: InventoryItem[]
): RecipeIngredientSpec[] {
  if (!template) return [];
  const byId = new Map(inventory.map((i) => [i.id, i]));
  const byKey = new Map(
    inventory.map((i) => [normalizeIngredientKey(i.nameKey || i.name), i])
  );

  if (Array.isArray(template.recipeIngredients) && template.recipeIngredients.length > 0) {
    return resolveProductRecipeSpecs(template, byId);
  }

  const merged = mergeProductIngredientsForEditor(
    template.baseRecipe,
    template.removableOptions
  );
  const out: RecipeIngredientSpec[] = [];
  const seen = new Set<string>();

  for (const item of merged) {
    const resolved = canonicalizeRecipeIngredient(item.name);
    const inv =
      byKey.get(resolved.canonicalKey) || byKey.get(normalizeIngredientKey(item.name));
    if (inv) {
      if (seen.has(`inv:${inv.id}`)) continue;
      seen.add(`inv:${inv.id}`);
      out.push({
        inventoryItemId: inv.id,
        name: inv.name,
        quantity: inv.unit === 'ud' ? resolved.suggestedMultiplier : 0,
        unit: inv.unit,
        removable: item.removable,
      });
    } else {
      const nonInvKey = `noninv:${normalizeIngredientKey(item.name)}`;
      if (seen.has(nonInvKey)) continue;
      seen.add(nonInvKey);
      out.push({
        inventoryItemId: '',
        name: item.name,
        quantity: 0,
        unit: 'g',
        removable: item.removable,
        inventoriable: false,
      });
    }
  }
  return out;
}

export const ProductEditorModal: React.FC<Props> = ({ product, copySource, onClose }) => {
  const { products, inventory, saveProduct, saveInventoryItem } = usePosStore();

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

  const [recipeSpecs, setRecipeSpecs] = useState<RecipeIngredientSpec[]>(() =>
    buildInitialSpecs(initialTemplate, inventory)
  );
  const [ingredientMode, setIngredientMode] = useState<'inventariable' | 'no_inventariable'>(
    'inventariable'
  );
  const [selectedInvId, setSelectedInvId] = useState('');
  const [specQuantityInput, setSpecQuantityInput] = useState('');
  const [nonInvNameInput, setNonInvNameInput] = useState('');
  const [newIngredientRemovable, setNewIngredientRemovable] = useState(true);

  // Quick-create new inventory ingredient inline
  const [quickCreateOpen, setQuickCreateOpen] = useState(false);
  const [quickName, setQuickName] = useState('');
  const [quickUnit, setQuickUnit] = useState<InventoryUnit>('g');
  const [quickInitQty, setQuickInitQty] = useState('');
  const [quickInitCost, setQuickInitCost] = useState('');
  const [creatingQuickInv, setCreatingQuickInv] = useState(false);

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
  const [addonInvId, setAddonInvId] = useState('');
  const [addonInvQty, setAddonInvQty] = useState('');

  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const inventoryMap = useMemo(
    () => new Map(inventory.map((i) => [i.id, i])),
    [inventory]
  );

  const sortedInventory = useMemo(
    () => [...inventory].sort((a, b) => a.name.localeCompare(b.name, 'es')),
    [inventory]
  );

  const availableInventoryForRecipe = useMemo(() => {
    const used = new Set(recipeSpecs.map((s) => s.inventoryItemId));
    return sortedInventory.filter((i) => !used.has(i.id));
  }, [sortedInventory, recipeSpecs]);

  const selectedInvItem = useMemo(
    () => (selectedInvId ? inventoryMap.get(selectedInvId) || null : null),
    [selectedInvId, inventoryMap]
  );

  const estimatedRecipeCost = useMemo(
    () => calculateProductRecipeCost(recipeSpecs, inventoryMap),
    [recipeSpecs, inventoryMap]
  );

  const quickPreviewUnitCost = useMemo(() => {
    const q = Number(quickInitQty);
    const c = Number(quickInitCost);
    if (!Number.isFinite(q) || q <= 0 || !Number.isFinite(c) || c < 0) return 0;
    return calculatePurchaseUnitCost(q, c);
  }, [quickInitQty, quickInitCost]);

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
    setRecipeSpecs(buildInitialSpecs(source, inventory));
    setAddonOptions(
      source.addonOptions.map((a) => ({
        ...a,
        id: createSafeId('ext'),
        allowMultiple: a.allowMultiple !== false,
      }))
    );
  };

  const handleAddInventorySpec = () => {
    if (!selectedInvItem) {
      setErrorMsg('Selecciona un ingrediente del inventario o créalo primero.');
      return;
    }
    if (
      recipeSpecs.some(
        (s) =>
          (isRecipeSpecInventoriable(s) && s.inventoryItemId === selectedInvItem.id) ||
          normalizeIngredientKey(s.name) === normalizeIngredientKey(selectedInvItem.name)
      )
    ) {
      setErrorMsg(`El ingrediente "${selectedInvItem.name}" ya está en la receta.`);
      return;
    }

    const parsedQty = specQuantityInput.trim()
      ? Number(specQuantityInput)
      : selectedInvItem.unit === 'ud'
        ? 1
        : 0;
    if (!Number.isFinite(parsedQty) || parsedQty < 0) {
      setErrorMsg('Ingresa un gramaje o cantidad válida (0 o mayor).');
      return;
    }

    setErrorMsg(null);
    setRecipeSpecs((prev) => [
      ...prev,
      {
        inventoryItemId: selectedInvItem.id,
        name: selectedInvItem.name,
        quantity: roundStockQty(parsedQty),
        unit: selectedInvItem.unit,
        removable: newIngredientRemovable,
      },
    ]);
    setSelectedInvId('');
    setSpecQuantityInput('');
  };

  const handleAddNonInventoriableSpec = () => {
    const cleanName = nonInvNameInput.trim().replace(/\s+/g, ' ').slice(0, 80);
    if (!cleanName) {
      setErrorMsg('Escribe el nombre del ingrediente no inventariable.');
      return;
    }
    const cleanKey = normalizeIngredientKey(cleanName);
    if (recipeSpecs.some((s) => normalizeIngredientKey(s.name) === cleanKey)) {
      setErrorMsg(`El ingrediente "${cleanName}" ya está en la receta.`);
      return;
    }

    setErrorMsg(null);
    setRecipeSpecs((prev) => [
      ...prev,
      {
        inventoryItemId: '',
        name: cleanName,
        quantity: 0,
        unit: 'g',
        removable: newIngredientRemovable,
        inventoriable: false,
      },
    ]);
    setNonInvNameInput('');
  };

  const handleCreateQuickInventory = async () => {
    const clean = quickName.trim().replace(/\s+/g, ' ');
    if (!clean) {
      setErrorMsg('Escribe el nombre del nuevo ingrediente.');
      return;
    }
    if (hasDuplicateInventoryName(clean, inventory)) {
      const existing = inventory.find(
        (i) => normalizeIngredientKey(i.nameKey || i.name) === normalizeIngredientKey(clean)
      );
      if (existing) {
        setSelectedInvId(existing.id);
        setSpecQuantityInput(existing.unit === 'ud' ? '1' : '');
        setQuickCreateOpen(false);
        setQuickName('');
        setErrorMsg(null);
        return;
      }
    }

    const initQtyNum = quickInitQty.trim() ? Number(quickInitQty) : 0;
    const initCostNum = quickInitCost.trim() ? Number(quickInitCost) : 0;
    if (quickInitQty.trim() && (Number.isNaN(initQtyNum) || initQtyNum < 0)) {
      setErrorMsg('Ingresa una cantidad inicial válida.');
      return;
    }
    if (quickInitCost.trim() && (Number.isNaN(initCostNum) || initCostNum < 0)) {
      setErrorMsg('Ingresa un costo total inicial válido.');
      return;
    }

    setCreatingQuickInv(true);
    setErrorMsg(null);
    try {
      const created = await saveInventoryItem({
        name: clean,
        unit: quickUnit,
        initialQuantity: initQtyNum,
        initialTotalCost: initCostNum,
      });
      setSelectedInvId(created.id);
      setSpecQuantityInput(created.unit === 'ud' ? '1' : '');
      setQuickCreateOpen(false);
      setQuickName('');
      setQuickInitQty('');
      setQuickInitCost('');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'No se pudo crear el ingrediente.');
    } finally {
      setCreatingQuickInv(false);
    }
  };

  const updateSpecQuantity = (specKey: string, rawVal: string) => {
    const num = rawVal === '' ? 0 : Number(rawVal);
    if (Number.isNaN(num) || num < 0) return;
    setRecipeSpecs((prev) =>
      prev.map((s) =>
        getRecipeSpecKey(s) === specKey ? { ...s, quantity: roundStockQty(num) } : s
      )
    );
  };

  const toggleIngredientRemovable = (specKey: string) => {
    setRecipeSpecs((prev) =>
      prev.map((item) =>
        getRecipeSpecKey(item) === specKey
          ? { ...item, removable: !item.removable }
          : item
      )
    );
  };

  const removeIngredient = (specKey: string) => {
    setRecipeSpecs((prev) => prev.filter((item) => getRecipeSpecKey(item) !== specKey));
  };

  const addAddon = () => {
    const cleanName = addonName.trim();
    const priceNum = Number(addonPrice || 0);
    if (!cleanName || Number.isNaN(priceNum) || priceNum < 0) return;
    const invQty = addonInvQty.trim() ? Number(addonInvQty) : 0;
    setAddonOptions((prev) => [
      ...prev,
      {
        id: createSafeId('ext'),
        name: cleanName,
        price: Math.round(priceNum),
        allowMultiple: addonAllowMultiple,
        ...(addonInvId
          ? {
              inventoryItemId: addonInvId,
              inventoryQuantity: Number.isFinite(invQty) && invQty > 0 ? roundStockQty(invQty) : 0,
            }
          : {}),
      },
    ]);
    setAddonName('');
    setAddonPrice('');
    setAddonAllowMultiple(true);
    setAddonInvId('');
    setAddonInvQty('');
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

    const { baseRecipe, removableOptions, recipeIngredients } =
      splitProductRecipeFromSpecs(recipeSpecs);

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
        recipeIngredients,
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

        <div className="p-4 sm:p-5 overflow-y-auto space-y-4">
          {errorMsg && (
            <div className="rounded-xl bg-red-950/60 border border-red-700 px-3.5 py-2.5 text-xs font-medium text-red-200">
              {errorMsg}
            </div>
          )}

          {/* Copy from existing product template (shown when creating/copying) */}
          {!isEditingExisting && products.length > 0 && (
            <div className="rounded-xl border border-amber-500/40 bg-[#101014] p-3 space-y-1.5">
              <label
                htmlFor="copy-template-select"
                className="flex items-center gap-1.5 text-xs font-bold text-amber-400"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>Copiar receta existente (opcional)</span>
              </label>
              <select
                id="copy-template-select"
                value={selectedTemplateId}
                onChange={(e) => applyTemplateToForm(e.target.value)}
                className="w-full min-h-[38px] rounded-xl border border-[#27272E] bg-[#0A0A0A] px-3 text-xs sm:text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
              >
                <option value="">-- Empezar desde cero --</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {p.category} ({formatCurrency(p.basePrice)})
                  </option>
                ))}
              </select>
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

          {/* Sauces config */}
          <section className="rounded-xl border border-[#27272E] bg-[#101014] p-3 space-y-2.5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <Droplets className="w-4 h-4 text-amber-400 shrink-0" />
                <p className="text-xs font-bold text-white">Selección de salsas</p>
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
                className={`min-h-[34px] px-3 rounded-xl border text-xs font-bold whitespace-nowrap ${
                  allowSauces
                    ? 'bg-amber-500 border-amber-400 text-black'
                    : 'bg-[#1C1C22] border-[#27272E] text-zinc-300'
                }`}
              >
                {allowSauces ? 'Con salsas' : 'Sin salsas'}
              </button>
            </div>

            {allowSauces && (
              <div className="grid grid-cols-2 gap-2.5 pt-2 border-t border-[#27272E]">
                <div>
                  <label htmlFor="prod-min-sauces" className="block text-[11px] font-medium text-zinc-400 mb-1">
                    Mínimo de salsas
                  </label>
                  <select
                    id="prod-min-sauces"
                    value={minSauces}
                    onChange={(e) => setMinSauces(Number(e.target.value))}
                    className="w-full min-h-[38px] rounded-xl border border-[#27272E] bg-[#0A0A0A] px-3 text-xs sm:text-sm text-white"
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
                    className="w-full min-h-[38px] rounded-xl border border-[#27272E] bg-[#0A0A0A] px-3 text-xs sm:text-sm text-white"
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

          {/* Recipe Ingredients: Inventoriable + Non-inventoriable with Quitable / Fijo */}
          <section className="space-y-2.5 border-t border-[#27272E] pt-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-bold text-zinc-200 uppercase tracking-wide">
                Ingredientes de la receta
              </p>
              <div className="flex items-center gap-2 text-[11px] tabular-nums shrink-0">
                <span className="text-zinc-400">
                  {recipeSpecs.filter((i) => i.removable).length} quitables ·{' '}
                  {recipeSpecs.filter((i) => !i.removable).length} fijos
                </span>
                {estimatedRecipeCost > 0 && (
                  <span className="px-2 py-0.5 rounded-md bg-emerald-950/60 border border-emerald-700/70 text-emerald-300 font-mono font-bold">
                    Costo: {formatCurrency(estimatedRecipeCost)}
                  </span>
                )}
              </div>
            </div>

            {/* Mode Switch: Inventariable vs No inventariable */}
            <div className="inline-flex p-1 rounded-xl bg-[#0A0A0A] border border-[#27272E] gap-1">
              <button
                type="button"
                onClick={() => {
                  setIngredientMode('inventariable');
                  setErrorMsg(null);
                }}
                className={`min-h-[34px] px-3 rounded-lg text-xs font-bold transition-colors ${
                  ingredientMode === 'inventariable'
                    ? 'bg-amber-500 text-black'
                    : 'text-zinc-300 hover:text-white'
                }`}
              >
                Inventariable (g/ud)
              </button>
              <button
                type="button"
                onClick={() => {
                  setIngredientMode('no_inventariable');
                  setQuickCreateOpen(false);
                  setErrorMsg(null);
                }}
                className={`min-h-[34px] px-3 rounded-lg text-xs font-bold transition-colors ${
                  ingredientMode === 'no_inventariable'
                    ? 'bg-sky-500 text-black'
                    : 'text-zinc-300 hover:text-white'
                }`}
              >
                No inventariable (solo receta)
              </button>
            </div>

            {ingredientMode === 'no_inventariable' ? (
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  id="recipe-noninv-name"
                  type="text"
                  maxLength={80}
                  aria-label="Nombre del ingrediente no inventariable"
                  value={nonInvNameInput}
                  onChange={(e) => setNonInvNameInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddNonInventoriableSpec();
                    }
                  }}
                  placeholder="Ej. Cebolla caramelizada, Papitas ripio, Orégano, Hielo..."
                  className="flex-1 min-h-[42px] rounded-xl border border-[#27272E] bg-[#0A0A0A] px-3 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-sky-500"
                />

                <div className="flex items-center gap-2">
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
                    onClick={handleAddNonInventoriableSpec}
                    className="min-h-[42px] px-4 rounded-xl bg-sky-500 text-black text-xs font-bold hover:bg-sky-400 whitespace-nowrap shrink-0"
                  >
                    Añadir
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex flex-col sm:flex-row gap-2">
                  <select
                    id="recipe-inv-select"
                    value={selectedInvId}
                    onChange={(e) => {
                      const id = e.target.value;
                      setSelectedInvId(id);
                      const found = inventoryMap.get(id);
                      if (found) {
                        setSpecQuantityInput(found.unit === 'ud' ? '1' : '');
                      }
                    }}
                    className="flex-1 min-h-[42px] rounded-xl border border-[#27272E] bg-[#0A0A0A] px-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                  >
                    <option value="">-- Elegir ingrediente ya creado en inventario --</option>
                    {availableInventoryForRecipe.map((inv) => (
                      <option key={inv.id} value={inv.id}>
                        {inv.name} ({inv.unit}) · Stock: {formatInventoryQuantity(inv.currentStock, inv.unit)}
                      </option>
                    ))}
                  </select>

                  <div className="flex items-center gap-2">
                    <div className="relative w-28">
                      <input
                        type="number"
                        min={0}
                        step="any"
                        aria-label="Gramaje o cantidad en receta"
                        value={specQuantityInput}
                        onChange={(e) => setSpecQuantityInput(e.target.value)}
                        placeholder={selectedInvItem?.unit === 'ud' ? 'Ej. 1' : 'Ej. 40'}
                        className="w-full min-h-[42px] rounded-xl border border-[#27272E] bg-[#0A0A0A] pl-3 pr-8 font-mono text-sm text-amber-400 placeholder:text-zinc-500"
                      />
                      <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] font-mono text-zinc-400">
                        {selectedInvItem?.unit || 'g/ud'}
                      </span>
                    </div>

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
                      onClick={handleAddInventorySpec}
                      className="min-h-[42px] px-4 rounded-xl bg-amber-500 text-black text-xs font-bold hover:bg-amber-400 whitespace-nowrap shrink-0"
                    >
                      Añadir
                    </button>
                  </div>
                </div>

                {/* Inline Quick-Create Inventory Ingredient */}
                <div>
                  <button
                    type="button"
                    onClick={() => {
                      setQuickCreateOpen((v) => !v);
                      setErrorMsg(null);
                    }}
                    className="text-xs font-bold text-amber-400 hover:text-amber-300 inline-flex items-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>
                      {quickCreateOpen
                        ? 'Ocultar creación rápida'
                        : '¿No está en la lista? Crear nuevo ingrediente inventariable aquí'}
                    </span>
                  </button>

                  {quickCreateOpen && (
                    <div className="mt-2 rounded-xl border border-amber-500/40 bg-[#101014] p-3.5 space-y-3">
                      <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
                        <div className="sm:col-span-6">
                          <label htmlFor="quick-inv-name" className="block text-[11px] font-semibold text-zinc-300 mb-1">
                            Nombre del ingrediente
                          </label>
                          <input
                            id="quick-inv-name"
                            type="text"
                            maxLength={80}
                            value={quickName}
                            onChange={(e) => {
                              setQuickName(e.target.value);
                              setQuickUnit(inferDefaultInventoryUnit(e.target.value));
                            }}
                            placeholder="Ej. Ensalada, Pan brioche, Salsa especial"
                            className="w-full min-h-[38px] rounded-xl border border-[#27272E] bg-[#0A0A0A] px-3 text-xs text-white"
                          />
                        </div>
                        <div className="sm:col-span-6">
                          <span className="block text-[11px] font-semibold text-zinc-300 mb-1">
                            Unidad de inventario
                          </span>
                          <div className="grid grid-cols-2 gap-1 p-1 rounded-xl border border-[#27272E] bg-[#0A0A0A]">
                            <button
                              type="button"
                              onClick={() => setQuickUnit('g')}
                              className={`min-h-[30px] rounded-lg text-xs font-bold ${
                                quickUnit === 'g' ? 'bg-amber-500 text-black' : 'text-zinc-300'
                              }`}
                            >
                              Gramos (g)
                            </button>
                            <button
                              type="button"
                              onClick={() => setQuickUnit('ud')}
                              className={`min-h-[30px] rounded-lg text-xs font-bold ${
                                quickUnit === 'ud' ? 'bg-amber-500 text-black' : 'text-zinc-300'
                              }`}
                            >
                              Unidades (ud)
                            </button>
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-12 gap-2.5 items-end">
                        <div className="sm:col-span-4">
                          <label htmlFor="quick-inv-qty" className="block text-[11px] font-semibold text-zinc-400 mb-1">
                            Compra inicial ({quickUnit})
                          </label>
                          <input
                            id="quick-inv-qty"
                            type="number"
                            min={0}
                            step="any"
                            value={quickInitQty}
                            onChange={(e) => setQuickInitQty(e.target.value)}
                            placeholder={quickUnit === 'g' ? '1000' : '24'}
                            className="w-full min-h-[38px] rounded-xl border border-[#27272E] bg-[#0A0A0A] px-3 font-mono text-xs text-white"
                          />
                        </div>
                        <div className="sm:col-span-4">
                          <label htmlFor="quick-inv-cost" className="block text-[11px] font-semibold text-zinc-400 mb-1">
                            Costo compra ($)
                          </label>
                          <input
                            id="quick-inv-cost"
                            type="number"
                            min={0}
                            step={100}
                            value={quickInitCost}
                            onChange={(e) => setQuickInitCost(e.target.value)}
                            placeholder="15000"
                            className="w-full min-h-[38px] rounded-xl border border-[#27272E] bg-[#0A0A0A] px-3 font-mono text-xs text-amber-400"
                          />
                        </div>
                        <div className="col-span-2 sm:col-span-4 flex items-center justify-between gap-2">
                          {Number(quickInitQty) > 0 && (
                            <span className="text-[11px] font-mono text-emerald-400 flex items-center gap-1">
                              <Calculator className="w-3 h-3 shrink-0" />
                              {formatUnitCost(quickPreviewUnitCost, quickUnit)}
                            </span>
                          )}
                          <button
                            type="button"
                            disabled={creatingQuickInv}
                            onClick={handleCreateQuickInventory}
                            className="ml-auto min-h-[38px] px-3.5 rounded-xl bg-amber-500 text-black text-xs font-bold hover:bg-amber-400 disabled:opacity-50 whitespace-nowrap"
                          >
                            {creatingQuickInv ? 'Creando...' : 'Crear y elegir'}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}

            {recipeSpecs.length > 0 && (
              <div className="divide-y divide-[#27272E] border border-[#27272E] rounded-xl overflow-hidden bg-[#0A0A0A]">
                {recipeSpecs.map((ing) => {
                  const specKey = getRecipeSpecKey(ing);
                  const isInv = isRecipeSpecInventoriable(ing);
                  const inv = isInv ? inventoryMap.get(ing.inventoryItemId) : undefined;
                  const lineCost =
                    inv && inv.unitCost > 0 && ing.quantity > 0
                      ? Math.round(inv.unitCost * ing.quantity)
                      : 0;
                  return (
                    <div
                      key={specKey}
                      className="px-3 py-2 space-y-1.5 text-xs"
                    >
                      {/* Top line: full wrapping ingredient name + badge + stock/cost + fixed delete X */}
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1 space-y-0.5">
                          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                            <span className="font-semibold text-white leading-snug break-words">
                              {ing.name}
                            </span>
                            {!isInv && (
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded border border-sky-700/60 bg-sky-950/60 text-sky-300 shrink-0">
                                No inv.
                              </span>
                            )}
                          </div>
                          <p className="text-[10px] text-zinc-400 font-mono leading-tight break-words">
                            {isInv
                              ? inv
                                ? `Stock: ${formatInventoryQuantity(inv.currentStock, inv.unit)}${
                                    lineCost > 0 ? ` · Costo: ${formatCurrency(lineCost)}` : ''
                                  }`
                                : ing.unit
                              : 'Solo receta'}
                            {ing.removable && (
                              <span className="font-sans text-red-300">
                                {' '}· ({formatWithoutIngredientLabel(ing.name)})
                              </span>
                            )}
                          </p>
                        </div>

                        <button
                          type="button"
                          aria-label={`Eliminar ingrediente ${ing.name} de receta`}
                          onClick={() => removeIngredient(specKey)}
                          className="min-h-[28px] min-w-[28px] flex items-center justify-center rounded-lg text-zinc-400 hover:text-red-400 hover:bg-red-950/40 shrink-0"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      {/* Bottom compact control strip: bounded width so controls never clip */}
                      <div className="flex items-center justify-between gap-2">
                        {isInv ? (
                          <div className="relative w-24 shrink-0">
                            <input
                              type="number"
                              min={0}
                              step="any"
                              aria-label={`Cantidad de ${ing.name} en ${ing.unit}`}
                              value={ing.quantity}
                              onChange={(e) => updateSpecQuantity(specKey, e.target.value)}
                              className={`w-full min-h-[30px] rounded-lg border bg-[#141418] pl-2 pr-7 font-mono text-xs text-right tabular-nums focus:outline-none focus:ring-1 focus:ring-amber-500 ${
                                ing.quantity <= 0
                                  ? 'border-amber-500/60 text-amber-300'
                                  : 'border-[#27272E] text-white'
                              }`}
                            />
                            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-mono text-zinc-400">
                              {ing.unit}
                            </span>
                          </div>
                        ) : (
                          <span className="text-[10px] font-medium text-zinc-500">Sin descuento de stock</span>
                        )}

                        <button
                          type="button"
                          onClick={() => toggleIngredientRemovable(specKey)}
                          aria-pressed={ing.removable}
                          className={`min-h-[30px] px-2.5 rounded-lg border text-[11px] font-semibold flex items-center gap-1 transition-colors shrink-0 ${
                            ing.removable
                              ? 'border-red-700 bg-red-950/50 text-red-200 hover:bg-red-950'
                              : 'border-[#27272E] bg-[#1C1C22] text-zinc-300 hover:border-zinc-500'
                          }`}
                        >
                          {ing.removable && <Check className="w-3 h-3 text-red-400 shrink-0" />}
                          <span>{ing.removable ? 'Quitable' : 'Fijo'}</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Add-on extras (with optional inventory ingredient link) */}
          <section className="space-y-2 border-t border-[#27272E] pt-4">
            <p className="text-xs font-semibold text-zinc-300">
              Adiciones o extras que se pueden PONER (con precio adicional y descuento opcional de inventario)
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

            {sortedInventory.length > 0 && (
              <div className="flex flex-col sm:flex-row gap-2">
                <select
                  aria-label="Ingrediente del inventario para este extra (opcional)"
                  value={addonInvId}
                  onChange={(e) => setAddonInvId(e.target.value)}
                  className="flex-1 min-h-[36px] rounded-xl border border-[#27272E] bg-[#0A0A0A] px-3 text-xs text-zinc-300"
                >
                  <option value="">Opcional: vincular extra a un ingrediente del inventario...</option>
                  {sortedInventory.map((inv) => (
                    <option key={inv.id} value={inv.id}>
                      {inv.name} ({inv.unit})
                    </option>
                  ))}
                </select>
                {addonInvId && (
                  <input
                    type="number"
                    min={0}
                    step="any"
                    aria-label="Cantidad del extra en inventario"
                    value={addonInvQty}
                    onChange={(e) => setAddonInvQty(e.target.value)}
                    placeholder={`Cantidad (${inventoryMap.get(addonInvId)?.unit || 'g'})`}
                    className="sm:w-36 min-h-[36px] rounded-xl border border-[#27272E] bg-[#0A0A0A] px-3 font-mono text-xs text-amber-400"
                  />
                )}
              </div>
            )}

            {addonOptions.length > 0 && (
              <div className="divide-y divide-[#27272E] border border-[#27272E] rounded-xl overflow-hidden mt-2 bg-[#0A0A0A]">
                {addonOptions.map((ex) => {
                  const multi = ex.allowMultiple !== false;
                  const linkedInv = ex.inventoryItemId ? inventoryMap.get(ex.inventoryItemId) : null;
                  return (
                    <div
                      key={ex.id}
                      className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 text-sm"
                    >
                      <div className="min-w-0">
                        <span className="font-medium text-zinc-200 block">{ex.name}</span>
                        {linkedInv && (
                          <span className="text-[11px] font-mono text-zinc-400">
                            Descuenta {formatInventoryQuantity(ex.inventoryQuantity || 0, linkedInv.unit)} de {linkedInv.name}
                          </span>
                        )}
                      </div>
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
          <section className="rounded-xl border border-[#27272E] bg-[#101014] p-3.5 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <ImageIcon className="w-4 h-4 text-amber-400 shrink-0" />
                <p className="text-xs font-bold text-white">Foto del producto (opcional)</p>
              </div>
              <span className="text-[11px] text-zinc-400 hidden sm:inline">
                Compresión automática WebP
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
                      placeholder="/menu/mixta.webp o https://..."
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
