/**
 * useFolderUpload Hook
 *
 * Main orchestration hook for folder upload functionality.
 * Handles folder creation, file batching, pause/resume, and progress tracking.
 *
 * Flow:
 * 1. Read folder structure (via folderReader)
 * 2. Validate limits and show errors if exceeded
 * 3. Create folders in batch
 * 4. Upload files in batches of 500
 * 5. Support pause/resume via localStorage
 *
 * @module domains/files/hooks/useFolderUpload
 */

import { useCallback, useRef, useState } from 'react';
import { getFileApiClient } from '@/src/infrastructure/api';
import { useSessionStore } from '@/src/domains/session/stores/sessionStore';
import { useFileListStore } from '../stores/fileListStore';
import { useFolderTreeStore } from '../stores/folderTreeStore';
import { useUploadLimitStore } from '../stores/uploadLimitStore';
import { useUnsupportedFilesStore } from '../stores/unsupportedFilesStore';
import {
  saveUploadState,
  loadUploadState,
  clearUploadState,
} from '../utils/folderUploadPersistence';
import { FILE_UPLOAD_LIMITS, FILE_BULK_UPLOAD_CONFIG } from '@bc-agent/shared';
import type {
  FolderStructure,
  FolderUploadProgress,
  FolderUploadPhase,
  PersistedFolderUploadState,
  FolderEntry,
  FileEntry,
} from '../types/folderUpload.types';
import { validateFolderLimits } from '../types/folderUpload.types';
import { computeFileSha256 } from '@/lib/utils/hash';

/**
 * Batch size for file uploads
 */
const BATCH_SIZE = FILE_UPLOAD_LIMITS.MAX_FILES_PER_BULK_UPLOAD;

/**
 * Concurrent upload count within a batch
 */
const UPLOAD_CONCURRENCY = FILE_BULK_UPLOAD_CONFIG.QUEUE_CONCURRENCY;

/**
 * Generate a unique batch ID
 */
function generateBatchId(): string {
  return `batch-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * useFolderUpload return type
 */
export interface UseFolderUploadReturn {
  /** Upload a folder structure */
  uploadFolder: (
    structure: FolderStructure,
    targetFolderId: string | null
  ) => Promise<void>;

  /** Current upload state */
  isUploading: boolean;

  /** Whether upload is paused */
  isPaused: boolean;

  /** Upload progress */
  progress: FolderUploadProgress;

  /** Pause the upload */
  pause: () => void;

  /** Resume a paused upload */
  resume: () => Promise<void>;

  /** Cancel the upload */
  cancel: () => void;

  /** Check if there's a resumable upload */
  hasResumableUpload: () => boolean;
}

/**
 * Initial progress state
 */
const initialProgress: FolderUploadProgress = {
  phase: 'idle',
  totalFiles: 0,
  uploadedFiles: 0,
  failedFiles: 0,
  currentBatch: 0,
  totalBatches: 0,
  percent: 0,
  speed: 0,
  eta: 0,
};

/**
 * Hook for managing folder uploads
 *
 * @example
 * ```tsx
 * function FolderDropZone() {
 *   const { uploadFolder, isUploading, progress, pause, resume, cancel } = useFolderUpload();
 *
 *   const handleDrop = async (structure: FolderStructure) => {
 *     await uploadFolder(structure, currentFolderId);
 *   };
 *
 *   return (
 *     <div>
 *       {isUploading && (
 *         <ProgressBar value={progress.percent} />
 *       )}
 *     </div>
 *   );
 * }
 * ```
 */
export function useFolderUpload(): UseFolderUploadReturn {
  // State
  const [isUploading, setIsUploading] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [progress, setProgress] = useState<FolderUploadProgress>(initialProgress);

  // Refs for tracking upload state
  const abortRef = useRef(false);
  const pauseRef = useRef(false);
  const startTimeRef = useRef<number>(0);
  const uploadedCountRef = useRef(0);

  // Stores
  const showLimitErrors = useUploadLimitStore((state) => state.showErrors);
  const openUnsupportedModal = useUnsupportedFilesStore((state) => state.openModal);
  const addFile = useFileListStore((state) => state.addFile);
  const setFiles = useFileListStore((state) => state.setFiles);

  /**
   * Update progress state
   */
  const updateProgress = useCallback((updates: Partial<FolderUploadProgress>) => {
    setProgress((prev) => {
      const updated = { ...prev, ...updates };

      // Calculate speed and ETA whenever we have a valid start time
      if (startTimeRef.current > 0) {
        // Use minimum of 0.1 seconds to avoid division issues
        const elapsedSeconds = Math.max((Date.now() - startTimeRef.current) / 1000, 0.1);

        if (updated.uploadedFiles > 0) {
          updated.speed = Math.round(updated.uploadedFiles / elapsedSeconds);
          const remainingFiles = updated.totalFiles - updated.uploadedFiles;
          updated.eta = updated.speed > 0 ? Math.round(remainingFiles / updated.speed) : 0;
        } else {
          // Before first file completes, show 0 speed and estimate based on total
          updated.speed = 0;
          updated.eta = 0;
        }
      }

      // Calculate percent
      if (updated.totalFiles > 0) {
        updated.percent = Math.round((updated.uploadedFiles / updated.totalFiles) * 100);
      }

      return updated;
    });
  }, []);

  /**
   * Create folders in batch
   */
  const createFolders = useCallback(
    async (
      structure: FolderStructure,
      targetFolderId: string | null
    ): Promise<Map<string, string>> => {
      updateProgress({ phase: 'creating-folders' });

      const fileApi = getFileApiClient();
      const folderIdMap = new Map<string, string>();

      // Collect all folders with tempIds
      const allFolders: Array<{ tempId: string; name: string; parentTempId: string | null }> = [];
      let tempIdCounter = 0;

      function collectFolders(folder: FolderEntry, parentTempId: string | null) {
        const tempId = `folder-${tempIdCounter++}`;
        allFolders.push({
          tempId,
          name: folder.name,
          parentTempId,
        });

        // Map path to tempId for child lookup
        folderIdMap.set(folder.path, tempId);

        // Collect children
        for (const child of folder.children) {
          if (child.type === 'folder') {
            collectFolders(child, tempId);
          }
        }
      }

      // Collect from all root folders
      for (const rootFolder of structure.rootFolders) {
        collectFolders(rootFolder, null);
      }

      // Create folders in batch
      if (allFolders.length > 0) {
        const result = await fileApi.createFolderBatch({
          folders: allFolders,
          targetFolderId,
        });

        if (!result.success) {
          throw new Error(result.error.message);
        }

        // Update map with actual folder IDs
        for (const created of result.data.created) {
          const originalTempId = created.tempId;
          // Find the folder by tempId and update with real ID
          for (const [path, tempId] of folderIdMap.entries()) {
            if (tempId === originalTempId) {
              folderIdMap.set(path, created.folderId);
              break;
            }
          }
        }
      }

      return folderIdMap;
    },
    [updateProgress]
  );

  /**
   * Upload files in batches
   */
  const uploadFiles = useCallback(
    async (
      files: FileEntry[],
      folderIdMap: Map<string, string>,
      targetFolderId: string | null,
      completedBatches: number[] = [],
      megaBatchId: string
    ): Promise<void> => {
      const fileApi = getFileApiClient();
      const sessionId = useSessionStore.getState().currentSession?.id;
      const currentFolderId = useFolderTreeStore.getState().currentFolderId;

      // Split files into batches
      const batches: FileEntry[][] = [];
      for (let i = 0; i < files.length; i += BATCH_SIZE) {
        batches.push(files.slice(i, i + BATCH_SIZE));
      }

      // Initialize timing refs BEFORE first updateProgress so speed/ETA calculations work
      startTimeRef.current = Date.now();
      uploadedCountRef.current = completedBatches.length * BATCH_SIZE;

      updateProgress({
        phase: 'uploading',
        totalBatches: batches.length,
        currentBatch: completedBatches.length,
      });

      // Process each batch
      for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
        // Skip already completed batches
        if (completedBatches.includes(batchIndex)) {
          continue;
        }

        // Check for pause/abort
        if (pauseRef.current || abortRef.current) {
          if (pauseRef.current) {
            // Save state for resume
            // Note: We can't store File objects, so resume requires re-selection
            // For now, we store progress info
            setIsPaused(true);
          }
          break;
        }

        const batch = batches[batchIndex];
        updateProgress({ currentBatch: batchIndex + 1 });

        // Prepare batch metadata
        const filesMetadata = batch.map((file, idx) => ({
          tempId: `${megaBatchId}-batch${batchIndex}-${idx}`,
          fileName: file.name,
          mimeType: file.file.type || 'application/octet-stream',
          sizeBytes: file.file.size,
          file: file.file,
          parentPath: getParentPath(file.path),
        }));

        // Get parent folder ID for each file
        const getParentFolderId = (filePath: string): string | undefined => {
          const parentPath = getParentPath(filePath);
          if (!parentPath) return targetFolderId ?? undefined;
          return folderIdMap.get(parentPath) ?? targetFolderId ?? undefined;
        };

        // Initialize bulk upload
        const initResult = await fileApi.initBulkUpload({
          files: filesMetadata.map(({ tempId, fileName, mimeType, sizeBytes }) => ({
            tempId,
            fileName,
            mimeType,
            sizeBytes,
          })),
          parentFolderId: targetFolderId ?? undefined,
          sessionId,
        });

        if (!initResult.success) {
          console.error('Bulk upload init failed:', initResult.error);
          continue; // Skip this batch
        }

        const { batchId, files: sasInfoList } = initResult.data;
        const sasInfoMap = new Map(sasInfoList.map((info) => [info.tempId, info]));

        // Upload files in parallel with concurrency limit
        const uploadResults: Array<{
          tempId: string;
          success: boolean;
          contentHash?: string;
          error?: string;
        }> = [];

        // Process in chunks of UPLOAD_CONCURRENCY
        for (let i = 0; i < filesMetadata.length; i += UPLOAD_CONCURRENCY) {
          if (pauseRef.current || abortRef.current) break;

          const chunk = filesMetadata.slice(i, i + UPLOAD_CONCURRENCY);
          const promises = chunk.map(async (meta) => {
            const sasInfo = sasInfoMap.get(meta.tempId);
            if (!sasInfo) {
              return { tempId: meta.tempId, success: false, error: 'SAS URL not found' };
            }

            try {
              const uploadResult = await fileApi.uploadToBlob(meta.file, sasInfo.sasUrl);

              if (uploadResult.success) {
                let contentHash: string | undefined;
                try {
                  contentHash = await computeFileSha256(meta.file);
                } catch {
                  // Non-fatal
                }

                uploadedCountRef.current++;
                updateProgress({
                  uploadedFiles: uploadedCountRef.current,
                });

                return { tempId: meta.tempId, success: true, contentHash };
              } else {
                return { tempId: meta.tempId, success: false, error: uploadResult.error };
              }
            } catch (error) {
              return {
                tempId: meta.tempId,
                success: false,
                error: error instanceof Error ? error.message : 'Upload failed',
              };
            }
          });

          const results = await Promise.all(promises);
          uploadResults.push(...results);
        }

        // Complete bulk upload - include parentFolderId per file for correct folder placement
        const completeResult = await fileApi.completeBulkUpload({
          batchId,
          uploads: uploadResults.map((result) => {
            const meta = filesMetadata.find((m) => m.tempId === result.tempId);
            return {
              ...result,
              parentFolderId: meta ? getParentFolderId(meta.parentPath ? `${meta.parentPath}/${meta.fileName}` : meta.fileName) : (targetFolderId ?? null),
            };
          }),
          parentFolderId: targetFolderId,
        });

        if (!completeResult.success) {
          console.error('Bulk upload complete failed:', completeResult.error);
        }

        // Mark batch as completed
        completedBatches.push(batchIndex);
      }

      // Refresh file list if we're in the target folder
      if (targetFolderId === currentFolderId || (targetFolderId === null && currentFolderId === null)) {
        const result = await fileApi.getFiles({ folderId: currentFolderId ?? undefined });
        if (result.success) {
          const { files: fetchedFiles, pagination } = result.data;
          const hasMoreFiles = pagination.offset + fetchedFiles.length < pagination.total;
          setFiles(fetchedFiles, pagination.total, hasMoreFiles);
        }
      }
    },
    [updateProgress, setFiles]
  );

  /**
   * Main upload function
   */
  const uploadFolder = useCallback(
    async (structure: FolderStructure, targetFolderId: string | null): Promise<void> => {
      // Reset state
      abortRef.current = false;
      pauseRef.current = false;
      setIsUploading(true);
      setIsPaused(false);
      setProgress({ ...initialProgress, totalFiles: structure.validFiles.length });

      try {
        // Step 1: Validate limits
        const validation = validateFolderLimits(structure);
        if (!validation.isValid) {
          showLimitErrors(validation.errors);
          setIsUploading(false);
          return;
        }

        // Step 2: Handle unsupported files
        if (structure.invalidFiles.length > 0) {
          updateProgress({ phase: 'validating' });
          const resolution = await openUnsupportedModal(structure.invalidFiles);

          if (!resolution.proceed) {
            setIsUploading(false);
            setProgress(initialProgress);
            return;
          }

          // Filter out skipped files
          const filesToUpload = structure.validFiles.filter(
            (f) => !resolution.skippedPaths.has(f.path)
          );
          structure = {
            ...structure,
            validFiles: filesToUpload,
            totalFiles: filesToUpload.length,
          };

          setProgress((prev) => ({ ...prev, totalFiles: filesToUpload.length }));
        }

        const megaBatchId = generateBatchId();

        // Step 3: Create folders
        const folderIdMap = await createFolders(structure, targetFolderId);

        // Step 4: Upload files
        await uploadFiles(
          structure.validFiles,
          folderIdMap,
          targetFolderId,
          [],
          megaBatchId
        );

        // Complete
        updateProgress({ phase: 'done' });
        clearUploadState();
      } catch (error) {
        console.error('[useFolderUpload] Upload failed:', error);
        updateProgress({ phase: 'error' });
      } finally {
        if (!pauseRef.current) {
          setIsUploading(false);
        }
      }
    },
    [createFolders, uploadFiles, showLimitErrors, openUnsupportedModal, updateProgress]
  );

  /**
   * Pause the upload
   */
  const pause = useCallback(() => {
    pauseRef.current = true;
    updateProgress({ phase: 'paused' });
  }, [updateProgress]);

  /**
   * Resume a paused upload
   */
  const resume = useCallback(async () => {
    // For now, resume is limited since we can't store File objects
    // User would need to re-select files
    // This is a placeholder for future enhancement
    console.warn('[useFolderUpload] Resume not fully implemented - files need re-selection');
    pauseRef.current = false;
    setIsPaused(false);
  }, []);

  /**
   * Cancel the upload
   */
  const cancel = useCallback(() => {
    abortRef.current = true;
    pauseRef.current = false;
    clearUploadState();
    setIsUploading(false);
    setIsPaused(false);
    setProgress(initialProgress);
  }, []);

  /**
   * Check if there's a resumable upload
   */
  const hasResumableUpload = useCallback(() => {
    return loadUploadState() !== null;
  }, []);

  return {
    uploadFolder,
    isUploading,
    isPaused,
    progress,
    pause,
    resume,
    cancel,
    hasResumableUpload,
  };
}

/**
 * Get parent path from file path
 */
function getParentPath(filePath: string): string | null {
  const lastSlash = filePath.lastIndexOf('/');
  if (lastSlash === -1) return null;
  return filePath.substring(0, lastSlash);
}
