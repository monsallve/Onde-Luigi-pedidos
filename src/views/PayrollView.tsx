import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Download,
  Edit3,
  FileText,
  FolderOpen,
  HelpCircle,
  Lock,
  Plus,
  Search,
  Trash2,
  Upload,
  Users,
  X,
} from 'lucide-react';
import { PayrollCompanyModal } from '../components/payroll/PayrollCompanyModal';
import { PayrollEmployeeDetail } from '../components/payroll/PayrollEmployeeDetail';
import { PayrollEmployeeModal } from '../components/payroll/PayrollEmployeeModal';
import {
  PayrollConfirmModal,
  PayrollExportModal,
} from '../components/payroll/PayrollAuxModals';
import { usePosStore } from '../services/posStore';
import type { PayrollCompany, PayrollEmployee, PayrollStubRecord } from '../types/payroll';
import {
  formatCopMoney,
  getCutoffAndPayDates,
  getPayrollInitials,
  parseAndNormalizePayrollImport,
  sanitizeExportFilename,
  serializePayrollExportJson,
} from '../utils/payrollMath';
import { downloadPayrollStubPdf } from '../utils/payrollPdf';
import { ROLE_LABELS } from '../utils/rolePermissions';

type PayrollConfirmState =
  | { kind: 'deleteCompany'; company: PayrollCompany }
  | { kind: 'deleteEmployee'; company: PayrollCompany; employee: PayrollEmployee }
  | { kind: 'deleteStub'; company: PayrollCompany; stub: PayrollStubRecord }
  | { kind: 'importReplace'; companies: PayrollCompany[]; filename: string }
  | null;

export const PayrollView: React.FC = () => {
  const {
    permissions,
    effectiveRole,
    firebaseUser,
    authorizedEmails,
    payrollCompanies,
    payrollLoaded,
    savePayrollCompany,
    deletePayrollCompany,
    savePayrollEmployee,
    deletePayrollEmployee,
    savePayrollEmployeeQuincena,
    savePayrollStub,
    deletePayrollStub,
    importPayrollCompanies,
  } = usePosStore();

  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);
  const [companySubTab, setCompanySubTab] = useState<'empleados' | 'colillas'>('empleados');

  const [companySearch, setCompanySearch] = useState('');
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [stubSearch, setStubSearch] = useState('');

  const [companyModalOpen, setCompanyModalOpen] = useState(false);
  const [editingCompany, setEditingCompany] = useState<PayrollCompany | null>(null);

  const [employeeModalOpen, setEmployeeModalOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<PayrollEmployee | null>(null);

  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [confirmState, setConfirmState] = useState<PayrollConfirmState>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [showHowItWorks, setShowHowItWorks] = useState(false);

  const [toast, setToast] = useState<{ msg: string; tone: 'success' | 'error' } | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const notify = (msg: string, tone: 'success' | 'error' = 'success') => {
    setToast({ msg, tone });
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 3200);
  };

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    };
  }, []);

  const currentCompany = useMemo(
    () => payrollCompanies.find((c) => c.id === selectedCompanyId) || null,
    [payrollCompanies, selectedCompanyId]
  );

  const currentEmployee = useMemo(
    () =>
      currentCompany?.employees.find((e) => e.id === selectedEmployeeId) || null,
    [currentCompany, selectedEmployeeId]
  );

  // Android / browser back intercept inside nested Payroll views
  useEffect(() => {
    const handleBackIntercept = (e: Event) => {
      if (confirmState) {
        e.preventDefault();
        setConfirmState(null);
        return;
      }
      if (exportModalOpen) {
        e.preventDefault();
        setExportModalOpen(false);
        return;
      }
      if (employeeModalOpen) {
        e.preventDefault();
        setEmployeeModalOpen(false);
        return;
      }
      if (companyModalOpen) {
        e.preventDefault();
        setCompanyModalOpen(false);
        return;
      }
      if (selectedEmployeeId) {
        e.preventDefault();
        setSelectedEmployeeId(null);
        return;
      }
      if (selectedCompanyId) {
        e.preventDefault();
        setSelectedCompanyId(null);
      }
    };
    window.addEventListener('ondeluigi:back-intercept', handleBackIntercept);
    return () => window.removeEventListener('ondeluigi:back-intercept', handleBackIntercept);
  }, [
    confirmState,
    exportModalOpen,
    employeeModalOpen,
    companyModalOpen,
    selectedEmployeeId,
    selectedCompanyId,
  ]);

  const sortedFilteredCompanies = useMemo(() => {
    const q = companySearch.trim().toLowerCase();
    return payrollCompanies
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }))
      .filter(
        (c) =>
          !q ||
          c.name.toLowerCase().includes(q) ||
          c.nit.toLowerCase().includes(q) ||
          c.address.toLowerCase().includes(q)
      );
  }, [payrollCompanies, companySearch]);

  const sortedFilteredEmployees = useMemo(() => {
    if (!currentCompany) return [];
    const q = employeeSearch.trim().toLowerCase();
    return currentCompany.employees
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }))
      .filter(
        (e) =>
          !q ||
          e.name.toLowerCase().includes(q) ||
          e.document.toLowerCase().includes(q) ||
          e.position.toLowerCase().includes(q)
      );
  }, [currentCompany, employeeSearch]);

  const sortedFilteredStubs = useMemo(() => {
    if (!currentCompany) return [];
    const q = stubSearch.trim().toLowerCase();
    return currentCompany.stubs
      .slice()
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
      .filter((s) => {
        if (!q) return true;
        const emp = currentCompany.employees.find((e) => e.id === s.employeeId);
        const empName = emp ? emp.name.toLowerCase() : '';
        return (
          empName.includes(q) ||
          (s.periodLabel || '').toLowerCase().includes(q) ||
          (s.date || '').toLowerCase().includes(q)
        );
      });
  }, [currentCompany, stubSearch]);

  const totalEmployeesAll = useMemo(
    () => payrollCompanies.reduce((acc, c) => acc + c.employees.length, 0),
    [payrollCompanies]
  );

  const totalStubsAll = useMemo(
    () => payrollCompanies.reduce((acc, c) => acc + c.stubs.length, 0),
    [payrollCompanies]
  );

  if (!permissions.canManagePayroll) {
    return (
      <div className="bg-[#141418] border border-[#27272E] rounded-2xl p-10 text-center max-w-lg mx-auto my-8 space-y-3">
        <Lock className="w-10 h-10 text-amber-400 mx-auto" />
        <h1 className="font-poster text-2xl font-extrabold text-white tracking-wide">
          ACCESO ADMINISTRATIVO REQUERIDO
        </h1>
        <p className="text-sm text-zinc-400">
          Solo los usuarios con rol <strong className="text-amber-400">Administrador</strong> pueden
          ver y gestionar el módulo de Nómina. Tu rol actual es{' '}
          <strong className="text-white">{ROLE_LABELS[effectiveRole]}</strong>.
        </p>
      </div>
    );
  }

  const triggerJsonDownload = (rawName: string) => {
    const filename = sanitizeExportFilename(rawName);
    const jsonText = serializePayrollExportJson(payrollCompanies);
    const blob = new Blob([jsonText], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
    notify(`Respaldo descargado: ${filename}`, 'success');
  };

  const handleImportFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = String(reader.result || '');
        const imported = parseAndNormalizePayrollImport(text, {
          ownerUid: firebaseUser?.uid || 'admin',
          createdByUid: firebaseUser?.uid || 'admin',
          allowedEmails: authorizedEmails,
        });
        setConfirmState({
          kind: 'importReplace',
          companies: imported,
          filename: file.name,
        });
      } catch (err) {
        notify(err instanceof Error ? err.message : 'Error al leer el archivo JSON', 'error');
      }
    };
    reader.readAsText(file);
  };

  const handleDownloadExistingStub = async (company: PayrollCompany, stub: PayrollStubRecord) => {
    const emp = company.employees.find((e) => e.id === stub.employeeId);
    if (!emp) {
      notify('Empleado no encontrado para esta colilla', 'error');
      return;
    }
    let dateInfo = {
      cutoff: stub.cutoff || '',
      pay: stub.pay || '',
      cutoffDay: stub.cutoffDay || 13,
      payDay: stub.payDay || 14,
    };
    if (!dateInfo.cutoff && stub.periodKey) {
      const parts = String(stub.periodKey).split('-');
      if (parts.length >= 3) {
        dateInfo = getCutoffAndPayDates(parts[0], parts[1], parts[2]);
      }
    }
    try {
      await downloadPayrollStubPdf({
        company,
        employee: emp,
        periodLabel: stub.periodLabel || '',
        hoursData: {
          days: stub.days || {},
          totalHours: stub.totalHours || 0,
          gross: stub.gross || 0,
          deductionList: stub.deductions || [],
          dedTotal: stub.dedTotal || 0,
          neto: stub.total,
        },
        genDate: stub.date || '',
        dateInfo,
      });
      notify('Colilla PDF descargada', 'success');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'No se pudo generar el PDF', 'error');
    }
  };

  const handleConfirmAction = async () => {
    if (!confirmState) return;
    setConfirmBusy(true);
    try {
      if (confirmState.kind === 'deleteCompany') {
        await deletePayrollCompany(confirmState.company.id);
        if (selectedCompanyId === confirmState.company.id) {
          setSelectedCompanyId(null);
          setSelectedEmployeeId(null);
        }
        notify('Empresa eliminada', 'success');
      } else if (confirmState.kind === 'deleteEmployee') {
        await deletePayrollEmployee(confirmState.company.id, confirmState.employee.id);
        if (selectedEmployeeId === confirmState.employee.id) {
          setSelectedEmployeeId(null);
        }
        notify('Empleado eliminado', 'success');
      } else if (confirmState.kind === 'deleteStub') {
        await deletePayrollStub(confirmState.company.id, confirmState.stub.id);
        notify('Colilla eliminada', 'success');
      } else if (confirmState.kind === 'importReplace') {
        await importPayrollCompanies(confirmState.companies);
        setSelectedCompanyId(null);
        setSelectedEmployeeId(null);
        notify(
          `Importado en la nube: ${confirmState.filename} (${confirmState.companies.length} empresas)`,
          'success'
        );
      }
      setConfirmState(null);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'No se pudo completar la acción', 'error');
    } finally {
      setConfirmBusy(false);
    }
  };

  const confirmDialogProps = (() => {
    if (!confirmState) return null;
    switch (confirmState.kind) {
      case 'deleteCompany':
        return {
          title: 'Eliminar empresa',
          message: `¿Eliminar la empresa «${confirmState.company.name}»?\nSe borrarán también ${confirmState.company.employees.length} empleado(s) y ${confirmState.company.stubs.length} colilla(s). Esta acción no se puede deshacer.`,
          confirmLabel: 'Eliminar empresa',
          danger: true,
        };
      case 'deleteEmployee':
        return {
          title: 'Eliminar empleado',
          message: `¿Eliminar al empleado «${confirmState.employee.name}»?\nSe eliminarán sus horas registradas y las colillas asociadas. Esta acción no se puede deshacer.`,
          confirmLabel: 'Eliminar empleado',
          danger: true,
        };
      case 'deleteStub': {
        const emp = confirmState.company.employees.find(
          (e) => e.id === confirmState.stub.employeeId
        );
        return {
          title: 'Eliminar colilla',
          message: `¿Eliminar la colilla de «${emp ? emp.name : 'empleado'}» (${confirmState.stub.periodLabel || confirmState.stub.periodKey})?\nEsta acción no se puede deshacer.`,
          confirmLabel: 'Eliminar colilla',
          danger: true,
        };
      }
      case 'importReplace':
        return {
          title: 'Importar respaldo JSON',
          message: `¿Reemplazar las empresas actuales con «${confirmState.filename}» (${confirmState.companies.length} empresas)?\nLos datos se sincronizarán en Firestore para el rol Administrador.`,
          confirmLabel: 'Importar y reemplazar',
          danger: false,
        };
    }
  })();

  return (
    <div className="space-y-5">
      {/* Header & JSON Backup Toolbar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h1 className="font-poster text-3xl sm:text-4xl font-extrabold tracking-wide text-white leading-none">
            NÓMINA QUINCENAL
          </h1>
          <p className="text-xs text-zinc-400 mt-1">
            Empresas, horas trabajadas, recargos nocturnos/dominicales, deducciones y colillas PDF en
            tiempo real.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => setExportModalOpen(true)}
            className="min-h-[38px] px-3.5 rounded-xl border border-[#27272E] bg-[#141418] text-xs font-semibold text-zinc-200 hover:border-amber-500 inline-flex items-center gap-1.5"
          >
            <Download className="w-3.5 h-3.5 text-amber-400" />
            <span>Exportar JSON</span>
          </button>

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="min-h-[38px] px-3.5 rounded-xl border border-[#27272E] bg-[#141418] text-xs font-semibold text-zinc-200 hover:border-amber-500 inline-flex items-center gap-1.5"
          >
            <Upload className="w-3.5 h-3.5 text-amber-400" />
            <span>Importar JSON</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            onChange={handleImportFileChange}
            className="hidden"
          />

          <button
            type="button"
            onClick={() => setShowHowItWorks((v) => !v)}
            aria-expanded={showHowItWorks}
            className="min-h-[38px] px-3 rounded-xl border border-[#27272E] bg-[#141418] text-xs font-semibold text-zinc-300 hover:border-zinc-500 inline-flex items-center gap-1.5"
          >
            <HelpCircle className="w-3.5 h-3.5 text-amber-400" />
            <span>Ayuda</span>
          </button>
        </div>
      </div>

      {toast && (
        <div
          role={toast.tone === 'error' ? 'alert' : 'status'}
          className={`rounded-xl px-4 py-3 text-xs font-semibold flex items-center justify-between gap-2 border ${
            toast.tone === 'error'
              ? 'bg-red-950/70 border-red-700 text-red-200'
              : 'bg-emerald-950/70 border-emerald-700 text-emerald-200'
          }`}
        >
          <span>{toast.msg}</span>
          <button
            type="button"
            onClick={() => setToast(null)}
            aria-label="Cerrar notificación de nómina"
            className="p-1 rounded-lg hover:bg-black/20"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {showHowItWorks && (
        <div className="bg-[#141418] border border-[#27272E] rounded-2xl p-4 text-xs text-zinc-300 space-y-1.5">
          <p className="font-bold text-amber-400">Cómo funciona la Nómina Quincenal</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Todos los cambios se guardan en tiempo real en Firestore bajo permisos exclusivos de Administrador.</li>
            <li>
              Quincenas automáticas: <strong>1ª quincena</strong> del 29 (mes anterior) al 13 (pago día 14) y{' '}
              <strong>2ª quincena</strong> del 14 al 28 (pago día 29).
            </li>
            <li>
              Los recargos nocturnos o dominicales/festivos solo aplican si están activados en el empleado.
            </li>
            <li>Las deducciones solo se descuentan si las marcas con valor mayor a cero.</li>
            <li>Puedes usar Exportar / Importar JSON como respaldo portátil compatible con Nómina Pro.</li>
          </ul>
        </div>
      )}

      {/* VIEW 3: Employee Detail */}
      {currentCompany && currentEmployee ? (
        <PayrollEmployeeDetail
          company={currentCompany}
          employee={currentEmployee}
          onBack={() => setSelectedEmployeeId(null)}
          onEditEmployee={() => {
            setEditingEmployee(currentEmployee);
            setEmployeeModalOpen(true);
          }}
          onDeleteEmployee={() =>
            setConfirmState({
              kind: 'deleteEmployee',
              company: currentCompany,
              employee: currentEmployee,
            })
          }
          onSaveHours={(periodKey, record) =>
            savePayrollEmployeeQuincena(currentCompany.id, currentEmployee.id, periodKey, record)
          }
          onSaveStub={(stub) => savePayrollStub(currentCompany.id, stub)}
          onNotify={notify}
        />
      ) : currentCompany ? (
        /* VIEW 2: Company Detail (Employees + Generated Stubs) */
        <div className="space-y-5">
          <button
            type="button"
            onClick={() => {
              setSelectedCompanyId(null);
              setSelectedEmployeeId(null);
              setEmployeeSearch('');
              setStubSearch('');
            }}
            className="inline-flex items-center gap-2 text-xs font-semibold text-zinc-300 hover:text-amber-400 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Empresas</span>
          </button>

          {/* Company Hero Card */}
          <div className="bg-[#141418] border border-[#27272E] rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-4 min-w-0">
              {currentCompany.logo ? (
                <img
                  src={currentCompany.logo}
                  alt={`Logo de ${currentCompany.name}`}
                  className="w-16 h-16 rounded-2xl object-contain bg-white p-1.5 border border-[#27272E] shrink-0"
                />
              ) : (
                <div className="w-16 h-16 rounded-2xl bg-amber-500/15 border border-amber-500/40 text-amber-400 font-poster text-2xl font-extrabold flex items-center justify-center shrink-0">
                  {getPayrollInitials(currentCompany.name)}
                </div>
              )}
              <div className="min-w-0">
                <h2 className="font-poster text-2xl font-extrabold tracking-wide text-white truncate">
                  {currentCompany.name}
                </h2>
                <p className="text-xs font-mono text-amber-400 mt-0.5">
                  NIT: {currentCompany.nit}
                </p>
                <p className="text-xs text-zinc-400 mt-0.5 truncate">
                  {[currentCompany.address, currentCompany.phone, currentCompany.email]
                    .filter(Boolean)
                    .join(' · ') || 'Sin datos de contacto'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap shrink-0">
              <button
                type="button"
                onClick={() => {
                  setEditingCompany(currentCompany);
                  setCompanyModalOpen(true);
                }}
                className="min-h-[38px] px-3.5 rounded-xl border border-[#27272E] bg-[#1C1C22] text-xs font-semibold text-zinc-200 hover:border-amber-500 inline-flex items-center gap-1.5"
              >
                <Edit3 className="w-3.5 h-3.5 text-amber-400" />
                <span>Editar</span>
              </button>
              <button
                type="button"
                onClick={() =>
                  setConfirmState({ kind: 'deleteCompany', company: currentCompany })
                }
                className="min-h-[38px] px-3.5 rounded-xl border border-red-800/70 bg-red-950/40 text-xs font-semibold text-red-300 hover:bg-red-900/60 inline-flex items-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Eliminar</span>
              </button>
            </div>
          </div>

          {/* Sub-navigation Tabs inside Company */}
          <div className="flex flex-wrap items-center gap-2 border-b border-[#27272E] pb-2">
            <button
              type="button"
              onClick={() => setCompanySubTab('empleados')}
              className={`min-h-[38px] px-4 rounded-xl text-xs font-bold inline-flex items-center gap-2 border transition-colors ${
                companySubTab === 'empleados'
                  ? 'bg-amber-500 text-black border-amber-400'
                  : 'bg-[#141418] text-zinc-300 border-[#27272E] hover:border-zinc-500'
              }`}
            >
              <Users className="w-4 h-4" />
              <span>Empleados ({currentCompany.employees.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setCompanySubTab('colillas')}
              className={`min-h-[38px] px-4 rounded-xl text-xs font-bold inline-flex items-center gap-2 border transition-colors ${
                companySubTab === 'colillas'
                  ? 'bg-amber-500 text-black border-amber-400'
                  : 'bg-[#141418] text-zinc-300 border-[#27272E] hover:border-zinc-500'
              }`}
            >
              <FileText className="w-4 h-4" />
              <span>Colillas generadas ({currentCompany.stubs.length})</span>
            </button>
          </div>

          {companySubTab === 'empleados' ? (
            <div className="bg-[#141418] border border-[#27272E] rounded-2xl p-4 sm:p-5 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="relative flex-1 max-w-sm">
                  <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="search"
                    value={employeeSearch}
                    onChange={(e) => setEmployeeSearch(e.target.value)}
                    placeholder="Buscar empleado por nombre, cédula o cargo..."
                    className="w-full min-h-[40px] pl-9 pr-3 rounded-xl border border-[#27272E] bg-[#0A0A0A] text-xs sm:text-sm text-white placeholder:text-zinc-500 focus:border-amber-500 focus:outline-none"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setEditingEmployee(null);
                    setEmployeeModalOpen(true);
                  }}
                  className="min-h-[40px] px-4 rounded-xl bg-amber-500 text-black text-xs font-bold hover:bg-amber-400 inline-flex items-center justify-center gap-1.5 shrink-0"
                >
                  <Plus className="w-4 h-4" />
                  <span>Agregar empleado</span>
                </button>
              </div>

              {sortedFilteredEmployees.length === 0 ? (
                <div className="py-10 text-center space-y-2 border border-dashed border-[#27272E] rounded-xl">
                  <Users className="w-8 h-8 text-zinc-500 mx-auto" />
                  <p className="text-sm font-semibold text-zinc-300">
                    {currentCompany.employees.length === 0
                      ? 'No hay empleados en esta empresa'
                      : 'Ningún empleado coincide con la búsqueda'}
                  </p>
                  <p className="text-xs text-zinc-500">
                    Agrega el primero para empezar a reportar horas quincenales.
                  </p>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {sortedFilteredEmployees.map((emp) => (
                    <button
                      key={emp.id}
                      type="button"
                      onClick={() => setSelectedEmployeeId(emp.id)}
                      className="w-full text-left bg-[#0A0A0A] border border-[#27272E] hover:border-amber-500/80 rounded-xl p-3.5 flex items-center justify-between gap-3 transition-colors group"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-11 h-11 rounded-xl bg-[#1C1C22] border border-[#27272E] text-amber-400 font-bold text-sm flex items-center justify-center shrink-0">
                          {getPayrollInitials(emp.name)}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-white group-hover:text-amber-400 truncate">
                            {emp.name}
                          </p>
                          <p className="text-xs text-zinc-400 truncate">
                            Doc {emp.document} · {emp.position || 'Sin cargo'} ·{' '}
                            <span className="font-mono text-zinc-200">
                              {formatCopMoney(emp.hourlyRate)}/h
                            </span>{' '}
                            · {emp.paymentMethod === 'banco' ? 'Banco' : 'Efectivo'}
                          </p>
                        </div>
                      </div>
                      <ArrowRight className="w-4 h-4 text-zinc-500 group-hover:text-amber-400 shrink-0" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            /* Generated Stubs Table */
            <div className="bg-[#141418] border border-[#27272E] rounded-2xl p-4 sm:p-5 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="relative flex-1 max-w-sm">
                  <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="search"
                    value={stubSearch}
                    onChange={(e) => setStubSearch(e.target.value)}
                    placeholder="Filtrar colillas por empleado, periodo o fecha..."
                    className="w-full min-h-[40px] pl-9 pr-3 rounded-xl border border-[#27272E] bg-[#0A0A0A] text-xs sm:text-sm text-white placeholder:text-zinc-500 focus:border-amber-500 focus:outline-none"
                  />
                </div>
                <div className="text-xs text-zinc-400">
                  Total pagado filtrado:{' '}
                  <strong className="font-mono text-emerald-400">
                    {formatCopMoney(
                      sortedFilteredStubs.reduce((sum, s) => sum + (s.total || 0), 0)
                    )}
                  </strong>
                </div>
              </div>

              {sortedFilteredStubs.length === 0 ? (
                <div className="py-10 text-center space-y-2 border border-dashed border-[#27272E] rounded-xl">
                  <FileText className="w-8 h-8 text-zinc-500 mx-auto" />
                  <p className="text-sm font-semibold text-zinc-300">Aún no hay colillas</p>
                  <p className="text-xs text-zinc-500">
                    Entra a un empleado, registra horas y genera la colilla PDF.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-[#27272E]">
                  <table className="w-full text-left border-collapse text-xs sm:text-sm">
                    <thead className="bg-[#0A0A0A] text-zinc-400 uppercase text-[11px]">
                      <tr>
                        <th className="py-2.5 px-3 font-semibold">Empleado</th>
                        <th className="py-2.5 px-3 font-semibold">Periodo</th>
                        <th className="py-2.5 px-3 font-semibold">Fecha</th>
                        <th className="py-2.5 px-3 font-semibold text-right">Neto</th>
                        <th className="py-2.5 px-3 font-semibold text-right">Acciones</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#27272E]">
                      {sortedFilteredStubs.map((stub) => {
                        const emp = currentCompany.employees.find(
                          (e) => e.id === stub.employeeId
                        );
                        return (
                          <tr key={stub.id} className="hover:bg-[#1C1C22]/60">
                            <td className="py-2.5 px-3 font-semibold text-white">
                              {emp ? emp.name : '—'}
                            </td>
                            <td className="py-2.5 px-3 text-zinc-300">{stub.periodLabel}</td>
                            <td className="py-2.5 px-3 font-mono text-zinc-400">{stub.date}</td>
                            <td className="py-2.5 px-3 font-mono font-bold text-emerald-400 text-right">
                              {formatCopMoney(stub.total)}
                            </td>
                            <td className="py-2.5 px-3 text-right whitespace-nowrap">
                              <div className="inline-flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() =>
                                    void handleDownloadExistingStub(currentCompany, stub)
                                  }
                                  className="min-h-[32px] px-2.5 rounded-lg border border-[#27272E] bg-[#1C1C22] text-xs font-semibold text-amber-400 hover:border-amber-500 inline-flex items-center gap-1"
                                >
                                  <Download className="w-3.5 h-3.5" />
                                  <span>PDF</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setConfirmState({
                                      kind: 'deleteStub',
                                      company: currentCompany,
                                      stub,
                                    })
                                  }
                                  aria-label={`Eliminar colilla de ${emp ? emp.name : 'empleado'}`}
                                  className="min-h-[32px] px-2.5 rounded-lg border border-red-800/70 bg-red-950/40 text-xs font-semibold text-red-300 hover:bg-red-900/60"
                                >
                                  Eliminar
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        /* VIEW 1: Companies Dashboard */
        <div className="space-y-5">
          {/* KPI Summary */}
          <div className="grid grid-cols-3 gap-2.5 sm:gap-3">
            <div className="bg-[#141418] border border-[#27272E] rounded-2xl p-3 sm:p-4">
              <p className="text-[11px] sm:text-xs text-zinc-400">Empresas</p>
              <p className="font-mono text-xl sm:text-2xl font-extrabold text-white mt-1 tabular-nums">
                {payrollCompanies.length}
              </p>
            </div>
            <div className="bg-[#141418] border border-[#27272E] rounded-2xl p-3 sm:p-4">
              <p className="text-[11px] sm:text-xs text-zinc-400">Empleados</p>
              <p className="font-mono text-xl sm:text-2xl font-extrabold text-amber-400 mt-1 tabular-nums">
                {totalEmployeesAll}
              </p>
            </div>
            <div className="bg-[#141418] border border-[#27272E] rounded-2xl p-3 sm:p-4">
              <p className="text-[11px] sm:text-xs text-zinc-400">Colillas</p>
              <p className="font-mono text-xl sm:text-2xl font-extrabold text-emerald-400 mt-1 tabular-nums">
                {totalStubsAll}
              </p>
            </div>
          </div>

          <div className="bg-[#141418] border border-[#27272E] rounded-2xl p-4 sm:p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="relative flex-1 max-w-sm">
                <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="search"
                  value={companySearch}
                  onChange={(e) => setCompanySearch(e.target.value)}
                  placeholder="Buscar empresa por nombre o NIT..."
                  className="w-full min-h-[40px] pl-9 pr-3 rounded-xl border border-[#27272E] bg-[#0A0A0A] text-xs sm:text-sm text-white placeholder:text-zinc-500 focus:border-amber-500 focus:outline-none"
                />
              </div>
              <button
                type="button"
                onClick={() => {
                  setEditingCompany(null);
                  setCompanyModalOpen(true);
                }}
                className="min-h-[42px] px-4 rounded-xl bg-amber-500 text-black text-xs font-bold hover:bg-amber-400 inline-flex items-center justify-center gap-1.5 shrink-0"
              >
                <Plus className="w-4 h-4" />
                <span>Nueva empresa</span>
              </button>
            </div>

            {!payrollLoaded ? (
              <div className="py-12 flex items-center justify-center">
                <div className="w-7 h-7 rounded-full border-2 border-[#27272E] border-t-amber-500 animate-spin" />
              </div>
            ) : sortedFilteredCompanies.length === 0 ? (
              <div className="py-12 text-center space-y-2 border border-dashed border-[#27272E] rounded-xl">
                <Building2 className="w-10 h-10 text-zinc-500 mx-auto" />
                <p className="text-sm font-semibold text-zinc-200">
                  {payrollCompanies.length === 0
                    ? 'No hay empresas registradas'
                    : 'Ninguna empresa coincide con la búsqueda'}
                </p>
                <p className="text-xs text-zinc-400">
                  {payrollCompanies.length === 0
                    ? 'Crea tu primera empresa o importa un respaldo JSON para comenzar a gestionar la nómina.'
                    : 'Prueba con otro término de búsqueda.'}
                </p>
                {payrollCompanies.length === 0 && (
                  <div className="pt-2 flex items-center justify-center gap-2">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="min-h-[38px] px-3.5 rounded-xl border border-[#27272E] bg-[#1C1C22] text-xs font-semibold text-zinc-200 hover:border-amber-500 inline-flex items-center gap-1.5"
                    >
                      <FolderOpen className="w-3.5 h-3.5 text-amber-400" />
                      <span>Importar JSON</span>
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-2.5">
                {sortedFilteredCompanies.map((comp) => (
                  <button
                    key={comp.id}
                    type="button"
                    onClick={() => {
                      setSelectedCompanyId(comp.id);
                      setSelectedEmployeeId(null);
                      setCompanySubTab('empleados');
                    }}
                    className="w-full text-left bg-[#0A0A0A] border border-[#27272E] hover:border-amber-500/80 rounded-xl p-3.5 flex items-center justify-between gap-3 transition-colors group"
                  >
                    <div className="flex items-center gap-3.5 min-w-0">
                      {comp.logo ? (
                        <img
                          src={comp.logo}
                          alt=""
                          className="w-12 h-12 rounded-xl object-contain bg-white p-1 border border-[#27272E] shrink-0"
                        />
                      ) : (
                        <div className="w-12 h-12 rounded-xl bg-amber-500/15 border border-amber-500/40 text-amber-400 font-poster text-lg font-extrabold flex items-center justify-center shrink-0">
                          {getPayrollInitials(comp.name)}
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-white group-hover:text-amber-400 truncate">
                          {comp.name}
                        </p>
                        <p className="text-xs text-zinc-400 truncate">
                          NIT {comp.nit} · {comp.employees.length} empleado
                          {comp.employees.length !== 1 ? 's' : ''} · {comp.stubs.length} colilla
                          {comp.stubs.length !== 1 ? 's' : ''}
                        </p>
                      </div>
                    </div>
                    <ArrowRight className="w-4 h-4 text-zinc-500 group-hover:text-amber-400 shrink-0" />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modals */}
      <PayrollCompanyModal
        open={companyModalOpen}
        editingCompany={editingCompany}
        onClose={() => {
          setCompanyModalOpen(false);
          setEditingCompany(null);
        }}
        onSave={async (input) => {
          const saved = await savePayrollCompany(input);
          notify(input.id ? 'Empresa actualizada' : 'Empresa creada', 'success');
          if (!input.id) setSelectedCompanyId(saved.id);
        }}
      />

      {currentCompany && (
        <PayrollEmployeeModal
          open={employeeModalOpen}
          editingEmployee={editingEmployee}
          onClose={() => {
            setEmployeeModalOpen(false);
            setEditingEmployee(null);
          }}
          onSave={async (input) => {
            await savePayrollEmployee(currentCompany.id, input);
            notify(input.id ? 'Empleado actualizado' : 'Empleado agregado', 'success');
          }}
        />
      )}

      <PayrollExportModal
        open={exportModalOpen}
        defaultFilename={`nomina_${new Date().toISOString().slice(0, 10)}`}
        onClose={() => setExportModalOpen(false)}
        onConfirm={triggerJsonDownload}
      />

      {confirmDialogProps && (
        <PayrollConfirmModal
          open={Boolean(confirmState)}
          title={confirmDialogProps.title}
          message={confirmDialogProps.message}
          confirmLabel={confirmDialogProps.confirmLabel}
          danger={confirmDialogProps.danger}
          loading={confirmBusy}
          onCancel={() => {
            if (!confirmBusy) setConfirmState(null);
          }}
          onConfirm={handleConfirmAction}
        />
      )}
    </div>
  );
};
