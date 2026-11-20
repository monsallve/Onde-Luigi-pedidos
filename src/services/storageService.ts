import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { storage } from '../firebase/config';
import type { ConnectionMode } from '../types/pos';
import { compressImageFile } from '../utils/imageCompressor';

export interface ReceiptUploadResult {
  imageUrl: string;
  storagePath: string;
  compressedBytes: number;
  originalBytes: number;
  usedFallbackInline: boolean;
}

export async function uploadTransferReceiptImage(params: {
  mode: ConnectionMode;
  workspaceId: string;
  transferId: string;
  file: File;
}): Promise<ReceiptUploadResult> {
  const compressed = await compressImageFile(params.file, 1200, 0.78);

  if (params.mode === 'cloud' && storage) {
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
      // If Storage bucket rules or billing aren't enabled yet, fall back to compressed inline Data URL
      return {
        imageUrl: compressed.dataUrl,
        storagePath: `inline/${params.transferId}.jpg`,
        compressedBytes: compressed.compressedBytes,
        originalBytes: compressed.originalBytes,
        usedFallbackInline: true,
      };
    }
  }

  return {
    imageUrl: compressed.dataUrl,
    storagePath: `demo/${params.transferId}.jpg`,
    compressedBytes: compressed.compressedBytes,
    originalBytes: compressed.originalBytes,
    usedFallbackInline: false,
  };
}
