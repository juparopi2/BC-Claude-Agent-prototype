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
} from '@bc-agent/shared';

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
  const { enabled = true, onDeletionFailed, onDeletionSuccess } = options;

  // Use refs for callbacks to avoid re-subscribing on every render
  const callbacksRef = useRef({
    onDeletionFailed,
    onDeletionSuccess,
  });

  // Update refs when callbacks change
  useEffect(() => {
    callbacksRef.current = {
      onDeletionFailed,
      onDeletionSuccess,
    };
  }, [onDeletionFailed, onDeletionSuccess]);

  /**
   * Handle file status events (file:status channel)
   */
  const handleFileStatusEvent = useCallback((event: FileWebSocketEvent) => {
    // Only handle deletion events
    if (event.type !== FILE_WS_EVENTS.DELETED) {
      return;
    }

    const deleteEvent = event as FileDeletedEvent;
    const { fileId, success, error } = deleteEvent;

    if (success) {
      // Deletion succeeded - call success callback if provided
      callbacksRef.current.onDeletionSuccess?.(fileId);
    } else {
      // Deletion failed - show error toast
      const errorMessage = error || 'Failed to delete file';
      toast.error(`Delete failed: ${errorMessage}`);

      // Call failure callback if provided
      callbacksRef.current.onDeletionFailed?.(fileId, errorMessage);
    }
  }, []);

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
