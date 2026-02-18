/**
 * useBlobUploadV2 Hook
 *
 * Wraps Uppy blob upload for V2 batch uploads.
 * Reads SAS URLs from batch response and uploads files directly to Azure Blob.
 *
 * @module domains/files/hooks/v2/useBlobUploadV2
 */

import { useCallback, useRef } from 'react';
import { createBlobUploadUppy, type BlobUploadMeta } from '@/src/infrastructure/upload';
import { useBatchUploadStoreV2 } from '../../stores/v2/batchUploadStoreV2';

export interface BlobUploadFile {
  file: File;
  fileId: string;
  tempId: string;
  sasUrl: string;
  blobPath: string;
}

export interface BlobUploadResult {
  fileId: string;
  success: boolean;
  error?: string;
}

/**
 * Hook for uploading files to Azure Blob via Uppy (V2)
 */
export function useBlobUploadV2() {
  const updateProgress = useBatchUploadStoreV2((s) => s.updateFileUploadProgress);
  const markFailed = useBatchUploadStoreV2((s) => s.markFileFailed);
  const uppyRef = useRef<ReturnType<typeof createBlobUploadUppy> | null>(null);

  const uploadBlobs = useCallback(
    async (files: BlobUploadFile[]): Promise<BlobUploadResult[]> => {
      if (files.length === 0) return [];

      const uppy = createBlobUploadUppy({ concurrency: 5 });
      uppyRef.current = uppy;

      const results = new Map<string, BlobUploadResult>();
      const fileIdByUppyId = new Map<string, string>();

      // Add files to Uppy with SAS URL metadata
      for (const f of files) {
        const uppyFileId = uppy.addFile({
          name: f.file.name,
          type: f.file.type || 'application/octet-stream',
          data: f.file,
          meta: {
            sasUrl: f.sasUrl,
            correlationId: f.fileId,
            contentType: f.file.type || 'application/octet-stream',
            blobPath: f.blobPath,
          } satisfies BlobUploadMeta,
        });
        fileIdByUppyId.set(uppyFileId, f.fileId);
      }

      return new Promise<BlobUploadResult[]>((resolve) => {
        // Track per-file progress
        uppy.on('upload-progress', (file, progress) => {
          if (!file) return;
          const fileId = fileIdByUppyId.get(file.id);
          if (fileId && progress.bytesTotal && progress.bytesTotal > 0) {
            const pct = Math.round((progress.bytesUploaded / progress.bytesTotal) * 100);
            updateProgress(fileId, pct);
          }
        });

        // Track per-file success
        uppy.on('upload-success', (file) => {
          if (!file) return;
          const fileId = fileIdByUppyId.get(file.id);
          if (fileId) {
            results.set(fileId, { fileId, success: true });
            updateProgress(fileId, 100);
          }
        });

        // Track per-file failure
        uppy.on('upload-error', (file, error) => {
          if (!file) return;
          const fileId = fileIdByUppyId.get(file.id);
          const errMsg = error?.message ?? 'Blob upload failed';
          if (fileId) {
            results.set(fileId, { fileId, success: false, error: errMsg });
            markFailed(fileId, errMsg);
          }
        });

        // All done
        uppy.on('complete', () => {
          // Build final results for all files
          const finalResults: BlobUploadResult[] = files.map((f) => {
            return results.get(f.fileId) ?? { fileId: f.fileId, success: false, error: 'Upload did not complete' };
          });

          uppy.clear();
          uppy.destroy();
          uppyRef.current = null;
          resolve(finalResults);
        });

        // Start upload
        uppy.upload();
      });
    },
    [updateProgress, markFailed]
  );

  const cancel = useCallback(() => {
    if (uppyRef.current) {
      uppyRef.current.cancelAll();
      uppyRef.current.clear();
      uppyRef.current.destroy();
      uppyRef.current = null;
    }
  }, []);

  return { uploadBlobs, cancel };
}
