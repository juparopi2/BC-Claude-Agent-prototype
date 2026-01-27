/**
 * useFolderUpload Hook
 *
 * Main orchestration hook for folder-based batch upload functionality.
 * Each folder is treated as a batch, processed sequentially for clear progress feedback.
 *
 * Flow:
 * 1. Read folder structure (via folderReader)
 * 2. Validate limits and show errors if exceeded
 * 3. Initialize upload session (backend creates session in Redis)
 * 4. For each folder (sequentially):
 *    a. Create folder in DB
 *    b. Register files (early persistence - files visible immediately)
 *    c. Get SAS URLs
 *    d. Upload files to blob (parallel within folder)
 *    e. Complete folder batch
 * 5. Session completion via WebSocket events
 *
 * @module domains/files/hooks/useFolderUpload
 */

import { useCallback, useRef, useState, useEffect } from 'react';
import { getFileApiClient } from '@/src/infrastructure/api';
import { useSessionStore } from '@/src/domains/session/stores/sessionStore';
import { useFileListStore } from '../stores/fileListStore';
import { useFolderTreeStore } from '../stores/folderTreeStore';
import { useUploadLimitStore } from '../stores/uploadLimitStore';
import { useUnsupportedFilesStore } from '../stores/unsupportedFilesStore';
import { useUploadSessionStore } from '../stores/uploadSessionStore';
import {
  clearUploadState,
} from '../utils/folderUploadPersistence';
import { FILE_UPLOAD_LIMITS, FOLDER_UPLOAD_CONFIG } from '@bc-agent/shared';
import type {
  FolderStructure,
  FolderUploadProgress,
  FolderEntry,
  FileEntry,
} from '../types/folderUpload.types';
import { validateFolderLimits } from '../types/folderUpload.types';
import { computeFileSha256 } from '@/lib/utils/hash';
import type {
  FolderInput,
  FileRegistrationMetadata,
  FolderBatch,
  RegisteredFileSasInfo,
} from '@bc-agent/shared';

/**
 * Concurrent upload count within a folder batch
 */
const UPLOAD_CONCURRENCY = FOLDER_UPLOAD_CONFIG.FILE_UPLOAD_CONCURRENCY;

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

  /** Upload progress (folder-based) */
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
};

/**
 * Hook for managing folder uploads
 *
 * Uses folder-based batching: each folder is a batch processed sequentially.
 * Progress shows "Folder 1 of N: FolderName" for clear user feedback.
 *
 * @example
 * ```tsx
 * function FolderDropZone() {
 *   const { uploadFolder, isUploading, progress, pause, cancel } = useFolderUpload();
 *
 *   const handleDrop = async (structure: FolderStructure) => {
 *     await uploadFolder(structure, currentFolderId);
 *   };
 *
 *   return (
 *     <div>
 *       {isUploading && (
 *         <span>
 *           Folder {progress.currentBatch} of {progress.totalBatches}
 *         </span>
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
  const uploadedCountRef = useRef(0);
  const heartbeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const currentSessionIdRef = useRef<string | null>(null);

  // Stores
  const showLimitErrors = useUploadLimitStore((state) => state.showErrors);
  const openUnsupportedModal = useUnsupportedFilesStore((state) => state.openModal);
  const setFiles = useFileListStore((state) => state.setFiles);
  const setSession = useUploadSessionStore((state) => state.setSession);
  const updateBatch = useUploadSessionStore((state) => state.updateBatch);
  const clearSession = useUploadSessionStore((state) => state.clearSession);

  // Clean up heartbeat on unmount
  useEffect(() => {
    return () => {
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
        heartbeatIntervalRef.current = null;
      }
    };
  }, []);

  /**
   * Update progress state
   *
   * Simplified: Only tracks phase and file counts.
   * Percent is calculated from uploadedFiles/totalFiles.
   * ETA/speed calculations removed for simpler UX.
   */
  const updateProgress = useCallback((updates: Partial<FolderUploadProgress>) => {
    setProgress((prev) => {
      const updated = { ...prev, ...updates };

      // Calculate percent based on file counts
      if (updated.totalFiles > 0) {
        updated.percent = Math.round((updated.uploadedFiles / updated.totalFiles) * 100);
      }

      return updated;
    });
  }, []);

  /**
   * Start heartbeat to keep session alive
   */
  const startHeartbeat = useCallback((sessionId: string) => {
    const fileApi = getFileApiClient();

    // Clear any existing interval
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
    }

    // Send heartbeat every minute
    heartbeatIntervalRef.current = setInterval(async () => {
      if (!pauseRef.current && !abortRef.current) {
        await fileApi.heartbeatUploadSession(sessionId);
      }
    }, FOLDER_UPLOAD_CONFIG.HEARTBEAT_INTERVAL_MS);
  }, []);

  /**
   * Stop heartbeat
   */
  const stopHeartbeat = useCallback(() => {
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }
  }, []);

  /**
   * Build folder input structure for session initialization
   */
  const buildFolderInputs = useCallback(
    (structure: FolderStructure): { folderInputs: FolderInput[]; fileToFolderMap: Map<string, string> } => {
      const folderInputs: FolderInput[] = [];
      const fileToFolderMap = new Map<string, string>(); // filePath -> folderTempId
      let tempIdCounter = 0;

      function processFolderEntry(
        folder: FolderEntry,
        parentTempId: string | null
      ): void {
        const tempId = `folder-${tempIdCounter++}`;

        // Collect files in this folder
        const files: FileRegistrationMetadata[] = [];
        for (const child of folder.children) {
          if (child.type === 'file') {
            const fileEntry = child as FileEntry;
            const fileTempId = `file-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
            files.push({
              tempId: fileTempId,
              fileName: fileEntry.name,
              mimeType: fileEntry.file.type || 'application/octet-stream',
              sizeBytes: fileEntry.file.size,
            });
            fileToFolderMap.set(fileEntry.path, tempId);
          }
        }

        folderInputs.push({
          tempId,
          name: folder.name,
          parentTempId,
          files,
        });

        // Process child folders
        for (const child of folder.children) {
          if (child.type === 'folder') {
            processFolderEntry(child as FolderEntry, tempId);
          }
        }
      }

      // Process all root folders
      for (const rootFolder of structure.rootFolders) {
        processFolderEntry(rootFolder, null);
      }

      return { folderInputs, fileToFolderMap };
    },
    []
  );

  /**
   * Upload files within a single folder batch
   */
  const uploadFolderBatch = useCallback(
    async (
      sessionId: string,
      batch: FolderBatch,
      files: FileEntry[],
      targetFolderId: string | null
    ): Promise<{ success: boolean; uploadedCount: number; failedCount: number }> => {
      const fileApi = getFileApiClient();
      let uploadedCount = 0;
      let failedCount = 0;

      try {
        // Step 1: Create folder in DB
        const createResult = await fileApi.createSessionFolder(sessionId, batch.tempId);
        if (!createResult.success) {
          console.error('[useFolderUpload] Failed to create folder:', createResult.error);
          return { success: false, uploadedCount, failedCount: files.length };
        }

        const { folderId, folderBatch: updatedBatch1 } = createResult.data;
        updateBatch(batch.tempId, updatedBatch1);

        // Transition to registering phase
        updateProgress({ phase: 'registering' });

        // Step 2: Register files (early persistence)
        const fileMetadata: FileRegistrationMetadata[] = files.map((file, idx) => ({
          tempId: `${batch.tempId}-file-${idx}`,
          fileName: file.name,
          mimeType: file.file.type || 'application/octet-stream',
          sizeBytes: file.file.size,
        }));

        const registerResult = await fileApi.registerSessionFiles(
          sessionId,
          batch.tempId,
          fileMetadata
        );

        if (!registerResult.success) {
          console.error('[useFolderUpload] Failed to register files:', registerResult.error);
          return { success: false, uploadedCount, failedCount: files.length };
        }

        const { registered, folderBatch: updatedBatch2 } = registerResult.data;
        updateBatch(batch.tempId, updatedBatch2);

        // Create tempId -> File mapping for correlating uploads
        const tempIdToFile = new Map(fileMetadata.map((m, idx) => [m.tempId, files[idx]!]));

        // Transition to getting-sas phase
        updateProgress({ phase: 'getting-sas' });

        // Step 3: Get SAS URLs
        const fileIds = registered.map((r) => r.fileId);
        const sasResult = await fileApi.getSessionSasUrls(sessionId, batch.tempId, fileIds);

        if (!sasResult.success) {
          console.error('[useFolderUpload] Failed to get SAS URLs:', sasResult.error);
          return { success: false, uploadedCount, failedCount: files.length };
        }

        const sasInfoMap = new Map<string, RegisteredFileSasInfo>(
          sasResult.data.files.map((f) => [f.fileId, f])
        );

        // Transition to uploading phase
        updateProgress({ phase: 'uploading' });

        // Step 4: Upload files in parallel (with concurrency limit)
        const uploadQueue = [...registered];

        while (uploadQueue.length > 0 && !abortRef.current && !pauseRef.current) {
          const chunk = uploadQueue.splice(0, UPLOAD_CONCURRENCY);

          const uploadPromises = chunk.map(async (reg) => {
            const sasInfo = sasInfoMap.get(reg.fileId);
            const file = tempIdToFile.get(reg.tempId);

            if (!sasInfo || !file) {
              failedCount++;
              return;
            }

            try {
              // Upload to blob
              const uploadResult = await fileApi.uploadToBlob(file.file, sasInfo.sasUrl);

              if (!uploadResult.success) {
                failedCount++;
                return;
              }

              // Compute content hash
              let contentHash = '';
              try {
                contentHash = await computeFileSha256(file.file);
              } catch {
                // Non-fatal, use empty hash
              }

              // Mark as uploaded (include blobPath so DB record gets updated)
              const markResult = await fileApi.markSessionFileUploaded(
                sessionId,
                batch.tempId,
                { fileId: reg.fileId, contentHash, blobPath: sasInfo.blobPath }
              );

              if (markResult.success) {
                uploadedCount++;
                uploadedCountRef.current++;
                updateProgress({ uploadedFiles: uploadedCountRef.current });
                updateBatch(batch.tempId, markResult.data.folderBatch);
              } else {
                failedCount++;
              }
            } catch (error) {
              console.error('[useFolderUpload] File upload error:', error);
              failedCount++;
            }
          });

          await Promise.all(uploadPromises);
        }

        // Step 5: Complete folder batch
        if (!abortRef.current && !pauseRef.current) {
          const completeResult = await fileApi.completeSessionFolder(sessionId, batch.tempId);
          if (completeResult.success) {
            updateBatch(batch.tempId, completeResult.data.folderBatch);
          }
        }

        return { success: true, uploadedCount, failedCount };
      } catch (error) {
        console.error('[useFolderUpload] Batch upload error:', error);
        return { success: false, uploadedCount, failedCount: files.length - uploadedCount };
      }
    },
    [updateBatch, updateProgress]
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

      const fileApi = getFileApiClient();
      const currentFolderId = useFolderTreeStore.getState().currentFolderId;

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

        // Step 3: Build folder inputs
        updateProgress({ phase: 'creating-folders' });
        const { folderInputs, fileToFolderMap } = buildFolderInputs(structure);

        // Step 4: Initialize upload session (with auto-recovery for stale sessions)
        updateProgress({ phase: 'session-init' });
        let initResult = await fileApi.initUploadSession({
          folders: folderInputs,
          targetFolderId,
        });

        // Handle CONFLICT (user has an active session from a previous failed upload)
        if (!initResult.success && initResult.error.code === 'CONFLICT') {
          console.log('[useFolderUpload] Active session conflict, attempting auto-recovery');
          updateProgress({ phase: 'validating' });

          // Cancel the active session
          const cancelResult = await fileApi.cancelActiveUploadSession();
          if (cancelResult.success && cancelResult.data.cancelled) {
            console.log('[useFolderUpload] Previous session cancelled, retrying init');

            // Retry initialization
            initResult = await fileApi.initUploadSession({
              folders: folderInputs,
              targetFolderId,
            });
          }
        }

        if (!initResult.success) {
          console.error('[useFolderUpload] Session init failed:', initResult.error);
          updateProgress({ phase: 'error' });
          setIsUploading(false);
          return;
        }

        const { sessionId, folderBatches } = initResult.data;
        currentSessionIdRef.current = sessionId;

        // Initialize session store
        setSession({
          id: sessionId,
          userId: '', // Will be set by backend
          totalFolders: folderBatches.length,
          currentFolderIndex: -1,
          completedFolders: 0,
          failedFolders: 0,
          status: 'active',
          folderBatches,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          expiresAt: Date.now() + FOLDER_UPLOAD_CONFIG.SESSION_TTL_MS,
        });

        // Start heartbeat
        startHeartbeat(sessionId);

        // Reset uploaded count for this session
        uploadedCountRef.current = 0;

        updateProgress({
          phase: 'uploading',
          totalBatches: folderBatches.length,
          currentBatch: 0,
        });

        // Step 5: Process each folder sequentially
        for (let i = 0; i < folderBatches.length; i++) {
          if (abortRef.current) break;
          if (pauseRef.current) {
            setIsPaused(true);
            break;
          }

          const batch = folderBatches[i]!;
          updateProgress({ currentBatch: i + 1 });

          // Get files for this folder
          const folderFiles = structure.validFiles.filter((f) => {
            const folderTempId = fileToFolderMap.get(f.path);
            return folderTempId === batch.tempId;
          });

          // Upload the folder batch
          await uploadFolderBatch(sessionId, batch, folderFiles, targetFolderId);
        }

        // Step 6: Complete
        if (!abortRef.current && !pauseRef.current) {
          updateProgress({ phase: 'done' });
          clearUploadState();
        }

        // Refresh file list if in target folder
        if (targetFolderId === currentFolderId || (targetFolderId === null && currentFolderId === null)) {
          const result = await fileApi.getFiles({ folderId: currentFolderId ?? undefined });
          if (result.success) {
            const { files: fetchedFiles, pagination } = result.data;
            const hasMoreFiles = pagination.offset + fetchedFiles.length < pagination.total;
            setFiles(fetchedFiles, pagination.total, hasMoreFiles);
          }
        }
      } catch (error) {
        console.error('[useFolderUpload] Upload failed:', error);
        updateProgress({ phase: 'error' });
      } finally {
        stopHeartbeat();
        if (!pauseRef.current) {
          setIsUploading(false);
          currentSessionIdRef.current = null;
        }
      }
    },
    [
      buildFolderInputs,
      uploadFolderBatch,
      showLimitErrors,
      openUnsupportedModal,
      updateProgress,
      setFiles,
      setSession,
      startHeartbeat,
      stopHeartbeat,
    ]
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
    // Resume is limited since we can't store File objects
    // User would need to re-select files for full resume
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
    stopHeartbeat();
    clearUploadState();
    clearSession();
    setIsUploading(false);
    setIsPaused(false);
    setProgress(initialProgress);
    currentSessionIdRef.current = null;
  }, [stopHeartbeat, clearSession]);

  /**
   * Check if there's a resumable upload
   */
  const hasResumableUpload = useCallback(() => {
    // Check if we have an active session
    return currentSessionIdRef.current !== null;
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
