import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Ban,
  Camera,
  Image as ImageIcon,
  Lock,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { usePosStore } from '../services/posStore';
import type { TransferReceipt } from '../types/pos';
import { formatCurrency, formatDateTimeShort } from '../utils/orderMath';
import { ROLE_LABELS } from '../utils/rolePermissions';

interface Props {
  onOpenViewer: (index: number, filteredIds?: string[]) => void;
  onOpenWaiterPicker: () => void;
}

export const TransfersGalleryView: React.FC<Props> = ({
  onOpenViewer,
  onOpenWaiterPicker,
}) => {
  const {
    transfers,
    orders,
    activeWaiter,
    effectiveRole,
    permissions,
    attachReceiptToOrder,
    voidTransferReceipt,
    deleteTransferReceipt,
  } = usePosStore();

  const [galleryTab, setGalleryTab] = useState<'activos' | 'anulaciones'>('activos');
  const [statusFilter, setStatusFilter] = useState<'todas' | 'pagado' | 'pendiente'>('todas');
  const [searchTerm, setSearchTerm] = useState('');

  const [showAttach, setShowAttach] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [attachNotes, setAttachNotes] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const [voidTarget, setVoidTarget] = useState<TransferReceipt | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<TransferReceipt | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleBackIntercept = (e: Event) => {
      if (deleteTarget) {
        e.preventDefault();
        if (!actionBusy) {
          setDeleteTarget(null);
          setActionError(null);
        }
      } else if (voidTarget) {
        e.preventDefault();
        if (!actionBusy) {
          setVoidTarget(null);
          setVoidReason('');
          setActionError(null);
        }
      } else if (showAttach) {
        e.preventDefault();
        if (!uploading) {
          setShowAttach(false);
        }
      }
    };
    window.addEventListener('ondeluigi:back-intercept', handleBackIntercept);
    return () => window.removeEventListener('ondeluigi:back-intercept', handleBackIntercept);
  }, [deleteTarget, voidTarget, showAttach, actionBusy, uploading]);

  const activeCount = useMemo(
    () => transfers.filter((t) => !t.annulled).length,
    [transfers]
  );
  const annulledCount = useMemo(
    () => transfers.filter((t) => Boolean(t.annulled)).length,
    [transfers]
  );

  const filteredTransfers = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return transfers.filter((t) => {
      const isAnnulled = Boolean(t.annulled);
      if (galleryTab === 'activos' && isAnnulled) return false;
      if (galleryTab === 'anulaciones' && !isAnnulled) return false;

      if (galleryTab === 'activos' && statusFilter !== 'todas' && t.paymentStatus !== statusFilter) {
        return false;
      }
      if (q) {
        return (
          String(t.orderNumber).includes(q) ||
          t.orderReference.toLowerCase().includes(q) ||
          t.waiterName.toLowerCase().includes(q) ||
          t.notes.toLowerCase().includes(q) ||
          (t.annulledReason || '').toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [transfers, galleryTab, statusFilter, searchTerm]);

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

  const handleConfirmVoid = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!voidTarget) return;
    setActionBusy(true);
    setActionError(null);
    try {
      await voidTransferReceipt(voidTarget.id, voidReason);
      setVoidTarget(null);
      setVoidReason('');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'No se pudo anular el comprobante.');
    } finally {
      setActionBusy(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setActionBusy(true);
    setActionError(null);
    try {
      await deleteTransferReceipt(deleteTarget.id);
      setDeleteTarget(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'No se pudo eliminar el comprobante.');
    } finally {
      setActionBusy(false);
    }
  };

  if (!permissions.canViewTransfers) {
    return (
      <div className="bg-[#141418] border border-[#27272E] rounded-2xl p-10 text-center max-w-lg mx-auto my-8 space-y-3">
        <Lock className="w-10 h-10 text-amber-400 mx-auto" />
        <h1 className="font-poster text-2xl font-extrabold text-white tracking-wide">
          ACCESO RESTRINGIDO
        </h1>
        <p className="text-sm text-zinc-400">
          Tu rol actual (<strong className="text-white">{ROLE_LABELS[effectiveRole]}</strong>) no tiene acceso a pagos ni comprobantes de transferencia.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="font-poster text-3xl sm:text-4xl font-extrabold tracking-wide text-white leading-none">
            PAGOS Y TRANSFERENCIAS
          </h1>
          <p className="text-xs text-zinc-400 mt-1 tabular-nums">
            {activeCount} comprobantes activos · {annulledCount} en registro de anulaciones
          </p>
        </div>

        {permissions.canUploadReceipts && (
          <button
            type="button"
            onClick={() => {
              setSelectedOrderId(candidateOrders[0]?.id || '');
              setUploadError(null);
              setShowAttach(true);
            }}
            className="min-h-[44px] px-4 rounded-xl bg-amber-500 text-black text-xs font-bold hover:bg-amber-400 flex items-center justify-center gap-2 whitespace-nowrap shrink-0"
          >
            <Upload className="w-4 h-4" />
            <span>Adjuntar comprobante</span>
          </button>
        )}
      </div>

      {/* Main Sub-Tabs: Active Gallery vs Annulled Registry */}
      <div className="flex items-center gap-1 p-1 bg-[#141418] border border-[#27272E] rounded-xl self-start w-full sm:w-auto sm:inline-flex">
        <button
          type="button"
          onClick={() => setGalleryTab('activos')}
          className={`flex-1 sm:flex-initial min-h-[38px] px-4 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
            galleryTab === 'activos'
              ? 'bg-amber-500 text-black font-bold'
              : 'text-zinc-300 hover:text-white'
          }`}
        >
          Galería activa ({activeCount})
        </button>
        <button
          type="button"
          onClick={() => setGalleryTab('anulaciones')}
          className={`flex-1 sm:flex-initial min-h-[38px] px-4 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
            galleryTab === 'anulaciones'
              ? 'bg-red-600 text-white font-bold'
              : 'text-zinc-300 hover:text-white'
          }`}
        >
          Registro de anulaciones ({annulledCount})
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
        {galleryTab === 'activos' && (
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
        )}
      </div>

      {/* Gallery Grid */}
      {filteredTransfers.length === 0 ? (
        <div className="bg-[#141418] border border-[#27272E] rounded-2xl p-10 text-center space-y-3">
          <ImageIcon className="w-10 h-10 text-zinc-600 mx-auto" />
          <p className="text-base font-bold text-white">
            {galleryTab === 'activos'
              ? 'No hay comprobantes fotográficos activos'
              : 'No hay comprobantes en el registro de anulaciones'}
          </p>
          <p className="text-sm text-zinc-400 max-w-sm mx-auto">
            {galleryTab === 'activos'
              ? 'Cuando registres un pago por transferencia con foto de cámara o galería, aparecerá aquí.'
              : 'Los comprobantes anulados por cualquier integrante aparecen aquí sin perder su rastro.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3.5">
          {filteredTransfers.map((tr, idx) => (
            <div
              key={tr.id}
              className={`rounded-2xl overflow-hidden border bg-[#141418] flex flex-col ${
                tr.annulled ? 'border-red-900/70' : 'border-[#27272E]'
              }`}
            >
              <button
                type="button"
                onClick={() =>
                  onOpenViewer(
                    idx,
                    filteredTransfers.map((item) => item.id)
                  )
                }
                aria-label={`Abrir comprobante pedido #${tr.orderNumber} por ${formatCurrency(tr.amount)}`}
                className="group relative aspect-[3/4] w-full overflow-hidden bg-[#0A0A0A] text-left focus:outline-none focus:ring-2 focus:ring-amber-500"
              >
                <img
                  src={tr.imageUrl}
                  alt={`Comprobante pedido #${tr.orderNumber}`}
                  referrerPolicy="no-referrer"
                  className={`w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-200 ${
                    tr.annulled ? 'opacity-65 grayscale-[40%]' : ''
                  }`}
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/35 to-transparent p-2.5 sm:p-3 flex flex-col justify-between">
                  <div className="flex items-center justify-between gap-1">
                    <span className="px-2 py-0.5 rounded bg-black/75 border border-white/15 text-amber-400 font-mono text-[11px] font-bold tabular-nums">
                      #{tr.orderNumber}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] sm:text-[11px] font-bold ${
                        tr.annulled
                          ? 'bg-red-600 text-white'
                          : tr.paymentStatus === 'pagado'
                            ? 'bg-emerald-600 text-white'
                            : 'bg-amber-500 text-black'
                      }`}
                    >
                      {tr.annulled
                        ? 'Anulado'
                        : tr.paymentStatus === 'pagado'
                          ? 'Pagado'
                          : 'Pendiente'}
                    </span>
                  </div>

                  <div className="space-y-0.5 text-white">
                    <p
                      className={`font-mono text-sm sm:text-base font-extrabold tabular-nums ${
                        tr.annulled ? 'text-red-300 line-through' : 'text-amber-400'
                      }`}
                    >
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

              {tr.annulled && (tr.annulledByName || tr.annulledReason) && (
                <div className="px-2.5 py-2 bg-red-950/40 border-t border-red-900/50 text-[11px] text-red-200 space-y-0.5">
                  <p className="font-semibold truncate">
                    Anuló: {tr.annulledByName || 'Equipo'}
                  </p>
                  {tr.annulledReason && (
                    <p className="text-red-300/90 line-clamp-2">{tr.annulledReason}</p>
                  )}
                </div>
              )}

              {((!tr.annulled && permissions.canVoidReceipts) || permissions.canHardDelete) && (
                <div className="p-2 border-t border-[#27272E] bg-[#101014] flex items-center gap-1.5">
                  {!tr.annulled && permissions.canVoidReceipts && (
                    <button
                      type="button"
                      onClick={() => {
                        setActionError(null);
                        setVoidReason('');
                        setVoidTarget(tr);
                      }}
                      className="flex-1 min-h-[34px] px-2 rounded-lg border border-amber-700/70 bg-amber-950/40 text-amber-300 text-[11px] font-semibold hover:bg-amber-950 flex items-center justify-center gap-1"
                    >
                      <Ban className="w-3 h-3 shrink-0" />
                      <span>Anular</span>
                    </button>
                  )}

                  {permissions.canHardDelete && (
                    <button
                      type="button"
                      aria-label={`Eliminar rastro comprobante #${tr.orderNumber}`}
                      onClick={() => {
                        setActionError(null);
                        setDeleteTarget(tr);
                      }}
                      className={`${
                        tr.annulled || !permissions.canVoidReceipts ? 'flex-1' : 'px-2.5'
                      } min-h-[34px] rounded-lg border border-red-800 bg-red-950/40 text-red-300 text-[11px] font-semibold hover:bg-red-950 flex items-center justify-center gap-1`}
                    >
                      <Trash2 className="w-3 h-3 shrink-0" />
                      {(tr.annulled || !permissions.canVoidReceipts) && <span>Eliminar rastro</span>}
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Attach Receipt Modal */}
      {showAttach && permissions.canUploadReceipts && (
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

      {/* Void Transfer Receipt Modal */}
      {voidTarget && permissions.canVoidReceipts && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-sm sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="void-transfer-title"
        >
          <form
            onSubmit={handleConfirmVoid}
            className="w-full sm:max-w-md bg-[#141418] text-white rounded-t-3xl sm:rounded-2xl border border-[#27272E] shadow-2xl overflow-hidden"
          >
            <div className="px-5 py-4 border-b border-[#27272E] flex items-center justify-between bg-[#101014]">
              <div className="flex items-center gap-2">
                <Ban className="w-5 h-5 text-amber-400 shrink-0" />
                <h2 id="void-transfer-title" className="font-poster text-xl font-extrabold tracking-wide uppercase">
                  ANULAR COMPROBANTE #{voidTarget.orderNumber}
                </h2>
              </div>
              <button
                type="button"
                disabled={actionBusy}
                onClick={() => setVoidTarget(null)}
                aria-label="Cerrar"
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-zinc-400 hover:bg-[#1C1C22]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {actionError && (
                <div className="rounded-xl bg-red-950/60 border border-red-700 px-3 py-2 text-xs font-medium text-red-200">
                  {actionError}
                </div>
              )}

              <p className="text-xs text-zinc-300 leading-relaxed">
                El comprobante del pedido <strong>#{voidTarget.orderNumber} ({voidTarget.orderReference})</strong> saldrá de la galería principal pero quedará guardado en el <strong>Registro de anulaciones</strong>.
              </p>

              <div>
                <label htmlFor="void-transfer-reason" className="block text-xs font-semibold text-zinc-300 mb-1">
                  Motivo (opcional)
                </label>
                <input
                  id="void-transfer-reason"
                  type="text"
                  maxLength={160}
                  value={voidReason}
                  onChange={(e) => setVoidReason(e.target.value)}
                  placeholder="Ej. Foto borrosa, transferencia repetida..."
                  className="w-full min-h-[42px] rounded-xl border border-[#27272E] bg-[#0A0A0A] px-3 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  disabled={actionBusy}
                  onClick={() => setVoidTarget(null)}
                  className="min-h-[44px] rounded-xl border border-[#27272E] bg-[#1C1C22] text-sm font-semibold text-zinc-200 hover:border-zinc-500"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={actionBusy}
                  className="min-h-[44px] rounded-xl bg-amber-500 text-black text-sm font-bold hover:bg-amber-400 disabled:opacity-50"
                >
                  {actionBusy ? 'Anulando...' : 'Confirmar anulación'}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* Hard Delete Transfer Receipt Modal (Admin Only) */}
      {deleteTarget && permissions.canHardDelete && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-sm sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-transfer-title"
        >
          <div className="w-full sm:max-w-md bg-[#141418] text-white rounded-t-3xl sm:rounded-2xl border border-[#27272E] shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-[#27272E] flex items-center justify-between bg-[#101014]">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-red-400 shrink-0" />
                <h2 id="delete-transfer-title" className="font-poster text-xl font-extrabold tracking-wide uppercase">
                  ELIMINAR RASTRO DE COMPROBANTE
                </h2>
              </div>
              <button
                type="button"
                disabled={actionBusy}
                onClick={() => setDeleteTarget(null)}
                aria-label="Cerrar"
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-zinc-400 hover:bg-[#1C1C22]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {actionError && (
                <div className="rounded-xl bg-red-950/60 border border-red-700 px-3 py-2 text-xs font-medium text-red-200">
                  {actionError}
                </div>
              )}

              <p className="text-sm text-zinc-200 leading-relaxed">
                ¿Eliminar definitivamente este comprobante del pedido{' '}
                <strong className="text-amber-400">#{deleteTarget.orderNumber}</strong>? No quedará rastro en la galería ni en el registro de anulaciones.
              </p>

              <div className="grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  disabled={actionBusy}
                  onClick={() => setDeleteTarget(null)}
                  className="min-h-[44px] rounded-xl border border-[#27272E] bg-[#1C1C22] text-sm font-semibold text-zinc-200 hover:border-zinc-500"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={actionBusy}
                  onClick={handleConfirmDelete}
                  className="min-h-[44px] rounded-xl bg-red-600 text-white text-sm font-bold hover:bg-red-500 disabled:opacity-50"
                >
                  {actionBusy ? 'Eliminando...' : 'Eliminar rastro'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

