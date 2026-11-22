import type { AccountRole, AppTab, ConnectionMode, StaffMember, StaffRole } from '../types/pos';

export const ALL_STAFF_ROLES: StaffRole[] = ['admin', 'mesero', 'cajero', 'cocina'];

export const ROLE_LABELS: Record<StaffRole, string> = {
  admin: 'Administrador',
  mesero: 'Mesero',
  cajero: 'Caja',
  cocina: 'Cocina',
};

export const ROLE_DESCRIPTIONS: Record<StaffRole, string> = {
  admin: 'Acceso total: pedidos, comandas, cobros, ventas, menú y eliminar rastros.',
  mesero: 'Toma y edita pedidos, entrega comandas, cobra y anula; sin Ventas, Menú ni eliminar rastros.',
  cajero: 'Cobra pedidos, gestiona transferencias, anula y toma pedidos en caja; sin cocina, Ventas, Menú ni eliminar rastros.',
  cocina: 'Solo pantalla de Comandas en preparación (Tomado → En preparación → Listo); sin cobros, caja, pedidos ni anulaciones.',
};

export interface RolePermissions {
  role: StaffRole;
  label: string;
  allowedTabs: AppTab[];
  defaultTab: AppTab;
  canTakeOrders: boolean;
  canEditOrders: boolean;
  canAdvanceKitchen: boolean;
  canDeliverOrders: boolean;
  canManagePayments: boolean;
  canViewTransfers: boolean;
  canUploadReceipts: boolean;
  canVoidOrders: boolean;
  canVoidReceipts: boolean;
  canViewHistory: boolean;
  canViewSales: boolean;
  canManageMenu: boolean;
  canHardDelete: boolean;
  canManageTeam: boolean;
}

export function isValidStaffRole(value: unknown): value is StaffRole {
  return value === 'admin' || value === 'mesero' || value === 'cajero' || value === 'cocina';
}

export function getRolePermissions(role: StaffRole): RolePermissions {
  switch (role) {
    case 'admin':
      return {
        role: 'admin',
        label: ROLE_LABELS.admin,
        allowedTabs: ['pedidos', 'comandas', 'historial', 'transferencias', 'ventas', 'menu'],
        defaultTab: 'pedidos',
        canTakeOrders: true,
        canEditOrders: true,
        canAdvanceKitchen: true,
        canDeliverOrders: true,
        canManagePayments: true,
        canViewTransfers: true,
        canUploadReceipts: true,
        canVoidOrders: true,
        canVoidReceipts: true,
        canViewHistory: true,
        canViewSales: true,
        canManageMenu: true,
        canHardDelete: true,
        canManageTeam: true,
      };
    case 'mesero':
      return {
        role: 'mesero',
        label: ROLE_LABELS.mesero,
        allowedTabs: ['pedidos', 'comandas', 'historial', 'transferencias'],
        defaultTab: 'pedidos',
        canTakeOrders: true,
        canEditOrders: true,
        canAdvanceKitchen: true,
        canDeliverOrders: true,
        canManagePayments: true,
        canViewTransfers: true,
        canUploadReceipts: true,
        canVoidOrders: true,
        canVoidReceipts: true,
        canViewHistory: true,
        canViewSales: false,
        canManageMenu: false,
        canHardDelete: false,
        canManageTeam: false,
      };
    case 'cajero':
      return {
        role: 'cajero',
        label: ROLE_LABELS.cajero,
        allowedTabs: ['pedidos', 'comandas', 'historial', 'transferencias'],
        defaultTab: 'comandas',
        canTakeOrders: true,
        canEditOrders: true,
        canAdvanceKitchen: false,
        canDeliverOrders: true,
        canManagePayments: true,
        canViewTransfers: true,
        canUploadReceipts: true,
        canVoidOrders: true,
        canVoidReceipts: true,
        canViewHistory: true,
        canViewSales: false,
        canManageMenu: false,
        canHardDelete: false,
        canManageTeam: false,
      };
    case 'cocina':
      return {
        role: 'cocina',
        label: ROLE_LABELS.cocina,
        allowedTabs: ['comandas'],
        defaultTab: 'comandas',
        canTakeOrders: false,
        canEditOrders: false,
        canAdvanceKitchen: true,
        canDeliverOrders: false,
        canManagePayments: false,
        canViewTransfers: false,
        canUploadReceipts: false,
        canVoidOrders: false,
        canVoidReceipts: false,
        canViewHistory: false,
        canViewSales: false,
        canManageMenu: false,
        canHardDelete: false,
        canManageTeam: false,
      };
  }
}

export interface EffectiveRoleParams {
  sessionMode: ConnectionMode | null;
  isRealPrimaryAdmin: boolean;
  previewRole: StaffRole;
  demoAccountRole: StaffRole;
  cloudMemberRole: AccountRole;
  myLinkedStaff: StaffMember | null;
}

export function resolveEffectiveRole({
  sessionMode,
  isRealPrimaryAdmin,
  previewRole,
  demoAccountRole,
  cloudMemberRole,
  myLinkedStaff,
}: EffectiveRoleParams): StaffRole {
  if (isRealPrimaryAdmin) {
    return isValidStaffRole(previewRole) ? previewRole : 'admin';
  }
  if (sessionMode === 'demo') {
    return isValidStaffRole(demoAccountRole) ? demoAccountRole : 'mesero';
  }
  if (myLinkedStaff && isValidStaffRole(myLinkedStaff.role)) {
    return myLinkedStaff.role;
  }
  return cloudMemberRole === 'admin' ? 'admin' : 'mesero';
}

export function isTabAllowedForRole(role: StaffRole, tab: AppTab): boolean {
  return getRolePermissions(role).allowedTabs.includes(tab);
}
