import type { jsPDF as JsPdfType } from 'jspdf';
import type { BusinessBillingConfig, Order } from '../types/pos';
import {
  buildReceiptFilename,
  buildReceiptItemLineDetails,
  buildReceiptNumber,
  normalizeBillingConfig,
  resolveOrderCustomerInfo,
} from './billingUtils';
import { sanitizePlainText } from './inputSecurity';
import {
  formatCurrency,
  formatDateTimeShort,
  ORDER_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  resolveAssetUrl,
} from './orderMath';

async function loadLogoDataUrl(): Promise<string | null> {
  if (typeof window === 'undefined' || typeof fetch === 'undefined') return null;
  try {
    const url = resolveAssetUrl('/onde-luigi-logo.png');
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const blob = await resp.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('logo read error'));
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/**
 * Generates an immediate-download 80mm POS receipt PDF ("Colilla de compra")
 * containing business tax/DIAN details, customer NIT/Cédula (default 222222222),
 * and full itemized order breakdown.
 */
export async function downloadOrderReceiptPdf(
  order: Order,
  rawBillingConfig?: Partial<BusinessBillingConfig> | null
): Promise<string> {
  const cfg = normalizeBillingConfig(rawBillingConfig);
  const customer = resolveOrderCustomerInfo(order);
  const receiptNo = buildReceiptNumber(order, cfg);
  const filename = buildReceiptFilename(order, cfg);
  const logoDataUrl = await loadLogoDataUrl();
  const safeText = (val: unknown, maxLen = 200) => sanitizePlainText(val, { maxLen });

  const { jsPDF } = await import('jspdf');
  const pageWidth = 80;
  const marginX = 5;
  const contentWidth = pageWidth - marginX * 2;

  // First pass with generous height, then create exact-fit ticket PDF
  const measureDoc = new jsPDF({ unit: 'mm', format: [pageWidth, 297] });

  const drawContent = (doc: JsPdfType): number => {
    let y = 6;

    if (logoDataUrl) {
      try {
        doc.addImage(logoDataUrl, 'PNG', pageWidth / 2 - 7, y, 14, 14);
        y += 16;
      } catch {
        // ignore invalid image decoding
      }
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    const bizLines = doc.splitTextToSize(safeText(cfg.businessName, 120).toUpperCase(), contentWidth);
    doc.text(bizLines, pageWidth / 2, y, { align: 'center' });
    y += bizLines.length * 4.6;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    const headerMeta: string[] = [];
    if (cfg.legalName) headerMeta.push(safeText(cfg.legalName, 120));
    if (cfg.nit) headerMeta.push(`NIT: ${safeText(cfg.nit, 40)}`);
    if (cfg.regime) headerMeta.push(safeText(cfg.regime, 80));
    if (cfg.address) headerMeta.push(safeText(cfg.address, 160));
    if (cfg.city) headerMeta.push(safeText(cfg.city, 80));
    if (cfg.phone) headerMeta.push(`Tel: ${safeText(cfg.phone, 40)}`);
    if (cfg.email) headerMeta.push(safeText(cfg.email, 160));

    for (const line of headerMeta) {
      const wrapped = doc.splitTextToSize(line, contentWidth);
      doc.text(wrapped, pageWidth / 2, y, { align: 'center' });
      y += wrapped.length * 3.5;
    }

    y += 1.5;
    doc.setDrawColor(180);
    doc.setLineDashPattern([1, 1], 0);
    doc.line(marginX, y, pageWidth - marginX, y);
    y += 4;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.text(`COLILLA DE COMPRA ${safeText(receiptNo, 40)}`, pageWidth / 2, y, { align: 'center' });
    y += 4.2;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text(`Pedido: #${order.orderNumber} (${safeText(order.reference, 100)})`, marginX, y);
    y += 3.6;
    doc.text(`Fecha: ${formatDateTimeShort(order.createdAtMs)}`, marginX, y);
    y += 3.6;
    doc.text(`Atendido por: ${safeText(order.waiterName, 80)}`, marginX, y);
    y += 3.6;
    doc.text(`Estado: ${ORDER_STATUS_LABELS[order.status]}`, marginX, y);
    y += 4.2;

    doc.line(marginX, y, pageWidth - marginX, y);
    y += 3.8;

    // Customer block
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.2);
    doc.text('DATOS DEL CLIENTE', marginX, y);
    y += 3.6;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    const custNameLines = doc.splitTextToSize(`Cliente: ${safeText(customer.name, 120)}`, contentWidth);
    doc.text(custNameLines, marginX, y);
    y += custNameLines.length * 3.5;
    doc.text(`NIT / Cédula: ${safeText(customer.documentNumber, 40)}`, marginX, y);
    y += 3.5;
    if (customer.phone) {
      doc.text(`Tel: ${safeText(customer.phone, 40)}`, marginX, y);
      y += 3.5;
    }
    if (customer.email) {
      const emailLines = doc.splitTextToSize(`Correo: ${safeText(customer.email, 160)}`, contentWidth);
      doc.text(emailLines, marginX, y);
      y += emailLines.length * 3.5;
    }

    y += 1;
    doc.line(marginX, y, pageWidth - marginX, y);
    y += 3.8;

    // Items header
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text('CANT  PRODUCTO', marginX, y);
    doc.text('TOTAL', pageWidth - marginX, y, { align: 'right' });
    y += 3.6;

    doc.setFont('helvetica', 'normal');
    for (const item of order.items) {
      const titleText = `${item.quantity}x ${safeText(item.productName, 100)}`;
      const titleLines = doc.splitTextToSize(titleText, contentWidth - 18);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.text(titleLines, marginX, y);
      doc.text(formatCurrency(item.lineTotal), pageWidth - marginX, y, { align: 'right' });
      y += titleLines.length * 3.5;

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.2);
      const details = safeText(buildReceiptItemLineDetails(item), 240);
      if (details) {
        const detailLines = doc.splitTextToSize(details, contentWidth - 3);
        doc.text(detailLines, marginX + 2, y);
        y += detailLines.length * 3.2;
      }
      if (item.quantity > 1) {
        doc.text(`(c/u ${formatCurrency(item.unitPrice)})`, marginX + 2, y);
        y += 3.2;
      }
      y += 0.8;
    }

    y += 1;
    doc.line(marginX, y, pageWidth - marginX, y);
    y += 4.2;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.text('TOTAL A PAGAR:', marginX, y);
    doc.text(formatCurrency(order.total), pageWidth - marginX, y, { align: 'right' });
    y += 4.5;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    const payLabel =
      order.status === 'cancelado'
        ? order.paymentStatus === 'pagado' && order.refundMethod
          ? `VENTA ANULADA · Devolución: ${PAYMENT_METHOD_LABELS[order.refundMethod]}`
          : 'VENTA ANULADA'
        : order.paymentStatus === 'pagado'
          ? `Pagado (${PAYMENT_METHOD_LABELS[order.paymentMethod]})`
          : 'Pendiente por pagar';
    doc.text(`Pago: ${payLabel}`, marginX, y);
    y += 3.8;

    if (order.notes) {
      const noteLines = doc.splitTextToSize(`Nota: ${safeText(order.notes, 400)}`, contentWidth);
      doc.text(noteLines, marginX, y);
      y += noteLines.length * 3.5;
    }

    y += 1.5;
    doc.line(marginX, y, pageWidth - marginX, y);
    y += 4;

    doc.setFontSize(7.4);
    const footerLines = doc.splitTextToSize(safeText(cfg.footerNote, 280), contentWidth);
    doc.text(footerLines, pageWidth / 2, y, { align: 'center' });
    y += footerLines.length * 3.2 + 5;

    return y;
  };

  const finalHeight = Math.max(95, Math.ceil(drawContent(measureDoc)));
  const pdfDoc = new jsPDF({ unit: 'mm', format: [pageWidth, finalHeight] });
  drawContent(pdfDoc);
  pdfDoc.save(filename);
  return filename;
}
