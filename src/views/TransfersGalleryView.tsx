import React, { useMemo, useRef, useState } from 'react';
import { Camera, Image as ImageIcon, Search, Upload, X } from 'lucide-react';
import { usePosStore } from '../services/posStore';
import { formatCurrency, formatDateTimeShort } from '../utils/orderMath';

interface Props {
  onOpenViewer: (index: number, filteredIds?: string[]) => void;
  onOpenWaiterPicker: () => void;
}

export const TransfersGalleryView: React.FC<Props> = ({
  onOpenViewer,
  onOpenWaiterPicker,
}) => {
  const { transfers, orders, activeWaiter, attachReceiptToOrder } = usePosStore();
  const [statusFilter, setStatusFilter] = useState<'todas' | 'pagado' | 'pendiente'>('todas');
  const [searchTerm, setSearchTerm] = useState('');

  const [showAttach, setShowAttach] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [attachNotes, setAttachNotes] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  const filteredTransfers = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return transfers.filter((t) => {
      if (statusFilter !== 'todas' && t.paymentStatus !== statusFilter) {
        return false;
      }
      if (q) {
        return (
          String(t.orderNumber).includes(q) ||
          t.orderReference.toLowerCase().includes(q) ||
          t.waiterName.toLowerCase().includes(q) ||
          t.notes.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [transfers, statusFilter, searchTerm]);

  const candidateOrders = useMemo(
    () => orders.filter((o) => o.status !== 'cancelado'),
    [orders]
  );

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSelectedFile(file);
    const reader = new FileReader();
    reader.onload = () => setPreviewUrl(String(reader.result));
    reader.readAsDataURL(file);
  };

  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeWaiter) {
      onOpenWaiterPicker();
      return;
    }
    if (!selectedOrderId || !selectedFile) {
      setUploadError('Selecciona un pedido y una foto del comprobante.');
      return;
    }
    const order = orders.find((o) => o.id === selectedOrderId);
    if (!order) return;

    setUploading(true);
    setUploadError(null);
    try {
      await attachReceiptToOrder({
        orderId: order.id,
        file: selectedFile,
        amount: order.total,
        notes: attachNotes,
      });
      setShowAttach(false);
      setSelectedFile(null);
      setPreviewUrl('');
      setAttachNotes('');
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'No se pudo subir el comprobante.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="font-poster text-3xl sm:text-4xl font-extrabold tracking-wide text-white leading-none">
            GALERÍA DE TRANSFERENCIAS
          </h1>
          <p className="text-xs text-zinc-400 mt-1 tabular-nums">
            {transfers.length} comprobantes · Toca cualquier foto para abrir el visor con zoom
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            setSelectedOrderId(candidateOrders[0]?.id || '');
            setShowAttach(true);
          }}
          className="min-h-[44px] px-4 rounded-xl bg-amber-500 text-black text-xs font-bold hover:bg-amber-400 flex items-center justify-center gap-2 whitespace-nowrap shrink-0"
        >
          <Upload className="w-4 h-4" />
          <span>Adjuntar comprobante</span>
        </button>
      </div>

      {/* Filters */}
      <div className="bg-[#141418] border border-[#27272E] rounded-2xl p-3.5 flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="search"
            aria-label="Buscar comprobante por pedido, mesa o referencia"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Buscar por #pedido, cliente, mesero o referencia..."
            className="w-full min-h-[42px] pl-9 pr-3 rounded-xl border border-[#27272E] bg-[#0A0A0A] text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
          />
        </div>
        <div className="flex items-center gap-1 p-1 bg-[#0A0A0A] border border-[#27272E] rounded-xl self-start sm:self-auto">
          {(
            [
              { id: 'todas', label: 'Todas' },
              { id: 'pagado', label: 'Pagadas' },
              { id: 'pendiente', label: 'Pendientes' },
            ] as const
          ).map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setStatusFilter(f.id)}
              className={`min-h-[34px] px-3 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                statusFilter === f.id
                  ? 'bg-amber-500 text-black font-bold'
                  : 'text-zinc-300 hover:text-white'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Gallery Grid */}
      {filteredTransfers.length === 0 ? (
        <div className="bg-[#141418] border border-[#27272E] rounded-2xl p-10 text-center space-y-3">
          <ImageIcon className="w-10 h-10 text-zinc-600 mx-auto" />
          <p className="text-base font-bold text-white">
            No hay comprobantes fotográficos registrados
          </p>
          <p className="text-sm text-zinc-400 max-w-sm mx-auto">
            Cuando registres un pago por transferencia con foto de cámara o galería, aparecerá aquí.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3.5">
          {filteredTransfers.map((tr, idx) => (
            <button
              key={tr.id}
              type="button"
              onClick={() =>
                onOpenViewer(
                  idx,
                  filteredTransfers.map((item) => item.id)
                )
              }
              aria-label={`Abrir comprobante pedido #${tr.orderNumber} por ${formatCurrency(tr.amount)}`}
              className="group relative aspect-[3/4] rounded-2xl overflow-hidden border border-[#27272E] bg-[#0A0A0A] text-left focus:outline-none focus:ring-2 focus:ring-amber-500"
            >
              <img
                src={tr.imageUrl}
                alt={`Comprobante pedido #${tr.orderNumber}`}
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-200"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/35 to-transparent p-3 flex flex-col justify-between">
                <div className="flex items-center justify-between gap-1">
                  <span className="px-2 py-0.5 rounded bg-black/75 border border-white/15 text-amber-400 font-mono text-[11px] font-bold tabular-nums">
                    #{tr.orderNumber}
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                      tr.paymentStatus === 'pagado'
                        ? 'bg-emerald-600 text-white'
                        : 'bg-amber-500 text-black'
                    }`}
                  >
                    {tr.paymentStatus === 'pagado' ? 'Pagado' : 'Pendiente'}
                  </span>
                </div>

                <div className="space-y-0.5 text-white">
                  <p className="font-mono text-base font-extrabold text-amber-400 tabular-nums">
                    {formatCurrency(tr.amount)}
                  </p>
                  <p className="text-xs font-semibold text-zinc-100 truncate">
                    {tr.orderReference}
                  </p>
                  <p className="text-[11px] text-zinc-300 truncate">
                    {tr.waiterName} · {formatDateTimeShort(tr.createdAtMs)}
                  </p>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Attach Receipt Modal */}
      {showAttach && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-sm sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="attach-receipt-title"
        >
          <form
            onSubmit={handleUploadSubmit}
            className="w-full sm:max-w-md bg-[#141418] text-white rounded-t-3xl sm:rounded-2xl border border-[#27272E] shadow-2xl overflow-hidden"
          >
            <div className="px-5 py-4 border-b border-[#27272E] flex items-center justify-between bg-[#101014]">
              <h2 id="attach-receipt-title" className="font-poster text-xl font-extrabold text-white tracking-wide">
                SUBIR COMPROBANTE
              </h2>
              <button
                type="button"
                onClick={() => setShowAttach(false)}
                aria-label="Cerrar"
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-zinc-400 hover:bg-[#1C1C22]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {uploadError && (
                <div className="rounded-xl bg-red-950/60 border border-red-700 px-3 py-2 text-xs font-medium text-red-200">
                  {uploadError}
                </div>
              )}

              <div>
                <label htmlFor="attach-order-select" className="block text-xs font-semibold text-zinc-300 mb-1">
                  Pedido asociado
                </label>
                <select
                  id="attach-order-select"
                  value={selectedOrderId}
                  onChange={(e) => setSelectedOrderId(e.target.value)}
                  className="w-full min-h-[44px] rounded-xl border border-[#27272E] bg-[#0A0A0A] px-3 text-sm text-white"
                >
                  {candidateOrders.map((o) => (
                    <option key={o.id} value={o.id}>
                      #{o.orderNumber} · {o.reference} ({formatCurrency(o.total)})
                    </option>
                  ))}
                </select>
              </div>

              <input
                ref={cameraRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handleFile}
                className="hidden"
              />
              <input
                ref={galleryRef}
                type="file"
                accept="image/*"
                onChange={handleFile}
                className="hidden"
              />

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => cameraRef.current?.click()}
                  className="min-h-[46px] rounded-xl border border-[#27272E] bg-[#1C1C22] text-xs font-semibold text-white flex items-center justify-center gap-2 hover:border-zinc-500"
                >
                  <Camera className="w-4 h-4 text-amber-400" />
                  <span>Cámara</span>
                </button>
                <button
                  type="button"
                  onClick={() => galleryRef.current?.click()}
                  className="min-h-[46px] rounded-xl border border-[#27272E] bg-[#1C1C22] text-xs font-semibold text-white flex items-center justify-center gap-2 hover:border-zinc-500"
                >
                  <ImageIcon className="w-4 h-4 text-zinc-300" />
                  <span>Galería</span>
                </button>
              </div>

              {previewUrl && (
                <div className="flex items-center gap-3 p-2.5 border border-[#27272E] rounded-xl bg-[#0A0A0A]">
                  <img
                    src={previewUrl}
                    alt="Vista previa"
                    className="w-14 h-16 object-cover rounded-lg border border-[#27272E]"
                  />
                  <input
                    type="text"
                    value={attachNotes}
                    onChange={(e) => setAttachNotes(e.target.value)}
                    placeholder="Ref. o banco (opcional)"
                    className="flex-1 min-h-[40px] rounded-lg border border-[#27272E] bg-[#141418] px-2.5 text-xs text-white"
                  />
                </div>
              )}

              <button
                type="submit"
                disabled={uploading || !selectedFile}
                className="w-full min-h-[48px] rounded-xl bg-amber-500 text-black text-sm font-bold hover:bg-amber-400 disabled:opacity-50"
              >
                {uploading ? 'Optimizando y guardando...' : 'Guardar comprobante y marcar Pagado'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
