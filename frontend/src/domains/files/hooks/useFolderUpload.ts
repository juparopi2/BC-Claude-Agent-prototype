/**
 * useFolderUpload Hook
 *
 * Main orchestration hook for folder-based batch upload functionality.
 * Supports multiple concurrent upload sessions - each folder upload
 * creates an independent session that can be cancelled without affecting others.
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
 * Multi-Session Support:
 * - Users can upload multiple folders simultaneously (up to MAX_CONCURRENT_SESSIONS)
 * - Each session has independent progress tracking
 * - Cancelling one session does not affect others
 *
 * @module domains/files/hooks/useFolderUpload
 */

import { useCallback, useRef, useEffect, useMemo } from 'react';
import { getFileApiClient, withAuthRetry } from '@/src/infrastructure/api';
import { useFileListStore } from '../stores/fileListStore';
import { useFolderTreeStore } from '../stores/folderTreeStore';
import { useUploadLimitStore } from '../stores/uploadLimitStore';
import { useUnsupportedFilesStore } from '../stores/unsupportedFilesStore';
import { useMultiUploadSessionStore } from '../stores/multiUploadSessionStore';
import { useShallow } from 'zustand/react/shallow';
import { FOLDER_UPLOAD_CONFIG } from '@bc-agent/shared';
import { toast } from 'sonner';
import type {
  FolderStructure,
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
  UploadSession,
} from '@bc-agent/shared';

/**
 * Concurrent upload count within a folder batch
 */
const UPLOAD_CONCURRENCY = FOLDER_UPLOAD_CONFIG.FILE_UPLOAD_CONCURRENCY;

/**
 * Max retries for getSasUrls call (race condition mitigation)
 */
const GET_SAS_URLS_MAX_RETRIES = 3;

/**
 * Base delay for getSasUrls retry in milliseconds
 */
const GET_SAS_URLS_RETRY_BASE_DELAY_MS = 100;

/**
 * Sleep helper function
 */
const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/**
 * useFolderUpload return type
 */
export interface UseFolderUploadReturn {
  /** Upload a folder structure. Returns sessionId for tracking. */
  uploadFolder: (
    structure: FolderStructure,
    targetFolderId: string | null
  ) => Promise<string | null>;

  /** Cancel a specific upload session */
  cancelSession: (sessionId: string) => Promise<void>;

  /** All active sessions */
  sessions: UploadSession[];

  /** Whether there are any active uploads */
  hasActiveUploads: boolean;

  /** Number of active sessions */
  activeCount: number;

  /** Maximum concurrent sessions allowed */
  maxConcurrentSessions: number;
}

/**
 * Track per-session state
 */
interface SessionTrackingState {
  aborted: boolean;
  uploadedCount: number;
  heartbeatInterval: ReturnType<typeof setInterval> | null;
}

/**
 * Hook for managing folder uploads with multi-session support
 *
 * Each call to uploadFolder() creates a new independent session.
 * Sessions can be tracked and cancelled individually.
 *
 * @example
 * ```tsx
 * function FolderDropZone() {
 *   const { uploadFolder, sessions, cancelSession, hasActiveUploads } = useFolderUpload();
 *
 *   const handleDrop = async (structure: FolderStructure) => {
 *     const sessionId = await uploadFolder(structure, currentFolderId);
 *     if (sessionId) {
 *       console.log('Upload started:', sessionId);
 *     }
 *   };
 *
 *   return (
 *     <div>
 *       {hasActiveUploads && (
 *         <div>
 *           {sessions.map(session => (
 *             <SessionProgress
 *               key={session.id}
 *               session={session}
 *               onCancel={() => cancelSession(session.id)}
 *             />
 *           ))}
 *         </div>
 *       )}
 *     </div>
 *   );
 * }
 * ```
 */
export function useFolderUpload(): UseFolderUploadReturn {
  // Per-session tracking state (keyed by sessionId)
  const sessionTrackingRef = useRef<Map<string, SessionTrackingState>>(new Map());

  // Stores
  const showLimitErrors = useUploadLimitStore((state) => state.showErrors);
  const openUnsupportedModal = useUnsupportedFilesStore((state) => state.openModal);
  const setFiles = useFileListStore((state) => state.setFiles);
  const addFile = useFileListStore((state) => state.addFile);

  // Multi-session store
  const addSession = useMultiUploadSessionStore((state) => state.addSession);
  const updateSession = useMultiUploadSessionStore((state) => state.updateSession);
  const updateBatch = useMultiUploadSessionStore((state) => state.updateBatch);
  const removeSession = useMultiUploadSessionStore((state) => state.removeSession);
  const sessions = useMultiUploadSessionStore(
    useShallow((state) =>
      Array.from(state.sessions.values()).filter(
        s => s.status === 'active' || s.status === 'initializing'
      )
    )
  );
  const activeCount = useMultiUploadSessionStore((state) => state.activeCount);

  // Clean up all heartbeats on unmount
  useEffect(() => {
    return () => {
      for (const tracking of sessionTrackingRef.current.values()) {
        if (tracking.heartbeatInterval) {
          clearInterval(tracking.heartbeatInterval);
        }
      }
      sessionTrackingRef.current.clear();
    };
  }, []);

  /**
   * Get or create tracking state for a session
   */
  const getSessionTracking = useCallback((sessionId: string): SessionTrackingState => {
    let tracking = sessionTrackingRef.current.get(sessionId);
    if (!tracking) {
      tracking = { aborted: false, uploadedCount: 0, heartbeatInterval: null };
      sessionTrackingRef.current.set(sessionId, tracking);
    }
    return tracking;
  }, []);

  /**
   * Clean up tracking state for a session
   */
  const cleanupSessionTracking = useCallback((sessionId: string) => {
    const tracking = sessionTrackingRef.current.get(sessionId);
    if (tracking?.heartbeatInterval) {
      clearInterval(tracking.heartbeatInterval);
    }
    sessionTrackingRef.current.delete(sessionId);
  }, []);

  /**
   * Start heartbeat to keep session alive
   */
  const startHeartbeat = useCallback((sessionId: string) => {
    const fileApi = getFileApiClient();
    const tracking = getSessionTracking(sessionId);

    // Clear any existing interval
    if (tracking.heartbeatInterval) {
      clearInterval(tracking.heartbeatInterval);
    }

    // Send heartbeat every minute
    tracking.heartbeatInterval = setInterval(async () => {
      if (!tracking.aborted) {
        await fileApi.heartbeatUploadSession(sessionId);
      }
    }, FOLDER_UPLOAD_CONFIG.HEARTBEAT_INTERVAL_MS);
  }, [getSessionTracking]);

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
      files: FileEntry[]
    ): Promise<{ success: boolean; uploadedCount: number; failedCount: number }> => {
      const fileApi = getFileApiClient();
      const tracking = getSessionTracking(sessionId);
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
        updateBatch(sessionId, batch.tempId, updatedBatch1);

        // Handle empty folders (folders containing only subfolders, no direct files)
        if (files.length === 0) {
          // Register with empty array to trigger state transition
          const registerResult = await fileApi.registerSessionFiles(
            sessionId,
            batch.tempId,
            []
          );

          if (!registerResult.success) {
            console.error('[useFolderUpload] Failed to register empty folder:', registerResult.error);
            return { success: false, uploadedCount: 0, failedCount: 0 };
          }

          updateBatch(sessionId, batch.tempId, registerResult.data.folderBatch);

          // Complete the batch immediately (no files to upload)
          if (!tracking.aborted) {
            const completeResult = await fileApi.completeSessionFolder(sessionId, batch.tempId);
            if (completeResult.success) {
              updateBatch(sessionId, batch.tempId, {
                ...completeResult.data.folderBatch,
                status: 'completed', // Explicitly ensure status is set
              });
            }
          }

          return { success: true, uploadedCount: 0, failedCount: 0 };
        }

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
        updateBatch(sessionId, batch.tempId, updatedBatch2);

        // Add registered files to fileListStore immediately
        const currentViewFolderId = useFolderTreeStore.getState().currentFolderId;
        const shouldAddToStore = folderId === currentViewFolderId;

        if (shouldAddToStore) {
          for (const reg of registered) {
            const meta = fileMetadata.find((m) => m.tempId === reg.tempId);
            if (meta) {
              addFile({
                id: reg.fileId,
                userId: '',
                name: meta.fileName,
                mimeType: meta.mimeType,
                sizeBytes: meta.sizeBytes,
                blobPath: '',
                isFolder: false,
                isFavorite: false,
                readinessState: 'uploading',
                processingStatus: 'pending',
                embeddingStatus: 'pending',
                processingRetryCount: 0,
                embeddingRetryCount: 0,
                lastError: null,
                failedAt: null,
                hasExtractedText: false,
                contentHash: null,
                deletionStatus: null,
                deletedAt: null,
                parentFolderId: folderId,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              });
            }
          }
        }

        // Create tempId -> File mapping for correlating uploads
        const tempIdToFile = new Map(fileMetadata.map((m, idx) => [m.tempId, files[idx]!]));

        // Step 3: Get SAS URLs (with retry for race condition and auth errors)
        const fileIds = registered.map((r) => r.fileId);
        let sasResult: Awaited<ReturnType<typeof fileApi.getSessionSasUrls>> | null = null;

        for (let retryAttempt = 0; retryAttempt < GET_SAS_URLS_MAX_RETRIES; retryAttempt++) {
          sasResult = await withAuthRetry(() =>
            fileApi.getSessionSasUrls(sessionId, batch.tempId, fileIds)
          );

          if (sasResult.success) {
            break;
          }

          // Check if error is due to 'registering state' race condition
          const errorMessage = sasResult.error?.message ?? '';
          if (errorMessage.includes('registering state') && retryAttempt < GET_SAS_URLS_MAX_RETRIES - 1) {
            console.log(`[useFolderUpload] Retrying getSasUrls (attempt ${retryAttempt + 1}) due to state transition`);
            await sleep(GET_SAS_URLS_RETRY_BASE_DELAY_MS * (retryAttempt + 1));
            continue;
          }

          // Non-retryable error or max retries reached
          break;
        }

        if (!sasResult?.success) {
          console.error('[useFolderUpload] Failed to get SAS URLs:', sasResult?.error);
          return { success: false, uploadedCount, failedCount: files.length };
        }

        const sasInfoMap = new Map<string, RegisteredFileSasInfo>(
          sasResult.data.files.map((f) => [f.fileId, f])
        );

        // Step 4: Upload files in parallel (with concurrency limit)
        const uploadQueue = [...registered];

        while (uploadQueue.length > 0 && !tracking.aborted) {
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

              // Mark as uploaded (with auth retry)
              const markResult = await withAuthRetry(() =>
                fileApi.markSessionFileUploaded(
                  sessionId,
                  batch.tempId,
                  { fileId: reg.fileId, contentHash, blobPath: sasInfo.blobPath }
                )
              );

              if (markResult.success) {
                uploadedCount++;
                tracking.uploadedCount++;
                updateBatch(sessionId, batch.tempId, markResult.data.folderBatch);
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
        if (!tracking.aborted) {
          const completeResult = await fileApi.completeSessionFolder(sessionId, batch.tempId);
          if (completeResult.success) {
            updateBatch(sessionId, batch.tempId, {
              ...completeResult.data.folderBatch,
              status: 'completed', // Explicitly ensure status is set
            });
          }
        }

        return { success: true, uploadedCount, failedCount };
      } catch (error) {
        console.error('[useFolderUpload] Batch upload error:', error);
        return { success: false, uploadedCount, failedCount: files.length - uploadedCount };
      }
    },
    [addFile, updateBatch, getSessionTracking]
  );

  /**
   * Main upload function - creates a new session
   * Returns sessionId on success, null on failure
   */
  const uploadFolder = useCallback(
    async (structure: FolderStructure, targetFolderId: string | null): Promise<string | null> => {
      const fileApi = getFileApiClient();
      const currentFolderId = useFolderTreeStore.getState().currentFolderId;

      try {
        // Step 1: Validate limits
        const validation = validateFolderLimits(structure);
        if (!validation.isValid) {
          showLimitErrors(validation.errors);
          return null;
        }

        // Step 2: Handle unsupported files
        if (structure.invalidFiles.length > 0) {
          const resolution = await openUnsupportedModal(structure.invalidFiles);

          if (!resolution.proceed) {
            return null;
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
        }

        // Step 3: Build folder inputs
        const { folderInputs, fileToFolderMap } = buildFolderInputs(structure);

        // Step 4: Initialize upload session (with auth retry)
        const initResult = await withAuthRetry(() =>
          fileApi.initUploadSession({
            folders: folderInputs,
            targetFolderId,
          })
        );

        // Handle CONFLICT (max sessions reached)
        if (!initResult.success) {
          if (initResult.error.code === 'CONFLICT') {
            console.error('[useFolderUpload] Max concurrent sessions reached');
            // Show user-friendly error (handled by component)
          }
          console.error('[useFolderUpload] Session init failed:', initResult.error);
          return null;
        }

        const { sessionId, folderBatches, renamedFolderCount, renamedFolders } = initResult.data;

        // Show notification if folders were renamed to avoid duplicates
        if (renamedFolderCount && renamedFolderCount > 0 && renamedFolders) {
          const renameDetails = renamedFolders
            .slice(0, 3) // Show max 3 examples
            .map(r => `"${r.originalName}" → "${r.resolvedName}"`)
            .join(', ');
          const suffix = renamedFolderCount > 3 ? ` and ${renamedFolderCount - 3} more` : '';
          toast.info(
            `${renamedFolderCount} folder(s) renamed to avoid duplicates`,
            { description: renameDetails + suffix }
          );
        }

        // Initialize session in store
        const session: UploadSession = {
          id: sessionId,
          userId: '',
          totalFolders: folderBatches.length,
          currentFolderIndex: -1,
          completedFolders: 0,
          failedFolders: 0,
          status: 'active',
          folderBatches,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          expiresAt: Date.now() + FOLDER_UPLOAD_CONFIG.SESSION_TTL_MS,
        };
        addSession(session);

        // Initialize tracking state
        const tracking = getSessionTracking(sessionId);
        tracking.uploadedCount = 0;
        tracking.aborted = false;

        // Start heartbeat
        startHeartbeat(sessionId);

        // Step 5: Process each folder sequentially
        for (let i = 0; i < folderBatches.length; i++) {
          if (tracking.aborted) break;

          const batch = folderBatches[i]!;

          // Update current folder index
          updateSession(sessionId, { currentFolderIndex: i });

          // Get files for this folder
          const folderFiles = structure.validFiles.filter((f) => {
            const folderTempId = fileToFolderMap.get(f.path);
            return folderTempId === batch.tempId;
          });

          // Upload the folder batch
          const result = await uploadFolderBatch(sessionId, batch, folderFiles);

          // Get fresh session state to avoid stale counter values
          const currentSession = useMultiUploadSessionStore.getState().sessions.get(sessionId);
          if (!result.success) {
            updateSession(sessionId, { failedFolders: (currentSession?.failedFolders ?? 0) + 1 });
          } else {
            updateSession(sessionId, { completedFolders: (currentSession?.completedFolders ?? 0) + 1 });
          }
        }

        // Step 6: Complete
        if (!tracking.aborted) {
          updateSession(sessionId, { status: 'completed' });

          // Refresh file list if in target folder
          if (targetFolderId === currentFolderId || (targetFolderId === null && currentFolderId === null)) {
            const result = await fileApi.getFiles({ folderId: currentFolderId ?? undefined });
            if (result.success) {
              const { files: fetchedFiles, pagination } = result.data;
              const hasMoreFiles = pagination.offset + fetchedFiles.length < pagination.total;
              setFiles(fetchedFiles, pagination.total, hasMoreFiles);
            }
          }

          // Clean up after a delay
          setTimeout(() => {
            removeSession(sessionId);
            cleanupSessionTracking(sessionId);
          }, 3000);
        }

        return sessionId;
      } catch (error) {
        console.error('[useFolderUpload] Upload failed:', error);
        return null;
      }
    },
    [
      buildFolderInputs,
      uploadFolderBatch,
      showLimitErrors,
      openUnsupportedModal,
      setFiles,
      addSession,
      updateSession,
      removeSession,
      getSessionTracking,
      startHeartbeat,
      cleanupSessionTracking,
    ]
  );

  /**
   * Cancel a specific upload session
   */
  const cancelSession = useCallback(async (sessionId: string) => {
    const tracking = sessionTrackingRef.current.get(sessionId);
    if (tracking) {
      tracking.aborted = true;
    }

    // Cancel on backend
    const fileApi = getFileApiClient();
    await fileApi.cancelUploadSession(sessionId);

    // Update store
    updateSession(sessionId, { status: 'failed' });

    // Clean up after a short delay
    setTimeout(() => {
      removeSession(sessionId);
      cleanupSessionTracking(sessionId);
    }, 1000);
  }, [updateSession, removeSession, cleanupSessionTracking]);

  return {
    uploadFolder,
    cancelSession,
    sessions,
    hasActiveUploads: activeCount > 0,
    activeCount,
    maxConcurrentSessions: FOLDER_UPLOAD_CONFIG.MAX_CONCURRENT_SESSIONS,
  };
}
