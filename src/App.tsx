import React, { useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  ClipboardList,
  History,
  Image as ImageIcon,
  PlusCircle,
  Settings,
  UserCheck,
  UtensilsCrossed,
} from 'lucide-react';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AuthGate } from './components/AuthGate';
import { OfflineIndicator } from './components/OfflineIndicator';
import { OrderComposerModal } from './components/OrderComposerModal';
import { PaymentSheetModal } from './components/PaymentSheetModal';
import { PWAInstallButton } from './components/PWAInstallBanner';
import { SettingsModal } from './components/SettingsModal';
import { WaiterSelectorModal } from './components/WaiterSelectorModal';
import { WhatsAppReceiptViewer } from './components/WhatsAppReceiptViewer';
import { PosProvider, usePosStore } from './services/posStore';
import type { AppTab, Order } from './types/pos';
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
  adminOnly?: boolean;
}

const ALL_NAV_ITEMS: NavDef[] = [
  { id: 'pedidos', label: 'Tomar Pedido', shortLabel: 'Pedir', icon: <PlusCircle className="w-5 h-5" /> },
  { id: 'comandas', label: 'Comandas', shortLabel: 'Comandas', icon: <ClipboardList className="w-5 h-5" /> },
  { id: 'historial', label: 'Historial', shortLabel: 'Historial', icon: <History className="w-5 h-5" /> },
  { id: 'transferencias', label: 'Transferencias', shortLabel: 'Pagos', icon: <ImageIcon className="w-5 h-5" /> },
  { id: 'ventas', label: 'Ventas', shortLabel: 'Ventas', icon: <BarChart3 className="w-5 h-5" /> },
  { id: 'menu', label: 'Menú y Salsas', shortLabel: 'Menú', icon: <UtensilsCrossed className="w-5 h-5" />, adminOnly: true },
];

const PosShell: React.FC = () => {
  const {
    sessionMode,
    authReady,
    activeWaiter,
    isAdmin,
    orders,
    transfers,
    cloudError,
  } = usePosStore();

  const [activeTab, setActiveTab] = useState<AppTab>('pedidos');
  const [composerOpen, setComposerOpen] = useState(false);
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [paymentOrder, setPaymentOrder] = useState<Order | null>(null);
  const [waiterModalOpen, setWaiterModalOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [viewerState, setViewerState] = useState<{
    index: number;
    receiptIds?: string[];
  } | null>(null);

  const navItems = useMemo(
    () => ALL_NAV_ITEMS.filter((item) => !item.adminOnly || isAdmin),
    [isAdmin]
  );

  // Redirect away from admin-only Menú tab if account is Waiter
  useEffect(() => {
    if (!isAdmin && activeTab === 'menu') {
      setActiveTab('pedidos');
    }
  }, [isAdmin, activeTab]);

  const viewerReceipts = useMemo(() => {
    if (!viewerState) return [];
    if (viewerState.receiptIds) {
      const set = new Set(viewerState.receiptIds);
      return transfers.filter((t) => set.has(t.id));
    }
    return transfers;
  }, [viewerState, transfers]);

  const activeOrderCount = useMemo(
    () => orders.filter((o) => o.status !== 'entregado' && o.status !== 'cancelado').length,
    [orders]
  );

  if (!authReady) {
    return (
      <div className="min-h-screen bg-[#0A0A0A] flex items-center justify-center p-6">
        <div className="text-sm font-medium text-zinc-400">Cargando O&apos;NDE LUIGI...</div>
      </div>
    );
  }

  if (!sessionMode) {
    return <AuthGate />;
  }

  const handleOpenNewOrderModal = () => {
    if (!activeWaiter) {
      setWaiterModalOpen(true);
      return;
    }
    setActiveTab('pedidos');
  };

  const handleEditOrder = (order: Order) => {
    if (!activeWaiter) {
      setWaiterModalOpen(true);
      return;
    }
    setEditingOrder(order);
    setComposerOpen(true);
  };

  const handleViewOrderReceipt = (orderId: string) => {
    const matching = transfers.filter((t) => t.orderId === orderId);
    if (matching.length > 0) {
      setViewerState({
        index: 0,
        receiptIds: matching.map((m) => m.id),
      });
    } else {
      setActiveTab('transferencias');
    }
  };

  const handleInspectOrderFromViewer = (orderId: string) => {
    setViewerState(null);
    const target = orders.find((o) => o.id === orderId);
    if (target) {
      setActiveTab('comandas');
      setPaymentOrder(target);
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
            onClick={() => setActiveTab('pedidos')}
            className="flex items-center gap-2.5 shrink-0 text-left"
          >
            <img
              src="/onde-luigi-logo.png"
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
                  onClick={() => setActiveTab(item.id)}
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
              <span className="max-w-[95px] truncate">
                {activeWaiter ? activeWaiter.name : 'Elegir mesero'}
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

            <button
              type="button"
              onClick={() => setActiveTab('comandas')}
              className="hidden lg:inline-flex min-h-[38px] px-4 rounded-xl bg-red-600 text-white text-xs font-bold hover:bg-red-500 transition-colors items-center gap-2 whitespace-nowrap shrink-0"
            >
              <ClipboardList className="w-4 h-4" />
              <span>Comandas ({activeOrderCount})</span>
            </button>
          </div>
        </div>

        {/* Workspace Toolbar (Desktop secondary controls) */}
        <div className="hidden lg:block bg-[#0A0A0A] border-t border-[#27272E]">
          <div className="max-w-7xl mx-auto px-6 h-11 flex items-center justify-between text-xs">
            <div className="flex items-center gap-3 text-zinc-400">
              <span>
                Rol:{' '}
                <strong className={isAdmin ? 'text-amber-400' : 'text-white'}>
                  {isAdmin ? 'Administrador' : 'Mesero'}
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
                  En turno: {activeWaiter ? activeWaiter.name : 'Seleccionar obligatorio'}
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
            className="mb-4 rounded-xl bg-red-950/60 border border-red-700 px-4 py-3 text-xs font-medium text-red-200"
          >
            {cloudError}
          </div>
        )}

        {!activeWaiter && (
          <div className="mb-4 rounded-2xl bg-[#141418] border border-amber-500/70 p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <p className="text-sm font-bold text-amber-400">
                Selecciona quién está tomando pedidos
              </p>
              <p className="text-xs text-zinc-300">
                Indica tu nombre para que cada comanda y cobro quede registrado a tu turno.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setWaiterModalOpen(true)}
              className="min-h-[42px] px-4 rounded-xl bg-amber-500 text-black text-xs font-bold hover:bg-amber-400 whitespace-nowrap shrink-0"
            >
              Elegir mi nombre
            </button>
          </div>
        )}

        {activeTab === 'pedidos' && (
          <PosOrderWorkspaceView
            onOpenWaiterPicker={() => setWaiterModalOpen(true)}
            onGoToOrders={() => setActiveTab('comandas')}
          />
        )}

        {activeTab === 'comandas' && (
          <OrdersView
            onNewOrder={handleOpenNewOrderModal}
            onEditOrder={handleEditOrder}
            onOpenPayment={(order) => setPaymentOrder(order)}
            onViewOrderReceipt={handleViewOrderReceipt}
            onOpenWaiterPicker={() => setWaiterModalOpen(true)}
          />
        )}

        {activeTab === 'historial' && <HistoryView />}

        {activeTab === 'transferencias' && (
          <TransfersGalleryView
            onOpenViewer={(index, receiptIds) => setViewerState({ index, receiptIds })}
            onOpenWaiterPicker={() => setWaiterModalOpen(true)}
          />
        )}

        {activeTab === 'ventas' && <SalesReportView />}

        {activeTab === 'menu' && <MenuManagerView />}
      </main>

      {/* Mobile Fixed Bottom Navigation Bar (<= 15% sticky height cap) */}
      <nav
        aria-label="Menú inferior móvil"
        className="lg:hidden fixed bottom-0 left-0 right-0 z-30 bg-[#101014]/95 backdrop-blur-md border-t border-[#27272E] pb-safe"
      >
        <div
          className={`grid h-16 items-center ${
            navItems.length === 6 ? 'grid-cols-6' : 'grid-cols-5'
          }`}
        >
          {navItems.map((item) => {
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
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
      {composerOpen && (
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

      {paymentOrder && (
        <PaymentSheetModal
          order={paymentOrder}
          onClose={() => setPaymentOrder(null)}
          onOpenWaiterPicker={() => setWaiterModalOpen(true)}
        />
      )}

      <WaiterSelectorModal
        open={waiterModalOpen}
        onClose={() => setWaiterModalOpen(false)}
      />

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />

      {viewerState && viewerReceipts.length > 0 && (
        <WhatsAppReceiptViewer
          receipts={viewerReceipts}
          initialIndex={viewerState.index}
          onClose={() => setViewerState(null)}
          onInspectOrder={handleInspectOrderFromViewer}
        />
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
