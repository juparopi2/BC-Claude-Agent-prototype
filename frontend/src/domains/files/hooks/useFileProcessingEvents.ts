/**
 * useFileProcessingEvents Hook
 *
 * Hook for subscribing to file processing WebSocket events and updating stores.
 * Handles events from file:status and file:processing channels.
 *
 * @module domains/files/hooks/useFileProcessingEvents
 */

import { useEffect, useRef, useCallback } from 'react';
import { useFileProcessingStore } from '../stores/fileProcessingStore';
import { useFileListStore } from '../stores/fileListStore';
import { getSocketClient } from '@/src/infrastructure/socket/SocketClient';
import {
  FILE_WS_EVENTS,
  type FileWebSocketEvent,
  type FileReadinessChangedEvent,
  type FilePermanentlyFailedEvent,
  type FileProcessingProgressEvent,
  type FileProcessingCompletedEvent,
  type FileProcessingFailedEvent,
} from '@bc-agent/shared';

/**
 * Options for useFileProcessingEvents hook
 */
export interface UseFileProcessingEventsOptions {
  /** Whether to enable the event subscription */
  enabled?: boolean;
}

/**
 * Hook for subscribing to file processing WebSocket events
 *
 * Automatically subscribes to file:status and file:processing channels
 * and updates fileProcessingStore and fileListStore accordingly.
 *
 * @param options - Hook options
 *
 * @example
 * ```tsx
 * function FileExplorer() {
 *   // Subscribe to file processing events
 *   useFileProcessingEvents({ enabled: true });
 *
 *   return <FileList />;
 * }
 * ```
 */
export function useFileProcessingEvents(
  options: UseFileProcessingEventsOptions = {}
): void {
  const { enabled = true } = options;

  // Get store actions
  const setProcessingStatus = useFileProcessingStore((state) => state.setProcessingStatus);
  const updateProgress = useFileProcessingStore((state) => state.updateProgress);
  const markCompleted = useFileProcessingStore((state) => state.markCompleted);
  const markFailed = useFileProcessingStore((state) => state.markFailed);
  const updateFileInStore = useFileListStore((state) => state.updateFile);

  // Use refs for callbacks to avoid re-subscribing on every render
  const callbacksRef = useRef({
    setProcessingStatus,
    updateProgress,
    markCompleted,
    markFailed,
    updateFileInStore,
  });

  // Update refs when callbacks change
  useEffect(() => {
    callbacksRef.current = {
      setProcessingStatus,
      updateProgress,
      markCompleted,
      markFailed,
      updateFileInStore,
    };
  }, [setProcessingStatus, updateProgress, markCompleted, markFailed, updateFileInStore]);

  /**
   * Handle file status events (file:status channel)
   */
  const handleFileStatusEvent = useCallback((event: FileWebSocketEvent) => {
    const { setProcessingStatus: setStatus, markFailed: fail, updateFileInStore: updateFile } =
      callbacksRef.current;

    switch (event.type) {
      case FILE_WS_EVENTS.READINESS_CHANGED: {
        const e = event as FileReadinessChangedEvent;
        // Update processing store
        setStatus(e.fileId, {
          readinessState: e.readinessState,
        });
        // Update file list store
        updateFile(e.fileId, {
          readinessState: e.readinessState,
          processingStatus: e.processingStatus,
          embeddingStatus: e.embeddingStatus,
        });
        break;
      }

      case FILE_WS_EVENTS.PERMANENTLY_FAILED: {
        const e = event as FilePermanentlyFailedEvent;
        // Mark as failed with retry info
        fail(e.fileId, e.error, e.canRetryManually);
        // Update file list store
        updateFile(e.fileId, {
          readinessState: 'failed',
          processingRetryCount: e.processingRetryCount,
          embeddingRetryCount: e.embeddingRetryCount,
          lastError: e.error,
          failedAt: e.timestamp,
        });
        break;
      }
    }
  }, []);

  /**
   * Handle file processing events (file:processing channel)
   */
  const handleFileProcessingEvent = useCallback((event: FileWebSocketEvent) => {
    const {
      setProcessingStatus: setStatus,
      updateProgress: progress,
      markCompleted: complete,
    } = callbacksRef.current;

    switch (event.type) {
      case FILE_WS_EVENTS.PROCESSING_PROGRESS: {
        const e = event as FileProcessingProgressEvent;
        // Update progress in processing store
        progress(e.fileId, e.progress, e.attemptNumber, e.maxAttempts);
        break;
      }

      case FILE_WS_EVENTS.PROCESSING_COMPLETED: {
        const e = event as FileProcessingCompletedEvent;
        // Mark as completed
        complete(e.fileId);
        break;
      }

      case FILE_WS_EVENTS.PROCESSING_FAILED: {
        const e = event as FileProcessingFailedEvent;
        // Note: This is a transient failure (before retry decision)
        // The backend will either retry or emit permanently_failed
        setStatus(e.fileId, {
          error: e.error,
        });
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

    // Subscribe to both channels
    const unsubscribeStatus = client.onFileStatusEvent(handleFileStatusEvent);
    const unsubscribeProcessing = client.onFileProcessingEvent(handleFileProcessingEvent);

    // Cleanup on unmount
    return () => {
      unsubscribeStatus();
      unsubscribeProcessing();
    };
  }, [enabled, handleFileStatusEvent, handleFileProcessingEvent]);
}
