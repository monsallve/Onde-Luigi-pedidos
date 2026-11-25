import React, { useMemo } from 'react';
import {
  AlertCircle,
  Droplets,
  Edit3,
  Minus,
  Plus,
  Search,
  SlidersHorizontal,
  Split,
  Trash2,
} from 'lucide-react';
import type { OrderItem, Product } from '../types/pos';
import {
  formatCurrency,
  formatCustomizationSummary,
  formatWithoutIngredientLabel,
  getAddonQuantity,
  resolveAssetUrl,
} from '../utils/orderMath';

interface ProductCatalogPanelProps {
  products: Product[];
  itemsInOrder: OrderItem[];
  topProductIds?: Set<string>;
  categories: string[];
  selectedCategory: string;
  onSelectCategory: (cat: string) => void;
  searchTerm: string;
  onSearchChange: (term: string) => void;
  onQuickAdd: (product: Product) => void;
  onCustomize: (product: Product) => void;
  compactHeader?: boolean;
}

export const ProductCatalogPanel: React.FC<ProductCatalogPanelProps> = React.memo(({
  products,
  itemsInOrder,
  topProductIds,
  categories,
  selectedCategory,
  onSelectCategory,
  searchTerm,
  onSearchChange,
  onQuickAdd,
  onCustomize,
  compactHeader = false,
}) => {
  const orderQtyByProductId = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of itemsInOrder) {
      map.set(item.productId, (map.get(item.productId) || 0) + item.quantity);
    }
    return map;
  }, [itemsInOrder]);

  return (
    <div className="space-y-3.5">
      <div className="bg-[#141418] border border-[#27272E] rounded-2xl p-3 space-y-2.5">
        <div className="relative">
          <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="search"
            aria-label="Buscar producto en el menú"
            value={searchTerm}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Buscar hamburguesa, perro, papas o bebida..."
            className="w-full min-h-[42px] pl-9 pr-3 rounded-xl border border-[#27272E] bg-[#0A0A0A] text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
          />
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => onSelectCategory(cat)}
              className={`min-h-[34px] px-3 rounded-xl text-xs font-bold border whitespace-nowrap shrink-0 transition-colors ${
                selectedCategory === cat
                  ? 'bg-amber-500 text-black border-amber-400'
                  : 'bg-[#1C1C22] text-zinc-300 border-[#27272E] hover:border-zinc-500'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {products.length === 0 ? (
        <div className="bg-[#141418] border border-[#27272E] rounded-2xl p-10 text-center text-sm text-zinc-400">
          No hay productos activos que coincidan con tu búsqueda.
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2.5 sm:gap-3.5">
          {products.map((product) => {
            const countInOrder = orderQtyByProductId.get(product.id) || 0;

            const hasCustomization =
              product.allowSauces ||
              product.removableOptions.length > 0 ||
              product.addonOptions.length > 0;

            const isTopProduct = Boolean(topProductIds?.has(product.id));

            return (
              <article
                key={product.id}
                className={`bg-[#141418] border rounded-2xl overflow-hidden flex flex-col justify-between transition-colors ${
                  countInOrder > 0 ? 'border-amber-500/80' : 'border-[#27272E]'
                }`}
              >
                {product.imageUrl && (
                  <div
                    className={`relative ${
                      compactHeader ? 'h-20 sm:h-28' : 'h-24 sm:h-36'
                    } bg-[#0A0A0A] overflow-hidden border-b border-[#27272E]`}
                  >
                    <img
                      src={resolveAssetUrl(product.imageUrl)}
                      alt={product.name}
                      loading="lazy"
                      decoding="async"
                      className="w-full h-full object-cover object-top"
                    />
                    {isTopProduct && (
                      <span className="absolute top-1.5 left-1.5 sm:top-2.5 sm:left-2.5 px-2 py-0.5 rounded-lg bg-[#0A0A0A]/85 border border-amber-500/60 text-amber-300 text-[10px] font-bold uppercase tracking-wide shadow">
                        Más pedido
                      </span>
                    )}
                    {countInOrder > 0 && (
                      <span className="absolute top-1.5 right-1.5 sm:top-2.5 sm:right-2.5 px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-lg bg-amber-500 text-black font-mono text-[10px] sm:text-xs font-extrabold tabular-nums shadow">
                        {countInOrder} en pedido
                      </span>
                    )}
                  </div>
                )}

                <div className="p-2.5 sm:p-3.5 flex-1 flex flex-col justify-between gap-2 sm:gap-3">
                  <div>
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-0.5 sm:gap-2">
                      <div className="min-w-0">
                        <p className="text-[10px] sm:text-[11px] font-semibold text-zinc-400 uppercase tracking-wide truncate">
                          {product.category}
                          {!product.imageUrl && isTopProduct ? ' · Top' : ''}
                          {!product.imageUrl && countInOrder > 0 ? ` · ${countInOrder}` : ''}
                        </p>
                        <h3 className="font-poster text-sm sm:text-lg font-extrabold text-white leading-tight uppercase mt-0.5 line-clamp-2">
                          {product.name}
                        </h3>
                      </div>
                      <span className="font-mono text-xs sm:text-base font-bold text-amber-400 tabular-nums shrink-0">
                        {formatCurrency(product.basePrice)}
                      </span>
                    </div>

                    {product.baseRecipe.length > 0 && (
                      <p className="hidden sm:block text-xs text-zinc-400 mt-1.5 line-clamp-2 leading-relaxed">
                        {product.baseRecipe.join(' · ')}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 sm:gap-2 pt-0.5">
                    <button
                      type="button"
                      onClick={() => onQuickAdd(product)}
                      className="flex-1 min-w-0 min-h-[40px] sm:min-h-[44px] px-2 rounded-xl bg-amber-500 text-black text-[11px] sm:text-xs font-bold hover:bg-amber-400 transition-colors flex items-center justify-center gap-1"
                    >
                      <Plus className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
                      <span>Agregar</span>
                    </button>

                    {hasCustomization && (
                      <button
                        type="button"
                        onClick={() => onCustomize(product)}
                        aria-label={`Personalizar ${product.name}`}
                        className="min-h-[40px] sm:min-h-[44px] px-2 sm:px-3 rounded-xl border border-[#27272E] bg-[#1C1C22] text-zinc-200 text-[11px] sm:text-xs font-semibold hover:border-zinc-500 flex items-center gap-1 whitespace-nowrap shrink-0"
                      >
                        <SlidersHorizontal className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                        <span>Receta</span>
                      </button>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
});

interface OrderCartItemsListProps {
  items: OrderItem[];
  productMap: Map<string, Product>;
  onUpdateQty: (lineId: string, delta: number) => void;
  onSplitUnit: (lineId: string) => void;
  onEditItem: (item: OrderItem) => void;
  onRemoveItem: (lineId: string) => void;
}

export const OrderCartItemsList: React.FC<OrderCartItemsListProps> = React.memo(({
  items,
  productMap,
  onUpdateQty,
  onSplitUnit,
  onEditItem,
  onRemoveItem,
}) => {
  if (items.length === 0) {
    return (
      <div className="text-center py-8 border border-dashed border-[#27272E] rounded-xl bg-[#0A0A0A]/60 px-4">
        <p className="text-sm font-semibold text-zinc-200">Comanda vacía</p>
        <p className="text-xs text-zinc-400 mt-1">
          Toca <strong>Agregar</strong> en los productos que quiera el cliente y luego ajusta lo que no lleva y sus salsas.
        </p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-[#27272E] border border-[#27272E] rounded-xl overflow-hidden bg-[#1C1C22]">
      {items.map((item) => {
        const customSummary = formatCustomizationSummary(item);
        const prod = productMap.get(item.productId);
        const needsSauces =
          Boolean(prod?.allowSauces) &&
          (item.selectedSauces?.length || 0) < (prod?.minSauces ?? 1);

        return (
          <div key={item.lineId} className="p-3.5 space-y-2.5">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-bold text-white leading-snug">{item.productName}</p>
                {item.removedIngredients.length > 0 && (
                  <p className="text-xs text-red-300 font-medium mt-0.5">
                    ({item.removedIngredients.map((r) => formatWithoutIngredientLabel(r)).join(', ')})
                  </p>
                )}
                {item.selectedSauces.length > 0 && (
                  <p className="text-xs text-amber-300 font-medium mt-0.5 flex items-center gap-1">
                    <Droplets className="w-3 h-3 shrink-0" />
                    <span>
                      Salsas ({item.selectedSauces.length}/4): {item.selectedSauces.join(', ')}
                    </span>
                  </p>
                )}
                {(item.addedExtras.length > 0 || item.customNote) && (
                  <p className="text-xs text-emerald-300 mt-0.5">
                    {[
                      ...item.addedExtras.map((e) => {
                        const qty = getAddonQuantity(e);
                        return qty > 1 ? `+${qty}x ${e.name}` : `+${e.name}`;
                      }),
                      item.customNote ? `Nota: "${item.customNote}"` : '',
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                )}
                {!customSummary && !needsSauces && (
                  <p className="text-[11px] text-zinc-400 mt-0.5">Receta estándar</p>
                )}
                {needsSauces && (
                  <p className="text-[11px] font-semibold text-amber-400 flex items-center gap-1 mt-1">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    <span>Elige de 1 a 4 salsas</span>
                  </p>
                )}
              </div>
              <span className="font-mono text-sm font-bold text-amber-400 tabular-nums shrink-0">
                {formatCurrency(item.lineTotal)}
              </span>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
              <div className="flex items-center border border-[#27272E] bg-[#0A0A0A] rounded-lg overflow-hidden">
                <button
                  type="button"
                  aria-label={`Restar 1 ${item.productName}`}
                  onClick={() => onUpdateQty(item.lineId, -1)}
                  className="min-h-[34px] min-w-[34px] flex items-center justify-center text-zinc-300 hover:bg-[#1C1C22]"
                >
                  <Minus className="w-3.5 h-3.5" />
                </button>
                <span className="w-7 text-center font-mono text-xs font-bold text-white tabular-nums">
                  {item.quantity}
                </span>
                <button
                  type="button"
                  aria-label={`Sumar 1 ${item.productName}`}
                  onClick={() => onUpdateQty(item.lineId, 1)}
                  className="min-h-[34px] min-w-[34px] flex items-center justify-center text-zinc-300 hover:bg-[#1C1C22]"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="flex items-center gap-1.5">
                {item.quantity > 1 && (
                  <button
                    type="button"
                    onClick={() => onSplitUnit(item.lineId)}
                    title="Separar 1 unidad para personalizar diferente"
                    className="min-h-[34px] px-2 rounded-lg border border-[#27272E] bg-[#0A0A0A] text-[11px] font-semibold text-zinc-300 hover:text-white flex items-center gap-1"
                  >
                    <Split className="w-3 h-3" />
                    <span>Separar 1</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onEditItem(item)}
                  className={`min-h-[34px] px-2.5 rounded-lg border text-xs font-bold flex items-center gap-1 transition-colors ${
                    needsSauces
                      ? 'border-amber-400 bg-amber-500 text-black'
                      : 'border-[#27272E] bg-[#0A0A0A] text-white hover:border-amber-500'
                  }`}
                >
                  <Edit3 className="w-3 h-3" />
                  <span>Receta / Salsas</span>
                </button>
                <button
                  type="button"
                  aria-label={`Quitar ${item.productName}`}
                  onClick={() => onRemoveItem(item.lineId)}
                  className="min-h-[34px] min-w-[34px] flex items-center justify-center rounded-lg text-red-400 hover:bg-red-950/60"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
});
