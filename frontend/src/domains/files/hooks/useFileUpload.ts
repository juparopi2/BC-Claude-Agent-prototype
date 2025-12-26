/**
 * useFileUpload Hook
 *
 * Hook for file upload functionality with API execution.
 * Wraps uploadStore for queue state and progress tracking.
 *
 * @module domains/files/hooks/useFileUpload
 */

import { useCallback } from 'react';
import { useUploadStore, type UploadItem } from '../stores/uploadStore';
import { useFileListStore } from '../stores/fileListStore';
import { useFolderTreeStore } from '../stores/folderTreeStore';
import { getFileApiClient } from '@/lib/services/fileApi';

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

  // Upload files to server
  const uploadFiles = useCallback(
    async (files: File[], folderId?: string | null) => {
      // Use provided folderId or fall back to current folder
      const targetFolderId = folderId !== undefined ? folderId : currentFolderId;

      // Add files to queue
      addToQueueAction(files);

      // Get the file API client
      const fileApi = getFileApiClient();

      // Get current queue state to process pending items
      const currentQueue = useUploadStore.getState().queue;

      // Process each pending item
      for (const item of currentQueue) {
        if (item.status !== 'pending') continue;

        // Mark as uploading
        startUploadAction(item.id);

        try {
          // Upload the file with progress tracking
          const result = await fileApi.uploadFiles(
            [item.file],
            targetFolderId ?? undefined,
            (progress) => {
              updateProgressAction(item.id, progress);
            }
          );

          if (result.success && result.data.files.length > 0) {
            // Mark as completed and store result
            completeUploadAction(item.id, result.data.files[0]);
            // Add to file list if we're in the same folder
            if (targetFolderId === currentFolderId || (targetFolderId === null && currentFolderId === null)) {
              addFile(result.data.files[0]);
            }
          } else {
            // Mark as failed
            failUploadAction(
              item.id,
              result.success ? 'No file returned' : result.error.message
            );
          }
        } catch (err) {
          failUploadAction(
            item.id,
            err instanceof Error ? err.message : 'Upload failed'
          );
        }
      }
    },
    [
      currentFolderId,
      addToQueueAction,
      startUploadAction,
      updateProgressAction,
      completeUploadAction,
      failUploadAction,
      addFile,
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
