import type { User } from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase/config';
import { ADMIN_BOOTSTRAP_EMAIL, buildInitialCatalogSeed } from '../data/initialCatalog';
import type {
  AccountRole,
  AddonOption,
  Movement,
  Order,
  OrderItem,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  Product,
  Sauce,
  StaffMember,
  StaffRole,
  TransferReceipt,
} from '../types/pos';
import { findLinkedStaffMember } from '../utils/identityState';
import { isValidStaffRole } from '../utils/rolePermissions';

export const SHARED_WORKSPACE_ID = 'ws_onde_luigi';

export function toMillis(val: unknown): number {
  if (val instanceof Timestamp) return val.toMillis();
  if (typeof val === 'number') return val;
  if (
    val &&
    typeof val === 'object' &&
    'toMillis' in val &&
    typeof (val as { toMillis: () => number }).toMillis === 'function'
  ) {
    return (val as { toMillis: () => number }).toMillis();
  }
  return Date.now();
}

export function stripClientTimestamps<T extends { createdAtMs?: number; updatedAtMs?: number }>(
  obj: T
): Omit<T, 'createdAtMs' | 'updatedAtMs'> {
  const { createdAtMs: _c, updatedAtMs: _u, ...rest } = obj;
  return rest;
}

export function mapStaffDoc(d: Record<string, unknown>, fallbackId = ''): StaffMember {
  return {
    id: String(d.id || fallbackId),
    name: String(d.name || ''),
    role: isValidStaffRole(d.role) ? d.role : 'mesero',
    active: Boolean(d.active),
    linkedUid: String(d.linkedUid || ''),
    linkedEmail: String(d.linkedEmail || ''),
    ownerUid: String(d.ownerUid || ''),
    createdByUid: String(d.createdByUid || ''),
    allowedEmails: Array.isArray(d.allowedEmails) ? (d.allowedEmails as string[]) : [],
    createdAtMs: toMillis(d.createdAt),
    updatedAtMs: toMillis(d.updatedAt),
  };
}

export function mapSauceDoc(d: Record<string, unknown>): Sauce {
  return {
    id: String(d.id),
    name: String(d.name),
    active: Boolean(d.active),
    ownerUid: String(d.ownerUid),
    createdByUid: String(d.createdByUid),
    allowedEmails: Array.isArray(d.allowedEmails) ? (d.allowedEmails as string[]) : [],
    createdAtMs: toMillis(d.createdAt),
    updatedAtMs: toMillis(d.updatedAt),
  };
}

export function mapProductDoc(d: Record<string, unknown>): Product {
  return {
    id: String(d.id),
    name: String(d.name),
    category: String(d.category),
    basePrice: Number(d.basePrice) || 0,
    imageUrl: String(d.imageUrl || ''),
    baseRecipe: Array.isArray(d.baseRecipe) ? (d.baseRecipe as string[]) : [],
    removableOptions: Array.isArray(d.removableOptions) ? (d.removableOptions as string[]) : [],
    addonOptions: Array.isArray(d.addonOptions)
      ? (d.addonOptions as AddonOption[]).map((ex) => ({
          ...ex,
          allowMultiple: ex.allowMultiple !== false,
        }))
      : [],
    allowSauces: d.allowSauces !== undefined ? Boolean(d.allowSauces) : true,
    minSauces: d.minSauces !== undefined ? Number(d.minSauces) : 1,
    maxSauces: d.maxSauces !== undefined ? Number(d.maxSauces) : 4,
    active: Boolean(d.active),
    ownerUid: String(d.ownerUid),
    createdByUid: String(d.createdByUid),
    allowedEmails: Array.isArray(d.allowedEmails) ? (d.allowedEmails as string[]) : [],
    createdAtMs: toMillis(d.createdAt),
    updatedAtMs: toMillis(d.updatedAt),
  };
}

export function mapOrderDoc(d: Record<string, unknown>): Order {
  return {
    id: String(d.id),
    orderNumber: Number(d.orderNumber) || 1,
    reference: String(d.reference),
    waiterId: String(d.waiterId),
    waiterName: String(d.waiterName),
    status: d.status as OrderStatus,
    paymentStatus: d.paymentStatus as PaymentStatus,
    paymentMethod: (d.paymentMethod || '') as PaymentMethod,
    items: Array.isArray(d.items)
      ? (d.items as OrderItem[]).map((it) => ({
          ...it,
          selectedSauces: Array.isArray(it.selectedSauces) ? it.selectedSauces : [],
        }))
      : [],
    subtotal: Number(d.subtotal) || 0,
    total: Number(d.total) || 0,
    notes: String(d.notes || ''),
    receiptCount: Number(d.receiptCount) || 0,
    latestReceiptUrl: String(d.latestReceiptUrl || ''),
    voidReason: d.voidReason ? String(d.voidReason) : undefined,
    voidedByName: d.voidedByName ? String(d.voidedByName) : undefined,
    voidedAtMs: d.voidedAtMs ? Number(d.voidedAtMs) : undefined,
    ownerUid: String(d.ownerUid),
    createdByUid: String(d.createdByUid),
    allowedEmails: Array.isArray(d.allowedEmails) ? (d.allowedEmails as string[]) : [],
    createdAtMs: toMillis(d.createdAt),
    updatedAtMs: toMillis(d.updatedAt),
  };
}

export function mapMovementDoc(d: Record<string, unknown>): Movement {
  return {
    id: String(d.id),
    orderId: String(d.orderId),
    orderNumber: Number(d.orderNumber) || 1,
    orderReference: String(d.orderReference),
    type: d.type as Movement['type'],
    description: String(d.description),
    waiterId: String(d.waiterId),
    waiterName: String(d.waiterName),
    actorUid: String(d.actorUid),
    details: (d.details || {}) as Record<string, string | number | boolean>,
    ownerUid: String(d.ownerUid),
    createdByUid: String(d.createdByUid),
    allowedEmails: Array.isArray(d.allowedEmails) ? (d.allowedEmails as string[]) : [],
    createdAtMs: toMillis(d.createdAt),
  };
}

export function mapTransferDoc(d: Record<string, unknown>): TransferReceipt {
  return {
    id: String(d.id),
    orderId: String(d.orderId),
    orderNumber: Number(d.orderNumber) || 1,
    orderReference: String(d.orderReference),
    amount: Number(d.amount) || 0,
    imageUrl: String(d.imageUrl),
    storagePath: String(d.storagePath || ''),
    waiterId: String(d.waiterId),
    waiterName: String(d.waiterName),
    paymentStatus: d.paymentStatus as PaymentStatus,
    notes: String(d.notes || ''),
    annulled: Boolean(d.annulled),
    annulledByName: d.annulledByName ? String(d.annulledByName) : undefined,
    annulledReason: d.annulledReason ? String(d.annulledReason) : undefined,
    annulledAtMs: d.annulledAtMs ? Number(d.annulledAtMs) : undefined,
    ownerUid: String(d.ownerUid),
    createdByUid: String(d.createdByUid),
    allowedEmails: Array.isArray(d.allowedEmails) ? (d.allowedEmails as string[]) : [],
    createdAtMs: toMillis(d.createdAt),
  };
}

export interface WorkspaceBootstrapInfo {
  ownerUid: string;
  authorizedEmails: string[];
  allowSelfRegistration: boolean;
  memberRole: AccountRole;
}

export async function resolveOrBootstrapCloudWorkspace(
  user: User
): Promise<WorkspaceBootstrapInfo | null> {
  if (!db) return null;
  const wsRef = doc(db, 'workspaces', SHARED_WORKSPACE_ID);
  const dirRef = doc(db, 'workspaceDirectory', SHARED_WORKSPACE_ID);
  const memberRef = doc(db, 'workspaces', SHARED_WORKSPACE_ID, 'members', user.uid);
  const userEmail = (user.email || '').toLowerCase();
  const isAdminEmail = userEmail === ADMIN_BOOTSTRAP_EMAIL;

  // 1. Principal Admin bootstrap & backfill
  if (isAdminEmail) {
    try {
      const snap = await getDoc(wsRef);
      if (!snap.exists()) {
        const batch = writeBatch(db);
        const initialEmails = [userEmail];
        batch.set(wsRef, {
          id: SHARED_WORKSPACE_ID,
          name: "O'NDE LUIGI",
          ownerUid: user.uid,
          ownerEmail: userEmail,
          authorizedEmails: initialEmails,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        batch.set(dirRef, {
          id: SHARED_WORKSPACE_ID,
          name: "O'NDE LUIGI",
          ownerUid: user.uid,
          allowSelfRegistration: true,
          updatedAt: serverTimestamp(),
        });
        batch.set(memberRef, {
          uid: user.uid,
          displayName: (user.displayName || userEmail || 'Administrador').trim().slice(0, 100),
          role: 'admin',
          active: true,
          ownerUid: user.uid,
          createdAt: serverTimestamp(),
        });

        const adminStaffId = `staff_${user.uid}`;
        batch.set(doc(db, 'workspaces', SHARED_WORKSPACE_ID, 'staff', adminStaffId), {
          id: adminStaffId,
          name: (user.displayName || 'Administrador').trim().slice(0, 80),
          role: 'admin',
          active: true,
          linkedUid: user.uid,
          linkedEmail: user.email || userEmail,
          ownerUid: user.uid,
          createdByUid: user.uid,
          allowedEmails: initialEmails,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        const seed = buildInitialCatalogSeed(user.uid, userEmail);
        for (const sauce of seed.sauces) {
          batch.set(doc(db, 'workspaces', SHARED_WORKSPACE_ID, 'sauces', sauce.id), {
            id: sauce.id,
            name: sauce.name,
            active: sauce.active,
            ownerUid: user.uid,
            createdByUid: user.uid,
            allowedEmails: initialEmails,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
        for (const prod of seed.products) {
          batch.set(doc(db, 'workspaces', SHARED_WORKSPACE_ID, 'products', prod.id), {
            ...stripClientTimestamps(prod),
            ownerUid: user.uid,
            createdByUid: user.uid,
            allowedEmails: initialEmails,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }

        await batch.commit();
        return {
          ownerUid: user.uid,
          authorizedEmails: initialEmails,
          allowSelfRegistration: true,
          memberRole: 'admin',
        };
      }

      const data = snap.data() as { name?: string; ownerUid: string; authorizedEmails?: string[] };
      const emails = Array.isArray(data.authorizedEmails)
        ? data.authorizedEmails.map((e) => e.toLowerCase())
        : [ADMIN_BOOTSTRAP_EMAIL];

      const [dirSnap, memberSnap, staffSnap] = await Promise.all([
        getDoc(dirRef),
        getDoc(memberRef),
        getDocs(
          query(
            collection(db, 'workspaces', SHARED_WORKSPACE_ID, 'staff'),
            where('ownerUid', '==', data.ownerUid)
          )
        ),
      ]);

      let currentAllowSelf = true;
      if (!dirSnap.exists()) {
        await setDoc(dirRef, {
          id: SHARED_WORKSPACE_ID,
          name: (data.name || "O'NDE LUIGI").slice(0, 120),
          ownerUid: data.ownerUid,
          allowSelfRegistration: true,
          updatedAt: serverTimestamp(),
        });
      } else {
        currentAllowSelf = Boolean(
          (dirSnap.data() as { allowSelfRegistration?: boolean }).allowSelfRegistration
        );
      }

      if (!memberSnap.exists()) {
        await setDoc(memberRef, {
          uid: user.uid,
          displayName: (user.displayName || userEmail || 'Administrador').trim().slice(0, 100),
          role: 'admin',
          active: true,
          ownerUid: data.ownerUid,
          createdAt: serverTimestamp(),
        });
      }

      const existingStaffList = staffSnap.docs.map((d) =>
        mapStaffDoc(d.data() as Record<string, unknown>, d.id)
      );
      const existingAdminStaff = findLinkedStaffMember(existingStaffList, user.uid, userEmail);
      if (!existingAdminStaff) {
        const adminStaffId = `staff_${user.uid}`;
        await setDoc(doc(db, 'workspaces', SHARED_WORKSPACE_ID, 'staff', adminStaffId), {
          id: adminStaffId,
          name: (user.displayName || 'Administrador').trim().slice(0, 80),
          role: 'admin',
          active: true,
          linkedUid: user.uid,
          linkedEmail: user.email || userEmail,
          ownerUid: data.ownerUid,
          createdByUid: user.uid,
          allowedEmails: emails,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else if (!existingAdminStaff.active || existingAdminStaff.linkedUid !== user.uid) {
        await updateDoc(doc(db, 'workspaces', SHARED_WORKSPACE_ID, 'staff', existingAdminStaff.id), {
          active: true,
          linkedUid: user.uid,
          linkedEmail: user.email || userEmail,
          updatedAt: serverTimestamp(),
        });
      }

      return {
        ownerUid: data.ownerUid,
        authorizedEmails: emails,
        allowSelfRegistration: currentAllowSelf,
        memberRole: 'admin',
      };
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, `workspaces/${SHARED_WORKSPACE_ID}`);
      return null;
    }
  }

  // 2. Non-admin user flow
  const [memberSnap, dirSnap] = await Promise.all([
    getDoc(memberRef).catch((err) => {
      handleFirestoreError(err, OperationType.GET, `workspaces/${SHARED_WORKSPACE_ID}/members/${user.uid}`);
      throw err;
    }),
    getDoc(dirRef).catch((err) => {
      handleFirestoreError(err, OperationType.GET, `workspaceDirectory/${SHARED_WORKSPACE_ID}`);
      throw err;
    }),
  ]);

  const dirAllowSelf = dirSnap.exists()
    ? Boolean((dirSnap.data() as { allowSelfRegistration?: boolean }).allowSelfRegistration)
    : false;
  let resolvedRole: AccountRole = 'mesero';

  if (memberSnap.exists()) {
    const mData = memberSnap.data() as { active?: boolean; role?: string };
    if (mData.active === false) {
      throw new Error(
        'Tu acceso fue desactivado por el administrador. Pídele que vuelva a activarte en Ajustes.'
      );
    }
    resolvedRole = mData.role === 'admin' ? 'admin' : 'mesero';
  } else if (dirSnap.exists() && dirAllowSelf) {
    const dirData = dirSnap.data() as { ownerUid: string };
    try {
      await setDoc(memberRef, {
        uid: user.uid,
        displayName: (user.displayName || userEmail || 'Mesero').trim().slice(0, 100),
        role: 'mesero',
        active: true,
        ownerUid: dirData.ownerUid,
        createdAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `workspaces/${SHARED_WORKSPACE_ID}/members/${user.uid}`);
    }
  } else {
    let preAuthorizedSnap;
    try {
      preAuthorizedSnap = await getDoc(wsRef);
    } catch {
      if (!dirSnap.exists()) {
        throw new Error(
          `El administrador (${ADMIN_BOOTSTRAP_EMAIL}) debe abrir la aplicación una vez para activar el acceso del equipo.`
        );
      }
      throw new Error(
        `El registro abierto está desactivado. Pide al administrador (${ADMIN_BOOTSTRAP_EMAIL}) que active el acceso con enlace o agregue tu correo (${userEmail}) en Ajustes.`
      );
    }

    if (!preAuthorizedSnap.exists()) {
      throw new Error(
        `El espacio O'NDE LUIGI aún no ha sido inicializado por el administrador (${ADMIN_BOOTSTRAP_EMAIL}).`
      );
    }

    const preData = preAuthorizedSnap.data() as { ownerUid: string; authorizedEmails?: string[] };
    const preEmails = Array.isArray(preData.authorizedEmails)
      ? preData.authorizedEmails.map((e) => e.toLowerCase())
      : [ADMIN_BOOTSTRAP_EMAIL];

    if (preData.ownerUid !== user.uid && !preEmails.includes(userEmail)) {
      throw new Error(
        `La cuenta ${userEmail} no está autorizada. Pide al administrador (${ADMIN_BOOTSTRAP_EMAIL}) que agregue tu correo en Ajustes.`
      );
    }

    await setDoc(memberRef, {
      uid: user.uid,
      displayName: (user.displayName || userEmail || 'Mesero').trim().slice(0, 100),
      role: preData.ownerUid === user.uid ? 'admin' : 'mesero',
      active: true,
      ownerUid: preData.ownerUid,
      createdAt: serverTimestamp(),
    });
    resolvedRole = preData.ownerUid === user.uid ? 'admin' : 'mesero';
  }

  try {
    const wsSnap = await getDoc(wsRef);
    if (!wsSnap.exists()) {
      throw new Error(
        `El espacio O'NDE LUIGI aún no ha sido inicializado por el administrador (${ADMIN_BOOTSTRAP_EMAIL}).`
      );
    }
    const wsData = wsSnap.data() as { ownerUid: string; authorizedEmails?: string[] };
    const emails = Array.isArray(wsData.authorizedEmails)
      ? wsData.authorizedEmails.map((e) => e.toLowerCase())
      : [ADMIN_BOOTSTRAP_EMAIL];
    return {
      ownerUid: wsData.ownerUid,
      authorizedEmails: emails,
      allowSelfRegistration: dirAllowSelf,
      memberRole: wsData.ownerUid === user.uid ? 'admin' : resolvedRole,
    };
  } catch (error) {
    if (error instanceof Error && error.message.includes('no ha sido inicializado')) {
      throw error;
    }
    handleFirestoreError(error, OperationType.GET, `workspaces/${SHARED_WORKSPACE_ID}`);
    return null;
  }
}
