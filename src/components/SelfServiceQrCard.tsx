import React, { useMemo, useState } from 'react';
import { Check, Copy, Landmark, QrCode, Smartphone } from 'lucide-react';
import type { SelfServicePaymentConfig } from '../types/pos';
import { formatCurrency } from '../utils/orderMath';
import { buildDeterministicQrMatrix } from '../utils/selfServiceMath';

interface Props {
  config: SelfServicePaymentConfig;
  amount: number;
}

export const SelfServiceQrCard: React.FC<Props> = ({ config, amount }) => {
  const [copiedKey, setCopiedKey] = useState(false);

  const qrMatrix = useMemo(
    () =>
      buildDeterministicQrMatrix(
        `BREB|${config.brebKey}|${config.accountHolder}|${Math.round(amount)}`
      ),
    [config.brebKey, config.accountHolder, amount]
  );

  const handleCopyKey = async () => {
    const keyToCopy = config.brebKey.trim();
    if (!keyToCopy) return;
    try {
      await navigator.clipboard.writeText(keyToCopy);
      setCopiedKey(true);
      window.setTimeout(() => setCopiedKey(false), 2400);
    } catch {
      setCopiedKey(false);
    }
  };

  return (
    <div className="rounded-2xl border border-amber-500/40 bg-[#101014] p-4 space-y-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <QrCode className="w-4 h-4 text-amber-400 shrink-0" />
          <span className="text-xs font-extrabold uppercase tracking-wider text-amber-400">
            Pago Digital · QR / Llave Bre-B
          </span>
        </div>
        <span className="px-2.5 py-1 rounded-lg bg-amber-500/15 border border-amber-500/40 font-mono text-xs font-extrabold text-amber-300 tabular-nums">
          Total: {formatCurrency(amount)}
        </span>
      </div>

      <div className="flex flex-col items-center gap-3.5">
        <div className="w-36 h-36 rounded-2xl bg-white p-2.5 shadow-lg border border-zinc-200 flex items-center justify-center shrink-0 overflow-hidden">
          {config.qrImageUrl ? (
            <img
              src={config.qrImageUrl}
              alt="Código QR oficial para transferencia"
              className="w-full h-full object-contain"
            />
          ) : (
            <svg
              viewBox={`0 0 ${qrMatrix.length} ${qrMatrix.length}`}
              role="img"
              aria-label={`Código QR de pago para llave ${config.brebKey}`}
              className="w-full h-full"
              shapeRendering="crispEdges"
            >
              <rect width={qrMatrix.length} height={qrMatrix.length} fill="#FFFFFF" />
              {qrMatrix.map((row, r) =>
                row.map((filled, c) =>
                  filled ? (
                    <rect
                      key={`${r}-${c}`}
                      x={c}
                      y={r}
                      width={1}
                      height={1}
                      fill="#09090B"
                    />
                  ) : null
                )
              )}
            </svg>
          )}
        </div>

        <div className="w-full min-w-0 space-y-2.5">
          <div className="rounded-xl border border-[#27272E] bg-[#0A0A0A] p-3 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wide flex items-center gap-1.5 min-w-0">
                <Smartphone className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span className="truncate">Llave Bre-B / Cuenta</span>
              </span>
              <button
                type="button"
                onClick={handleCopyKey}
                className="min-h-[30px] px-2.5 rounded-lg bg-amber-500 text-black text-[11px] font-bold hover:bg-amber-400 inline-flex items-center gap-1 shrink-0 whitespace-nowrap transition-colors"
              >
                {copiedKey ? (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    <span>¡Copiada!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copiar llave</span>
                  </>
                )}
              </button>
            </div>
            <p className="font-mono text-base font-extrabold text-white tracking-wide break-all select-all">
              {config.brebKey}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-xl border border-[#27272E] bg-[#0A0A0A] px-3 py-2 min-w-0">
              <span className="text-[10px] uppercase tracking-wider text-zinc-500 block">
                Titular
              </span>
              <span className="font-semibold text-zinc-100 truncate block">
                {config.accountHolder}
              </span>
            </div>
            <div className="rounded-xl border border-[#27272E] bg-[#0A0A0A] px-3 py-2 min-w-0">
              <span className="text-[10px] uppercase tracking-wider text-zinc-500 flex items-center gap-1">
                <Landmark className="w-3 h-3 text-amber-400 shrink-0" />
                <span className="truncate">Banco / Billetera</span>
              </span>
              <span className="font-semibold text-zinc-100 truncate block">
                {config.bankName}
              </span>
            </div>
          </div>
        </div>
      </div>

      {config.paymentInstructions && (
        <p className="text-xs text-zinc-300 leading-relaxed bg-[#0A0A0A] border border-[#27272E] rounded-xl px-3 py-2">
          {config.paymentInstructions}
        </p>
      )}
    </div>
  );
};
