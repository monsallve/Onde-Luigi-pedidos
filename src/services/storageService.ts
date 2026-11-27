import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { storage } from '../firebase/config';

export interface CompressedImageResult {
  blob: Blob;
  dataUrl: string;
  width: number;
  height: number;
  originalBytes: number;
  compressedBytes: number;
  mimeType: 'image/webp' | 'image/jpeg';
  extension: 'webp' | 'jpg';
}

export interface ReceiptUploadResult {
  imageUrl: string;
  storagePath: string;
  compressedBytes: number;
  originalBytes: number;
  usedFallbackInline: boolean;
}

const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';

let cachedWebpSupport: boolean | null = null;

function supportsCanvasWebp(): boolean {
  if (cachedWebpSupport !== null) return cachedWebpSupport;
  try {
    const probe = document.createElement('canvas');
    probe.width = 2;
    probe.height = 2;
    cachedWebpSupport = probe.toDataURL('image/webp', 0.8).startsWith('data:image/webp');
  } catch {
    cachedWebpSupport = false;
  }
  return cachedWebpSupport;
}

export async function compressImageFile(
  file: File,
  maxDimension = 1200,
  quality = 0.78,
  backgroundColor = '#FFFFFF'
): Promise<CompressedImageResult> {
  const originalBytes = file.size;
  const targetMime: 'image/webp' | 'image/jpeg' = supportsCanvasWebp()
    ? 'image/webp'
    : 'image/jpeg';
  const extension: 'webp' | 'jpg' = targetMime === 'image/webp' ? 'webp' : 'jpg';

  const dataUrlRaw = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('No se pudo leer la imagen seleccionada.'));
    reader.readAsDataURL(file);
  });

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('El archivo no es una imagen válida.'));
    image.src = dataUrlRaw;
  });

  const drawScaled = (targetMax: number) => {
    let { width, height } = img;
    if (width > targetMax || height > targetMax) {
      if (width >= height) {
        height = Math.round((height * targetMax) / width);
        width = targetMax;
      } else {
        width = Math.round((width * targetMax) / height);
        height = targetMax;
      }
    }
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, width);
    canvas.height = Math.max(1, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('No se pudo inicializar el compresor de imágenes.');
    }
    if (backgroundColor && backgroundColor !== 'transparent') {
      ctx.fillStyle = backgroundColor;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas;
  };

  let activeMaxDim = maxDimension;
  let canvas = drawScaled(activeMaxDim);

  // Target <= ~140KB in WebP so both Storage bandwidth and Firestore inline fallbacks stay ultra-light
  let currentQuality = quality;
  let dataUrl = canvas.toDataURL(targetMime, currentQuality);
  while (dataUrl.length > 140000 && currentQuality > 0.44) {
    currentQuality -= 0.08;
    dataUrl = canvas.toDataURL(targetMime, currentQuality);
  }

  while (dataUrl.length > 165000 && activeMaxDim > 360) {
    activeMaxDim = Math.round(activeMaxDim * 0.72);
    canvas = drawScaled(activeMaxDim);
    dataUrl = canvas.toDataURL(targetMime, Math.max(0.45, currentQuality));
  }

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => {
        if (b) resolve(b);
        else reject(new Error('Error al comprimir la imagen.'));
      },
      targetMime,
      currentQuality
    );
  });

  return {
    blob,
    dataUrl,
    width: canvas.width,
    height: canvas.height,
    originalBytes,
    compressedBytes: blob.size,
    mimeType: targetMime,
    extension,
  };
}

export async function uploadTransferReceiptImage(params: {
  workspaceId: string;
  transferId: string;
  file: File;
}): Promise<ReceiptUploadResult> {
  const compressed = await compressImageFile(params.file, 1200, 0.76, '#FFFFFF');

  if (storage) {
    const storagePath = `workspaces/${params.workspaceId}/transfers/${params.transferId}.${compressed.extension}`;
    try {
      const storageRef = ref(storage, storagePath);
      await uploadBytes(storageRef, compressed.blob, {
        contentType: compressed.mimeType,
        cacheControl: IMMUTABLE_CACHE_CONTROL,
      });
      const downloadUrl = await getDownloadURL(storageRef);
      return {
        imageUrl: downloadUrl,
        storagePath,
        compressedBytes: compressed.compressedBytes,
        originalBytes: compressed.originalBytes,
        usedFallbackInline: false,
      };
    } catch {
      // Fall back to compressed inline Data URL if Storage bucket rules or billing aren't enabled yet
    }
  }

  return {
    imageUrl: compressed.dataUrl,
    storagePath: `inline/${params.transferId}.${compressed.extension}`,
    compressedBytes: compressed.compressedBytes,
    originalBytes: compressed.originalBytes,
    usedFallbackInline: true,
  };
}

export async function uploadProductImage(params: {
  workspaceId: string;
  productId: string;
  file: File;
}): Promise<ReceiptUploadResult> {
  const compressed = await compressImageFile(params.file, 900, 0.78, '#141418');

  if (storage) {
    const storagePath = `workspaces/${params.workspaceId}/products/${params.productId}_${Date.now()}.${compressed.extension}`;
    try {
      const storageRef = ref(storage, storagePath);
      await uploadBytes(storageRef, compressed.blob, {
        contentType: compressed.mimeType,
        cacheControl: IMMUTABLE_CACHE_CONTROL,
      });
      const downloadUrl = await getDownloadURL(storageRef);
      return {
        imageUrl: downloadUrl,
        storagePath,
        compressedBytes: compressed.compressedBytes,
        originalBytes: compressed.originalBytes,
        usedFallbackInline: false,
      };
    } catch {
      // Fall back to compressed inline Data URL if Storage bucket rules or billing aren't enabled yet
    }
  }

  return {
    imageUrl: compressed.dataUrl,
    storagePath: `inline/products/${params.productId}.${compressed.extension}`,
    compressedBytes: compressed.compressedBytes,
    originalBytes: compressed.originalBytes,
    usedFallbackInline: true,
  };
}

export async function uploadSelfServiceReceiptImage(params: {
  workspaceId: string;
  orderId: string;
  file: File;
}): Promise<ReceiptUploadResult> {
  const compressed = await compressImageFile(params.file, 1200, 0.76, '#FFFFFF');

  if (storage) {
    const storagePath = `selfOrders/${params.workspaceId}/${params.orderId}/receipt_${Date.now()}.${compressed.extension}`;
    try {
      const storageRef = ref(storage, storagePath);
      await uploadBytes(storageRef, compressed.blob, {
        contentType: compressed.mimeType,
        cacheControl: IMMUTABLE_CACHE_CONTROL,
      });
      const downloadUrl = await getDownloadURL(storageRef);
      return {
        imageUrl: downloadUrl,
        storagePath,
        compressedBytes: compressed.compressedBytes,
        originalBytes: compressed.originalBytes,
        usedFallbackInline: false,
      };
    } catch {
      // Fall back to compressed inline Data URL if Storage rules haven't been deployed yet
    }
  }

  return {
    imageUrl: compressed.dataUrl,
    storagePath: `inline/selfOrders/${params.orderId}.${compressed.extension}`,
    compressedBytes: compressed.compressedBytes,
    originalBytes: compressed.originalBytes,
    usedFallbackInline: true,
  };
}

export async function uploadStorefrontQrImage(params: {
  workspaceId: string;
  file: File;
}): Promise<ReceiptUploadResult> {
  const compressed = await compressImageFile(params.file, 900, 0.84, '#FFFFFF');

  if (storage) {
    const storagePath = `workspaces/${params.workspaceId}/storefront/qr_${Date.now()}.${compressed.extension}`;
    try {
      const storageRef = ref(storage, storagePath);
      await uploadBytes(storageRef, compressed.blob, {
        contentType: compressed.mimeType,
        cacheControl: IMMUTABLE_CACHE_CONTROL,
      });
      const downloadUrl = await getDownloadURL(storageRef);
      return {
        imageUrl: downloadUrl,
        storagePath,
        compressedBytes: compressed.compressedBytes,
        originalBytes: compressed.originalBytes,
        usedFallbackInline: false,
      };
    } catch (err) {
      const code =
        typeof err === 'object' && err !== null && 'code' in err
          ? String((err as { code?: unknown }).code || '')
          : '';
      if (code === 'storage/unauthorized' || code === 'storage/unauthenticated') {
        throw new Error(
          'Acceso denegado: solo un Administrador puede subir o reemplazar la imagen QR en Firebase Storage.'
        );
      }
      // Fall back to compressed inline Data URL only if Storage bucket rules or billing aren't enabled yet
    }
  }

  return {
    imageUrl: compressed.dataUrl,
    storagePath: `inline/storefront/qr.${compressed.extension}`,
    compressedBytes: compressed.compressedBytes,
    originalBytes: compressed.originalBytes,
    usedFallbackInline: true,
  };
}


