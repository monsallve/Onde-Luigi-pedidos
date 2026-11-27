import type { jsPDF as JsPdfType } from 'jspdf';
import type {
  CutoffPayInfo,
  PayrollCompany,
  PayrollDayEntry,
  PayrollEmployee,
  PayrollQuincenaRecord,
} from '../types/payroll';
import { sanitizePlainText, sanitizeSafeUrl } from './inputSecurity';
import { calcDayValue, formatCopMoney } from './payrollMath';

interface LogoFitResult {
  w: number;
  h: number;
  dataUrl: string;
  format: 'PNG' | 'JPEG';
}

function prepareLogoForPdf(
  dataUrl: string,
  maxWmm: number,
  maxHmm: number
): Promise<LogoFitResult | null> {
  return new Promise((resolve) => {
    const safeUrl = sanitizeSafeUrl(dataUrl, {
      allowDataImage: true,
      allowRelative: false,
      maxLen: 250000,
    });
    if (!safeUrl || typeof Image === 'undefined') {
      resolve(null);
      return;
    }
    const img = new Image();
    img.onload = () => {
      const nw = img.naturalWidth || 1;
      const nh = img.naturalHeight || 1;
      const scale = Math.min(maxWmm / nw, maxHmm / nh);
      const w = Math.max(8, nw * scale);
      const h = Math.max(6, nh * scale);

      if (/^data:image\/jpe?g/i.test(safeUrl)) {
        resolve({ w, h, dataUrl: safeUrl, format: 'JPEG' });
        return;
      }
      if (/^data:image\/png/i.test(safeUrl)) {
        resolve({ w, h, dataUrl: safeUrl, format: 'PNG' });
        return;
      }

      // Convert WebP or other raster formats to PNG so jsPDF embeds cleanly
      try {
        const canvas = document.createElement('canvas');
        canvas.width = nw;
        canvas.height = nh;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, nw, nh);
        ctx.drawImage(img, 0, 0, nw, nh);
        resolve({
          w,
          h,
          dataUrl: canvas.toDataURL('image/png'),
          format: 'PNG',
        });
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = safeUrl;
  });
}

export async function downloadPayrollStubPdf(params: {
  company: PayrollCompany;
  employee: PayrollEmployee;
  periodLabel: string;
  hoursData: Pick<
    PayrollQuincenaRecord,
    'days' | 'totalHours' | 'gross' | 'deductionList' | 'dedTotal' | 'neto'
  >;
  genDate: string;
  dateInfo: CutoffPayInfo;
}): Promise<string> {
  const { company, employee, periodLabel, hoursData, dateInfo } = params;
  const safeText = (v: unknown, maxLen = 200) => sanitizePlainText(v, { maxLen });

  const [{ jsPDF }, autoTableMod] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);
  const autoTable = autoTableMod.default;
  const logoFit = await prepareLogoForPdf(company.logo, 32, 18);

  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  let y = 14;

  const hasLogo = Boolean(logoFit && logoFit.w && logoFit.h && logoFit.dataUrl);
  const logoW = hasLogo && logoFit ? logoFit.w : 0;
  const logoH = hasLogo && logoFit ? logoFit.h : 0;
  const textX = hasLogo ? 14 + logoW + 4 : 14;
  const headerH = hasLogo ? Math.max(logoH, 16) : 16;

  if (hasLogo && logoFit) {
    try {
      doc.addImage(logoFit.dataUrl, logoFit.format, 14, y, logoW, logoH);
    } catch {
      try {
        doc.addImage(logoFit.dataUrl, 'PNG', 14, y, logoW, logoH);
      } catch {
        // ignore logo format fallback failure
      }
    }
  }

  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.text(safeText(company.name, 140) || 'Empresa', textX, y + 5);
  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'normal');
  doc.text(`NIT: ${safeText(company.nit, 40)}`, textX, y + 10);
  if (company.address) {
    doc.text(safeText(company.address, 160), textX, y + 14, {
      maxWidth: pageW - textX - 14,
    });
  }
  y += headerH + 4;

  doc.setFillColor(30, 58, 110);
  doc.roundedRect(14, y, pageW - 28, 8, 1.5, 1.5, 'F');
  doc.setTextColor(255);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text('COLILLA DE PAGO', pageW / 2, y + 5.5, { align: 'center' });
  doc.setTextColor(0);
  y += 12;

  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'bold');
  doc.text(`Periodo: ${safeText(periodLabel, 100)}`, 14, y);
  y += 5;
  doc.setFont('helvetica', 'normal');
  doc.text(`Fecha de corte: ${safeText(dateInfo.cutoff, 20) || '—'}`, 14, y);
  doc.text(`Fecha de pago: ${safeText(dateInfo.pay, 20) || '—'}`, pageW / 2, y);
  y += 5;
  doc.setFontSize(7.5);
  doc.setTextColor(90);
  doc.text(
    'La fecha de pago corresponde a la quincena con el corte indicado (pago al día siguiente del corte).',
    14,
    y
  );
  doc.setTextColor(0);
  y += 6;

  doc.setDrawColor(220);
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(14, y, pageW - 28, 26, 2, 2, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('Datos del trabajador', 17, y + 5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.text(`Nombre: ${safeText(employee.name, 120)}`, 17, y + 11);
  doc.text(`Documento: ${safeText(employee.document, 40)}`, 17, y + 16);
  doc.text(`Cargo: ${safeText(employee.position, 80) || '—'}`, 17, y + 21);
  doc.text(`Valor hora: ${formatCopMoney(employee.hourlyRate)}`, pageW / 2 + 2, y + 11);
  const payTxt =
    employee.paymentMethod === 'banco'
      ? `Consignación${employee.bank ? ` · ${safeText(employee.bank, 120)}` : ''}`
      : 'Efectivo';
  doc.text(`Pago: ${payTxt}`, pageW / 2 + 2, y + 16);
  y += 32;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('Detalle de horas por día', 14, y);
  y += 3;

  const daysObj = hoursData.days || {};
  const dayKeys = Object.keys(daysObj).sort((a, b) => {
    const na = /^\d{4}-\d{2}-\d{2}$/.test(a);
    const nb = /^\d{4}-\d{2}-\d{2}$/.test(b);
    if (na && nb) return a.localeCompare(b);
    if (na) return -1;
    if (nb) return 1;
    return Number(a) - Number(b);
  });

  const body: string[][] = dayKeys.map((d) => {
    const info = daysObj[d] as PayrollDayEntry | number;
    const h = typeof info === 'object' ? info.hours || 0 : info || 0;
    const night = typeof info === 'object' && Boolean(info.night);
    const holiday = typeof info === 'object' && Boolean(info.holiday);
    const val =
      typeof info === 'object' && info.value != null
        ? info.value
        : calcDayValue(h, night, holiday, employee);
    const flags = [night ? 'N' : '', holiday ? 'D/F' : ''].filter(Boolean).join('+') || '—';
    let label = String(d);
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      const p = d.split('-');
      label = `${p[2]}/${p[1]}`;
    }
    return [label, h.toFixed(1), flags, formatCopMoney(val)];
  });
  if (!body.length) body.push(['—', '0', '—', formatCopMoney(0)]);

  autoTable(doc, {
    startY: y,
    head: [['Fecha', 'Horas', 'Recargo', 'Valor']],
    body,
    theme: 'striped',
    headStyles: { fillColor: [30, 58, 110], fontSize: 8, cellPadding: 2.5 },
    bodyStyles: { fontSize: 8, cellPadding: 2.2 },
    margin: { left: 14, right: 14 },
    columnStyles: {
      0: { cellWidth: 22 },
      1: { cellWidth: 25 },
      2: { cellWidth: 28 },
      3: { cellWidth: 40 },
    },
  });

  const lastAutoTable = (doc as JsPdfType & { lastAutoTable?: { finalY?: number } }).lastAutoTable;
  y = (lastAutoTable?.finalY ?? y + 20) + 7;

  const gross = hoursData.gross || 0;
  const dedList = hoursData.deductionList || [];
  const dedTotal = hoursData.dedTotal || 0;
  const neto = hoursData.neto != null ? hoursData.neto : Math.max(0, gross - dedTotal);
  const boxH = 16 + (dedList.length ? dedList.length * 5 + 6 : 0) + 8;

  doc.setFillColor(245, 240, 230);
  doc.roundedRect(14, y, pageW - 28, boxH, 2, 2, 'F');
  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'normal');
  doc.text('Total horas:', 18, y + 6);
  doc.text(`${(hoursData.totalHours || 0).toFixed(1)} h`, pageW - 18, y + 6, { align: 'right' });
  doc.text('Total bruto:', 18, y + 12);
  doc.text(formatCopMoney(gross), pageW - 18, y + 12, { align: 'right' });

  let yy = y + 17;
  if (dedList.length) {
    doc.setFont('helvetica', 'bold');
    doc.text('Deducciones:', 18, yy);
    yy += 5;
    doc.setFont('helvetica', 'normal');
    for (const d of dedList) {
      doc.text(`  · ${safeText(d.name, 80)}`, 18, yy);
      doc.text(formatCopMoney(d.amount), pageW - 18, yy, { align: 'right' });
      yy += 5;
    }
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('NETO A PAGAR:', 18, y + boxH - 4);
  doc.text(formatCopMoney(neto), pageW - 18, y + boxH - 4, { align: 'right' });
  y += boxH + 7;

  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(120);
  const lines: string[] = [];
  if (company.rep) lines.push(`Representante legal: ${safeText(company.rep, 120)}`);
  if (company.legal) lines.push(safeText(company.legal, 400));
  if (!dedList.length) lines.push('No se aplicaron deducciones en este periodo.');
  lines.push('Periodos: 29–13 (pago 14) y 14–28 (pago 29). Cortes: 13 y 28.');
  if (params.genDate) lines.push(`Generado el ${safeText(params.genDate, 60)}.`);
  doc.text(lines, 14, y, { maxWidth: pageW - 28 });

  const safeEmpFile = (safeText(employee.name, 60) || 'empleado').replace(/\s+/g, '_');
  const safePeriodFile = (safeText(periodLabel, 60) || 'periodo').replace(/\s+/g, '_');
  const filename = `Colilla_${safeEmpFile}_${safePeriodFile}.pdf`;
  doc.save(filename);
  return filename;
}
