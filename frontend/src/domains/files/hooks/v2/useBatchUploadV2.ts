/**
 * useBatchUploadV2 Hook
 *
 * THE single entry point for V2 file uploads.
 * Replaces useFileUpload + useFolderUpload with a unified flow:
 * hash -> duplicate check -> manifest -> batch create -> blob upload -> confirm
 *
 * Supports multiple concurrent batches via batchKey-based state isolation.
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

const BATCHES_LOCALSTORAGE_KEY = 'v2_activeBatches';
const LEGACY_BATCH_LOCALSTORAGE_KEY = 'v2_activeBatchId';
const BATCH_TTL_HOURS = 4;
const MAX_CONCURRENT_BATCHES = 5;

interface StoredBatchRef {
  batchId: string;
  batchKey: string;
  ts: number;
}

export interface UseBatchUploadV2Return {
  startUpload: (
    files: File[],
    folders?: FolderEntry[],
    targetFolderId?: string | null
  ) => Promise<string | null>;
  cancelBatch: (batchKey: string) => Promise<void>;
  pause: (batchKey: string) => void;
  resume: (batchKey: string) => void;
  hasActiveUploads: boolean;
  activeBatchCount: number;
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

// ============================================
// localStorage helpers
// ============================================

function loadBatchRefs(): StoredBatchRef[] {
  try {
    const raw = localStorage.getItem(BATCHES_LOCALSTORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as StoredBatchRef[];
  } catch {
    return [];
  }
}

function saveBatchRef(ref: StoredBatchRef): void {
  const refs = loadBatchRefs();
  refs.push(ref);
  localStorage.setItem(BATCHES_LOCALSTORAGE_KEY, JSON.stringify(refs));
}

function removeBatchRef(batchKey: string): void {
  const refs = loadBatchRefs().filter((r) => r.batchKey !== batchKey);
  if (refs.length === 0) {
    localStorage.removeItem(BATCHES_LOCALSTORAGE_KEY);
  } else {
    localStorage.setItem(BATCHES_LOCALSTORAGE_KEY, JSON.stringify(refs));
  }
}

function clearAllBatchRefs(): void {
  localStorage.removeItem(BATCHES_LOCALSTORAGE_KEY);
}

/**
 * Migrate from legacy single-key localStorage to the new array format.
 */
function migrateLegacyLocalStorage(): void {
  const legacyId = localStorage.getItem(LEGACY_BATCH_LOCALSTORAGE_KEY);
  if (!legacyId) return;

  const legacyTs = localStorage.getItem(`${LEGACY_BATCH_LOCALSTORAGE_KEY}_ts`);
  const ts = legacyTs ? Number(legacyTs) : Date.now();

  const existing = loadBatchRefs();
  // Only migrate if not already present
  if (!existing.some((r) => r.batchId === legacyId)) {
    saveBatchRef({
      batchId: legacyId,
      batchKey: `legacy-${legacyId}`,
      ts,
    });
  }

  localStorage.removeItem(LEGACY_BATCH_LOCALSTORAGE_KEY);
  localStorage.removeItem(`${LEGACY_BATCH_LOCALSTORAGE_KEY}_ts`);
}

/**
 * Generate a unique batchKey for client-side tracking.
 */
function generateBatchKey(): string {
  return `batch-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Main V2 batch upload hook
 */
export function useBatchUploadV2(): UseBatchUploadV2Return {
  const hasActiveUploads = useBatchUploadStoreV2((s) => s.hasActiveUploads);
  const batches = useBatchUploadStoreV2((s) => s.batches);
  const addPreparing = useBatchUploadStoreV2((s) => s.addPreparing);
  const activateBatch = useBatchUploadStoreV2((s) => s.activateBatch);
  const setError = useBatchUploadStoreV2((s) => s.setError);
  const setPaused = useBatchUploadStoreV2((s) => s.setPaused);
  const removeBatch = useBatchUploadStoreV2((s) => s.removeBatch);
  const resetStore = useBatchUploadStoreV2((s) => s.reset);

  const { uploadBlobs, cancelByBatchKey: cancelBlobsByBatchKey, cancelAll: cancelAllBlobs } = useBlobUploadV2();
  const { confirmFiles, abortByBatchKey: abortConfirmByBatchKey, abortAll: abortAllConfirms } = useFileConfirmV2();
  const { checkAndResolve } = useDuplicateResolutionV2();
  const abortMapRef = useRef<Map<string, boolean>>(new Map());

  // Count active batches (preparing or active phase)
  const activeBatchCount = (() => {
    let count = 0;
    for (const entry of batches.values()) {
      if (entry.phase === 'preparing' || entry.phase === 'active') {
        count++;
      }
    }
    return count;
  })();

  // ============================================
  // Crash Recovery
  // ============================================
  useEffect(() => {
    // Migrate legacy single-key localStorage
    migrateLegacyLocalStorage();

    const refs = loadBatchRefs();
    if (refs.length === 0) return;

    const api = getFileApiClientV2();
    const now = Date.now();

    for (const ref of refs) {
      // Check age
      const ageHours = (now - ref.ts) / (1000 * 60 * 60);
      if (ageHours > BATCH_TTL_HOURS) {
        removeBatchRef(ref.batchKey);
        continue;
      }

      // Recover batch status
      api.getBatchStatus(ref.batchId).then((response) => {
        if (!response.success) {
          removeBatchRef(ref.batchKey);
          return;
        }

        const batch = response.data;
        if (batch.status === 'completed' || batch.status === 'expired' || batch.status === 'cancelled') {
          removeBatchRef(ref.batchKey);
          return;
        }

        // Restore batch in store (status-only, no blob re-upload)
        const { addPreparing: addPrep, activateBatch: activate } = useBatchUploadStoreV2.getState();
        addPrep(ref.batchKey, batch.files.length, false);

        const fileNames = new Map<string, string>();
        const filesForResponse = batch.files.map((f) => {
          fileNames.set(f.fileId, f.name);
          return { tempId: f.fileId, fileId: f.fileId, sasUrl: '', blobPath: '' };
        });

        activate(
          ref.batchKey,
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
    }
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
      const batchKey = generateBatchKey();
      abortMapRef.current.set(batchKey, false);

      try {
        // 1. Collect all files (flat + from folders), deduplicating any overlap
        const { allFiles, manifestFolders } = mergeFilesWithFolderContents(files, folders);

        if (allFiles.length === 0) return null;

        // Show preparing panel immediately (before any async work)
        addPreparing(batchKey, allFiles.length, (folders?.length ?? 0) > 0);

        // 2. Hash computation
        const hashResults = await computeFileHashesWithIds(
          allFiles.map((f) => f.file)
        );

        if (abortMapRef.current.get(batchKey)) {
          removeBatch(batchKey);
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
          removeBatch(batchKey); // cancelled
          return null;
        }
        if (abortMapRef.current.get(batchKey)) {
          removeBatch(batchKey);
          return null;
        }

        // Filter out skipped files
        const skippedSet = new Set(dupResult.skipped);
        const proceedHashes = hashResults.filter((h) => !skippedSet.has(h.tempId));
        const proceedFiles = allFiles.filter((_, i) => !skippedSet.has(hashResults[i]!.tempId));

        if (proceedHashes.length === 0) {
          removeBatch(batchKey); // all files skipped
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
          removeBatch(batchKey);
          return null;
        }

        const batch = batchResponse.data;

        // 6. Save to localStorage for crash recovery
        saveBatchRef({ batchId: batch.batchId, batchKey, ts: Date.now() });

        // 7. Set active batch in store
        const fileNames = new Map<string, string>();
        for (const h of proceedHashes) {
          fileNames.set(h.tempId, h.file.name);
        }
        activateBatch(batchKey, batch, fileNames);

        if (abortMapRef.current.get(batchKey)) return batch.batchId;

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

        const uploadResults = await uploadBlobs(batchKey, blobFiles);
        if (abortMapRef.current.get(batchKey)) return batch.batchId;

        // 9. Confirm successful uploads
        const successFileIds = uploadResults
          .filter((r) => r.success)
          .map((r) => r.fileId);

        if (successFileIds.length > 0) {
          await confirmFiles(batchKey, batch.batchId, successFileIds);
        }

        abortMapRef.current.delete(batchKey);
        return batch.batchId;
      } catch (error) {
        const currentEntry = useBatchUploadStoreV2.getState().batches.get(batchKey);
        if (currentEntry?.activeBatch) {
          // Batch already created — keep panel visible with error
          const msg = error instanceof Error ? error.message : 'Upload failed';
          setError(batchKey, msg);
        } else {
          // Still preparing — remove batch entry entirely
          removeBatch(batchKey);
        }
        abortMapRef.current.delete(batchKey);
        return null;
      }
    },
    [addPreparing, activateBatch, setError, removeBatch, uploadBlobs, confirmFiles, checkAndResolve]
  );

  // ============================================
  // Cancel
  // ============================================
  const cancelBatch = useCallback(
    async (batchKey: string) => {
      abortMapRef.current.set(batchKey, true);
      cancelBlobsByBatchKey(batchKey);
      abortConfirmByBatchKey(batchKey);

      const entry = useBatchUploadStoreV2.getState().batches.get(batchKey);
      const batchId = entry?.activeBatch?.batchId;
      if (batchId) {
        const api = getFileApiClientV2();
        await api.cancelBatch(batchId);
      }

      removeBatchRef(batchKey);
      removeBatch(batchKey);
      abortMapRef.current.delete(batchKey);
    },
    [cancelBlobsByBatchKey, abortConfirmByBatchKey, removeBatch]
  );

  // ============================================
  // Pause / Resume
  // ============================================
  const pause = useCallback((batchKey: string) => {
    setPaused(batchKey, true);
    cancelBlobsByBatchKey(batchKey);
  }, [setPaused, cancelBlobsByBatchKey]);

  const resume = useCallback((batchKey: string) => {
    setPaused(batchKey, false);
  }, [setPaused]);

  return {
    startUpload,
    cancelBatch,
    pause,
    resume,
    hasActiveUploads,
    activeBatchCount,
  };
}
