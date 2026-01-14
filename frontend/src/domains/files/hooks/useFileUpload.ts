/**
 * useFileUpload Hook
 *
 * Hook for file upload functionality with API execution.
 * Wraps uploadStore for queue state and progress tracking.
 * Includes duplicate detection and conflict resolution.
 *
 * @module domains/files/hooks/useFileUpload
 */

import { useCallback, useEffect, useRef } from 'react';
import { useUploadStore, type UploadItem } from '../stores/uploadStore';
import { useFileListStore } from '../stores/fileListStore';
import { useFolderTreeStore } from '../stores/folderTreeStore';
import { useDuplicateStore, type DuplicateConflict } from '../stores/duplicateStore';
import { getFileApiClient } from '@/src/infrastructure/api';
import { computeFileHashesWithIds, type FileHashResult } from '@/lib/utils/hash';

/**
 * useFileUpload return type
 */
export interface UseFileUploadReturn {
  /** Upload queue items */
  queue: UploadItem[];
  /** Whether any upload is in progress */
  isUploading: boolean;
  /** Overall progress (0-100) */
  overallProgress: number;
  /** Number of pending items */
  pendingCount: number;
  /** Number of completed items */
  completedCount: number;
  /** Number of failed items */
  failedCount: number;
  /** Add files to upload queue */
  addToQueue: (files: File[]) => void;
  /** Clear entire queue */
  clearQueue: () => void;
  /** Upload files to server (adds to queue and executes upload) */
  uploadFiles: (files: File[], folderId?: string | null) => Promise<void>;
}

/**
 * Hook for managing file uploads
 *
 * Provides upload queue state and actions.
 * Actual upload execution should be handled by a separate service/hook.
 *
 * @example
 * ```tsx
 * function UploadButton() {
 *   const { addToQueue, isUploading, overallProgress } = useFileUpload();
 *
 *   const handleFiles = (files: FileList) => {
 *     addToQueue(Array.from(files));
 *   };
 *
 *   return (
 *     <div>
 *       <input type="file" onChange={e => handleFiles(e.target.files!)} />
 *       {isUploading && <ProgressBar value={overallProgress} />}
 *     </div>
 *   );
 * }
 * ```
 */
export function useFileUpload(): UseFileUploadReturn {
  // Get queue state from store
  const queue = useUploadStore((state) => state.queue);
  const isUploading = useUploadStore((state) => state.isUploading);
  const overallProgress = useUploadStore((state) => state.overallProgress);

  // Get upload store action functions
  const addToQueueAction = useUploadStore((state) => state.addToQueue);
  const clearQueueAction = useUploadStore((state) => state.clearQueue);
  const startUploadAction = useUploadStore((state) => state.startUpload);
  const updateProgressAction = useUploadStore((state) => state.updateProgress);
  const completeUploadAction = useUploadStore((state) => state.completeUpload);
  const failUploadAction = useUploadStore((state) => state.failUpload);
  const getPendingCount = useUploadStore((state) => state.getPendingCount);
  const getCompletedCount = useUploadStore((state) => state.getCompletedCount);
  const getFailedCount = useUploadStore((state) => state.getFailedCount);

  // Get file list store action for adding uploaded files
  const addFile = useFileListStore((state) => state.addFile);

  // Get current folder ID
  const currentFolderId = useFolderTreeStore((state) => state.currentFolderId);

  // Wrap actions in useCallback for stable references
  const addToQueue = useCallback(
    (files: File[]) => {
      addToQueueAction(files);
    },
    [addToQueueAction]
  );

  const clearQueue = useCallback(() => {
    clearQueueAction();
  }, [clearQueueAction]);

  // Get duplicate store actions
  const setConflicts = useDuplicateStore((state) => state.setConflicts);
  const duplicateResolutions = useDuplicateStore((state) => state.resolutions);
  const isAllResolved = useDuplicateStore((state) => state.isAllResolved);
  const isCancelled = useDuplicateStore((state) => state.isCancelled);
  const resetDuplicates = useDuplicateStore((state) => state.reset);

  // Ref to track pending upload state for duplicate resolution
  const pendingUploadRef = useRef<{
    files: File[];
    hashResults: FileHashResult[];
    targetFolderId: string | null;
  } | null>(null);

  // Helper function to upload a single file
  const uploadSingleFile = useCallback(
    async (
      file: File,
      queueItemId: string,
      targetFolderId: string | null,
      fileApi: ReturnType<typeof getFileApiClient>
    ) => {
      startUploadAction(queueItemId);

      try {
        const result = await fileApi.uploadFiles(
          [file],
          targetFolderId ?? undefined,
          (progress) => {
            updateProgressAction(queueItemId, progress);
          }
        );

        if (result.success && result.data.files.length > 0) {
          completeUploadAction(queueItemId, result.data.files[0]);
          // Add to file list if we're in the same folder
          const currentFolder = useFolderTreeStore.getState().currentFolderId;
          if (targetFolderId === currentFolder || (targetFolderId === null && currentFolder === null)) {
            addFile(result.data.files[0]);
          }
          return { success: true as const, file: result.data.files[0] };
        } else {
          const errorMsg = result.success ? 'No file returned' : result.error.message;
          failUploadAction(queueItemId, errorMsg);
          return { success: false as const, error: errorMsg };
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Upload failed';
        failUploadAction(queueItemId, errorMsg);
        return { success: false as const, error: errorMsg };
      }
    },
    [startUploadAction, updateProgressAction, completeUploadAction, failUploadAction, addFile]
  );

  // Get removeFromQueue action for skipped files
  const removeFromQueueAction = useUploadStore((state) => state.removeFromQueue);

  // Process uploads after duplicate resolution
  const processUploadsAfterResolution = useCallback(async () => {
    const pending = pendingUploadRef.current;
    if (!pending) return;

    const { hashResults, targetFolderId } = pending;
    const fileApi = getFileApiClient();
    const resolutions = useDuplicateStore.getState().resolutions;
    const cancelled = useDuplicateStore.getState().isCancelled;

    // Clear pending ref
    pendingUploadRef.current = null;

    // If cancelled, clear queue and return
    if (cancelled) {
      clearQueueAction();
      resetDuplicates();
      return;
    }

    // Create a map of tempId -> resolution
    const resolutionMap = new Map(resolutions.map((r) => [r.tempId, r]));

    // Get current queue
    const currentQueue = useUploadStore.getState().queue;

    // Process each file
    for (const hashResult of hashResults) {
      const resolution = resolutionMap.get(hashResult.tempId);
      const queueItem = currentQueue.find((item) => item.file === hashResult.file);

      if (!queueItem) continue;

      // If there's a resolution for this file
      if (resolution) {
        if (resolution.action === 'skip') {
          // Remove from queue (skipped files don't complete)
          removeFromQueueAction(queueItem.id);
          continue;
        }

        if (resolution.action === 'replace' && resolution.existingFileId) {
          // Delete existing file first
          try {
            await fileApi.deleteFile(resolution.existingFileId);
            // Remove from file list if in current folder
            const currentFolder = useFolderTreeStore.getState().currentFolderId;
            if (targetFolderId === currentFolder || (targetFolderId === null && currentFolder === null)) {
              useFileListStore.getState().deleteFiles([resolution.existingFileId]);
            }
          } catch (err) {
            // If delete fails, fail the upload
            failUploadAction(
              queueItem.id,
              `Failed to replace existing file: ${err instanceof Error ? err.message : 'Unknown error'}`
            );
            continue;
          }
        }
      }

      // Upload the file
      await uploadSingleFile(hashResult.file, queueItem.id, targetFolderId, fileApi);
    }

    // Reset duplicate store
    resetDuplicates();
  }, [uploadSingleFile, failUploadAction, clearQueueAction, resetDuplicates, removeFromQueueAction]);

  // Effect to process uploads after all duplicates are resolved
  useEffect(() => {
    if (pendingUploadRef.current && isAllResolved()) {
      processUploadsAfterResolution();
    }
  }, [duplicateResolutions, isAllResolved, isCancelled, processUploadsAfterResolution]);

  // Upload files to server with duplicate detection
  const uploadFiles = useCallback(
    async (files: File[], folderId?: string | null) => {
      // Use provided folderId or fall back to current folder
      const targetFolderId = folderId !== undefined ? folderId : currentFolderId;

      // Reset any previous duplicate state
      resetDuplicates();

      // Add files to queue
      addToQueueAction(files);

      // Get the file API client
      const fileApi = getFileApiClient();

      // Step 1: Compute hashes for all files
      let hashResults: FileHashResult[];
      try {
        hashResults = await computeFileHashesWithIds(files);
      } catch (err) {
        // If hash computation fails, fall back to uploading without duplicate check
        console.warn('Hash computation failed, uploading without duplicate check:', err);
        const currentQueue = useUploadStore.getState().queue;
        for (const item of currentQueue) {
          if (item.status !== 'pending') continue;
          await uploadSingleFile(item.file, item.id, targetFolderId, fileApi);
        }
        return;
      }

      // Step 2: Check for duplicates
      const checkRequest = {
        files: hashResults.map((hr) => ({
          tempId: hr.tempId,
          contentHash: hr.hash,
          fileName: hr.file.name,
        })),
      };

      const checkResult = await fileApi.checkDuplicates(checkRequest);

      if (!checkResult.success) {
        // If duplicate check fails, fall back to uploading without duplicate check
        console.warn('Duplicate check failed, uploading without duplicate check:', checkResult.error);
        const currentQueue = useUploadStore.getState().queue;
        for (const item of currentQueue) {
          if (item.status !== 'pending') continue;
          await uploadSingleFile(item.file, item.id, targetFolderId, fileApi);
        }
        return;
      }

      // Step 3: Separate duplicates from non-duplicates
      const duplicates = checkResult.data.results.filter((r: { isDuplicate: boolean }) => r.isDuplicate);
      const nonDuplicates = checkResult.data.results.filter((r: { isDuplicate: boolean }) => !r.isDuplicate);

      // Step 4: If there are duplicates, show conflict modal and wait for resolution
      if (duplicates.length > 0) {
        // Create conflict objects
        const conflicts: DuplicateConflict[] = duplicates
          .map((dup: { tempId: string; isDuplicate: boolean; existingFile?: import('@bc-agent/shared').ParsedFile }) => {
            const hashResult = hashResults.find((hr) => hr.tempId === dup.tempId);
            if (!hashResult || !dup.existingFile) return null;

            return {
              tempId: dup.tempId,
              newFile: hashResult.file,
              existingFile: dup.existingFile,
              hash: hashResult.hash,
            };
          })
          .filter((c: DuplicateConflict | null): c is DuplicateConflict => c !== null);

        // Store pending upload state
        pendingUploadRef.current = {
          files,
          hashResults,
          targetFolderId,
        };

        // Set conflicts - this will open the modal
        setConflicts(conflicts);

        // Upload non-duplicates immediately
        const currentQueue = useUploadStore.getState().queue;
        for (const nonDup of nonDuplicates) {
          const hashResult = hashResults.find((hr) => hr.tempId === nonDup.tempId);
          if (!hashResult) continue;

          const queueItem = currentQueue.find((item) => item.file === hashResult.file);
          if (!queueItem || queueItem.status !== 'pending') continue;

          await uploadSingleFile(hashResult.file, queueItem.id, targetFolderId, fileApi);
        }

        // The duplicate files will be processed after user resolution via the useEffect
        return;
      }

      // Step 5: No duplicates - upload all files normally
      const currentQueue = useUploadStore.getState().queue;
      for (const item of currentQueue) {
        if (item.status !== 'pending') continue;
        await uploadSingleFile(item.file, item.id, targetFolderId, fileApi);
      }
    },
    [
      currentFolderId,
      addToQueueAction,
      uploadSingleFile,
      setConflicts,
      resetDuplicates,
    ]
  );

  return {
    queue,
    isUploading,
    overallProgress,
    pendingCount: getPendingCount(),
    completedCount: getCompletedCount(),
    failedCount: getFailedCount(),
    addToQueue,
    clearQueue,
    uploadFiles,
  };
}
