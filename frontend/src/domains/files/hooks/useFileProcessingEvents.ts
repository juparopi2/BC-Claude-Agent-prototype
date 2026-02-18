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
import { useBatchUploadStoreV2 } from '../stores/v2/batchUploadStoreV2';
import { getSocketClient } from '@/src/infrastructure/socket/SocketClient';
import {
  FILE_WS_EVENTS,
  PIPELINE_STATUS,
  type FileWebSocketEvent,
  type FileReadinessChangedEvent,
  type FilePermanentlyFailedEvent,
  type FileProcessingProgressEvent,
  type FileProcessingCompletedEvent,
  type FileProcessingFailedEvent,
  type FileUploadedEvent,
  type PipelineStatus,
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
  const addFileToStore = useFileListStore((state) => state.addFile);

  // V2 batch store actions
  const v2UpdatePipeline = useBatchUploadStoreV2((state) => state.updateFilePipelineStatus);
  const v2MarkFailed = useBatchUploadStoreV2((state) => state.markFileFailed);
  const v2Files = useBatchUploadStoreV2((state) => state.files);

  // Use refs for callbacks to avoid re-subscribing on every render
  const callbacksRef = useRef({
    setProcessingStatus,
    updateProgress,
    markCompleted,
    markFailed,
    updateFileInStore,
    addFileToStore,
    v2UpdatePipeline,
    v2MarkFailed,
    v2Files,
  });

  // Update refs when callbacks change
  useEffect(() => {
    callbacksRef.current = {
      setProcessingStatus,
      updateProgress,
      markCompleted,
      markFailed,
      updateFileInStore,
      addFileToStore,
      v2UpdatePipeline,
      v2MarkFailed,
      v2Files,
    };
  }, [setProcessingStatus, updateProgress, markCompleted, markFailed, updateFileInStore, addFileToStore, v2UpdatePipeline, v2MarkFailed, v2Files]);

  /**
   * Handle file status events (file:status channel)
   */
  const handleFileStatusEvent = useCallback((event: FileWebSocketEvent) => {
    const {
      setProcessingStatus: setStatus,
      markFailed: fail,
      updateFileInStore: updateFile,
      addFileToStore: addFile,
      v2UpdatePipeline: updateV2Pipeline,
      v2MarkFailed: failV2,
      v2Files,
    } = callbacksRef.current;

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
        // V2: Update batch store if file belongs to active batch
        if (v2Files.has(e.fileId)) {
          const readinessToPipeline: Record<string, PipelineStatus> = {
            processing: PIPELINE_STATUS.EXTRACTING,
            ready: PIPELINE_STATUS.READY,
            failed: PIPELINE_STATUS.FAILED,
          };
          const pipelineStatus = readinessToPipeline[e.readinessState];
          if (pipelineStatus) {
            updateV2Pipeline(e.fileId, pipelineStatus);
          }
        }
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
        // V2: Update batch store if file belongs to active batch
        if (v2Files.has(e.fileId)) {
          failV2(e.fileId, e.error);
        }
        break;
      }

      case FILE_WS_EVENTS.UPLOADED: {
        const e = event as FileUploadedEvent;
        // Add new file to list in real-time (bulk upload completion)
        if (e.success && e.file) {
          addFile(e.file);
        }
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
      updateFileInStore: updateFile,
      v2UpdatePipeline: updateV2Pipeline,
      v2Files,
    } = callbacksRef.current;

    switch (event.type) {
      case FILE_WS_EVENTS.PROCESSING_PROGRESS: {
        const e = event as FileProcessingProgressEvent;
        // Update progress in processing store
        progress(e.fileId, e.progress, e.attemptNumber, e.maxAttempts);
        // Update file list store with processing state
        updateFile(e.fileId, {
          readinessState: 'processing',
        });
        // V2: Update batch store with extracting status
        if (v2Files.has(e.fileId)) {
          updateV2Pipeline(e.fileId, PIPELINE_STATUS.EXTRACTING);
        }
        break;
      }

      case FILE_WS_EVENTS.PROCESSING_COMPLETED: {
        const e = event as FileProcessingCompletedEvent;
        // Mark as completed in processing store
        complete(e.fileId);
        // Update file list store with ready state
        updateFile(e.fileId, {
          readinessState: 'ready',
          processingStatus: 'completed',
        });
        // V2: Update batch store with ready status
        if (v2Files.has(e.fileId)) {
          updateV2Pipeline(e.fileId, PIPELINE_STATUS.READY);
        }
        break;
      }

      case FILE_WS_EVENTS.PROCESSING_FAILED: {
        const e = event as FileProcessingFailedEvent;
        // Note: This is a transient failure (before retry decision)
        // The backend will either retry or emit permanently_failed
        setStatus(e.fileId, {
          error: e.error,
        });
        // Update file list store with error
        updateFile(e.fileId, {
          lastError: e.error,
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
