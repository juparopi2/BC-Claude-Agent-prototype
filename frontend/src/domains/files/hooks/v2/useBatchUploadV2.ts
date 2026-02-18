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
export function collectFolderFiles(
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
 * Merge standalone files with files extracted from folders, deduplicating
 * any file that appears in both lists (by File object reference).
 *
 * Defense-in-depth: even if the call site already filters standalone files,
 * this function ensures no duplicates reach the manifest.
 */
export function mergeFilesWithFolderContents(
  files: File[],
  folders?: FolderEntry[],
): { allFiles: { file: File; parentTempId?: string }[]; manifestFolders: ManifestFolderItem[] } {
  if (folders && folders.length > 0) {
    const collected = collectFolderFiles(folders);
    const folderFileRefs = new Set(collected.files.map((f) => f.file));
    const standaloneFiles = files
      .filter((f) => !folderFileRefs.has(f))
      .map((f) => ({ file: f }));
    return {
      allFiles: [...standaloneFiles, ...collected.files],
      manifestFolders: collected.manifoldFolders,
    };
  }
  return { allFiles: files.map((f) => ({ file: f })), manifestFolders: [] };
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
        // 1. Collect all files (flat + from folders), deduplicating any overlap
        const { allFiles, manifestFolders } = mergeFilesWithFolderContents(files, folders);

        if (allFiles.length === 0) return null;

        // Show preparing panel immediately (before any async work)
        const { startPreparing } = useBatchUploadStoreV2.getState();
        startPreparing(allFiles.length, (folders?.length ?? 0) > 0);

        // 2. Hash computation
        const hashResults = await computeFileHashesWithIds(
          allFiles.map((f) => f.file)
        );

        if (abortRef.current) {
          resetStore();
          return null;
        }

        // 3. Duplicate check
        const dupInput = hashResults.map((h, i) => ({
          tempId: h.tempId,
          fileName: h.file.name,
          fileSize: h.file.size,
          contentHash: h.hash,
          folderId: allFiles[i]?.parentTempId,
        }));

        const dupResult = await checkAndResolve(dupInput);
        if (!dupResult) {
          resetStore(); // cancelled — clear preparing state
          return null;
        }
        if (abortRef.current) {
          resetStore();
          return null;
        }

        // Filter out skipped files
        const skippedSet = new Set(dupResult.skipped);
        const proceedHashes = hashResults.filter((h) => !skippedSet.has(h.tempId));
        const proceedFiles = allFiles.filter((_, i) => !skippedSet.has(hashResults[i]!.tempId));

        if (proceedHashes.length === 0) {
          resetStore(); // all files skipped — clear preparing state
          return null;
        }

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
          resetStore(); // clear preparing state
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
        const { activeBatch: currentBatch } = useBatchUploadStoreV2.getState();
        if (currentBatch) {
          // Batch already created — keep panel visible with error
          const msg = error instanceof Error ? error.message : 'Upload failed';
          setError(msg);
        } else {
          // Still preparing — clear panel entirely
          resetStore();
        }
        return null;
      }
    },
    [setActiveBatch, setError, uploadBlobs, confirmFiles, checkAndResolve, resetStore]
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
