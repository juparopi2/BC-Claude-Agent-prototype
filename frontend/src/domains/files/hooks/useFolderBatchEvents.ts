/**
 * useFolderBatchEvents Hook
 *
 * Hook for subscribing to folder batch WebSocket events and updating
 * the multiUploadSessionStore. Handles events from the folder:status channel.
 *
 * Multi-Session Support:
 * - Routes events to the correct session by sessionId
 * - Each session is tracked independently in the store
 *
 * @module domains/files/hooks/useFolderBatchEvents
 */

import { useEffect, useRef, useCallback } from 'react';
import { useMultiUploadSessionStore } from '../stores/multiUploadSessionStore';
import { useFileListStore } from '../stores/fileListStore';
import { getSocketClient } from '@/src/infrastructure/socket/SocketClient';
import {
  FOLDER_WS_EVENTS,
  type FolderWebSocketEvent,
  type FolderSessionStartedEvent,
  type FolderSessionCompletedEvent,
  type FolderSessionFailedEvent,
  type FolderSessionCancelledEvent,
  type FolderBatchStartedEvent,
  type FolderBatchProgressEvent,
  type FolderBatchCompletedEvent,
  type FolderBatchFailedEvent,
  type UploadSession,
} from '@bc-agent/shared';

/**
 * Options for useFolderBatchEvents hook
 */
export interface UseFolderBatchEventsOptions {
  /** Whether to enable the event subscription */
  enabled?: boolean;
  /** Callback when session starts */
  onSessionStart?: (sessionId: string, totalFolders: number) => void;
  /** Callback when session completes */
  onSessionComplete?: (sessionId: string, completedFolders: number, failedFolders: number) => void;
  /** Callback when session fails */
  onSessionFail?: (sessionId: string, error: string) => void;
  /** Callback when session is cancelled by user */
  onSessionCancel?: (sessionId: string, filesRolledBack: number) => void;
  /** Callback when a folder batch starts */
  onBatchStart?: (sessionId: string, folderIndex: number, folderName: string) => void;
  /** Callback when a folder batch completes */
  onBatchComplete?: (sessionId: string, folderIndex: number, folderName: string) => void;
  /** Callback when a folder batch fails */
  onBatchFail?: (sessionId: string, folderIndex: number, folderName: string, error: string) => void;
}

/**
 * Hook for subscribing to folder batch WebSocket events
 *
 * Automatically subscribes to the folder:status channel and updates
 * the multiUploadSessionStore accordingly. Routes events to the correct
 * session by sessionId.
 *
 * @param options - Hook options including callbacks
 *
 * @example
 * ```tsx
 * function FolderUploadProgress() {
 *   useFolderBatchEvents({
 *     enabled: true,
 *     onBatchComplete: (sessionId, index, name) => {
 *       toast.success(`Folder "${name}" completed!`);
 *     },
 *   });
 *
 *   const sessions = useMultiUploadSessionStore(state => state.getActiveSessions());
 *
 *   return (
 *     <div>
 *       {sessions.map(session => (
 *         <SessionProgress key={session.id} session={session} />
 *       ))}
 *     </div>
 *   );
 * }
 * ```
 */
export function useFolderBatchEvents(options: UseFolderBatchEventsOptions = {}): void {
  const {
    enabled = true,
    onSessionStart,
    onSessionComplete,
    onSessionFail,
    onSessionCancel,
    onBatchStart,
    onBatchComplete,
    onBatchFail,
  } = options;

  // Get store actions from multi-session store
  const addSession = useMultiUploadSessionStore((state) => state.addSession);
  const updateSession = useMultiUploadSessionStore((state) => state.updateSession);
  const updateBatch = useMultiUploadSessionStore((state) => state.updateBatch);
  const removeSession = useMultiUploadSessionStore((state) => state.removeSession);
  const getSession = useMultiUploadSessionStore((state) => state.getSession);

  // File list store for adding files in real-time
  const addFileToStore = useFileListStore((state) => state.addFile);

  // Use refs for callbacks to avoid re-subscribing on every render
  const callbacksRef = useRef({
    addSession,
    updateSession,
    updateBatch,
    removeSession,
    getSession,
    addFileToStore,
    onSessionStart,
    onSessionComplete,
    onSessionFail,
    onSessionCancel,
    onBatchStart,
    onBatchComplete,
    onBatchFail,
  });

  // Update refs when callbacks change
  useEffect(() => {
    callbacksRef.current = {
      addSession,
      updateSession,
      updateBatch,
      removeSession,
      getSession,
      addFileToStore,
      onSessionStart,
      onSessionComplete,
      onSessionFail,
      onSessionCancel,
      onBatchStart,
      onBatchComplete,
      onBatchFail,
    };
  }, [
    addSession,
    updateSession,
    updateBatch,
    removeSession,
    getSession,
    addFileToStore,
    onSessionStart,
    onSessionComplete,
    onSessionFail,
    onSessionCancel,
    onBatchStart,
    onBatchComplete,
    onBatchFail,
  ]);

  /**
   * Handle folder status events (folder:status channel)
   *
   * Routes events to the correct session by sessionId
   */
  const handleFolderStatusEvent = useCallback((event: FolderWebSocketEvent) => {
    const callbacks = callbacksRef.current;
    const sessionId = event.sessionId;

    switch (event.type) {
      case FOLDER_WS_EVENTS.SESSION_STARTED: {
        const e = event as FolderSessionStartedEvent;
        // Create a new session in the store (if not already created by useFolderUpload)
        const existingSession = callbacks.getSession(sessionId);
        if (!existingSession) {
          const session: UploadSession = {
            id: e.sessionId,
            userId: e.userId,
            totalFolders: e.totalFolders,
            currentFolderIndex: -1,
            completedFolders: 0,
            failedFolders: 0,
            status: 'active',
            folderBatches: [],
            createdAt: Date.now(),
            updatedAt: Date.now(),
            expiresAt: Date.now() + 4 * 60 * 60 * 1000, // 4 hours default
          };
          callbacks.addSession(session);
        }
        callbacks.onSessionStart?.(e.sessionId, e.totalFolders);
        break;
      }

      case FOLDER_WS_EVENTS.SESSION_COMPLETED: {
        const e = event as FolderSessionCompletedEvent;
        callbacks.updateSession(sessionId, {
          status: 'completed',
          completedFolders: e.completedFolders,
          failedFolders: e.failedFolders,
        });
        callbacks.onSessionComplete?.(e.sessionId, e.completedFolders, e.failedFolders);
        // Remove session after a delay to let UI show completion
        setTimeout(() => {
          callbacks.removeSession(sessionId);
        }, 3000);
        break;
      }

      case FOLDER_WS_EVENTS.SESSION_FAILED: {
        const e = event as FolderSessionFailedEvent;
        callbacks.updateSession(sessionId, {
          status: 'failed',
          completedFolders: e.completedFolders,
          failedFolders: e.failedFolders,
        });
        callbacks.onSessionFail?.(e.sessionId, e.error);
        break;
      }

      case FOLDER_WS_EVENTS.SESSION_CANCELLED: {
        const e = event as FolderSessionCancelledEvent;
        callbacks.updateSession(sessionId, {
          status: 'cancelled',
          completedFolders: e.completedFolders,
        });
        callbacks.onSessionCancel?.(e.sessionId, e.filesRolledBack);
        // Remove session after a delay to let UI show cancellation
        setTimeout(() => {
          callbacks.removeSession(sessionId);
        }, 3000);
        break;
      }

      case FOLDER_WS_EVENTS.BATCH_STARTED: {
        const e = event as FolderBatchStartedEvent;
        callbacks.updateSession(sessionId, { currentFolderIndex: e.folderIndex });
        callbacks.updateBatch(sessionId, e.folderBatch.tempId, {
          ...e.folderBatch,
          status: e.folderBatch.status,
        });
        callbacks.onBatchStart?.(e.sessionId, e.folderIndex, e.folderBatch.name);
        break;
      }

      case FOLDER_WS_EVENTS.BATCH_PROGRESS: {
        const e = event as FolderBatchProgressEvent;
        callbacks.updateBatch(sessionId, e.folderBatch.tempId, {
          uploadedFiles: e.folderBatch.uploadedFiles,
          registeredFiles: e.folderBatch.registeredFiles,
          processedFiles: e.folderBatch.processedFiles,
          status: e.folderBatch.status,
        });
        break;
      }

      case FOLDER_WS_EVENTS.BATCH_COMPLETED: {
        const e = event as FolderBatchCompletedEvent;
        callbacks.updateBatch(sessionId, e.folderBatch.tempId, {
          ...e.folderBatch,
          status: 'completed',
        });
        // Update session completed folders count
        const session = callbacks.getSession(sessionId);
        if (session) {
          callbacks.updateSession(sessionId, {
            completedFolders: session.completedFolders + 1,
          });
        }
        callbacks.onBatchComplete?.(e.sessionId, e.folderIndex, e.folderBatch.name);
        break;
      }

      case FOLDER_WS_EVENTS.BATCH_FAILED: {
        const e = event as FolderBatchFailedEvent;
        callbacks.updateBatch(sessionId, e.folderBatch.tempId, {
          ...e.folderBatch,
          status: 'failed',
          error: e.error,
        });
        // Update session failed folders count
        const session = callbacks.getSession(sessionId);
        if (session) {
          callbacks.updateSession(sessionId, {
            failedFolders: session.failedFolders + 1,
          });
        }
        callbacks.onBatchFail?.(e.sessionId, e.folderIndex, e.folderBatch.name, e.error);
        break;
      }
    }
  }, []);

  // Subscribe to WebSocket events
  useEffect(() => {
    if (!enabled) {
      return;
    }

    const client = getSocketClient();

    // Subscribe to folder status channel
    const unsubscribe = client.onFolderStatusEvent(handleFolderStatusEvent);

    // Cleanup on unmount
    return () => {
      unsubscribe();
    };
  }, [enabled, handleFolderStatusEvent]);
}
