import React, { useRef, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  FileDown,
  Image as ImageIcon,
  Upload,
  X,
} from 'lucide-react';
import { usePosStore } from '../services/posStore';
import type { Order, PaymentMethod, PaymentStatus } from '../types/pos';
import {
  DEFAULT_CUSTOMER_DOCUMENT,
  DEFAULT_CUSTOMER_NAME,
} from '../utils/billingUtils';
import { formatCurrency } from '../utils/orderMath';
import { downloadOrderReceiptPdf } from '../utils/receiptPdf';
import { CustomerOrderField, type CustomerOrderValue } from './CustomerOrderField';

interface Props {
  order: Order;
  onClose: () => void;
  onOpenWaiterPicker: () => void;
}

export const PaymentSheetModal: React.FC<Props> = ({
  order,
  onClose,
  onOpenWaiterPicker,
}) => {
  const { activeWaiter, openShift, customers, billingConfig, updateOrderPayment } = usePosStore();
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>(
    order.paymentStatus === 'pendiente' ? (openShift ? 'pagado' : 'pendiente') : order.paymentStatus
  );
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(
    order.paymentMethod || 'transferencia'
  );
  const [customerValue, setCustomerValue] = useState<CustomerOrderValue>({
    id: order.customerId,
    documentNumber: order.customerDocument || DEFAULT_CUSTOMER_DOCUMENT,
    name: order.customerName || DEFAULT_CUSTOMER_NAME,
    phone: order.customerPhone || '',
    email: order.customerEmail || '',
  });
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string>('');
  const [receiptNotes, setReceiptNotes] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!openShift) {
      setErrorMsg('Abre un turno en la barra superior antes de confirmar un pago.');
      return;
    }
    setReceiptFile(file);
    setPaymentStatus('pagado');
    setPaymentMethod('transferencia');
    const reader = new FileReader();
    reader.onload = () => setPreviewUrl(String(reader.result));
    reader.readAsDataURL(file);
  };

  const handleSave = async () => {
    if (!activeWaiter) {
      setErrorMsg('Selecciona tu nombre de mesero antes de registrar el pago.');
      onOpenWaiterPicker();
      return;
    }
    if (paymentStatus === 'pagado' && !openShift) {
      setErrorMsg('Debes abrir un turno en la barra superior antes de confirmar el pago.');
      return;
    }
    setSaving(true);
    setErrorMsg(null);
    try {
      await updateOrderPayment({
        orderId: order.id,
        paymentStatus,
        paymentMethod: paymentStatus === 'pagado' ? paymentMethod || 'efectivo' : paymentMethod,
        customer: customerValue,
        receiptFile,
        receiptNotes,
      });
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'No se pudo actualizar el pago.');
    } finally {
      setSaving(false);
    }
  };

  const handleDownloadColilla = async () => {
    setDownloadingPdf(true);
    try {
      const previewOrder: Order = {
        ...order,
        customerId: customerValue.id,
        customerDocument: customerValue.documentNumber,
        customerName: customerValue.name,
        customerPhone: customerValue.phone,
        customerEmail: customerValue.email,
      };
      await downloadOrderReceiptPdf(previewOrder, billingConfig);
    } finally {
      setDownloadingPdf(false);
    }
  };

  const payBlocked = paymentStatus === 'pagado' && !openShift;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-sm sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="payment-modal-title"
    >
      <div className="w-full sm:max-w-md bg-[#141418] text-white rounded-t-3xl sm:rounded-2xl border border-[#27272E] shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
        <div className="px-5 py-4 border-b border-[#27272E] flex items-center justify-between bg-[#101014]">
          <div>
            <p className="text-xs font-medium text-amber-400">
              Pedido #{order.orderNumber} · {order.reference}
            </p>
            <h2 id="payment-modal-title" className="font-poster text-xl font-extrabold text-white tracking-wide">
              COBRO Y COMPROBANTE
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar ventana de cobro"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-zinc-400 hover:bg-[#1C1C22] hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-5">
          {!openShift && (
            <div className="rounded-xl bg-amber-950/50 border border-amber-600/70 px-3.5 py-2.5 text-xs text-amber-200 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <span>
                <strong>Turno cerrado:</strong> no se pueden confirmar pagos ni finalizar comandas hasta que abras un turno desde la barra superior.
              </span>
            </div>
          )}

          {errorMsg && (
            <div className="rounded-xl bg-red-950/60 border border-red-700 px-3 py-2 text-xs font-medium text-red-200">
              {errorMsg}
            </div>
          )}

          <div className="flex items-center justify-between bg-[#0A0A0A] border border-[#27272E] rounded-xl px-4 py-3">
            <span className="text-sm font-medium text-zinc-300">Valor total</span>
            <span className="font-mono text-xl font-bold text-amber-400 tabular-nums">
              {formatCurrency(order.total)}
            </span>
          </div>

          <CustomerOrderField
            value={customerValue}
            onChange={setCustomerValue}
            customers={customers}
            compact
          />

          <div>
            <p className="text-xs font-bold text-zinc-300 mb-2">Estado de pago</p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={!openShift}
                onClick={() => setPaymentStatus('pagado')}
                className={`min-h-[46px] rounded-xl border text-sm font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                  paymentStatus === 'pagado'
                    ? 'bg-emerald-600 border-emerald-500 text-white'
                    : 'bg-[#1C1C22] border-[#27272E] text-zinc-300 hover:border-zinc-500'
                }`}
              >
                Pagado
              </button>
              <button
                type="button"
                onClick={() => setPaymentStatus('pendiente')}
                className={`min-h-[46px] rounded-xl border text-sm font-bold transition-colors ${
                  paymentStatus === 'pendiente'
                    ? 'bg-amber-500 border-amber-400 text-black'
                    : 'bg-[#1C1C22] border-[#27272E] text-zinc-300 hover:border-zinc-500'
                }`}
              >
                Por cobrar
              </button>
            </div>
          </div>

          <div>
            <p className="text-xs font-bold text-zinc-300 mb-2">Medio de pago</p>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  { id: 'efectivo', label: 'Efectivo' },
                  { id: 'transferencia', label: 'Transferencia' },
                  { id: 'tarjeta', label: 'Tarjeta' },
                  { id: 'otro', label: 'Otro' },
                ] as { id: PaymentMethod; label: string }[]
              ).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setPaymentMethod(m.id)}
                  className={`min-h-[44px] rounded-xl border text-sm font-semibold transition-colors ${
                    paymentMethod === m.id
                      ? 'bg-amber-500 border-amber-400 text-black font-bold'
                      : 'bg-[#1C1C22] border-[#27272E] text-zinc-300 hover:border-zinc-500'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3 border-t border-[#27272E] pt-4">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold text-zinc-300">
                Comprobante fotográfico de transferencia
              </p>
              <span className="text-[11px] text-zinc-400">Compresión automática</span>
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
                disabled={!openShift}
                onClick={() => cameraRef.current?.click()}
                className="min-h-[46px] rounded-xl border border-[#27272E] bg-[#1C1C22] text-xs font-semibold text-white flex items-center justify-center gap-2 hover:border-zinc-500 disabled:opacity-40"
              >
                <Camera className="w-4 h-4 text-amber-400" />
                <span>Abrir cámara</span>
              </button>
              <button
                type="button"
                disabled={!openShift}
                onClick={() => galleryRef.current?.click()}
                className="min-h-[46px] rounded-xl border border-[#27272E] bg-[#1C1C22] text-xs font-semibold text-white flex items-center justify-center gap-2 hover:border-zinc-500 disabled:opacity-40"
              >
                <ImageIcon className="w-4 h-4 text-zinc-300" />
                <span>Desde galería</span>
              </button>
            </div>

            {previewUrl && (
              <div className="rounded-xl border border-[#27272E] p-3 bg-[#0A0A0A] space-y-2">
                <div className="flex items-center gap-3">
                  <img
                    src={previewUrl}
                    alt="Comprobante seleccionado"
                    className="w-16 h-20 object-cover rounded-lg border border-[#27272E] bg-[#141418]"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-emerald-400 flex items-center gap-1">
                      <Upload className="w-3.5 h-3.5" />
                      <span>Listo para optimizar y subir</span>
                    </p>
                    <p className="text-[11px] text-zinc-400 truncate mt-0.5">
                      {receiptFile?.name}
                    </p>
                  </div>
                  <button
                    type="button"
                    aria-label="Quitar imagen"
                    onClick={() => {
                      setReceiptFile(null);
                      setPreviewUrl('');
                    }}
                    className="min-h-[40px] min-w-[40px] flex items-center justify-center text-zinc-400 hover:text-red-400"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div>
                  <label htmlFor="receipt-ref-note" className="sr-only">
                    Referencia de transferencia
                  </label>
                  <input
                    id="receipt-ref-note"
                    type="text"
                    maxLength={250}
                    value={receiptNotes}
                    onChange={(e) => setReceiptNotes(e.target.value)}
                    placeholder="Ej. Nequi / Bancolombia Ref. 987654..."
                    className="w-full min-h-[40px] rounded-lg border border-[#27272E] bg-[#141418] px-3 text-xs text-white placeholder:text-zinc-500"
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="px-5 py-4 border-t border-[#27272E] bg-[#101014] flex flex-col sm:flex-row gap-2">
          <button
            type="button"
            disabled={downloadingPdf}
            onClick={() => void handleDownloadColilla()}
            className="min-h-[46px] px-3.5 rounded-xl border border-[#27272E] bg-[#1C1C22] text-zinc-200 text-xs font-bold hover:border-amber-500 flex items-center justify-center gap-1.5 whitespace-nowrap"
          >
            <FileDown className="w-4 h-4 text-amber-400" />
            <span>{downloadingPdf ? 'Generando...' : 'Colilla PDF'}</span>
          </button>
          <button
            type="button"
            disabled={saving || payBlocked}
            onClick={handleSave}
            className="flex-1 min-h-[46px] rounded-xl bg-amber-500 text-black text-sm font-bold hover:bg-amber-400 disabled:opacity-50 flex items-center justify-center gap-2 transition-colors"
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>
              {saving
                ? 'Optimizando y guardando...'
                : paymentStatus === 'pagado'
                  ? 'Confirmar como Pagado'
                  : 'Guardar como Por cobrar'}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};
