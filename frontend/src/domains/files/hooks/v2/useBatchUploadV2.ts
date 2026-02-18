/**
 * useBatchUploadV2 Hook
 *
 * THE single entry point for V2 file uploads.
 * Replaces useFileUpload + useFolderUpload with a unified flow:
 * hash -> duplicate check -> manifest -> batch create -> blob upload -> confirm
 *
 * @module domains/files/hooks/v2/useBatchUploadV2
 */

import { useCallback, useEffect, useRef } from 'react';
import type {
  ManifestFileItem,
  ManifestFolderItem,
} from '@bc-agent/shared';
import { computeFileHashesWithIds } from '@/lib/utils/hash';
import { getFileApiClientV2 } from '@/src/infrastructure/api/fileApiClientV2';
import { useBatchUploadStoreV2 } from '../../stores/v2/batchUploadStoreV2';
import { useBlobUploadV2 } from './useBlobUploadV2';
import { useFileConfirmV2 } from './useFileConfirmV2';
import { useDuplicateResolutionV2 } from './useDuplicateResolutionV2';
import type { FolderEntry, FileEntry } from '../../types/folderUpload.types';

const BATCH_LOCALSTORAGE_KEY = 'v2_activeBatchId';
const BATCH_TTL_HOURS = 4;

export interface UseBatchUploadV2Return {
  startUpload: (
    files: File[],
    folders?: FolderEntry[],
    targetFolderId?: string | null
  ) => Promise<string | null>;
  cancelBatch: (batchId?: string) => Promise<void>;
  pause: () => void;
  resume: () => void;
  isUploading: boolean;
  activeBatch: ReturnType<typeof useBatchUploadStoreV2.getState>['activeBatch'];
}

/**
 * Recursively collect all files from folder entries with their parentTempId
 */
function collectFolderFiles(
  folders: FolderEntry[],
  parentTempId?: string
): { files: { file: File; parentTempId: string }[]; manifoldFolders: ManifestFolderItem[] } {
  const files: { file: File; parentTempId: string }[] = [];
  const manifestFolders: ManifestFolderItem[] = [];

  for (const folder of folders) {
    const folderTempId = `folder-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    manifestFolders.push({
      tempId: folderTempId,
      folderName: folder.name,
      parentTempId,
    });

    for (const child of folder.children) {
      if (child.type === 'file') {
        files.push({ file: (child as FileEntry).file, parentTempId: folderTempId });
      } else if (child.type === 'folder') {
        const nested = collectFolderFiles([child as FolderEntry], folderTempId);
        files.push(...nested.files);
        manifestFolders.push(...nested.manifoldFolders);
      }
    }
  }

  return { files, manifoldFolders: manifestFolders };
}

/**
 * Main V2 batch upload hook
 */
export function useBatchUploadV2(): UseBatchUploadV2Return {
  const activeBatch = useBatchUploadStoreV2((s) => s.activeBatch);
  const isUploading = useBatchUploadStoreV2((s) => s.isUploading);
  const setActiveBatch = useBatchUploadStoreV2((s) => s.setActiveBatch);
  const setError = useBatchUploadStoreV2((s) => s.setError);
  const setPaused = useBatchUploadStoreV2((s) => s.setPaused);
  const resetStore = useBatchUploadStoreV2((s) => s.reset);

  const { uploadBlobs, cancel: cancelBlobs } = useBlobUploadV2();
  const { confirmFiles, abort: abortConfirm } = useFileConfirmV2();
  const { checkAndResolve } = useDuplicateResolutionV2();
  const abortRef = useRef(false);

  // ============================================
  // Crash Recovery
  // ============================================
  useEffect(() => {
    const savedBatchId = localStorage.getItem(BATCH_LOCALSTORAGE_KEY);
    if (!savedBatchId) return;

    // Check age
    const savedAt = localStorage.getItem(`${BATCH_LOCALSTORAGE_KEY}_ts`);
    if (savedAt) {
      const ageHours = (Date.now() - Number(savedAt)) / (1000 * 60 * 60);
      if (ageHours > BATCH_TTL_HOURS) {
        localStorage.removeItem(BATCH_LOCALSTORAGE_KEY);
        localStorage.removeItem(`${BATCH_LOCALSTORAGE_KEY}_ts`);
        return;
      }
    }

    // Recover batch status
    const api = getFileApiClientV2();
    api.getBatchStatus(savedBatchId).then((response) => {
      if (!response.success) {
        localStorage.removeItem(BATCH_LOCALSTORAGE_KEY);
        localStorage.removeItem(`${BATCH_LOCALSTORAGE_KEY}_ts`);
        return;
      }

      const batch = response.data;
      if (batch.status === 'completed' || batch.status === 'expired' || batch.status === 'cancelled') {
        localStorage.removeItem(BATCH_LOCALSTORAGE_KEY);
        localStorage.removeItem(`${BATCH_LOCALSTORAGE_KEY}_ts`);
        return;
      }

      // Restore batch in store (status-only, no blob re-upload)
      const fileNames = new Map<string, string>();
      const filesForResponse = batch.files.map((f) => {
        fileNames.set(f.fileId, f.name);
        return { tempId: f.fileId, fileId: f.fileId, sasUrl: '', blobPath: '' };
      });

      setActiveBatch(
        {
          batchId: batch.batchId,
          status: batch.status,
          files: filesForResponse,
          folders: [],
          expiresAt: batch.expiresAt,
        },
        fileNames
      );
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ============================================
  // Main Upload Flow
  // ============================================
  const startUpload = useCallback(
    async (
      files: File[],
      folders?: FolderEntry[],
      targetFolderId?: string | null
    ): Promise<string | null> => {
      abortRef.current = false;

      try {
        // 1. Collect all files (flat + from folders)
        let allFiles: { file: File; parentTempId?: string }[] = files.map((f) => ({ file: f }));
        let manifestFolders: ManifestFolderItem[] = [];

        if (folders && folders.length > 0) {
          const collected = collectFolderFiles(folders);
          allFiles = [...allFiles, ...collected.files];
          manifestFolders = collected.manifoldFolders;
        }

        if (allFiles.length === 0) return null;

        // 2. Hash computation
        const hashResults = await computeFileHashesWithIds(
          allFiles.map((f) => f.file)
        );

        if (abortRef.current) return null;

        // 3. Duplicate check
        const dupInput = hashResults.map((h, i) => ({
          tempId: h.tempId,
          fileName: h.file.name,
          fileSize: h.file.size,
          contentHash: h.hash,
          folderId: allFiles[i]?.parentTempId,
        }));

        const dupResult = await checkAndResolve(dupInput);
        if (!dupResult) return null; // cancelled
        if (abortRef.current) return null;

        // Filter out skipped files
        const skippedSet = new Set(dupResult.skipped);
        const proceedHashes = hashResults.filter((h) => !skippedSet.has(h.tempId));
        const proceedFiles = allFiles.filter((_, i) => !skippedSet.has(hashResults[i]!.tempId));

        if (proceedHashes.length === 0) return null;

        // 4. Build manifest
        const manifestFiles: ManifestFileItem[] = proceedHashes.map((h, i) => ({
          tempId: h.tempId,
          fileName: h.file.name,
          mimeType: h.file.type || 'application/octet-stream',
          sizeBytes: h.file.size,
          contentHash: h.hash,
          parentTempId: proceedFiles[i]?.parentTempId,
        }));

        // 5. Create batch
        const api = getFileApiClientV2();
        const batchResponse = await api.createBatch({
          files: manifestFiles,
          folders: manifestFolders.length > 0 ? manifestFolders : undefined,
          targetFolderId: targetFolderId ?? undefined,
        });

        if (!batchResponse.success) {
          setError(batchResponse.error.message);
          return null;
        }

        const batch = batchResponse.data;

        // 6. Save to localStorage for crash recovery
        localStorage.setItem(BATCH_LOCALSTORAGE_KEY, batch.batchId);
        localStorage.setItem(`${BATCH_LOCALSTORAGE_KEY}_ts`, String(Date.now()));

        // 7. Set active batch in store
        const fileNames = new Map<string, string>();
        for (const h of proceedHashes) {
          fileNames.set(h.tempId, h.file.name);
        }
        setActiveBatch(batch, fileNames);

        if (abortRef.current) return batch.batchId;

        // 8. Upload blobs via Uppy
        const blobFiles = batch.files.map((bf) => {
          const hashResult = proceedHashes.find((h) => h.tempId === bf.tempId);
          return {
            file: hashResult!.file,
            fileId: bf.fileId,
            tempId: bf.tempId,
            sasUrl: bf.sasUrl,
            blobPath: bf.blobPath,
          };
        });

        const uploadResults = await uploadBlobs(blobFiles);
        if (abortRef.current) return batch.batchId;

        // 9. Confirm successful uploads
        const successFileIds = uploadResults
          .filter((r) => r.success)
          .map((r) => r.fileId);

        if (successFileIds.length > 0) {
          await confirmFiles(batch.batchId, successFileIds);
        }

        return batch.batchId;
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Upload failed';
        setError(msg);
        return null;
      }
    },
    [setActiveBatch, setError, uploadBlobs, confirmFiles, checkAndResolve]
  );

  // ============================================
  // Cancel
  // ============================================
  const cancelBatch = useCallback(
    async (batchId?: string) => {
      abortRef.current = true;
      cancelBlobs();
      abortConfirm();

      const id = batchId ?? activeBatch?.batchId;
      if (id) {
        const api = getFileApiClientV2();
        await api.cancelBatch(id);
      }

      localStorage.removeItem(BATCH_LOCALSTORAGE_KEY);
      localStorage.removeItem(`${BATCH_LOCALSTORAGE_KEY}_ts`);
      resetStore();
    },
    [activeBatch, cancelBlobs, abortConfirm, resetStore]
  );

  // ============================================
  // Pause / Resume
  // ============================================
  const pause = useCallback(() => {
    setPaused(true);
    cancelBlobs();
  }, [setPaused, cancelBlobs]);

  const resume = useCallback(() => {
    setPaused(false);
    // Resuming blob uploads requires re-creating Uppy, which is not supported
    // in the initial implementation. Show current status only.
  }, [setPaused]);

  return {
    startUpload,
    cancelBatch,
    pause,
    resume,
    isUploading,
    activeBatch,
  };
}
