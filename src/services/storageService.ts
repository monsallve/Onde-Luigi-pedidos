import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { storage } from '../firebase/config';

export interface CompressedImageResult {
  blob: Blob;
  dataUrl: string;
  width: number;
  height: number;
  originalBytes: number;
  compressedBytes: number;
}

export interface ReceiptUploadResult {
  imageUrl: string;
  storagePath: string;
  compressedBytes: number;
  originalBytes: number;
  usedFallbackInline: boolean;
}

export async function compressImageFile(
  file: File,
  maxDimension = 1200,
  quality = 0.78,
  backgroundColor = '#FFFFFF'
): Promise<CompressedImageResult> {
  const originalBytes = file.size;

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
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas;
  };

  let activeMaxDim = maxDimension;
  let canvas = drawScaled(activeMaxDim);

  // Target <= ~220KB so fallback Firestore/localStorage stays strictly within 250KB limits
  let currentQuality = quality;
  let dataUrl = canvas.toDataURL('image/jpeg', currentQuality);
  while (dataUrl.length > 220000 && currentQuality > 0.42) {
    currentQuality -= 0.1;
    dataUrl = canvas.toDataURL('image/jpeg', currentQuality);
  }

  while (dataUrl.length > 230000 && activeMaxDim > 360) {
    activeMaxDim = Math.round(activeMaxDim * 0.72);
    canvas = drawScaled(activeMaxDim);
    dataUrl = canvas.toDataURL('image/jpeg', Math.max(0.45, currentQuality));
  }

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => {
        if (b) resolve(b);
        else reject(new Error('Error al comprimir la imagen.'));
      },
      'image/jpeg',
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
  };
}

export async function uploadTransferReceiptImage(params: {
  workspaceId: string;
  transferId: string;
  file: File;
}): Promise<ReceiptUploadResult> {
  const compressed = await compressImageFile(params.file, 1200, 0.78, '#FFFFFF');

  if (storage) {
    const storagePath = `workspaces/${params.workspaceId}/transfers/${params.transferId}.jpg`;
    try {
      const storageRef = ref(storage, storagePath);
      await uploadBytes(storageRef, compressed.blob, {
        contentType: 'image/jpeg',
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
    storagePath: `inline/${params.transferId}.jpg`,
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
  const compressed = await compressImageFile(params.file, 900, 0.82, '#141418');

  if (storage) {
    const storagePath = `workspaces/${params.workspaceId}/products/${params.productId}_${Date.now()}.jpg`;
    try {
      const storageRef = ref(storage, storagePath);
      await uploadBytes(storageRef, compressed.blob, {
        contentType: 'image/jpeg',
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
    storagePath: `inline/products/${params.productId}.jpg`,
    compressedBytes: compressed.compressedBytes,
    originalBytes: compressed.originalBytes,
    usedFallbackInline: true,
  };
}

