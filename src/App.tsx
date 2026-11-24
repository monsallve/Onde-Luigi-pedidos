import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BarChart3,
  ClipboardList,
  History,
  Image as ImageIcon,
  LogOut,
  MailCheck,
  PlusCircle,
  Settings,
  UserCheck,
  UtensilsCrossed,
  WifiOff,
  X,
} from 'lucide-react';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AuthGate } from './components/AuthGate';
import { EmailVerificationModal } from './components/EmailVerificationModal';
import { OrderComposerModal } from './components/OrderComposerModal';
import { PaymentSheetModal } from './components/PaymentSheetModal';
import { PWAInstallButton } from './components/PWAInstallBanner';
import { SettingsModal } from './components/SettingsModal';
import { WaiterSelectorModal } from './components/WaiterSelectorModal';
import { WhatsAppReceiptViewer } from './components/WhatsAppReceiptViewer';
import { PosProvider, usePosStore } from './services/posStore';
import type { AppTab, Order } from './types/pos';
import { shouldPromptPermanentRegistration } from './utils/identityState';
import { isOrderInCourse, resolveAssetUrl } from './utils/orderMath';
import { ROLE_LABELS } from './utils/rolePermissions';
import { HistoryView } from './views/HistoryView';
import { MenuManagerView } from './views/MenuManagerView';
import { OrdersView } from './views/OrdersView';
import { PosOrderWorkspaceView } from './views/PosOrderWorkspaceView';
import { SalesReportView } from './views/SalesReportView';
import { TransfersGalleryView } from './views/TransfersGalleryView';

interface NavDef {
  id: AppTab;
  label: string;
  shortLabel: string;
  icon: React.ReactNode;
}

const ALL_NAV_ITEMS: NavDef[] = [
  { id: 'pedidos', label: 'Tomar Pedido', shortLabel: 'Pedir', icon: <PlusCircle className="w-5 h-5" /> },
  { id: 'comandas', label: 'Comandas', shortLabel: 'Comandas', icon: <ClipboardList className="w-5 h-5" /> },
  { id: 'historial', label: 'Historial', shortLabel: 'Historial', icon: <History className="w-5 h-5" /> },
  { id: 'transferencias', label: 'Transferencias', shortLabel: 'Pagos', icon: <ImageIcon className="w-5 h-5" /> },
  { id: 'ventas', label: 'Ventas', shortLabel: 'Ventas', icon: <BarChart3 className="w-5 h-5" /> },
  { id: 'menu', label: 'Menú y Salsas', shortLabel: 'Menú', icon: <UtensilsCrossed className="w-5 h-5" /> },
];

const OfflineIndicator: React.FC = () => {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  if (isOnline) return null;

  return (
    <div
      role="status"
      className="fixed bottom-20 lg:bottom-4 left-4 z-40 flex items-center gap-2 rounded-xl bg-amber-500 px-3.5 py-2 text-xs font-bold text-neutral-950 shadow-xl border border-amber-300/40"
    >
      <WifiOff className="w-4 h-4 shrink-0" />
      <span>Sin conexión — Trabajando con caché local</span>
    </div>
  );
};

const PosShell: React.FC = () => {
  const {
    sessionMode,
    authReady,
    loadingData,
    identityReady,
    activeWaiter,
    myLinkedStaff,
    effectiveRole,
    permissions,
    isPrimaryAdmin,
    isRealPrimaryAdmin,
    emailVerified,
    verificationNotice,
    clearVerificationNotice,
    orders,
    transfers,
    cloudError,
    voidTransferReceipt,
    deleteTransferReceipt,
    signOutSession,
  } = usePosStore();

  const [activeTab, setActiveTab] = useState<AppTab>('pedidos');
  const [composerOpen, setComposerOpen] = useState(false);
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [paymentOrder, setPaymentOrder] = useState<Order | null>(null);
  const [waiterModalOpen, setWaiterModalOpen] = useState(false);
  const [verifyModalOpen, setVerifyModalOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [exitConfirmOpen, setExitConfirmOpen] = useState(false);
  const autoPromptedRef = useRef(false);

  const [viewerState, setViewerState] = useState<{
    index: number;
    receiptIds?: string[];
  } | null>(null);

  const tabHistoryRef = useRef<AppTab[]>([]);
  const activeTabRef = useRef<AppTab>('pedidos');
  const permissionsRef = useRef(permissions);
  const allowExitRef = useRef(false);
  const guardAnchoredRef = useRef(false);

  activeTabRef.current = activeTab;
  permissionsRef.current = permissions;

  const navigateToTab = useCallback((nextTab: AppTab) => {
    if (!permissionsRef.current.allowedTabs.includes(nextTab)) return;
    setActiveTab((prev) => {
      if (prev !== nextTab) {
        const currentStack = tabHistoryRef.current;
        if (currentStack[currentStack.length - 1] !== prev) {
          tabHistoryRef.current = [...currentStack.slice(-19), prev];
        }
      }
      return nextTab;
    });
  }, []);

  const navItems = useMemo(
    () => ALL_NAV_ITEMS.filter((item) => permissions.allowedTabs.includes(item.id)),
    [permissions]
  );

  // Redirect away from disallowed tabs whenever effective role/permissions change
  useEffect(() => {
    if (!permissions.allowedTabs.includes(activeTab)) {
      setActiveTab(permissions.defaultTab);
    }
  }, [permissions, activeTab]);

  // Anchor Android/Browser back button sentinel and handle popstate consistently across views/modals
  const modalStateRef = useRef({
    exitConfirmOpen: false,
    hasViewer: false,
    verifyModalOpen: false,
    settingsOpen: false,
    waiterModalOpen: false,
    waiterModalRequired: false,
    hasPaymentOrder: false,
    composerOpen: false,
  });
  const requiresOneTimeName = shouldPromptPermanentRegistration({
    sessionMode,
    identityReady,
    loadingData,
    cloudError,
    isPrimaryAdmin: isRealPrimaryAdmin,
    myLinkedStaff,
  });
  modalStateRef.current = {
    exitConfirmOpen,
    hasViewer: Boolean(viewerState),
    verifyModalOpen,
    settingsOpen,
    waiterModalOpen,
    waiterModalRequired: requiresOneTimeName,
    hasPaymentOrder: Boolean(paymentOrder),
    composerOpen,
  };

  useEffect(() => {
    if (!sessionMode) {
      guardAnchoredRef.current = false;
      tabHistoryRef.current = [];
      return;
    }

    if (!guardAnchoredRef.current) {
      guardAnchoredRef.current = true;
      try {
        if (!window.history.state || !window.history.state.olGuard) {
          window.history.replaceState({ olRoot: true }, '');
          window.history.pushState({ olGuard: true }, '');
        }
      } catch {
        // ignore restricted history environments
      }
    }

    const pushGuard = () => {
      try {
        window.history.pushState({ olGuard: true }, '');
      } catch {
        // ignore restricted history environments
      }
    };

    const handlePopState = () => {
      if (allowExitRef.current) return;

      // 1. Let active child overlays/modals intercept Back first
      const childIntercept = new CustomEvent('ondeluigi:back-intercept', { cancelable: true });
      window.dispatchEvent(childIntercept);
      if (childIntercept.defaultPrevented) {
        pushGuard();
        return;
      }

      // 2. Step back through App-level modals in top-most order
      const ms = modalStateRef.current;
      if (ms.exitConfirmOpen) {
        setExitConfirmOpen(false);
        pushGuard();
        return;
      }
      if (ms.hasViewer) {
        setViewerState(null);
        pushGuard();
        return;
      }
      if (ms.verifyModalOpen) {
        setVerifyModalOpen(false);
        pushGuard();
        return;
      }
      if (ms.settingsOpen) {
        setSettingsOpen(false);
        pushGuard();
        return;
      }
      if (ms.waiterModalOpen && !ms.waiterModalRequired) {
        setWaiterModalOpen(false);
        pushGuard();
        return;
      }
      if (ms.hasPaymentOrder) {
        setPaymentOrder(null);
        pushGuard();
        return;
      }
      if (ms.composerOpen) {
        setComposerOpen(false);
        setEditingOrder(null);
        pushGuard();
        return;
      }

      // 3. Step back through allowed tab navigation history
      const currentPerms = permissionsRef.current;
      if (tabHistoryRef.current.length > 0) {
        const nextStack = [...tabHistoryRef.current];
        let prevTab: AppTab | undefined;
        while (nextStack.length > 0) {
          const candidate = nextStack.pop() as AppTab;
          if (currentPerms.allowedTabs.includes(candidate)) {
            prevTab = candidate;
            break;
          }
        }
        tabHistoryRef.current = nextStack;
        if (prevTab) {
          setActiveTab(prevTab);
          pushGuard();
          return;
        }
      }

      if (activeTabRef.current !== currentPerms.defaultTab) {
        setActiveTab(currentPerms.defaultTab);
        pushGuard();
        return;
      }

      // 4. At root screen: ask confirmation before leaving the app
      setExitConfirmOpen(true);
      pushGuard();
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [sessionMode]);

  // Auto-open WaiterSelectorModal ONLY after identityReady confirms registered user has no permanent staff profile yet
  useEffect(() => {
    if (
      shouldPromptPermanentRegistration({
        sessionMode,
        identityReady,
        loadingData,
        cloudError,
        isPrimaryAdmin: isRealPrimaryAdmin,
        myLinkedStaff,
      }) &&
      !autoPromptedRef.current
    ) {
      autoPromptedRef.current = true;
      setWaiterModalOpen(true);
    }
    if (!sessionMode || myLinkedStaff || !identityReady) {
      autoPromptedRef.current = false;
    }
  }, [sessionMode, identityReady, loadingData, cloudError, isRealPrimaryAdmin, myLinkedStaff]);

  const viewerReceipts = useMemo(() => {
    if (!viewerState) return [];
    if (viewerState.receiptIds) {
      const set = new Set(viewerState.receiptIds);
      return transfers.filter((t) => set.has(t.id));
    }
    return transfers.filter((t) => !t.annulled);
  }, [viewerState, transfers]);

  const activeOrderCount = useMemo(
    () => orders.filter(isOrderInCourse).length,
    [orders]
  );

  if (!authReady || (sessionMode && !identityReady)) {
    return (
      <div
        className="min-h-screen bg-[#0A0A0A] text-white flex flex-col items-center justify-center p-6 gap-4"
        role="status"
        aria-live="polite"
        aria-label="Verificando sesión y cargando datos"
      >
        <div
          className="w-11 h-11 rounded-full border-4 border-[#27272E] border-t-amber-500 animate-spin"
          aria-hidden="true"
        />
        <div className="text-center space-y-1">
          <p className="font-poster text-xl font-extrabold tracking-wide text-white uppercase">
            O&apos;NDE LUIGI
          </p>
          <p className="text-xs sm:text-sm font-medium text-zinc-400">
            {!authReady
              ? 'Iniciando sistema...'
              : 'Verificando usuario, rol y datos del local...'}
          </p>
        </div>
      </div>
    );
  }

  if (!sessionMode) {
    return <AuthGate />;
  }

  const handleOpenNewOrderModal = () => {
    if (!permissions.canTakeOrders) return;
    if (!activeWaiter) {
      setWaiterModalOpen(true);
      return;
    }
    navigateToTab('pedidos');
  };

  const handleEditOrder = (order: Order) => {
    if (!permissions.canEditOrders) return;
    if (!activeWaiter) {
      setWaiterModalOpen(true);
      return;
    }
    setEditingOrder(order);
    setComposerOpen(true);
  };

  const handleViewOrderReceipt = (orderId: string) => {
    const matching = transfers.filter((t) => t.orderId === orderId && !t.annulled);
    if (matching.length > 0) {
      setViewerState({
        index: 0,
        receiptIds: matching.map((m) => m.id),
      });
    } else {
      navigateToTab('transferencias');
    }
  };

  const handleInspectOrderFromViewer = (orderId: string) => {
    setViewerState(null);
    const target = orders.find((o) => o.id === orderId);
    if (target) {
      navigateToTab('comandas');
      setPaymentOrder(target);
    }
  };

  const handleConfirmAppExit = () => {
    allowExitRef.current = true;
    setExitConfirmOpen(false);
    try {
      window.history.go(-2);
    } catch {
      // ignore if browser blocks history exit
    }
  };

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white flex flex-col">
      {/* Desktop & Mobile Top Navigation */}
      <header className="sticky top-0 z-30 bg-[#101014]/95 backdrop-blur-md border-b border-[#27272E]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4 lg:gap-6">
          {/* Zone 1: O'NDE LUIGI Brand Emblem + Wordmark */}
          <button
            type="button"
            onClick={() => navigateToTab(permissions.defaultTab)}
            className="flex items-center gap-2.5 shrink-0 text-left"
          >
            <img
              src={resolveAssetUrl('/onde-luigi-logo.png')}
              alt="O'NDE LUIGI"
              className="w-8 h-8 rounded-full border border-red-600 object-cover shrink-0"
            />
            <span className="font-poster text-xl font-extrabold tracking-wide text-white whitespace-nowrap">
              O&apos;NDE LUIGI
            </span>
          </button>

          {/* Zone 2: Desktop Navigation */}
          <nav
            aria-label="Navegación principal"
            className="hidden lg:flex items-center gap-5 text-sm font-semibold"
          >
            {navItems.map((item) => {
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => navigateToTab(item.id)}
                  className={`py-1.5 border-b-2 whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
                    active
                      ? 'border-amber-500 text-amber-400 font-bold'
                      : 'border-transparent text-zinc-400 hover:text-white'
                  }`}
                >
                  <span>{item.label}</span>
                  {item.id === 'comandas' && activeOrderCount > 0 && (
                    <span className="font-mono text-[11px] bg-red-600 text-white px-1.5 py-0.5 rounded font-bold tabular-nums leading-none">
                      {activeOrderCount}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          {/* Zone 3: Single Primary CTA on Desktop + Mobile Quick Controls */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setWaiterModalOpen(true)}
              className={`lg:hidden min-h-[38px] px-2.5 rounded-lg border text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap ${
                activeWaiter
                  ? 'border-[#27272E] bg-[#1C1C22] text-zinc-200'
                  : 'border-amber-500 bg-amber-500/20 text-amber-300'
              }`}
            >
              <UserCheck className="w-3.5 h-3.5 text-amber-400" />
              <span className="max-w-[105px] truncate">
                {activeWaiter ? activeWaiter.name : 'Asociar cuenta'}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              aria-label="Abrir ajustes y permisos"
              className="lg:hidden min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl border border-[#27272E] bg-[#1C1C22] text-zinc-200"
            >
              <Settings className="w-4 h-4" />
            </button>

            {permissions.allowedTabs.includes('comandas') && (
              <button
                type="button"
                onClick={() => navigateToTab('comandas')}
                className="hidden lg:inline-flex min-h-[38px] px-4 rounded-xl bg-red-600 text-white text-xs font-bold hover:bg-red-500 transition-colors items-center gap-2 whitespace-nowrap shrink-0"
              >
                <ClipboardList className="w-4 h-4" />
                <span>Comandas ({activeOrderCount})</span>
              </button>
            )}
          </div>
        </div>

        {/* Workspace Toolbar (Desktop secondary controls) */}
        <div className="hidden lg:block bg-[#0A0A0A] border-t border-[#27272E]">
          <div className="max-w-7xl mx-auto px-6 h-11 flex items-center justify-between text-xs">
            <div className="flex items-center gap-3 text-zinc-400">
              <span>
                Rol:{' '}
                <strong className={effectiveRole === 'admin' ? 'text-amber-400' : 'text-white'}>
                  {ROLE_LABELS[effectiveRole]}
                </strong>
              </span>
              <span aria-hidden="true">·</span>
              <button
                type="button"
                onClick={() => setWaiterModalOpen(true)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border font-semibold transition-colors ${
                  activeWaiter
                    ? 'border-[#27272E] bg-[#141418] text-zinc-200 hover:border-zinc-500'
                    : 'border-amber-500 bg-amber-500/20 text-amber-300'
                }`}
              >
                <UserCheck className="w-3.5 h-3.5 text-amber-400" />
                <span>
                  En turno: {activeWaiter ? activeWaiter.name : 'Asocia tu cuenta'}
                </span>
              </button>
            </div>

            <div className="flex items-center gap-2">
              <PWAInstallButton compact />
              <button
                type="button"
                onClick={() => setSettingsOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#27272E] bg-[#141418] text-zinc-200 font-semibold hover:border-zinc-500 transition-colors"
              >
                <Settings className="w-3.5 h-3.5 text-amber-400" />
                <span>Ajustes y permisos</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-5 pb-32 lg:pb-10">
        {cloudError && (
          <div
            role="alert"
            className="mb-4 rounded-xl bg-red-950/60 border border-red-700 px-4 py-3 text-xs font-medium text-red-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
          >
            <span>{cloudError}</span>
            <button
              type="button"
              onClick={() => void signOutSession()}
              className="min-h-[36px] px-3 rounded-lg bg-red-600/30 border border-red-500/60 text-white font-bold hover:bg-red-600/50 whitespace-nowrap shrink-0"
            >
              Cambiar cuenta
            </button>
          </div>
        )}

        {verificationNotice && (
          <div
            role="status"
            className="mb-4 rounded-xl bg-emerald-950/60 border border-emerald-700 px-4 py-3 text-xs font-medium text-emerald-200 flex items-center justify-between gap-2.5"
          >
            <span>{verificationNotice}</span>
            <button
              type="button"
              onClick={clearVerificationNotice}
              aria-label="Cerrar aviso de verificación"
              className="min-h-[32px] min-w-[32px] flex items-center justify-center rounded-lg text-emerald-300 hover:bg-emerald-900/40 shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {!emailVerified && !cloudError && (isPrimaryAdmin || Boolean(myLinkedStaff)) && (
          <div className="mb-4 rounded-2xl bg-[#141418] border border-amber-500/70 p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <MailCheck className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-bold text-amber-400">
                  Verifica tu correo electrónico en O&apos;NDE LUIGI
                </p>
                <p className="text-xs text-zinc-300">
                  Tu nombre de usuario ya está configurado. Confirma tu correo para completar la verificación de tu cuenta.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setVerifyModalOpen(true)}
              className="min-h-[40px] px-4 rounded-xl bg-amber-500 text-black text-xs font-bold hover:bg-amber-400 whitespace-nowrap shrink-0"
            >
              Verificar correo
            </button>
          </div>
        )}

        {!activeWaiter && !cloudError && !isRealPrimaryAdmin && (
          <div className="mb-4 rounded-2xl bg-[#141418] border border-amber-500/70 p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <p className="text-sm font-bold text-amber-400">
                Asocia tu cuenta para comenzar
              </p>
              <p className="text-xs text-zinc-300">
                Elige el nombre con el que aparecerás en el sistema (rol inicial Mesero).
              </p>
            </div>
            <button
              type="button"
              onClick={() => setWaiterModalOpen(true)}
              className="min-h-[42px] px-4 rounded-xl bg-amber-500 text-black text-xs font-bold hover:bg-amber-400 whitespace-nowrap shrink-0"
            >
              Asociar mi nombre
            </button>
          </div>
        )}

        {activeTab === 'pedidos' && permissions.canTakeOrders && (
          <PosOrderWorkspaceView
            onOpenWaiterPicker={() => setWaiterModalOpen(true)}
            onGoToOrders={() => navigateToTab('comandas')}
          />
        )}

        {activeTab === 'comandas' && permissions.allowedTabs.includes('comandas') && (
          <OrdersView
            onNewOrder={handleOpenNewOrderModal}
            onEditOrder={handleEditOrder}
            onOpenPayment={(order) => {
              if (permissions.canManagePayments) setPaymentOrder(order);
            }}
            onViewOrderReceipt={handleViewOrderReceipt}
            onOpenWaiterPicker={() => setWaiterModalOpen(true)}
          />
        )}

        {activeTab === 'historial' && permissions.canViewHistory && <HistoryView />}

        {activeTab === 'transferencias' && permissions.canViewTransfers && (
          <TransfersGalleryView
            onOpenViewer={(index, receiptIds) => setViewerState({ index, receiptIds })}
            onOpenWaiterPicker={() => setWaiterModalOpen(true)}
          />
        )}

        {activeTab === 'ventas' && permissions.canViewSales && <SalesReportView />}

        {activeTab === 'menu' && permissions.canManageMenu && <MenuManagerView />}
      </main>

      {/* Mobile Fixed Bottom Navigation Bar (<= 15% sticky height cap) */}
      <nav
        aria-label="Menú inferior móvil"
        className="lg:hidden fixed bottom-0 left-0 right-0 z-30 bg-[#101014]/95 backdrop-blur-md border-t border-[#27272E] pb-safe"
      >
        <div
          className={`grid h-16 items-center ${
            navItems.length >= 6
              ? 'grid-cols-6'
              : navItems.length === 5
                ? 'grid-cols-5'
                : navItems.length === 4
                  ? 'grid-cols-4'
                  : navItems.length === 3
                    ? 'grid-cols-3'
                    : navItems.length === 2
                      ? 'grid-cols-2'
                      : 'grid-cols-1'
          }`}
        >
          {navItems.map((item) => {
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => navigateToTab(item.id)}
                className={`h-full flex flex-col items-center justify-center gap-0.5 ${
                  active ? 'text-amber-400' : 'text-zinc-400 hover:text-white'
                }`}
              >
                {item.icon}
                <span className="text-[10px] font-semibold tracking-tight whitespace-nowrap">
                  {item.shortLabel}
                </span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* Modals & Sheets */}
      {composerOpen && editingOrder && permissions.canEditOrders && (
        <OrderComposerModal
          open={composerOpen}
          editingOrder={editingOrder}
          onClose={() => {
            setComposerOpen(false);
            setEditingOrder(null);
          }}
          onOpenWaiterPicker={() => setWaiterModalOpen(true)}
        />
      )}

      {paymentOrder && permissions.canManagePayments && (
        <PaymentSheetModal
          order={paymentOrder}
          onClose={() => setPaymentOrder(null)}
          onOpenWaiterPicker={() => setWaiterModalOpen(true)}
        />
      )}

      <WaiterSelectorModal
        open={waiterModalOpen}
        onClose={() => setWaiterModalOpen(false)}
        required={requiresOneTimeName}
        onPermanentNameConfirmed={() => {
          if (!emailVerified) {
            setVerifyModalOpen(true);
          }
        }}
        onOpenVerifyEmail={() => setVerifyModalOpen(true)}
      />

      <EmailVerificationModal
        open={verifyModalOpen}
        onClose={() => setVerifyModalOpen(false)}
      />

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onOpenVerifyEmail={() => setVerifyModalOpen(true)}
      />

      {viewerState && viewerReceipts.length > 0 && permissions.canViewTransfers && (
        <WhatsAppReceiptViewer
          receipts={viewerReceipts}
          initialIndex={viewerState.index}
          isAdmin={permissions.canHardDelete}
          canVoidReceipt={permissions.canVoidReceipts}
          onClose={() => setViewerState(null)}
          onInspectOrder={
            permissions.allowedTabs.includes('comandas')
              ? handleInspectOrderFromViewer
              : undefined
          }
          onVoidReceipt={async (transferId) => {
            await voidTransferReceipt(transferId);
          }}
          onDeleteReceipt={async (transferId) => {
            await deleteTransferReceipt(transferId);
          }}
        />
      )}

      {/* In-App Confirmation Modal before exiting via Android/Browser Back */}
      {exitConfirmOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-sm sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="exit-app-modal-title"
        >
          <div className="w-full sm:max-w-sm bg-[#141418] text-white rounded-t-3xl sm:rounded-2xl border border-[#27272E] shadow-2xl overflow-hidden p-5 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/40 flex items-center justify-center shrink-0">
                <LogOut className="w-5 h-5 text-amber-400" />
              </div>
              <div>
                <h2 id="exit-app-modal-title" className="font-poster text-xl font-extrabold tracking-wide uppercase">
                  ¿SALIR DE O&apos;NDE LUIGI?
                </h2>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Si tienes un pedido en curso, tu borrador queda guardado automáticamente.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => setExitConfirmOpen(false)}
                className="min-h-[44px] rounded-xl bg-amber-500 text-black text-sm font-bold hover:bg-amber-400"
              >
                Seguir en la app
              </button>
              <button
                type="button"
                onClick={handleConfirmAppExit}
                className="min-h-[44px] rounded-xl border border-[#27272E] bg-[#1C1C22] text-sm font-semibold text-zinc-200 hover:border-zinc-500"
              >
                Salir
              </button>
            </div>
          </div>
        </div>
      )}

      <OfflineIndicator />
    </div>
  );
};

export default function App() {
  return (
    <ErrorBoundary>
      <PosProvider>
        <PosShell />
      </PosProvider>
    </ErrorBoundary>
  );
}

