import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Droplets, Edit3, Lock, Plus, Search, Trash2, X } from 'lucide-react';
import { usePosStore } from '../services/posStore';
import type { Product } from '../types/pos';
import { formatCurrency, resolveAssetUrl } from '../utils/orderMath';
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
    effectiveRole,
    permissions,
    toggleProductActive,
    deleteProduct,
    saveSauce,
    toggleSauceActive,
    deleteSauce,
  } = usePosStore();

  const [selectedCategory, setSelectedCategory] = useState('Todas');
  const [searchTerm, setSearchTerm] = useState('');
  const [editingProduct, setEditingProduct] = useState<Product | null | undefined>(undefined);

  const [newSauceName, setNewSauceName] = useState('');
  const [savingSauce, setSavingSauce] = useState(false);
  const [sauceError, setSauceError] = useState<string | null>(null);

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
      } else if (editingProduct !== undefined) {
        e.preventDefault();
        setEditingProduct(undefined);
      }
    };
    window.addEventListener('ondeluigi:back-intercept', handleBackIntercept);
    return () => window.removeEventListener('ondeluigi:back-intercept', handleBackIntercept);
  }, [pendingDelete, deleting, editingProduct]);

  const categories = useMemo(() => {
    const set = new Set(products.map((p) => p.category));
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

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="font-poster text-3xl sm:text-4xl font-extrabold tracking-wide text-white leading-none">
            MENÚ, RECETAS, BEBIDAS Y SALSAS
          </h1>
          <p className="text-xs text-zinc-400 mt-1 tabular-nums">
            Panel exclusivo Administrador · {products.filter((p) => p.active).length} productos activos ·{' '}
            {sauces.filter((s) => s.active).length} salsas activas
          </p>
        </div>

        <button
          type="button"
          onClick={() => setEditingProduct(null)}
          className="min-h-[46px] px-5 rounded-xl bg-amber-500 text-black text-sm font-bold hover:bg-amber-400 flex items-center justify-center gap-2 whitespace-nowrap shrink-0 shadow-sm"
        >
          <Plus className="w-4 h-4" />
          <span>Nuevo producto o bebida</span>
        </button>
      </div>

      {/* Sauces Management Card */}
      <section className="bg-[#141418] border border-[#27272E] rounded-2xl p-4 sm:p-5 space-y-3.5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Droplets className="w-5 h-5 text-amber-400 shrink-0" />
            <div>
              <h2 className="font-poster text-xl font-extrabold text-white tracking-wide leading-none">
                SALSAS DEL SISTEMA (SELECCIÓN 1 A 4 POR PRODUCTO)
              </h2>
              <p className="text-xs text-zinc-400 mt-0.5">
                Toca el nombre para activar/desactivar, o usa el ícono de papelera para eliminar una salsa definitivamente.
              </p>
            </div>
          </div>
        </div>

        {sauceError && (
          <div className="rounded-xl bg-red-950/60 border border-red-700 px-3 py-2 text-xs font-medium text-red-200">
            {sauceError}
          </div>
        )}

        <form onSubmit={handleAddSauce} className="flex gap-2">
          <input
            type="text"
            aria-label="Nombre de nueva salsa"
            value={newSauceName}
            onChange={(e) => setNewSauceName(e.target.value)}
            placeholder="Ej. Salsa Maíz, Chipotle, Miel Mostaza..."
            className="flex-1 min-h-[42px] rounded-xl border border-[#27272E] bg-[#0A0A0A] px-3 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
          />
          <button
            type="submit"
            disabled={savingSauce}
            className="min-h-[42px] px-4 rounded-xl bg-red-600 text-white text-xs font-bold hover:bg-red-500 flex items-center gap-1.5 whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>{savingSauce ? 'Agregando...' : 'Agregar salsa'}</span>
          </button>
        </form>

        <div className="flex flex-wrap gap-2">
          {sauces.map((sauce) => (
            <div
              key={sauce.id}
              className={`inline-flex items-center rounded-xl border overflow-hidden transition-colors ${
                sauce.active
                  ? 'bg-[#1C1C22] border-amber-500/60 text-white'
                  : 'bg-[#0A0A0A] border-[#27272E] text-zinc-500'
              }`}
            >
              <button
                type="button"
                onClick={() => toggleSauceActive(sauce.id, !sauce.active)}
                className={`min-h-[38px] px-3 text-xs font-semibold flex items-center gap-2 hover:bg-white/5 ${
                  !sauce.active ? 'line-through' : ''
                }`}
              >
                <span>{sauce.name}</span>
                <span
                  className={`text-[10px] font-mono uppercase px-1.5 py-0.5 rounded ${
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
                className="min-h-[38px] min-w-[36px] flex items-center justify-center border-l border-[#27272E] text-red-400 hover:bg-red-950/60"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* Filters */}
      <div className="bg-[#141418] border border-[#27272E] rounded-2xl p-3.5 flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="search"
            aria-label="Buscar producto en catálogo"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Buscar producto, bebida o categoría..."
            className="w-full min-h-[42px] pl-9 pr-3 rounded-xl border border-[#27272E] bg-[#0A0A0A] text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
          />
        </div>
        <div className="flex items-center gap-1 p-1 bg-[#0A0A0A] border border-[#27272E] rounded-xl overflow-x-auto">
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

      {/* Product Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-stretch">
        {filtered.map((product) => (
          <article
            key={product.id}
            className={`bg-[#141418] border rounded-2xl p-4 flex flex-col justify-between gap-4 ${
              product.active ? 'border-[#27272E]' : 'border-[#27272E] opacity-60'
            }`}
          >
            <div className="space-y-3">
              <div className="flex items-start gap-3">
                {product.imageUrl && (
                  <img
                    src={resolveAssetUrl(product.imageUrl)}
                    alt={product.name}
                    className="w-16 h-16 rounded-xl object-cover object-top border border-[#27272E] shrink-0"
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

              {product.baseRecipe.length > 0 && (
                <p className="text-xs text-zinc-400 leading-relaxed">
                  <strong className="text-zinc-200">Receta base:</strong>{' '}
                  {product.baseRecipe.join(' · ')}
                </p>
              )}

              {product.removableOptions.length > 0 && (
                <p className="text-xs text-red-300 leading-relaxed">
                  <strong>Se puede quitar:</strong>{' '}
                  {product.removableOptions.map((r) => `Sin ${r}`).join(', ')}
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

            <div className="flex items-center gap-2 pt-2 border-t border-[#27272E]">
              <button
                type="button"
                onClick={() => setEditingProduct(product)}
                className="flex-1 min-h-[42px] px-3 rounded-xl border border-[#27272E] bg-[#1C1C22] text-xs font-semibold text-white hover:border-amber-500 flex items-center justify-center gap-1.5"
              >
                <Edit3 className="w-3.5 h-3.5 text-amber-400" />
                <span>Editar receta</span>
              </button>

              <button
                type="button"
                onClick={() => toggleProductActive(product.id, !product.active)}
                className={`min-h-[42px] px-3 rounded-xl border text-xs font-semibold transition-colors ${
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
                className="min-h-[42px] min-w-[42px] flex items-center justify-center rounded-xl border border-red-900/70 bg-red-950/40 text-red-400 hover:bg-red-950"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </article>
        ))}
      </div>

      {editingProduct !== undefined && (
        <ProductEditorModal
          product={editingProduct}
          onClose={() => setEditingProduct(undefined)}
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

