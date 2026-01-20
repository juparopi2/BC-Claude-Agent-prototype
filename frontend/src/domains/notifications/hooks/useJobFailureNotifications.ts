/**
 * useJobFailureNotifications Hook
 *
 * Hook for subscribing to background job failure WebSocket events.
 * Shows toast notifications when BullMQ jobs fail after all retries.
 *
 * Phase 3, Task 3.3
 *
 * @module domains/notifications/hooks/useJobFailureNotifications
 */

import { useEffect, useRef, useCallback } from 'react';
import { toast } from 'sonner';
import { getSocketClient } from '@/src/infrastructure/socket/SocketClient';
import {
  type JobFailedPayload,
  getQueueDisplayName,
} from '@bc-agent/shared';

/**
 * Options for useJobFailureNotifications hook
 */
export interface UseJobFailureNotificationsOptions {
  /** Whether to enable the event subscription (default: true) */
  enabled?: boolean;
  /** Custom callback when a job fails */
  onJobFailed?: (event: JobFailedPayload) => void;
  /** Whether to show toast notifications (default: true) */
  showToast?: boolean;
}

/**
 * Hook for subscribing to job failure WebSocket events
 *
 * Automatically subscribes to job:failed channel and shows toast
 * notifications when background jobs fail permanently.
 *
 * @param options - Hook options
 *
 * @example
 * ```tsx
 * function App() {
 *   // Subscribe to job failure notifications
 *   useJobFailureNotifications({
 *     enabled: true,
 *     onJobFailed: (event) => {
 *       console.error(`Job ${event.jobId} failed: ${event.error}`);
 *     },
 *   });
 *
 *   return <MainContent />;
 * }
 * ```
 */
export function useJobFailureNotifications(
  options: UseJobFailureNotificationsOptions = {}
): void {
  const { enabled = true, onJobFailed, showToast = true } = options;

  // Use refs for callbacks to avoid re-subscribing on every render
  const callbacksRef = useRef({
    onJobFailed,
    showToast,
  });

  // Update refs when options change
  useEffect(() => {
    callbacksRef.current = {
      onJobFailed,
      showToast,
    };
  }, [onJobFailed, showToast]);

  /**
   * Handle job failure events
   */
  const handleJobFailure = useCallback((event: JobFailedPayload) => {
    const { queueName, error, attemptsMade, maxAttempts, context } = event;
    const displayName = getQueueDisplayName(queueName);

    // Show toast notification if enabled
    if (callbacksRef.current.showToast) {
      // Format error message for display
      const truncatedError = error.length > 100
        ? `${error.substring(0, 100)}...`
        : error;

      const description = context?.fileName
        ? `File: ${context.fileName}\n${truncatedError}`
        : truncatedError;

      toast.error(`${displayName} failed`, {
        description,
        duration: 8000, // Show for 8 seconds (longer for errors)
        action: {
          label: `${attemptsMade}/${maxAttempts} attempts`,
          onClick: () => {
            // Could open a details modal in the future
          },
        },
      });
    }

    // Call custom callback if provided
    callbacksRef.current.onJobFailed?.(event);
  }, []);

  // Subscribe to WebSocket events
  useEffect(() => {
    if (!enabled) {
      return;
    }

    const client = getSocketClient();

    // Subscribe to job:failed channel
    const unsubscribe = client.onJobFailureEvent(handleJobFailure);

    // Cleanup on unmount
    return () => {
      unsubscribe();
    };
  }, [enabled, handleJobFailure]);
}
