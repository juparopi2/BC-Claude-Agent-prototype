/**
 * useFileUpload Hook
 *
 * Hook for file upload functionality with API execution.
 * Wraps uploadStore for queue state and progress tracking.
 * Includes duplicate detection and conflict resolution.
 *
 * Supports two upload modes:
 * - Traditional: For ≤20 files, uses Uppy + @uppy/xhr-upload with duplicate detection
 * - Bulk: For >20 files, uses Uppy + @uppy/aws-s3 for direct-to-blob uploads
 *
 * @module domains/files/hooks/useFileUpload
 */

import { useCallback, useEffect, useRef } from 'react';
import { useUploadStore, type UploadItem } from '../stores/uploadStore';
import { useFileListStore } from '../stores/fileListStore';
import { useFolderTreeStore } from '../stores/folderTreeStore';
import { useDuplicateStore, type DuplicateConflict } from '../stores/duplicateStore';
import { useSessionStore } from '@/src/domains/session/stores/sessionStore';
import { getFileApiClient } from '@/src/infrastructure/api';
import { computeFileHashesWithIds, computeFileSha256, type FileHashResult } from '@/lib/utils/hash';
import { FILE_UPLOAD_LIMITS, type BulkUploadFileSasInfo } from '@bc-agent/shared';
import { createBlobUploadUppy, createFormUploadUppy } from '@/src/infrastructure/upload';

/**
 * Number of concurrent uploads for bulk upload flow
 */
const BULK_UPLOAD_CONCURRENCY = 5;

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

  // Helper function to upload a single file via Uppy
  const uploadSingleFile = useCallback(
    async (
      file: File,
      queueItemId: string,
      targetFolderId: string | null,
      _fileApi: ReturnType<typeof getFileApiClient>
    ) => {
      const sessionId = useSessionStore.getState().currentSession?.id;
      const uppy = createFormUploadUppy({ concurrency: 1 });

      uppy.addFile({
        name: file.name,
        type: file.type || 'application/octet-stream',
        data: file,
        meta: {
          queueItemId,
          parentFolderId: targetFolderId ?? undefined,
          sessionId: sessionId ?? undefined,
        },
      });

      startUploadAction(queueItemId);

      return new Promise<{ success: true; file: unknown } | { success: false; error: string }>((resolve) => {
        uppy.on('upload-progress', (_uppyFile, progress) => {
          if (progress.bytesTotal && progress.bytesTotal > 0) {
            updateProgressAction(queueItemId, Math.round((progress.bytesUploaded / progress.bytesTotal) * 100));
          }
        });

        uppy.on('upload-success', (_uppyFile, response) => {
          const body = response?.body as unknown as { files?: Array<import('@bc-agent/shared').ParsedFile> } | undefined;
          const resultFile = body?.files?.[0] ?? null;
          if (resultFile) {
            completeUploadAction(queueItemId, resultFile);
            // Add to file list if in same folder
            const currentFolder = useFolderTreeStore.getState().currentFolderId;
            if (targetFolderId === currentFolder || (targetFolderId === null && currentFolder === null)) {
              addFile(resultFile);
            }
          }
          uppy.destroy();
          resolve({ success: true, file: resultFile });
        });

        uppy.on('upload-error', (_uppyFile, error) => {
          const errorMsg = error?.message ?? 'Upload failed';
          failUploadAction(queueItemId, errorMsg);
          uppy.destroy();
          resolve({ success: false, error: errorMsg });
        });

        uppy.upload();
      });
    },
    [startUploadAction, updateProgressAction, completeUploadAction, failUploadAction, addFile]
  );

  /**
   * Execute bulk upload flow for >20 files
   *
   * Uses Uppy + @uppy/aws-s3 with SAS URLs for direct-to-blob uploads.
   * Automatically handles concurrency and retries.
   *
   * Flow:
   * 1. Call initBulkUpload to get SAS URLs
   * 2. Upload files via Uppy to Azure Blob
   * 3. Call completeBulkUpload to confirm and enqueue processing
   * 4. Files are created via WebSocket events (file:uploaded)
   */
  const bulkUploadFiles = useCallback(
    async (files: File[], targetFolderId: string | null) => {
      const fileApi = getFileApiClient();
      const sessionId = useSessionStore.getState().currentSession?.id;
      const currentQueue = useUploadStore.getState().queue;

      // Map files to their queue items
      const fileToQueueItem = new Map<File, UploadItem>();
      for (const item of currentQueue) {
        fileToQueueItem.set(item.file, item);
      }

      // Step 1: Prepare file metadata for SAS URL generation
      const filesMetadata = files.map((file, index) => ({
        tempId: `temp-${Date.now()}-${index}`,
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        sizeBytes: file.size,
        file, // Keep reference for later
      }));

      // Step 2: Initialize bulk upload (get SAS URLs)
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
        // Fail all items in queue
        for (const file of files) {
          const queueItem = fileToQueueItem.get(file);
          if (queueItem) {
            failUploadAction(queueItem.id, initResult.error.message);
          }
        }
        return;
      }

      const { batchId, files: sasInfoList } = initResult.data;

      // Create a map of tempId -> SAS info
      const sasInfoMap = new Map<string, BulkUploadFileSasInfo>(
        sasInfoList.map((info: BulkUploadFileSasInfo) => [info.tempId, info])
      );

      // Step 3: Upload files via Uppy
      const uppy = createBlobUploadUppy({ concurrency: BULK_UPLOAD_CONCURRENCY });

      // Track tempId -> metadata for post-upload processing
      const uppyFileIdToTempId = new Map<string, string>();
      const successfulTempIds = new Set<string>();

      for (const meta of filesMetadata) {
        const sasInfo = sasInfoMap.get(meta.tempId);
        const queueItem = fileToQueueItem.get(meta.file);

        if (!sasInfo || !queueItem) continue;

        startUploadAction(queueItem.id);

        const uppyFileId = uppy.addFile({
          name: meta.fileName,
          type: meta.mimeType,
          data: meta.file,
          meta: {
            sasUrl: sasInfo.sasUrl,
            correlationId: meta.tempId,
            contentType: meta.mimeType,
            blobPath: sasInfo.blobPath,
          },
        });
        uppyFileIdToTempId.set(uppyFileId, meta.tempId);
      }

      // Wire progress events
      uppy.on('upload-progress', (uppyFile, progress) => {
        if (!uppyFile) return;
        const tempId = uppyFileIdToTempId.get(uppyFile.id);
        if (!tempId) return;
        const meta = filesMetadata.find((m) => m.tempId === tempId);
        if (!meta) return;
        const queueItem = fileToQueueItem.get(meta.file);
        if (!queueItem) return;
        if (progress.bytesTotal && progress.bytesTotal > 0) {
          updateProgressAction(queueItem.id, Math.round((progress.bytesUploaded / progress.bytesTotal) * 100));
        }
      });

      uppy.on('upload-success', (uppyFile) => {
        if (!uppyFile) return;
        const tempId = uppyFileIdToTempId.get(uppyFile.id);
        if (tempId) {
          successfulTempIds.add(tempId);
        }
      });

      uppy.on('upload-error', (uppyFile, error) => {
        if (!uppyFile) return;
        const tempId = uppyFileIdToTempId.get(uppyFile.id);
        if (!tempId) return;
        const meta = filesMetadata.find((m) => m.tempId === tempId);
        if (!meta) return;
        const queueItem = fileToQueueItem.get(meta.file);
        if (!queueItem) return;
        failUploadAction(queueItem.id, error?.message ?? 'Upload failed');
      });

      // Execute upload
      await uppy.upload();
      uppy.destroy();

      // Step 4: Compute hashes for successful uploads
      const uploadResults: Array<{
        tempId: string;
        success: boolean;
        contentHash?: string;
        error?: string;
      }> = [];

      for (const meta of filesMetadata) {
        if (successfulTempIds.has(meta.tempId)) {
          let contentHash: string | undefined;
          try {
            contentHash = await computeFileSha256(meta.file);
          } catch {
            console.warn(`Failed to compute hash for ${meta.fileName}`);
          }
          uploadResults.push({ tempId: meta.tempId, success: true, contentHash });
        } else {
          uploadResults.push({ tempId: meta.tempId, success: false, error: 'Upload failed' });
        }
      }

      // Step 5: Complete bulk upload (enqueue processing jobs)
      const successfulUploads = uploadResults.filter((r) => r.success);

      if (successfulUploads.length === 0) {
        console.warn('All bulk uploads failed');
        return;
      }

      const completeResult = await fileApi.completeBulkUpload({
        batchId,
        uploads: uploadResults,
        parentFolderId: targetFolderId,
      });

      if (!completeResult.success) {
        console.error('Failed to complete bulk upload:', completeResult.error);
      }

      // Mark successful uploads as complete in the queue
      for (const result of uploadResults) {
        if (result.success) {
          const meta = filesMetadata.find((m) => m.tempId === result.tempId);
          if (meta) {
            const queueItem = fileToQueueItem.get(meta.file);
            if (queueItem) {
              completeUploadAction(queueItem.id, null);
            }
          }
        }
      }
    },
    [startUploadAction, updateProgressAction, completeUploadAction, failUploadAction]
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

      // Skip files without resolution - they're non-duplicates already uploaded
      if (!resolution) continue;

      // Process files with resolution (duplicates)
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

      // Route to bulk upload for large batches (>20 files)
      // Bulk upload uses SAS URLs for direct-to-blob uploads
      if (files.length > FILE_UPLOAD_LIMITS.MAX_FILES_PER_UPLOAD) {
        await bulkUploadFiles(files, targetFolderId);
        return;
      }

      // Get the file API client (traditional upload flow)
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
      bulkUploadFiles,
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
