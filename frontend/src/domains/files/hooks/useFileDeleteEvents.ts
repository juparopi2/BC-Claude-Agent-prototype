/**
 * useFileDeleteEvents Hook
 *
 * Hook for subscribing to file deletion WebSocket events.
 * Handles FILE_WS_EVENTS.DELETED events from the file:status channel.
 *
 * @module domains/files/hooks/useFileDeleteEvents
 */

import { useEffect, useRef, useCallback } from 'react';
import { toast } from 'sonner';
import { getSocketClient } from '@/src/infrastructure/socket/SocketClient';
import {
  FILE_WS_EVENTS,
  type FileWebSocketEvent,
  type FileDeletedEvent,
  type FileDeletionStartedEvent,
} from '@bc-agent/shared';
import { useFileListStore } from '../stores/fileListStore';

/**
 * Options for useFileDeleteEvents hook
 */
export interface UseFileDeleteEventsOptions {
  /** Whether to enable the event subscription */
  enabled?: boolean;
  /** Callback when deletion fails (for custom error handling) */
  onDeletionFailed?: (fileId: string, error: string) => void;
  /** Callback when deletion succeeds (for custom success handling) */
  onDeletionSuccess?: (fileId: string) => void;
  /** Callback when deletion starts (Phase 2 begins) */
  onDeletionStarted?: (fileId: string, batchId?: string) => void;
}

/**
 * Hook for subscribing to file deletion WebSocket events
 *
 * Automatically subscribes to file:status channel and handles
 * file:deleted events. Shows toast notifications for failures.
 *
 * Since files are optimistically removed from UI when deletion is initiated,
 * this hook primarily handles error cases (showing toast when deletion fails).
 *
 * @param options - Hook options
 *
 * @example
 * ```tsx
 * function FileExplorer() {
 *   // Subscribe to file deletion events
 *   useFileDeleteEvents({
 *     enabled: true,
 *     onDeletionFailed: (fileId, error) => {
 *       console.error(`Failed to delete ${fileId}: ${error}`);
 *       // Optionally refetch file list to restore UI
 *     },
 *   });
 *
 *   return <FileList />;
 * }
 * ```
 */
export function useFileDeleteEvents(
  options: UseFileDeleteEventsOptions = {}
): void {
  const { enabled = true, onDeletionFailed, onDeletionSuccess, onDeletionStarted } = options;

  // Get store actions for handling deletion state
  const confirmDeletion = useFileListStore((state) => state.confirmDeletion);
  const cancelDeletion = useFileListStore((state) => state.cancelDeletion);

  // Use refs for callbacks to avoid re-subscribing on every render
  const callbacksRef = useRef({
    onDeletionFailed,
    onDeletionSuccess,
    onDeletionStarted,
  });

  // Update refs when callbacks change
  useEffect(() => {
    callbacksRef.current = {
      onDeletionFailed,
      onDeletionSuccess,
      onDeletionStarted,
    };
  }, [onDeletionFailed, onDeletionSuccess, onDeletionStarted]);

  /**
   * Handle file status events (file:status channel)
   */
  const handleFileStatusEvent = useCallback((event: FileWebSocketEvent) => {
    // Handle deletion started event (Phase 2 begins)
    if (event.type === FILE_WS_EVENTS.DELETION_STARTED) {
      const startedEvent = event as FileDeletionStartedEvent;
      callbacksRef.current.onDeletionStarted?.(startedEvent.fileId, startedEvent.batchId);
      return;
    }

    // Handle deletion completed event
    if (event.type !== FILE_WS_EVENTS.DELETED) {
      return;
    }

    const deleteEvent = event as FileDeletedEvent;
    const { fileId, success, error } = deleteEvent;

    if (success) {
      // Physical deletion succeeded - confirm in store (removes from deleting set)
      confirmDeletion(fileId);
      // Call success callback if provided
      callbacksRef.current.onDeletionSuccess?.(fileId);
    } else {
      // Deletion failed - restore file visibility and show error
      cancelDeletion([fileId]);
      const errorMessage = error || 'Failed to delete file';
      toast.error(`Delete failed: ${errorMessage}`);

      // Call failure callback if provided
      callbacksRef.current.onDeletionFailed?.(fileId, errorMessage);
    }
  }, [confirmDeletion, cancelDeletion]);

  // Subscribe to WebSocket events
  useEffect(() => {
    if (!enabled) {
      return;
    }

    const client = getSocketClient();

    // Subscribe to file:status channel (deletion events come through here)
    const unsubscribe = client.onFileStatusEvent(handleFileStatusEvent);

    // Cleanup on unmount
    return () => {
      unsubscribe();
    };
  }, [enabled, handleFileStatusEvent]);
}
