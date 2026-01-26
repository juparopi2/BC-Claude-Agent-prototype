/**
 * useFolderBatchEvents Hook
 *
 * Hook for subscribing to folder batch WebSocket events and updating
 * the uploadSessionStore. Handles events from the folder:status channel.
 *
 * @module domains/files/hooks/useFolderBatchEvents
 */

import { useEffect, useRef, useCallback } from 'react';
import { useUploadSessionStore } from '../stores/uploadSessionStore';
import { useFileListStore } from '../stores/fileListStore';
import { getSocketClient } from '@/src/infrastructure/socket/SocketClient';
import {
  FOLDER_WS_EVENTS,
  type FolderWebSocketEvent,
  type FolderSessionStartedEvent,
  type FolderSessionCompletedEvent,
  type FolderSessionFailedEvent,
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
 * the uploadSessionStore accordingly. Also provides optional callbacks
 * for UI notifications.
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
 *   const { progress } = useUploadSessionStore();
 *
 *   return (
 *     <div>
 *       {progress && (
 *         <span>
 *           Folder {progress.currentFolderIndex + 1} of {progress.totalFolders}
 *         </span>
 *       )}
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
    onBatchStart,
    onBatchComplete,
    onBatchFail,
  } = options;

  // Get store actions
  const setSession = useUploadSessionStore((state) => state.setSession);
  const updateSession = useUploadSessionStore((state) => state.updateSession);
  const updateBatch = useUploadSessionStore((state) => state.updateBatch);
  const setStatus = useUploadSessionStore((state) => state.setStatus);
  const setCurrentFolderIndex = useUploadSessionStore((state) => state.setCurrentFolderIndex);
  const incrementCompletedFolders = useUploadSessionStore((state) => state.incrementCompletedFolders);
  const incrementFailedFolders = useUploadSessionStore((state) => state.incrementFailedFolders);
  const clearSession = useUploadSessionStore((state) => state.clearSession);

  // File list store for adding files in real-time
  const addFileToStore = useFileListStore((state) => state.addFile);

  // Use refs for callbacks to avoid re-subscribing on every render
  const callbacksRef = useRef({
    setSession,
    updateSession,
    updateBatch,
    setStatus,
    setCurrentFolderIndex,
    incrementCompletedFolders,
    incrementFailedFolders,
    clearSession,
    addFileToStore,
    onSessionStart,
    onSessionComplete,
    onSessionFail,
    onBatchStart,
    onBatchComplete,
    onBatchFail,
  });

  // Update refs when callbacks change
  useEffect(() => {
    callbacksRef.current = {
      setSession,
      updateSession,
      updateBatch,
      setStatus,
      setCurrentFolderIndex,
      incrementCompletedFolders,
      incrementFailedFolders,
      clearSession,
      addFileToStore,
      onSessionStart,
      onSessionComplete,
      onSessionFail,
      onBatchStart,
      onBatchComplete,
      onBatchFail,
    };
  }, [
    setSession,
    updateSession,
    updateBatch,
    setStatus,
    setCurrentFolderIndex,
    incrementCompletedFolders,
    incrementFailedFolders,
    clearSession,
    addFileToStore,
    onSessionStart,
    onSessionComplete,
    onSessionFail,
    onBatchStart,
    onBatchComplete,
    onBatchFail,
  ]);

  /**
   * Handle folder status events (folder:status channel)
   */
  const handleFolderStatusEvent = useCallback((event: FolderWebSocketEvent) => {
    const callbacks = callbacksRef.current;

    switch (event.type) {
      case FOLDER_WS_EVENTS.SESSION_STARTED: {
        const e = event as FolderSessionStartedEvent;
        // Create a new session in the store
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
        callbacks.setSession(session);
        callbacks.onSessionStart?.(e.sessionId, e.totalFolders);
        break;
      }

      case FOLDER_WS_EVENTS.SESSION_COMPLETED: {
        const e = event as FolderSessionCompletedEvent;
        callbacks.updateSession({
          status: 'completed',
          completedFolders: e.completedFolders,
          failedFolders: e.failedFolders,
        });
        callbacks.onSessionComplete?.(e.sessionId, e.completedFolders, e.failedFolders);
        // Clear session after a delay to let UI show completion
        setTimeout(() => {
          callbacks.clearSession();
        }, 3000);
        break;
      }

      case FOLDER_WS_EVENTS.SESSION_FAILED: {
        const e = event as FolderSessionFailedEvent;
        callbacks.updateSession({
          status: 'failed',
          completedFolders: e.completedFolders,
          failedFolders: e.failedFolders,
        });
        callbacks.onSessionFail?.(e.sessionId, e.error);
        break;
      }

      case FOLDER_WS_EVENTS.BATCH_STARTED: {
        const e = event as FolderBatchStartedEvent;
        callbacks.setCurrentFolderIndex(e.folderIndex);
        callbacks.updateBatch(e.folderBatch.tempId, {
          ...e.folderBatch,
          status: e.folderBatch.status,
        });
        callbacks.onBatchStart?.(e.sessionId, e.folderIndex, e.folderBatch.name);
        break;
      }

      case FOLDER_WS_EVENTS.BATCH_PROGRESS: {
        const e = event as FolderBatchProgressEvent;
        callbacks.updateBatch(e.folderBatch.tempId, {
          uploadedFiles: e.folderBatch.uploadedFiles,
          registeredFiles: e.folderBatch.registeredFiles,
          processedFiles: e.folderBatch.processedFiles,
          status: e.folderBatch.status,
        });
        break;
      }

      case FOLDER_WS_EVENTS.BATCH_COMPLETED: {
        const e = event as FolderBatchCompletedEvent;
        callbacks.updateBatch(e.folderBatch.tempId, {
          ...e.folderBatch,
          status: 'completed',
        });
        callbacks.incrementCompletedFolders();
        callbacks.onBatchComplete?.(e.sessionId, e.folderIndex, e.folderBatch.name);
        break;
      }

      case FOLDER_WS_EVENTS.BATCH_FAILED: {
        const e = event as FolderBatchFailedEvent;
        callbacks.updateBatch(e.folderBatch.tempId, {
          ...e.folderBatch,
          status: 'failed',
          error: e.error,
        });
        callbacks.incrementFailedFolders();
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
