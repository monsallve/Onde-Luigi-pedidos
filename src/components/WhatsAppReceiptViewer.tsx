import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { TransferReceipt } from '../types/pos';
import { formatCurrency, formatDateTimeShort } from '../utils/orderMath';

interface Props {
  receipts: TransferReceipt[];
  initialIndex: number;
  onClose: () => void;
  onInspectOrder?: (orderId: string) => void;
}

export const WhatsAppReceiptViewer: React.FC<Props> = ({
  receipts,
  initialIndex,
  onClose,
  onInspectOrder,
}) => {
  const [index, setIndex] = useState(
    Math.max(0, Math.min(initialIndex, receipts.length - 1))
  );
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);

  const dragStartRef = useRef({ x: 0, y: 0, origX: 0, origY: 0 });
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);

  const current = receipts[index];

  const resetZoom = useCallback(() => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  }, []);

  const goPrev = useCallback(() => {
    if (index > 0) {
      setIndex((i) => i - 1);
      resetZoom();
    }
  }, [index, resetZoom]);

  const goNext = useCallback(() => {
    if (index < receipts.length - 1) {
      setIndex((i) => i + 1);
      resetZoom();
    }
  }, [index, receipts.length, resetZoom]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') goPrev();
      if (e.key === 'ArrowRight') goNext();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, goPrev, goNext]);

  if (!current) return null;

  const handleZoomIn = () => setZoom((z) => Math.min(3.5, Number((z + 0.75).toFixed(2))));
  const handleZoomOut = () => {
    setZoom((z) => {
      const next = Math.max(1, Number((z - 0.75).toFixed(2)));
      if (next === 1) setOffset({ x: 0, y: 0 });
      return next;
    });
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      touchStartRef.current = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
        time: Date.now(),
      };
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!touchStartRef.current || zoom > 1.1) {
      touchStartRef.current = null;
      return;
    }
    const endX = e.changedTouches[0].clientX;
    const dx = endX - touchStartRef.current.x;
    const dt = Date.now() - touchStartRef.current.time;
    touchStartRef.current = null;
    if (dt < 500 && Math.abs(dx) > 55) {
      if (dx < 0) goNext();
      else goPrev();
    }
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (zoom <= 1) return;
    setDragging(true);
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      origX: offset.x,
      origY: offset.y,
    };
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragging || zoom <= 1) return;
    setOffset({
      x: dragStartRef.current.origX + (e.clientX - dragStartRef.current.x),
      y: dragStartRef.current.origY + (e.clientY - dragStartRef.current.y),
    });
  };

  const handlePointerUp = () => setDragging(false);

  return (
    <div
      className="fixed inset-0 z-50 bg-black text-white flex flex-col select-none"
      role="dialog"
      aria-modal="true"
      aria-label={`Visor de comprobante pedido ${current.orderNumber}`}
    >
      {/* Top Overlay Header */}
      <div className="relative z-20 flex items-center justify-between gap-3 px-4 py-3 bg-gradient-to-b from-black/85 via-black/50 to-transparent">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar visor de comprobantes"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
          <div className="min-w-0">
            <p className="text-sm font-bold text-white truncate">
              Pedido #{current.orderNumber} · {current.orderReference}
            </p>
            <p className="text-xs text-slate-300 font-mono tabular-nums">
              {formatDateTimeShort(current.createdAtMs)} · {index + 1} de {receipts.length}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={handleZoomOut}
            disabled={zoom <= 1}
            aria-label="Alejar imagen"
            className="min-h-[42px] min-w-[42px] flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-40 text-white transition-colors"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <span className="font-mono text-xs font-semibold px-1.5 tabular-nums">
            {zoom.toFixed(1)}x
          </span>
          <button
            type="button"
            onClick={handleZoomIn}
            disabled={zoom >= 3.5}
            aria-label="Ampliar imagen"
            className="min-h-[42px] min-w-[42px] flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-40 text-white transition-colors"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          {zoom > 1 && (
            <button
              type="button"
              onClick={resetZoom}
              aria-label="Restablecer zoom"
              className="min-h-[42px] min-w-[42px] flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Image Stage */}
      <div
        className="relative flex-1 flex items-center justify-center overflow-hidden touch-none"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onDoubleClick={() => {
          if (zoom > 1) resetZoom();
          else setZoom(2.25);
        }}
      >
        <img
          src={current.imageUrl}
          alt={`Comprobante pedido #${current.orderNumber}`}
          draggable={false}
          referrerPolicy="no-referrer"
          style={{
            transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${zoom})`,
          }}
          className={`max-h-[75vh] max-w-[94vw] object-contain rounded-lg transition-transform ${
            dragging ? 'duration-0 cursor-grabbing' : 'duration-200'
          } ${zoom > 1 ? 'cursor-grab' : 'cursor-zoom-in'}`}
        />

        {/* Prev / Next Navigation Buttons */}
        <button
          type="button"
          onClick={goPrev}
          disabled={index === 0}
          aria-label="Comprobante anterior"
          className="absolute left-3 top-1/2 -translate-y-1/2 min-h-[48px] min-w-[48px] flex items-center justify-center rounded-full bg-black/60 border border-white/15 text-white hover:bg-black/85 disabled:opacity-25 transition-colors"
        >
          <ChevronLeft className="w-6 h-6" />
        </button>

        <button
          type="button"
          onClick={goNext}
          disabled={index >= receipts.length - 1}
          aria-label="Siguiente comprobante"
          className="absolute right-3 top-1/2 -translate-y-1/2 min-h-[48px] min-w-[48px] flex items-center justify-center rounded-full bg-black/60 border border-white/15 text-white hover:bg-black/85 disabled:opacity-25 transition-colors"
        >
          <ChevronRight className="w-6 h-6" />
        </button>
      </div>

      {/* Bottom Metadata Scrim */}
      <div className="relative z-20 px-4 sm:px-6 py-4 bg-gradient-to-t from-black/95 via-black/80 to-transparent pb-safe">
        <div className="max-w-3xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-mono text-xl font-bold text-white tabular-nums">
                {formatCurrency(current.amount)}
              </span>
              <span
                className={`px-2 py-0.5 rounded text-xs font-semibold ${
                  current.paymentStatus === 'pagado'
                    ? 'bg-emerald-600 text-white'
                    : 'bg-amber-600 text-white'
                }`}
              >
                {current.paymentStatus === 'pagado' ? 'Pagado' : 'Pendiente'}
              </span>
              <span className="text-xs text-slate-300">
                Registró: <strong className="text-white">{current.waiterName}</strong>
              </span>
            </div>
            {current.notes && (
              <p className="text-xs text-slate-300">{current.notes}</p>
            )}
          </div>

          {onInspectOrder && (
            <button
              type="button"
              onClick={() => onInspectOrder(current.orderId)}
              className="min-h-[42px] px-4 rounded-xl bg-white text-slate-900 text-xs font-semibold hover:bg-slate-200 transition-colors whitespace-nowrap shrink-0"
            >
              Ver pedido #{current.orderNumber}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
