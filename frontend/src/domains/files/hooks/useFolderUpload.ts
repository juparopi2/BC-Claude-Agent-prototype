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
 * Phase weights for weighted progress calculation.
 * Each phase contributes to a portion of the overall progress bar.
 * Total: 0-100%
 */
const PHASE_WEIGHTS = {
  validating: { start: 0, end: 2 },
  'session-init': { start: 2, end: 5 },
  'creating-folders': { start: 5, end: 10 },
  registering: { start: 10, end: 20 },
  'getting-sas': { start: 20, end: 25 },
  uploading: { start: 25, end: 100 },
} as const;

/**
 * EMA alpha factor for smoothing speed calculations.
 * Lower values = more smoothing (0.2 means 20% weight to new value, 80% to history)
 */
const EMA_ALPHA = 0.2;

/**
 * Calculate weighted progress based on phase and sub-progress within phase
 */
function calculateWeightedProgress(
  phase: keyof typeof PHASE_WEIGHTS,
  subProgress: number = 1
): number {
  const weights = PHASE_WEIGHTS[phase];
  if (!weights) return 0;
  const range = weights.end - weights.start;
  return Math.round(weights.start + range * Math.min(subProgress, 1));
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
  speed: 0,
  eta: 0,
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
  const startTimeRef = useRef<number>(0);
  const uploadedCountRef = useRef(0);
  const heartbeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const currentSessionIdRef = useRef<string | null>(null);

  // EMA state for smoothed speed/ETA calculations
  const etaStateRef = useRef({
    emaSpeed: 2, // Initial estimate: 2 files/sec (reasonable default)
    lastUpdateTime: 0,
    lastUploadedCount: 0,
  });

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
   * Update progress state with weighted progress and EMA-smoothed ETA
   */
  const updateProgress = useCallback((updates: Partial<FolderUploadProgress>) => {
    setProgress((prev) => {
      const updated = { ...prev, ...updates };
      const now = Date.now();

      // Calculate weighted progress based on phase
      const phase = updated.phase;
      if (phase && phase in PHASE_WEIGHTS) {
        // For uploading phase, sub-progress is based on files uploaded
        const subProgress =
          phase === 'uploading' && updated.totalFiles > 0
            ? updated.uploadedFiles / updated.totalFiles
            : 1; // Other phases complete instantly when transitioned to next phase
        updated.percent = calculateWeightedProgress(
          phase as keyof typeof PHASE_WEIGHTS,
          subProgress
        );
      }

      // Calculate speed and ETA using EMA (only during uploading phase with actual uploads)
      if (startTimeRef.current > 0 && updated.uploadedFiles > 0) {
        const state = etaStateRef.current;
        const timeDelta = (now - state.lastUpdateTime) / 1000;
        const fileDelta = updated.uploadedFiles - state.lastUploadedCount;

        // Only update EMA when we have meaningful deltas (avoid division by tiny numbers)
        if (timeDelta > 0.1 && fileDelta > 0) {
          const instantSpeed = fileDelta / timeDelta;
          // Apply EMA smoothing: newEMA = α * current + (1-α) * previous
          state.emaSpeed = EMA_ALPHA * instantSpeed + (1 - EMA_ALPHA) * state.emaSpeed;
        }

        // Update last known values
        state.lastUpdateTime = now;
        state.lastUploadedCount = updated.uploadedFiles;

        // Use smoothed speed for display and ETA calculation
        updated.speed = Math.round(state.emaSpeed);
        const remaining = updated.totalFiles - updated.uploadedFiles;
        updated.eta = state.emaSpeed > 0 ? Math.round(remaining / state.emaSpeed) : 0;
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

      // Start timing from the beginning (not just blob uploads)
      startTimeRef.current = Date.now();

      // Reset EMA state for new upload
      etaStateRef.current = {
        emaSpeed: 2, // Reset to default estimate
        lastUpdateTime: Date.now(),
        lastUploadedCount: 0,
      };

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
