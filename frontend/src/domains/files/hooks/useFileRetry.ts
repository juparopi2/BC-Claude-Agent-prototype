/**
 * useFileRetry Hook
 *
 * Hook for retrying processing of failed files.
 * Coordinates with fileProcessingStore and fileListStore for state updates.
 *
 * @module domains/files/hooks/useFileRetry
 */

import { useState, useCallback } from 'react';
import { useFileProcessingStore } from '../stores/fileProcessingStore';
import { useFileListStore } from '../stores/fileListStore';
import { getFileApiClient } from '@/src/infrastructure/api';
import type { RetryScope } from '@bc-agent/shared';

/**
 * useFileRetry return type
 */
export interface UseFileRetryReturn {
  /** Retry processing for a failed file */
  retryFile: (fileId: string, scope?: RetryScope) => Promise<boolean>;
  /** Whether a retry operation is in progress */
  isRetrying: boolean;
  /** Error message if retry failed */
  error: string | null;
  /** Clear error state */
  clearError: () => void;
}

/**
 * Hook for retrying failed file processing
 *
 * Provides a method to trigger re-processing of files that have permanently failed.
 * Updates fileProcessingStore and fileListStore after successful retry initiation.
 *
 * @example
 * ```tsx
 * function FileRetryButton({ fileId }: { fileId: string }) {
 *   const { retryFile, isRetrying, error } = useFileRetry();
 *
 *   const handleRetry = async () => {
 *     const success = await retryFile(fileId);
 *     if (success) {
 *       console.log('Retry initiated');
 *     }
 *   };
 *
 *   return (
 *     <button onClick={handleRetry} disabled={isRetrying}>
 *       {isRetrying ? 'Retrying...' : 'Retry'}
 *     </button>
 *   );
 * }
 * ```
 */
export function useFileRetry(): UseFileRetryReturn {
  const [isRetrying, setIsRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Get store actions
  const setProcessingStatus = useFileProcessingStore((state) => state.setProcessingStatus);
  const updateFileInStore = useFileListStore((state) => state.updateFile);

  /**
   * Clear error state
   */
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  /**
   * Retry processing for a failed file
   *
   * @param fileId - File UUID to retry
   * @param scope - Retry scope: 'full' (default) or 'embedding_only'
   * @returns True if retry was initiated successfully
   */
  const retryFile = useCallback(
    async (fileId: string, scope?: RetryScope): Promise<boolean> => {
      setIsRetrying(true);
      setError(null);

      try {
        const fileApi = getFileApiClient();
        const result = await fileApi.retryProcessing(fileId, scope ? { scope } : undefined);

        if (!result.success) {
          setError(result.error.message);
          return false;
        }

        // Update file processing store with new processing state
        setProcessingStatus(fileId, {
          readinessState: 'processing',
          progress: 0,
          error: undefined,
          canRetryManually: undefined,
        });

        // Update file list store with new file data from response
        updateFileInStore(fileId, {
          readinessState: result.data.file.readinessState,
          processingStatus: result.data.file.processingStatus,
          embeddingStatus: result.data.file.embeddingStatus,
          processingRetryCount: result.data.file.processingRetryCount,
          embeddingRetryCount: result.data.file.embeddingRetryCount,
          lastError: result.data.file.lastError,
          failedAt: result.data.file.failedAt,
        });

        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to retry processing';
        setError(message);
        return false;
      } finally {
        setIsRetrying(false);
      }
    },
    [setProcessingStatus, updateFileInStore]
  );

  return {
    retryFile,
    isRetrying,
    error,
    clearError,
  };
}
