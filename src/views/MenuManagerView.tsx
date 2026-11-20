import React, { useMemo, useState } from 'react';
import { Droplets, Edit3, Lock, Plus, Search } from 'lucide-react';
import { usePosStore } from '../services/posStore';
import type { Product } from '../types/pos';
import { formatCurrency } from '../utils/orderMath';
import { resolveAssetUrl } from '../utils/assetPath';
import { ProductEditorModal } from '../components/ProductEditorModal';

export const MenuManagerView: React.FC = () => {
  const {
    products,
    sauces,
    isAdmin,
    toggleProductActive,
    saveSauce,
    toggleSauceActive,
  } = usePosStore();

  const [selectedCategory, setSelectedCategory] = useState('Todas');
  const [searchTerm, setSearchTerm] = useState('');
  const [editingProduct, setEditingProduct] = useState<Product | null | undefined>(undefined);

  const [newSauceName, setNewSauceName] = useState('');
  const [savingSauce, setSavingSauce] = useState(false);
  const [sauceError, setSauceError] = useState<string | null>(null);

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

  if (!isAdmin) {
    return (
      <div className="bg-[#141418] border border-[#27272E] rounded-2xl p-10 text-center max-w-lg mx-auto my-8 space-y-3">
        <Lock className="w-10 h-10 text-amber-400 mx-auto" />
        <h1 className="font-poster text-2xl font-extrabold text-white tracking-wide">
          ACCESO ADMINISTRATIVO REQUERIDO
        </h1>
        <p className="text-sm text-zinc-400">
          Solo la cuenta Administradora puede agregar o editar productos, recetas, bebidas y salsas del sistema. Tu cuenta actual tiene permisos de Mesero.
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
                Las salsas activas aparecen para que los meseros elijan entre 1 y 4 salsas al tomar pedidos.
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
            <button
              key={sauce.id}
              type="button"
              onClick={() => toggleSauceActive(sauce.id, !sauce.active)}
              className={`min-h-[38px] px-3 rounded-xl border text-xs font-semibold flex items-center gap-2 transition-colors ${
                sauce.active
                  ? 'bg-[#1C1C22] border-amber-500/60 text-white hover:border-amber-400'
                  : 'bg-[#0A0A0A] border-[#27272E] text-zinc-500 line-through'
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
                    .map((a) => `${a.name} (+${formatCurrency(a.price)})`)
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
                className={`min-h-[42px] px-3.5 rounded-xl border text-xs font-semibold transition-colors ${
                  product.active
                    ? 'border-emerald-700 bg-emerald-950/60 text-emerald-300 hover:bg-emerald-950'
                    : 'border-[#27272E] bg-[#1C1C22] text-zinc-400'
                }`}
              >
                {product.active ? 'Activo' : 'Inactivo'}
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
    </div>
  );
};
