import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ChevronDown, Copy, Droplets, Edit3, Lock, Plus, Search, Trash2, X } from 'lucide-react';
import { usePosStore } from '../services/posStore';
import type { Product } from '../types/pos';
import { formatCurrency, formatWithoutIngredientLabel, resolveAssetUrl } from '../utils/orderMath';
import {
  calculateProductRecipeCost,
  formatInventoryQuantity,
  isRecipeSpecInventoriable,
} from '../utils/inventoryMath';
import { ROLE_LABELS } from '../utils/rolePermissions';
import { ProductEditorModal } from '../components/ProductEditorModal';

interface PendingMenuDelete {
  kind: 'product' | 'sauce';
  id: string;
  name: string;
}

export const MenuManagerView: React.FC = () => {
  const {
    products,
    sauces,
    inventory,
    effectiveRole,
    permissions,
    toggleProductActive,
    deleteProduct,
    saveSauce,
    toggleSauceActive,
    deleteSauce,
  } = usePosStore();

  const inventoryMap = useMemo(
    () => new Map(inventory.map((i) => [i.id, i])),
    [inventory]
  );

  const [selectedCategory, setSelectedCategory] = useState('Todas');
  const [searchTerm, setSearchTerm] = useState('');
  const [editorState, setEditorState] = useState<
    | { mode: 'closed' }
    | { mode: 'create' }
    | { mode: 'edit'; product: Product }
    | { mode: 'copy'; source: Product }
  >({ mode: 'closed' });

  const [newSauceName, setNewSauceName] = useState('');
  const [savingSauce, setSavingSauce] = useState(false);
  const [sauceError, setSauceError] = useState<string | null>(null);
  const [saucesDropdownOpen, setSaucesDropdownOpen] = useState(false);

  const [pendingDelete, setPendingDelete] = useState<PendingMenuDelete | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    const handleBackIntercept = (e: Event) => {
      if (pendingDelete) {
        e.preventDefault();
        if (!deleting) {
          setPendingDelete(null);
          setDeleteError(null);
        }
      } else if (editorState.mode !== 'closed') {
        e.preventDefault();
        setEditorState({ mode: 'closed' });
      }
    };
    window.addEventListener('ondeluigi:back-intercept', handleBackIntercept);
    return () => window.removeEventListener('ondeluigi:back-intercept', handleBackIntercept);
  }, [pendingDelete, deleting, editorState.mode]);

  const categories = useMemo(() => {
    const set = new Set(products.map((p) => p.category.trim()).filter(Boolean));
    return ['Todas', ...Array.from(set)];
  }, [products]);

  const filtered = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return products.filter((p) => {
      const catMatch = selectedCategory === 'Todas' || p.category === selectedCategory;
      const qMatch =
        !q || p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q);
      return catMatch && qMatch;
    });
  }, [products, selectedCategory, searchTerm]);

  if (!permissions.canManageMenu) {
    return (
      <div className="bg-[#141418] border border-[#27272E] rounded-2xl p-10 text-center max-w-lg mx-auto my-8 space-y-3">
        <Lock className="w-10 h-10 text-amber-400 mx-auto" />
        <h1 className="font-poster text-2xl font-extrabold text-white tracking-wide">
          ACCESO ADMINISTRATIVO REQUERIDO
        </h1>
        <p className="text-sm text-zinc-400">
          Solo las cuentas Administradoras pueden agregar, editar o eliminar productos, recetas, bebidas y salsas del sistema. Tu rol actual es <strong className="text-white">{ROLE_LABELS[effectiveRole]}</strong>.
        </p>
      </div>
    );
  }

  const handleAddSauce = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSauceName.trim()) return;
    setSavingSauce(true);
    setSauceError(null);
    try {
      await saveSauce(newSauceName);
      setNewSauceName('');
    } catch (err) {
      setSauceError(err instanceof Error ? err.message : 'No se pudo agregar la salsa.');
    } finally {
      setSavingSauce(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      if (pendingDelete.kind === 'product') {
        await deleteProduct(pendingDelete.id);
      } else {
        await deleteSauce(pendingDelete.id);
      }
      setPendingDelete(null);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'No se pudo eliminar del menú.');
    } finally {
      setDeleting(false);
    }
  };

  const activeSaucesCount = useMemo(
    () => sauces.filter((s) => s.active).length,
    [sauces]
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        <div className="flex items-baseline gap-2.5 flex-wrap">
          <h1 className="font-poster text-3xl sm:text-4xl font-extrabold tracking-wide text-white leading-none">
            MENÚ Y SALSAS
          </h1>
          <span className="text-xs text-zinc-400 tabular-nums">
            {products.filter((p) => p.active).length} activos · {activeSaucesCount} salsas
          </span>
        </div>

        <button
          type="button"
          onClick={() => setEditorState({ mode: 'create' })}
          className="min-h-[42px] px-4 rounded-xl bg-amber-500 text-black text-xs sm:text-sm font-bold hover:bg-amber-400 flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 shadow-sm"
        >
          <Plus className="w-4 h-4" />
          <span>Nuevo producto</span>
        </button>
      </div>

      {/* Compact Sauces Management Card with Collapsible Dropdown */}
      <section className="bg-[#141418] border border-[#27272E] rounded-xl p-3 sm:p-3.5 space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Droplets className="w-4 h-4 text-amber-400 shrink-0" />
            <h2 className="font-poster text-lg font-extrabold text-white tracking-wide uppercase leading-none truncate">
              MENÚ DE SALSAS
            </h2>
          </div>

          <button
            type="button"
            aria-expanded={saucesDropdownOpen}
            onClick={() => setSaucesDropdownOpen((v) => !v)}
            className="min-h-[32px] px-3 rounded-lg border border-[#27272E] bg-[#0A0A0A] text-xs font-semibold text-zinc-200 hover:border-amber-500 flex items-center gap-1.5 shrink-0"
          >
            <span className="tabular-nums">
              {saucesDropdownOpen ? 'Ocultar' : `Salsas (${activeSaucesCount}/${sauces.length})`}
            </span>
            <ChevronDown
              className={`w-3.5 h-3.5 text-amber-400 transition-transform ${
                saucesDropdownOpen ? 'rotate-180' : ''
              }`}
            />
          </button>
        </div>

        {sauceError && (
          <div className="rounded-lg bg-red-950/60 border border-red-700 px-3 py-1.5 text-xs font-medium text-red-200">
            {sauceError}
          </div>
        )}

        <form onSubmit={handleAddSauce} className="flex gap-2">
          <input
            type="text"
            aria-label="Nombre de nueva salsa"
            value={newSauceName}
            onChange={(e) => setNewSauceName(e.target.value)}
            placeholder="Nueva salsa (ej. Chipotle, Miel Mostaza)..."
            className="flex-1 min-h-[38px] rounded-lg border border-[#27272E] bg-[#0A0A0A] px-3 text-xs sm:text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
          />
          <button
            type="submit"
            disabled={savingSauce}
            className="min-h-[38px] px-3.5 rounded-lg bg-red-600 text-white text-xs font-bold hover:bg-red-500 flex items-center gap-1 whitespace-nowrap shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{savingSauce ? '...' : 'Agregar'}</span>
          </button>
        </form>

        {saucesDropdownOpen && (
          <div className="pt-1 border-t border-[#27272E] flex flex-wrap gap-1.5">
            {sauces.length === 0 ? (
              <p className="text-xs text-zinc-500 py-1">Sin salsas registradas.</p>
            ) : (
              sauces.map((sauce) => (
                <div
                  key={sauce.id}
                  className={`inline-flex items-center rounded-lg border overflow-hidden transition-colors ${
                    sauce.active
                      ? 'bg-[#1C1C22] border-amber-500/60 text-white'
                      : 'bg-[#0A0A0A] border-[#27272E] text-zinc-500'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => toggleSauceActive(sauce.id, !sauce.active)}
                    className={`min-h-[34px] px-2.5 text-xs font-semibold flex items-center gap-1.5 hover:bg-white/5 ${
                      !sauce.active ? 'line-through' : ''
                    }`}
                  >
                    <span>{sauce.name}</span>
                    <span
                      className={`text-[10px] font-mono uppercase px-1 py-0.5 rounded ${
                        sauce.active ? 'bg-emerald-950 text-emerald-300' : 'bg-zinc-900 text-zinc-500'
                      }`}
                    >
                      {sauce.active ? 'Activa' : 'Inactiva'}
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Eliminar salsa ${sauce.name}`}
                    onClick={() => {
                      setDeleteError(null);
                      setPendingDelete({ kind: 'sauce', id: sauce.id, name: sauce.name });
                    }}
                    className="min-h-[34px] min-w-[32px] flex items-center justify-center border-l border-[#27272E] text-red-400 hover:bg-red-950/60"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>
        )}
      </section>

      {/* Filters */}
      <div className="bg-[#141418] border border-[#27272E] rounded-xl p-2.5 flex flex-col sm:flex-row gap-2.5">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="search"
            aria-label="Buscar producto en catálogo"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Buscar producto, bebida o categoría..."
            className="w-full min-h-[38px] pl-9 pr-3 rounded-lg border border-[#27272E] bg-[#0A0A0A] text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
          />
        </div>
        <div className="flex items-center gap-1 p-1 bg-[#0A0A0A] border border-[#27272E] rounded-lg overflow-x-auto">
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setSelectedCategory(cat)}
              className={`min-h-[32px] px-2.5 rounded-md text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
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

      {/* Product Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 items-stretch">
        {filtered.map((product) => (
          <article
            key={product.id}
            className={`bg-[#141418] border rounded-xl p-3.5 flex flex-col justify-between gap-3 ${
              product.active ? 'border-[#27272E]' : 'border-[#27272E] opacity-60'
            }`}
          >
            <div className="space-y-2.5">
              <div className="flex items-start gap-2.5">
                {product.imageUrl && (
                  <img
                    src={resolveAssetUrl(product.imageUrl)}
                    alt={product.name}
                    loading="lazy"
                    decoding="async"
                    className="w-14 h-14 rounded-lg object-cover object-top border border-[#27272E] shrink-0"
                  />
                )}
                <div className="flex-1 min-w-0 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-amber-400">{product.category}</p>
                    <h2 className="font-poster text-xl font-extrabold text-white mt-0.5 uppercase leading-tight">
                      {product.name}
                    </h2>
                  </div>
                  <span className="font-mono text-base font-bold text-amber-400 tabular-nums shrink-0">
                    {formatCurrency(product.basePrice)}
                  </span>
                </div>
              </div>

              <p className="text-xs text-zinc-300">
                <strong className="text-white">Salsas:</strong>{' '}
                {product.allowSauces
                  ? `Elige ${product.minSauces} a ${product.maxSauces} salsas`
                  : 'Sin salsas (Bebida / Fijo)'}
              </p>

              {product.recipeIngredients && product.recipeIngredients.length > 0 ? (
                <div className="space-y-1">
                  <p className="text-xs text-zinc-400 leading-relaxed">
                    <strong className="text-zinc-200">Receta:</strong>{' '}
                    {product.recipeIngredients
                      .map((spec) =>
                        isRecipeSpecInventoriable(spec)
                          ? `${spec.name} (${
                              spec.quantity > 0
                                ? formatInventoryQuantity(spec.quantity, spec.unit)
                                : `0 ${spec.unit}`
                            })`
                          : `${spec.name} (no inv.)`
                      )
                      .join(' · ')}
                  </p>
                  <div className="flex flex-wrap items-center gap-2 text-[11px]">
                    {calculateProductRecipeCost(product.recipeIngredients, inventoryMap) > 0 && (
                      <span className="font-mono font-semibold text-emerald-400 tabular-nums">
                        Costo receta:{' '}
                        {formatCurrency(
                          calculateProductRecipeCost(product.recipeIngredients, inventoryMap)
                        )}
                      </span>
                    )}
                    {product.recipeIngredients.some(
                      (s) => isRecipeSpecInventoriable(s) && s.quantity <= 0
                    ) && (
                      <span className="text-amber-400 font-medium">
                        · Falta asignar gramaje en receta
                      </span>
                    )}
                  </div>
                </div>
              ) : (
                product.baseRecipe.length > 0 && (
                  <p className="text-xs text-zinc-400 leading-relaxed">
                    <strong className="text-zinc-200">Receta base:</strong>{' '}
                    {product.baseRecipe.join(' · ')}
                  </p>
                )
              )}

              {product.removableOptions.length > 0 && (
                <p className="text-xs text-red-300 leading-relaxed">
                  <strong>Quitables:</strong>{' '}
                  {product.removableOptions.map((r) => formatWithoutIngredientLabel(r)).join(', ')}
                </p>
              )}

              {product.addonOptions.length > 0 && (
                <p className="text-xs text-emerald-300 leading-relaxed">
                  <strong>Adiciones:</strong>{' '}
                  {product.addonOptions
                    .map(
                      (a) =>
                        `${a.name} (+${formatCurrency(a.price)}${a.allowMultiple === false ? ', máx. 1' : ''})`
                    )
                    .join(', ')}
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-[#27272E]">
              <button
                type="button"
                onClick={() => setEditorState({ mode: 'edit', product })}
                className="flex-1 min-h-[40px] px-3 rounded-xl border border-[#27272E] bg-[#1C1C22] text-xs font-semibold text-white hover:border-amber-500 flex items-center justify-center gap-1.5 whitespace-nowrap"
              >
                <Edit3 className="w-3.5 h-3.5 text-amber-400" />
                <span>Editar</span>
              </button>

              <button
                type="button"
                onClick={() => setEditorState({ mode: 'copy', source: product })}
                aria-label={`Copiar receta de ${product.name}`}
                className="min-h-[40px] px-3 rounded-xl border border-[#27272E] bg-[#1C1C22] text-xs font-semibold text-zinc-200 hover:border-amber-500 hover:text-amber-300 flex items-center justify-center gap-1.5 whitespace-nowrap"
              >
                <Copy className="w-3.5 h-3.5 text-amber-400" />
                <span>Copiar</span>
              </button>

              <button
                type="button"
                onClick={() => toggleProductActive(product.id, !product.active)}
                className={`min-h-[40px] px-3 rounded-xl border text-xs font-semibold transition-colors whitespace-nowrap ${
                  product.active
                    ? 'border-emerald-700 bg-emerald-950/60 text-emerald-300 hover:bg-emerald-950'
                    : 'border-[#27272E] bg-[#1C1C22] text-zinc-400'
                }`}
              >
                {product.active ? 'Activo' : 'Inactivo'}
              </button>

              <button
                type="button"
                aria-label={`Eliminar producto ${product.name}`}
                onClick={() => {
                  setDeleteError(null);
                  setPendingDelete({ kind: 'product', id: product.id, name: product.name });
                }}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl border border-red-900/70 bg-red-950/40 text-red-400 hover:bg-red-950"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </article>
        ))}
      </div>

      {editorState.mode !== 'closed' && (
        <ProductEditorModal
          product={editorState.mode === 'edit' ? editorState.product : null}
          copySource={editorState.mode === 'copy' ? editorState.source : null}
          onClose={() => setEditorState({ mode: 'closed' })}
        />
      )}

      {/* Confirmation Modal for Product or Sauce Deletion */}
      {pendingDelete && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-sm sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-menu-delete-title"
        >
          <div className="w-full sm:max-w-md bg-[#141418] text-white rounded-t-3xl sm:rounded-2xl border border-[#27272E] shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-[#27272E] flex items-center justify-between bg-[#101014]">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-red-400 shrink-0" />
                <h2 id="confirm-menu-delete-title" className="font-poster text-xl font-extrabold tracking-wide uppercase">
                  {pendingDelete.kind === 'product' ? 'ELIMINAR PRODUCTO' : 'ELIMINAR SALSA'}
                </h2>
              </div>
              <button
                type="button"
                disabled={deleting}
                onClick={() => setPendingDelete(null)}
                aria-label="Cerrar confirmación"
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-zinc-400 hover:bg-[#1C1C22]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {deleteError && (
                <div className="rounded-xl bg-red-950/60 border border-red-700 px-3 py-2 text-xs font-medium text-red-200">
                  {deleteError}
                </div>
              )}

              <p className="text-sm text-zinc-200 leading-relaxed">
                ¿Seguro que deseas eliminar{' '}
                <strong className="text-amber-400">{pendingDelete.name}</strong> del menú? Esta acción no se puede deshacer.
              </p>

              <div className="grid grid-cols-2 gap-2.5 pt-1">
                <button
                  type="button"
                  disabled={deleting}
                  onClick={() => setPendingDelete(null)}
                  className="min-h-[44px] rounded-xl border border-[#27272E] bg-[#1C1C22] text-sm font-semibold text-zinc-200 hover:border-zinc-500"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={deleting}
                  onClick={handleConfirmDelete}
                  className="min-h-[44px] rounded-xl bg-red-600 text-white text-sm font-bold hover:bg-red-500 disabled:opacity-50"
                >
                  {deleting ? 'Eliminando...' : 'Sí, eliminar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

