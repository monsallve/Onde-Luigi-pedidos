import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import {
  AlertOctagon,
  Bell,
  BellRing,
  CheckCheck,
  Clock,
  Loader2,
  ShoppingBag,
  Smartphone,
  Trash2,
  UserPlus,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import type { PushSyncStatusInfo } from '../services/pushMessagingService';
import { usePosStore } from '../services/posStore';
import type {
  AppTab,
  WorkspaceNotification,
  WorkspaceNotificationType,
} from '../types/pos';
import { safeJsonParse } from '../utils/inputSecurity';
import {
  getNotificationPermissionState,
  isNotificationPromptDismissed,
  isNotificationSoundMuted,
  requestDeviceNotificationPermission,
  setNotificationPromptDismissed,
  setNotificationSoundMuted,
  shouldOfferPermissionPrompt,
  triggerDeviceAlert,
  unlockNotificationAudio,
  type NotificationPermissionState,
} from '../utils/notificationAlert';
import { formatDateTimeShort } from '../utils/orderMath';
import {
  countUnreadNotifications,
  selectLiveNewNotifications,
} from '../utils/purchaseExpenseMath';

const LAST_READ_STORAGE_KEY = 'ondeluigi_notif_last_read_ms_v1';
const DISMISSED_SYNTHETIC_STORAGE_KEY = 'ondeluigi_notif_dismissed_sync_v1';

function readInitialLastReadMs(): number {
  try {
    if (typeof window === 'undefined') return Date.now();
    const raw = window.localStorage.getItem(LAST_READ_STORAGE_KEY);
    if (raw) {
      const parsed = Number(raw);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
    const now = Date.now();
    window.localStorage.setItem(LAST_READ_STORAGE_KEY, String(now));
    return now;
  } catch {
    return Date.now();
  }
}

function persistLastReadMs(ms: number): void {
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(LAST_READ_STORAGE_KEY, String(ms));
    }
  } catch {
    // ignore storage quota errors
  }
}

function readDismissedSyntheticIds(): string[] {
  try {
    if (typeof window === 'undefined') return [];
    const raw = window.localStorage.getItem(DISMISSED_SYNTHETIC_STORAGE_KEY);
    if (!raw) return [];
    const parsed = safeJsonParse<unknown>(raw, []);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === 'string').slice(-200);
  } catch {
    return [];
  }
}

function persistDismissedSyntheticIds(ids: string[]): void {
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(
        DISMISSED_SYNTHETIC_STORAGE_KEY,
        JSON.stringify(ids.slice(-200))
      );
    }
  } catch {
    // ignore storage quota errors
  }
}

function isSyntheticNotificationId(id: string): boolean {
  return (
    id.startsWith('notif_self_') ||
    id.startsWith('notif_sync_') ||
    id.startsWith('notif_access_req_')
  );
}

function getNotifVisuals(type: WorkspaceNotificationType): {
  badge: string;
  tone: string;
  toastTone: string;
  icon: React.ReactNode;
} {
  switch (type) {
    case 'nueva_comanda':
      return {
        badge: 'Nueva comanda',
        tone: 'bg-amber-500/15 border-amber-500/50 text-amber-300',
        toastTone: 'border-amber-500/80 bg-[#141418]',
        icon: <ShoppingBag className="w-4 h-4 text-amber-400 shrink-0" />,
      };
    case 'turno_abierto':
      return {
        badge: 'Turno abierto',
        tone: 'bg-emerald-950/70 border-emerald-600/70 text-emerald-300',
        toastTone: 'border-emerald-600/80 bg-[#101814]',
        icon: <Clock className="w-4 h-4 text-emerald-400 shrink-0" />,
      };
    case 'turno_cerrado':
      return {
        badge: 'Turno cerrado',
        tone: 'bg-sky-950/70 border-sky-600/70 text-sky-300',
        toastTone: 'border-sky-600/80 bg-[#10141A]',
        icon: <Clock className="w-4 h-4 text-sky-400 shrink-0" />,
      };
    case 'venta_anulada':
      return {
        badge: 'Anulación',
        tone: 'bg-red-950/70 border-red-600/70 text-red-300',
        toastTone: 'border-red-600/85 bg-[#1A1012]',
        icon: <AlertOctagon className="w-4 h-4 text-red-400 shrink-0" />,
      };
    case 'solicitud_acceso':
      return {
        badge: 'Nueva solicitud',
        tone: 'bg-amber-500/20 border-amber-400/70 text-amber-300',
        toastTone: 'border-amber-400/90 bg-[#1A150E]',
        icon: <UserPlus className="w-4 h-4 text-amber-400 shrink-0" />,
      };
  }
}

interface NotificationCenterContextValue {
  panelOpen: boolean;
  openPanel: () => void;
  closePanel: () => void;
  visibleNotifications: WorkspaceNotification[];
  notificationsLoaded: boolean;
  unreadCount: number;
  permState: NotificationPermissionState;
  pushSyncStatus: PushSyncStatusInfo;
  soundMuted: boolean;
  requestingPerm: boolean;
  showFloatingPermPrompt: boolean;
  liveToasts: WorkspaceNotification[];
  isAdmin: boolean;
  markAllRead: () => void;
  handleRequestDevicePermission: () => Promise<void>;
  handleSyncPushNow: () => Promise<void>;
  handleDismissPrompt: () => void;
  handleToggleSound: () => void;
  handleTestAlert: () => void;
  handleNotificationAction: (notif: WorkspaceNotification) => void;
  handleDismissToast: (notifId: string) => void;
  handleDeleteOrDismissNotification: (notif: WorkspaceNotification) => Promise<void>;
}

const NotificationCenterContext = createContext<NotificationCenterContextValue | null>(null);

function useNotificationCenterContext(): NotificationCenterContextValue {
  const ctx = useContext(NotificationCenterContext);
  if (!ctx) {
    throw new Error('NotificationCenter components must be rendered inside NotificationCenterProvider');
  }
  return ctx;
}

interface ProviderProps {
  onNavigateTab: (tab: AppTab) => void;
  onOpenShiftModal: () => void;
  onOpenSettings?: () => void;
  children: React.ReactNode;
}

export const NotificationCenterProvider: React.FC<ProviderProps> = ({
  onNavigateTab,
  onOpenShiftModal,
  onOpenSettings,
  children,
}) => {
  const {
    notifications,
    notificationsLoaded,
    permissions,
    isAdmin,
    sessionMode,
    activeWaiter,
    myLinkedStaff,
    isRealPrimaryAdmin,
    pushSyncStatus,
    syncBackgroundPushNow,
    deleteWorkspaceNotification,
  } = usePosStore();

  const [panelOpen, setPanelOpen] = useState(false);
  const [lastReadAtMs, setLastReadAtMs] = useState<number>(() => readInitialLastReadMs());
  const [dismissedSyntheticIds, setDismissedSyntheticIds] = useState<string[]>(() =>
    readDismissedSyntheticIds()
  );
  const [soundMuted, setSoundMuted] = useState<boolean>(() => isNotificationSoundMuted());
  const [permState, setPermState] = useState<NotificationPermissionState>(() =>
    getNotificationPermissionState()
  );
  const [promptDismissed, setPromptDismissed] = useState<boolean>(() =>
    isNotificationPromptDismissed()
  );
  const [requestingPerm, setRequestingPerm] = useState(false);
  const [liveToasts, setLiveToasts] = useState<WorkspaceNotification[]>([]);

  const sessionStartRef = useRef<number>(Date.now());
  const hydratedRef = useRef<boolean>(false);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const autoRequestedRef = useRef<boolean>(false);

  const dismissedSet = useMemo(
    () => new Set(dismissedSyntheticIds),
    [dismissedSyntheticIds]
  );

  const visibleNotifications = useMemo(
    () => notifications.filter((n) => !dismissedSet.has(n.id)),
    [notifications, dismissedSet]
  );

  // Sync permission state when returning from OS/browser settings
  useEffect(() => {
    const syncPerm = () => setPermState(getNotificationPermissionState());
    window.addEventListener('focus', syncPerm);
    document.addEventListener('visibilitychange', syncPerm);
    return () => {
      window.removeEventListener('focus', syncPerm);
      document.removeEventListener('visibilitychange', syncPerm);
    };
  }, []);

  // Unlock Web Audio and request notification permission on first gesture if still 'default'
  useEffect(() => {
    const onFirstInteraction = () => {
      unlockNotificationAudio();
      if (
        sessionMode &&
        !autoRequestedRef.current &&
        getNotificationPermissionState() === 'default' &&
        !isNotificationPromptDismissed()
      ) {
        autoRequestedRef.current = true;
        void requestDeviceNotificationPermission().then((next) => {
          setPermState(next);
        });
      }
    };
    window.addEventListener('pointerdown', onFirstInteraction, { passive: true, once: true });
    window.addEventListener('keydown', onFirstInteraction, { passive: true, once: true });
    return () => {
      window.removeEventListener('pointerdown', onFirstInteraction);
      window.removeEventListener('keydown', onFirstInteraction);
    };
  }, [sessionMode]);

  // Listen for Service Worker notification clicks to navigate directly
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    const onSwMessage = (event: MessageEvent) => {
      const msg = event.data as
        | { type?: string; payload?: { type?: WorkspaceNotificationType } }
        | undefined;
      if (!msg || msg.type !== 'ONDE_LUIGI_NOTIF_CLICK') return;
      const notifType = msg.payload?.type;
      if (notifType === 'nueva_comanda' && permissions.allowedTabs.includes('comandas')) {
        onNavigateTab('comandas');
      } else if (notifType === 'venta_anulada') {
        if (permissions.canViewHistory) onNavigateTab('historial');
        else if (permissions.allowedTabs.includes('comandas')) onNavigateTab('comandas');
      } else if (
        (notifType === 'turno_abierto' || notifType === 'turno_cerrado') &&
        permissions.canManageShifts
      ) {
        onOpenShiftModal();
      } else if (notifType === 'solicitud_acceso' && isAdmin) {
        onOpenSettings?.();
      }
    };
    navigator.serviceWorker.addEventListener('message', onSwMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onSwMessage);
  }, [permissions, isAdmin, onNavigateTab, onOpenShiftModal, onOpenSettings]);

  // Reset hydration guards on sign-out / workspace switch
  useEffect(() => {
    if (!sessionMode) {
      hydratedRef.current = false;
      seenIdsRef.current = new Set();
      autoRequestedRef.current = false;
      setLiveToasts([]);
      setPanelOpen(false);
      return;
    }
    sessionStartRef.current = Date.now();
  }, [sessionMode]);

  // Detect live incoming notifications after initial snapshot hydration
  useEffect(() => {
    if (!notificationsLoaded) return;

    if (!hydratedRef.current) {
      hydratedRef.current = true;
      seenIdsRef.current = new Set(visibleNotifications.map((n) => n.id));
      return;
    }

    const fresh = selectLiveNewNotifications(
      visibleNotifications,
      sessionStartRef.current,
      seenIdsRef.current
    );

    if (fresh.length === 0) return;

    for (const item of fresh) {
      seenIdsRef.current.add(item.id);
      triggerDeviceAlert(item);
    }

    setLiveToasts((prev) => {
      const merged = [...fresh.slice().reverse(), ...prev];
      const unique = merged.filter(
        (item, idx, arr) => arr.findIndex((x) => x.id === item.id) === idx
      );
      return unique.slice(0, 4);
    });
  }, [visibleNotifications, notificationsLoaded]);

  // Auto-dismiss live floating toast cards
  useEffect(() => {
    if (liveToasts.length === 0) return;
    const timer = window.setTimeout(() => {
      setLiveToasts((prev) => prev.slice(0, Math.max(0, prev.length - 1)));
    }, 7500);
    return () => window.clearTimeout(timer);
  }, [liveToasts]);

  // Intercept Android/Browser back button and Escape key when drawer is open
  useEffect(() => {
    if (!panelOpen) return;
    const handleBackIntercept = (e: Event) => {
      e.preventDefault();
      setPanelOpen(false);
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPanelOpen(false);
      }
    };
    window.addEventListener('ondeluigi:back-intercept', handleBackIntercept);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('ondeluigi:back-intercept', handleBackIntercept);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [panelOpen]);

  const unreadCount = useMemo(
    () => countUnreadNotifications(visibleNotifications, lastReadAtMs),
    [visibleNotifications, lastReadAtMs]
  );

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.title =
      unreadCount > 0
        ? `(${unreadCount}) O'NDE LUIGI · Sistema POS`
        : "O'NDE LUIGI · Sistema POS";
  }, [unreadCount]);

  const markAllRead = useCallback(() => {
    const newest = visibleNotifications[0]?.createdAtMs || 0;
    const nextMs = Math.max(Date.now(), newest);
    setLastReadAtMs(nextMs);
    persistLastReadMs(nextMs);
  }, [visibleNotifications]);

  const openPanel = useCallback(() => {
    setPanelOpen(true);
    markAllRead();
    setPermState(getNotificationPermissionState());
  }, [markAllRead]);

  const closePanel = useCallback(() => {
    setPanelOpen(false);
  }, []);

  const handleRequestDevicePermission = useCallback(async () => {
    setRequestingPerm(true);
    try {
      const next = await requestDeviceNotificationPermission();
      setPermState(next);
      if (next === 'granted') {
        setPromptDismissed(false);
        setNotificationPromptDismissed(false);
        void syncBackgroundPushNow();
        triggerDeviceAlert(
          {
            id: `perm_ok_${Date.now()}`,
            type: 'turno_abierto',
            title: "O'NDE LUIGI · Alertas activas",
            message: 'Este dispositivo recibirá notificaciones de comandas, turnos y anulaciones.',
            orderId: '',
            orderNumber: 0,
            shiftId: '',
            actorName: activeWaiter?.name || 'Sistema',
            actorUid: '',
            ownerUid: '',
            createdByUid: '',
            allowedEmails: [],
            createdAtMs: Date.now(),
          },
          { forceOsNotification: true }
        );
      }
    } finally {
      setRequestingPerm(false);
    }
  }, [activeWaiter?.name, syncBackgroundPushNow]);

  const handleSyncPushNow = useCallback(async () => {
    setRequestingPerm(true);
    try {
      await syncBackgroundPushNow();
    } finally {
      setRequestingPerm(false);
    }
  }, [syncBackgroundPushNow]);

  const handleDismissPrompt = useCallback(() => {
    setPromptDismissed(true);
    setNotificationPromptDismissed(true);
  }, []);

  const handleToggleSound = useCallback(() => {
    setSoundMuted((prev) => {
      const nextMuted = !prev;
      setNotificationSoundMuted(nextMuted);
      if (!nextMuted) unlockNotificationAudio();
      return nextMuted;
    });
  }, []);

  const handleTestAlert = useCallback(() => {
    unlockNotificationAudio();
    triggerDeviceAlert(
      {
        id: `test_alert_${Date.now()}`,
        type: 'nueva_comanda',
        title: "Prueba · O'NDE LUIGI",
        message: 'Sonido y notificación del dispositivo funcionando.',
        orderId: '',
        orderNumber: 0,
        shiftId: '',
        actorName: activeWaiter?.name || 'Equipo',
        actorUid: '',
        ownerUid: '',
        createdByUid: '',
        allowedEmails: [],
        createdAtMs: Date.now(),
      },
      { forceOsNotification: true }
    );
  }, [activeWaiter?.name]);

  const handleNotificationAction = useCallback(
    (notif: WorkspaceNotification) => {
      setLiveToasts((prev) => prev.filter((t) => t.id !== notif.id));
      setPanelOpen(false);
      markAllRead();

      if (notif.type === 'nueva_comanda' && permissions.allowedTabs.includes('comandas')) {
        onNavigateTab('comandas');
        return;
      }
      if (notif.type === 'venta_anulada') {
        if (permissions.canViewHistory) {
          onNavigateTab('historial');
        } else if (permissions.allowedTabs.includes('comandas')) {
          onNavigateTab('comandas');
        }
        return;
      }
      if (
        (notif.type === 'turno_abierto' || notif.type === 'turno_cerrado') &&
        permissions.canManageShifts
      ) {
        onOpenShiftModal();
        return;
      }
      if (notif.type === 'solicitud_acceso' && isAdmin) {
        onOpenSettings?.();
      }
    },
    [markAllRead, onNavigateTab, onOpenShiftModal, onOpenSettings, permissions, isAdmin]
  );

  const handleDismissToast = useCallback((notifId: string) => {
    setLiveToasts((prev) => prev.filter((t) => t.id !== notifId));
  }, []);

  const handleDeleteOrDismissNotification = useCallback(
    async (notif: WorkspaceNotification) => {
      setLiveToasts((prev) => prev.filter((t) => t.id !== notif.id));
      if (isSyntheticNotificationId(notif.id)) {
        setDismissedSyntheticIds((prev) => {
          if (prev.includes(notif.id)) return prev;
          const next = [...prev, notif.id].slice(-200);
          persistDismissedSyntheticIds(next);
          return next;
        });
        return;
      }
      await deleteWorkspaceNotification(notif.id);
    },
    [deleteWorkspaceNotification]
  );

  const showFloatingPermPrompt =
    Boolean(sessionMode) &&
    (isRealPrimaryAdmin || Boolean(myLinkedStaff)) &&
    shouldOfferPermissionPrompt(permState, promptDismissed);

  const ctxValue: NotificationCenterContextValue = {
    panelOpen,
    openPanel,
    closePanel,
    visibleNotifications,
    notificationsLoaded,
    unreadCount,
    permState,
    pushSyncStatus,
    soundMuted,
    requestingPerm,
    showFloatingPermPrompt,
    liveToasts,
    isAdmin,
    markAllRead,
    handleRequestDevicePermission,
    handleSyncPushNow,
    handleDismissPrompt,
    handleToggleSound,
    handleTestAlert,
    handleNotificationAction,
    handleDismissToast,
    handleDeleteOrDismissNotification,
  };

  return (
    <NotificationCenterContext.Provider value={ctxValue}>
      {children}
    </NotificationCenterContext.Provider>
  );
};

export const NotificationBellButton: React.FC = () => {
  const { panelOpen, openPanel, unreadCount, permState } = useNotificationCenterContext();

  return (
    <button
      type="button"
      onClick={openPanel}
      aria-expanded={panelOpen}
      aria-haspopup="dialog"
      aria-label={
        unreadCount > 0
          ? `Notificaciones (${unreadCount} sin leer)`
          : 'Notificaciones en tiempo real'
      }
      className="relative min-h-[36px] min-w-[36px] lg:min-h-[34px] lg:px-2.5 flex items-center justify-center gap-1.5 rounded-xl lg:rounded-lg border border-[#27272E] bg-[#1C1C22] lg:bg-[#141418] text-zinc-200 hover:border-amber-500 transition-colors shrink-0"
    >
      <Bell className={`w-4 h-4 ${unreadCount > 0 ? 'text-amber-400' : 'text-zinc-300'}`} />
      <span className="hidden xl:inline text-xs font-semibold">Alertas</span>
      {unreadCount > 0 ? (
        <span className="font-mono text-[10px] font-extrabold bg-red-600 text-white px-1.5 py-0.5 rounded-full leading-none tabular-nums">
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      ) : (
        permState === 'default' && (
          <span
            className="w-2 h-2 rounded-full bg-amber-400 shrink-0"
            aria-hidden="true"
          />
        )
      )}
    </button>
  );
};

export const NotificationCenterOverlays: React.FC = () => {
  const {
    panelOpen,
    closePanel,
    visibleNotifications,
    notificationsLoaded,
    permState,
    pushSyncStatus,
    soundMuted,
    requestingPerm,
    showFloatingPermPrompt,
    liveToasts,
    isAdmin,
    markAllRead,
    handleRequestDevicePermission,
    handleSyncPushNow,
    handleDismissPrompt,
    handleToggleSound,
    handleTestAlert,
    handleNotificationAction,
    handleDismissToast,
    handleDeleteOrDismissNotification,
  } = useNotificationCenterContext();

  if (typeof document === 'undefined') return null;

  return createPortal(
    <>
      {/* One-tap permission bar (shown only while browser permission is 'default' & not dismissed) */}
      {showFloatingPermPrompt && !panelOpen && (
        <div className="fixed bottom-[4.4rem] lg:bottom-4 right-3 left-3 sm:left-auto sm:w-96 z-40 rounded-2xl border border-amber-500/70 bg-[#141418]/95 backdrop-blur-md p-3 shadow-2xl flex items-center justify-between gap-2.5">
          <div className="flex items-center gap-2 min-w-0">
            <BellRing className="w-4 h-4 text-amber-400 shrink-0" />
            <span className="text-xs font-semibold text-zinc-100 leading-snug">
              Activa las alertas del dispositivo para escuchar comandas y turnos.
            </span>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              disabled={requestingPerm}
              onClick={() => void handleRequestDevicePermission()}
              className="min-h-[34px] px-3 rounded-xl bg-amber-500 text-black text-xs font-bold hover:bg-amber-400 whitespace-nowrap"
            >
              {requestingPerm ? '...' : 'Activar'}
            </button>
            <button
              type="button"
              onClick={handleDismissPrompt}
              aria-label="Ocultar aviso de notificaciones"
              className="min-h-[34px] min-w-[30px] flex items-center justify-center rounded-lg text-zinc-400 hover:text-white"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Real-time Toast Stack */}
      {liveToasts.length > 0 && (
        <div
          aria-live="polite"
          aria-label="Alertas en tiempo real"
          className="fixed top-16 right-3 sm:right-5 left-3 sm:left-auto sm:w-96 z-50 flex flex-col gap-2 pointer-events-none"
        >
          {liveToasts.map((toast) => {
            const visuals = getNotifVisuals(toast.type);
            return (
              <div
                key={toast.id}
                role="status"
                className={`pointer-events-auto rounded-2xl border shadow-2xl p-3 flex items-start gap-2.5 transition-all ${visuals.toastTone}`}
              >
                <div className="mt-0.5">{visuals.icon}</div>
                <button
                  type="button"
                  onClick={() => handleNotificationAction(toast)}
                  className="flex-1 min-w-0 text-left"
                >
                  <div className="flex items-center gap-1.5">
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${visuals.tone}`}>
                      {visuals.badge}
                    </span>
                    <span className="text-[10px] text-zinc-400">Ahora</span>
                  </div>
                  <p className="text-xs font-extrabold text-white mt-1 truncate">
                    {toast.title}
                  </p>
                  <p className="text-[11px] text-zinc-300 leading-snug mt-0.5">
                    {toast.message}
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => handleDismissToast(toast.id)}
                  aria-label="Cerrar alerta"
                  className="min-h-[28px] min-w-[28px] flex items-center justify-center rounded-lg text-zinc-400 hover:text-white hover:bg-black/30 shrink-0"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Notification Center Modal / Drawer (Portaled outside backdrop-blur header) */}
      {panelOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-start sm:justify-end bg-black/70 backdrop-blur-sm sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="notif-center-title"
          onClick={closePanel}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full sm:max-w-md bg-[#141418] text-white rounded-t-3xl sm:rounded-2xl border border-[#27272E] shadow-2xl overflow-hidden max-h-[82vh] sm:max-h-[80vh] flex flex-col sm:mt-14"
          >
            <div className="px-4 py-3 border-b border-[#27272E] bg-[#101014] flex items-center justify-between gap-2 shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <Bell className="w-4 h-4 text-amber-400 shrink-0" />
                <h2
                  id="notif-center-title"
                  className="font-poster text-lg font-extrabold tracking-wide uppercase truncate"
                >
                  NOTIFICACIONES ({visibleNotifications.length})
                </h2>
              </div>

              <button
                type="button"
                onClick={closePanel}
                aria-label="Cerrar centro de notificaciones"
                className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl text-zinc-400 hover:bg-[#1C1C22] hover:text-white shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Device Permission & Sound Controls */}
            <div className="px-4 py-2.5 border-b border-[#27272E] bg-[#0A0A0A] space-y-2 shrink-0">
              <div className="flex flex-wrap items-center justify-between gap-1.5">
                <button
                  type="button"
                  onClick={handleToggleSound}
                  className={`min-h-[32px] px-2.5 rounded-lg border text-xs font-semibold flex items-center gap-1.5 transition-colors ${
                    soundMuted
                      ? 'border-[#27272E] bg-[#141418] text-zinc-400'
                      : 'border-amber-500/50 bg-amber-500/10 text-amber-300'
                  }`}
                >
                  {soundMuted ? (
                    <VolumeX className="w-3.5 h-3.5" />
                  ) : (
                    <Volume2 className="w-3.5 h-3.5" />
                  )}
                  <span>{soundMuted ? 'Silenciado' : 'Sonido activo'}</span>
                </button>

                <div className="flex items-center gap-1.5">
                  {permState === 'granted' && (
                    <button
                      type="button"
                      onClick={handleTestAlert}
                      className="min-h-[32px] px-2.5 rounded-lg border border-emerald-700/70 bg-emerald-950/50 text-xs font-semibold text-emerald-300 hover:bg-emerald-950 flex items-center gap-1"
                    >
                      <BellRing className="w-3.5 h-3.5" />
                      <span>Probar</span>
                    </button>
                  )}

                  {visibleNotifications.length > 0 && (
                    <button
                      type="button"
                      onClick={markAllRead}
                      className="min-h-[32px] px-2.5 rounded-lg border border-[#27272E] bg-[#141418] text-xs font-semibold text-zinc-200 hover:border-amber-500 flex items-center gap-1"
                    >
                      <CheckCheck className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Leídas</span>
                    </button>
                  )}
                </div>
              </div>

              {permState === 'default' && (
                <div className="rounded-xl border border-amber-500/50 bg-amber-500/10 px-3 py-2 flex items-center justify-between gap-2">
                  <span className="text-[11px] font-medium text-amber-200">
                    Permiso del dispositivo pendiente
                  </span>
                  <button
                    type="button"
                    disabled={requestingPerm}
                    onClick={() => void handleRequestDevicePermission()}
                    className="min-h-[30px] px-3 rounded-lg bg-amber-500 text-black text-[11px] font-bold hover:bg-amber-400 shrink-0"
                  >
                    {requestingPerm ? 'Solicitando...' : 'Activar permisos'}
                  </button>
                </div>
              )}

              {permState === 'denied' && (
                <div className="rounded-xl border border-red-800/70 bg-red-950/40 px-3 py-2 text-[11px] text-red-200">
                  Notificaciones bloqueadas en el navegador. Habilítalas en la configuración del sitio para recibir alertas en segundo plano.
                </div>
              )}

              <div
                className={`rounded-xl border px-3 py-2 flex items-center justify-between gap-2 text-[11px] ${
                  pushSyncStatus.status === 'active'
                    ? 'border-emerald-700/60 bg-emerald-950/40 text-emerald-200'
                    : pushSyncStatus.status === 'blocked' || pushSyncStatus.status === 'error'
                      ? 'border-red-800/70 bg-red-950/35 text-red-200'
                      : 'border-[#27272E] bg-[#141418] text-zinc-300'
                }`}
              >
                <div className="flex items-start gap-1.5 min-w-0">
                  <Smartphone className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-400" />
                  <span className="leading-snug">{pushSyncStatus.message}</span>
                </div>
                {permState === 'granted' && pushSyncStatus.status !== 'active' && (
                  <button
                    type="button"
                    disabled={requestingPerm}
                    onClick={() => void handleSyncPushNow()}
                    className="min-h-[28px] px-2.5 rounded-lg border border-amber-500/60 bg-amber-500/15 text-[10px] font-bold text-amber-300 hover:bg-amber-500/25 shrink-0"
                  >
                    Reintentar
                  </button>
                )}
              </div>
            </div>

            <div className="p-3 overflow-y-auto space-y-2 flex-1">
              {!notificationsLoaded && visibleNotifications.length === 0 ? (
                <div className="py-10 px-4 text-center space-y-2">
                  <Loader2 className="w-7 h-7 text-amber-400 animate-spin mx-auto" />
                  <p className="text-sm font-bold text-zinc-300">
                    Cargando notificaciones...
                  </p>
                </div>
              ) : visibleNotifications.length === 0 ? (
                <div className="py-10 px-4 text-center space-y-1.5">
                  <Bell className="w-8 h-8 text-zinc-600 mx-auto" />
                  <p className="text-sm font-bold text-zinc-300">
                    Sin notificaciones aún
                  </p>
                  <p className="text-xs text-zinc-500 max-w-xs mx-auto">
                    Aquí aparecerán las comandas nuevas, aperturas y cierres de turno y anulaciones.
                  </p>
                </div>
              ) : (
                visibleNotifications.slice(0, 60).map((notif) => {
                  const visuals = getNotifVisuals(notif.type);
                  return (
                    <div
                      key={notif.id}
                      className="rounded-xl border border-[#27272E] bg-[#0A0A0A] p-3 flex items-start gap-2.5 hover:border-zinc-700 transition-colors"
                    >
                      <div className="mt-0.5">{visuals.icon}</div>
                      <button
                        type="button"
                        onClick={() => handleNotificationAction(notif)}
                        className="flex-1 min-w-0 text-left"
                      >
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span
                            className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${visuals.tone}`}
                          >
                            {visuals.badge}
                          </span>
                          <span className="text-[11px] text-zinc-500">
                            {formatDateTimeShort(notif.createdAtMs)}
                          </span>
                        </div>
                        <p className="text-xs font-bold text-white mt-1 leading-snug">
                          {notif.title}
                        </p>
                        <p className="text-[11px] text-zinc-400 mt-0.5 leading-snug">
                          {notif.message}
                        </p>
                      </button>
                      {isAdmin && (
                        <button
                          type="button"
                          onClick={() => void handleDeleteOrDismissNotification(notif)}
                          aria-label={`Eliminar notificación ${notif.title}`}
                          className="min-h-[30px] min-w-[30px] flex items-center justify-center rounded-lg text-zinc-500 hover:text-red-400 hover:bg-red-950/40 shrink-0"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </>,
    document.body
  );
};
