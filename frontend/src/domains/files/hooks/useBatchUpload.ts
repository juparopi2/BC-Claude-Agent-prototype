/**
 * useBatchUpload Hook
 *
 * THE single entry point for file uploads.
 * Replaces useFileUpload + useFolderUpload with a unified flow:
 * hash -> duplicate check -> manifest -> batch create -> blob upload -> confirm
 *
 * Supports multiple concurrent batches via batchKey-based state isolation.
 *
 * @module domains/files/hooks/useBatchUpload
 */

import { useCallback, useEffect, useRef } from 'react';
import type {
  ManifestFileItem,
  ManifestFolderItem,
} from '@bc-agent/shared';
import { PIPELINE_STATUS } from '@bc-agent/shared';
import { computeFileHashesWithIds } from '@/lib/utils/hash';
import { getUploadApiClient } from '@/src/infrastructure/api/uploadApiClient';
import { useBatchUploadStore } from '../stores/uploadBatchStore';
import { useFolderTreeStore } from '../stores/folderTreeStore';
import { useBlobUpload } from './useBlobUpload';
import { useFileConfirm } from './useFileConfirm';
import { useDuplicateResolution } from './useDuplicateResolution';
import { useFolderDuplicateResolution } from './useFolderDuplicateResolution';
import { getFileApiClient } from '@/src/infrastructure/api';
import type { FolderDuplicateCheckInput, ReplaceFolderMapping } from '@bc-agent/shared';
import type { FolderEntry, FileEntry } from '../types/folderUpload.types';

const BATCHES_LOCALSTORAGE_KEY = 'activeBatches';
const LEGACY_BATCH_LOCALSTORAGE_KEY = 'activeBatchId';
const BATCH_TTL_HOURS = 4;
const MAX_CONCURRENT_BATCHES = 5;

interface StoredBatchRef {
  batchId: string;
  batchKey: string;
  ts: number;
}

export interface UseBatchUploadReturn {
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
 * Main batch upload hook
 */
export function useBatchUpload(): UseBatchUploadReturn {
  const hasActiveUploads = useBatchUploadStore((s) => s.hasActiveUploads);
  const batches = useBatchUploadStore((s) => s.batches);
  const addPreparing = useBatchUploadStore((s) => s.addPreparing);
  const activateBatch = useBatchUploadStore((s) => s.activateBatch);
  const setError = useBatchUploadStore((s) => s.setError);
  const setPaused = useBatchUploadStore((s) => s.setPaused);
  const removeBatch = useBatchUploadStore((s) => s.removeBatch);
  const resetStore = useBatchUploadStore((s) => s.reset);

  const { uploadBlobs, cancelByBatchKey: cancelBlobsByBatchKey, cancelAll: cancelAllBlobs } = useBlobUpload();
  const { confirmFiles, abortByBatchKey: abortConfirmByBatchKey, abortAll: abortAllConfirms } = useFileConfirm();
  const { checkAndResolve } = useDuplicateResolution();
  const { checkAndResolveFolders } = useFolderDuplicateResolution();
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

    const api = getUploadApiClient();
    const now = Date.now();

    for (const ref of refs) {
      // Check age
      const ageHours = (now - ref.ts) / (1000 * 60 * 60);
      if (ageHours > BATCH_TTL_HOURS) {
        removeBatchRef(ref.batchKey);
        continue;
      }

      // Recover batch status from backend
      api.getBatchStatus(ref.batchId).then((response) => {
        if (!response.success) {
          // Backend still down or batch not found — clean up to prevent stuck modal
          removeBatchRef(ref.batchKey);
          return;
        }

        const batch = response.data;
        if (batch.status === 'completed' || batch.status === 'expired' || batch.status === 'cancelled') {
          removeBatchRef(ref.batchKey);
          return;
        }

        // Skip batches with no files (already cleaned up or mismatched)
        if (batch.files.length === 0) {
          removeBatchRef(ref.batchKey);
          return;
        }

        // Restore batch with real file states from the backend
        const { restoreBatch: restore } = useBatchUploadStore.getState();
        restore(ref.batchKey, batch);

        // Re-confirm files stuck at REGISTERED (blob uploaded, confirm never called)
        const registeredFileIds = batch.files
          .filter((f) => !f.pipelineStatus || f.pipelineStatus === PIPELINE_STATUS.REGISTERED)
          .map((f) => f.fileId);

        if (registeredFileIds.length > 0) {
          // Fire-and-forget: confirmFiles updates store as each file confirms/fails
          confirmFiles(ref.batchKey, batch.batchId, registeredFileIds);
        }

        // If all files are already READY, clean up localStorage so auto-close kicks in
        const restored = useBatchUploadStore.getState().batches.get(ref.batchKey);
        if (restored?.phase === 'completed') {
          removeBatchRef(ref.batchKey);
        }
      }).catch(() => {
        // API call failed (backend unreachable) — remove ref to prevent infinite stuck modal
        removeBatchRef(ref.batchKey);
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

        // 3. Folder-level duplicate check (before file-level)
        let finalManifestFolders = [...manifestFolders];
        let finalAllFiles = [...allFiles];
        let finalHashResults = [...hashResults];
        const folderReplaceMappings: ReplaceFolderMapping[] = [];
        const skipFileDupCheckTempIds = new Set<string>();

        if (finalManifestFolders.length > 0) {
          // Count files per root folder for the modal display
          const folderInputs: FolderDuplicateCheckInput[] = finalManifestFolders
            .filter((f) => !f.parentTempId)
            .map((f) => ({
              tempId: f.tempId,
              folderName: f.folderName,
              fileCount: finalAllFiles.filter((af) => af.parentTempId === f.tempId).length,
            }));

          if (folderInputs.length > 0) {
            const folderResult = await checkAndResolveFolders(folderInputs, targetFolderId);
            if (!folderResult) {
              removeBatch(batchKey); // cancelled
              return null;
            }
            if (abortMapRef.current.get(batchKey)) {
              removeBatch(batchKey);
              return null;
            }

            // Collect all descendant tempIds of a folder (recursive)
            const getDescendantFolderTempIds = (parentTempId: string): string[] => {
              const descendants: string[] = [];
              for (const folder of finalManifestFolders) {
                if (folder.parentTempId === parentTempId) {
                  descendants.push(folder.tempId);
                  descendants.push(...getDescendantFolderTempIds(folder.tempId));
                }
              }
              return descendants;
            };

            // Apply SKIP: remove folder + all descendant folders + their files
            for (const skippedId of folderResult.skippedFolderIds) {
              const allFolderIds = [skippedId, ...getDescendantFolderTempIds(skippedId)];
              const folderIdSet = new Set(allFolderIds);

              finalManifestFolders = finalManifestFolders.filter((f) => !folderIdSet.has(f.tempId));

              // Remove files belonging to skipped folders
              const removedFileIndices = new Set<number>();
              finalAllFiles = finalAllFiles.filter((f, idx) => {
                if (f.parentTempId && folderIdSet.has(f.parentTempId)) {
                  removedFileIndices.add(idx);
                  return false;
                }
                return true;
              });
              finalHashResults = finalHashResults.filter((_, idx) => !removedFileIndices.has(idx));
            }

            // Apply KEEP BOTH: rename folder, skip file-level dup check for its files
            for (const [tempId, newName] of folderResult.keepBothRenames) {
              const folder = finalManifestFolders.find((f) => f.tempId === tempId);
              if (folder) {
                folder.folderName = newName;
              }
              // Files in renamed folders don't need file-level dup check (new folder = no conflicts)
              const allFolderIds = [tempId, ...getDescendantFolderTempIds(tempId)];
              for (const fid of allFolderIds) {
                finalAllFiles.forEach((f, idx) => {
                  if (f.parentTempId === fid) {
                    skipFileDupCheckTempIds.add(finalHashResults[idx]!.tempId);
                  }
                });
              }
            }

            // Apply REPLACE: keep folder in manifest but build replaceFolderMappings
            // Files in replaced folders skip file-level dup check
            for (const [tempId, existingFolderId] of folderResult.replaceFolderIds) {
              folderReplaceMappings.push({ tempId, existingFolderId });
              // Files in replaced folders don't need file-level dup check
              const allFolderIds = [tempId, ...getDescendantFolderTempIds(tempId)];
              for (const fid of allFolderIds) {
                finalAllFiles.forEach((f, idx) => {
                  if (f.parentTempId === fid) {
                    skipFileDupCheckTempIds.add(finalHashResults[idx]!.tempId);
                  }
                });
              }
            }

            // If all files removed, abort
            if (finalAllFiles.length === 0) {
              removeBatch(batchKey);
              return null;
            }
          }
        }

        // 4. File-level duplicate check (only for files not in keep_both or replace folders)
        const fileDupInput = finalHashResults
          .filter((h) => !skipFileDupCheckTempIds.has(h.tempId))
          .map((h) => {
            const originalIdx = finalHashResults.indexOf(h);
            return {
              tempId: h.tempId,
              fileName: h.file.name,
              fileSize: h.file.size,
              contentHash: h.hash,
              folderId: finalAllFiles[originalIdx]?.parentTempId,
            };
          });

        // Build dup result combining skipped-by-folder-dup files
        let dupResult: { skipped: string[]; renames: Map<string, string>; replacements: Map<string, string> };

        if (fileDupInput.length > 0) {
          const fileDupResult = await checkAndResolve(fileDupInput, targetFolderId);
          if (!fileDupResult) {
            removeBatch(batchKey); // cancelled
            return null;
          }
          dupResult = {
            skipped: fileDupResult.skipped,
            renames: fileDupResult.renames,
            replacements: fileDupResult.replacements,
          };
        } else {
          dupResult = { skipped: [], renames: new Map(), replacements: new Map() };
        }

        if (abortMapRef.current.get(batchKey)) {
          removeBatch(batchKey);
          return null;
        }

        // Filter out skipped files
        const skippedSet = new Set(dupResult.skipped);
        const proceedHashes = finalHashResults.filter((h) => !skippedSet.has(h.tempId));
        const proceedFiles = finalAllFiles.filter((_, i) => !skippedSet.has(finalHashResults[i]!.tempId));

        if (proceedHashes.length === 0) {
          removeBatch(batchKey); // all files skipped
          return null;
        }

        // 5. Build manifest (apply renames for "Keep Both" and replacements for "Replace")
        const manifestFiles: ManifestFileItem[] = proceedHashes.map((h, i) => ({
          tempId: h.tempId,
          fileName: dupResult.renames.get(h.tempId) ?? h.file.name,
          mimeType: h.file.type || 'application/octet-stream',
          sizeBytes: h.file.size,
          contentHash: h.hash,
          lastModified: h.file.lastModified,
          parentTempId: proceedFiles[i]?.parentTempId,
          ...(dupResult.replacements.has(h.tempId)
            ? { replaceFileId: dupResult.replacements.get(h.tempId) }
            : {}),
        }));

        // 6. Create batch
        const api = getUploadApiClient();
        const batchResponse = await api.createBatch({
          files: manifestFiles,
          folders: finalManifestFolders.length > 0 ? finalManifestFolders : undefined,
          targetFolderId: targetFolderId ?? undefined,
          ...(folderReplaceMappings.length > 0 ? { replaceFolderMappings: folderReplaceMappings } : {}),
        });

        if (!batchResponse.success) {
          removeBatch(batchKey);
          return null;
        }

        const batch = batchResponse.data;

        // 7. Save to localStorage for crash recovery
        saveBatchRef({ batchId: batch.batchId, batchKey, ts: Date.now() });

        // 8. Set active batch in store
        const fileNames = new Map<string, string>();
        for (const h of proceedHashes) {
          fileNames.set(h.tempId, dupResult.renames.get(h.tempId) ?? h.file.name);
        }
        activateBatch(batchKey, batch, fileNames);

        // 8b. Sync folder tree with newly created folders
        if (batch.folders.length > 0) {
          const tempIdToFolderId = new Map(batch.folders.map((f) => [f.tempId, f.folderId]));
          const treeStore = useFolderTreeStore.getState();

          for (const mf of finalManifestFolders) {
            const folderId = tempIdToFolderId.get(mf.tempId);
            if (!folderId) continue;

            const parentKey = mf.parentTempId
              ? (tempIdToFolderId.get(mf.parentTempId) ?? mf.parentTempId)
              : (targetFolderId ?? 'root');

            treeStore.upsertTreeFolder(parentKey, {
              id: folderId,
              name: mf.folderName,
              isFolder: true,
              parentFolderId: mf.parentTempId
                ? (tempIdToFolderId.get(mf.parentTempId) ?? null)
                : (targetFolderId ?? null),
              userId: '',
              mimeType: 'inode/directory',
              sizeBytes: 0,
              blobPath: '',
              isFavorite: false,
              pipelineStatus: 'ready',
              readinessState: 'ready',
              processingRetryCount: 0,
              embeddingRetryCount: 0,
              lastError: null,
              failedAt: null,
              hasExtractedText: false,
              contentHash: null,
              deletionStatus: null,
              deletedAt: null,
              fileModifiedAt: null,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            });
          }
        }

        if (abortMapRef.current.get(batchKey)) return batch.batchId;

        // 9. Upload blobs via Uppy
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

        // 10. Confirm successful uploads
        const successFileIds = uploadResults
          .filter((r) => r.success)
          .map((r) => r.fileId);

        if (successFileIds.length > 0) {
          await confirmFiles(batchKey, batch.batchId, successFileIds);
        }

        // 11. Refresh folder tree after upload completes
        if (finalManifestFolders.length > 0) {
          try {
            const fileApiV1 = getFileApiClient();
            const treeResult = await fileApiV1.getFiles({ folderId: null });
            if (treeResult.success) {
              const rootFolders = treeResult.data.files.filter((f) => f.isFolder);
              useFolderTreeStore.getState().setTreeFolders('root', rootFolders);
            }
          } catch {
            // Non-critical: tree will refresh on next navigation
          }

          // Invalidate parent folders so they re-fetch on next expand
          const tempIdToFolderId = new Map(batch.folders.map((f) => [f.tempId, f.folderId]));
          const parentIds = new Set<string>();
          for (const mf of finalManifestFolders) {
            if (mf.parentTempId) {
              const parentId = tempIdToFolderId.get(mf.parentTempId);
              if (parentId) parentIds.add(parentId);
            }
          }
          if (targetFolderId) parentIds.add(targetFolderId);
          for (const parentId of parentIds) {
            useFolderTreeStore.getState().invalidateTreeFolder(parentId);
          }
        }

        abortMapRef.current.delete(batchKey);
        return batch.batchId;
      } catch (error) {
        const currentEntry = useBatchUploadStore.getState().batches.get(batchKey);
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
    [addPreparing, activateBatch, setError, removeBatch, uploadBlobs, confirmFiles, checkAndResolve, checkAndResolveFolders]
  );

  // ============================================
  // Cancel
  // ============================================
  const cancelBatch = useCallback(
    async (batchKey: string) => {
      abortMapRef.current.set(batchKey, true);
      cancelBlobsByBatchKey(batchKey);
      abortConfirmByBatchKey(batchKey);

      const entry = useBatchUploadStore.getState().batches.get(batchKey);
      const batchId = entry?.activeBatch?.batchId;
      if (batchId) {
        try {
          const api = getUploadApiClient();
          await api.cancelBatch(batchId);
        } catch {
          // Batch may already be completed/cancelled on backend — proceed with local cleanup
        }
      }

      removeBatchRef(batchKey);
      removeBatch(batchKey);
      abortMapRef.current.delete(batchKey);

      // Refresh folder tree to remove any partially-created folders
      try {
        const fileApiV1 = getFileApiClient();
        const treeResult = await fileApiV1.getFiles({ folderId: null });
        if (treeResult.success) {
          const rootFolders = treeResult.data.files.filter((f) => f.isFolder);
          useFolderTreeStore.getState().setTreeFolders('root', rootFolders);
        }
      } catch {
        // Non-critical: tree will refresh on next navigation
      }
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
