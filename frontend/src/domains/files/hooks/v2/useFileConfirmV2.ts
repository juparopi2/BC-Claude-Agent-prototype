/**
 * useFileConfirmV2 Hook
 *
 * Confirms file uploads with the backend to trigger processing.
 * Uses a concurrency limiter to avoid overwhelming the server.
 *
 * @module domains/files/hooks/v2/useFileConfirmV2
 */

import { useCallback, useRef } from 'react';
import { getFileApiClientV2 } from '@/src/infrastructure/api/fileApiClientV2';
import { useBatchUploadStoreV2 } from '../../stores/v2/batchUploadStoreV2';

const CONFIRM_CONCURRENCY = 5;
const BATCH_LOCALSTORAGE_KEY = 'v2_activeBatchId';

interface ConfirmResult {
  fileId: string;
  success: boolean;
  error?: string;
}

/**
 * Hook for confirming file uploads after blob upload succeeds
 */
export function useFileConfirmV2() {
  const markFileConfirmed = useBatchUploadStoreV2((s) => s.markFileConfirmed);
  const markFileFailed = useBatchUploadStoreV2((s) => s.markFileFailed);
  const abortRef = useRef(false);

  const confirmFiles = useCallback(
    async (batchId: string, fileIds: string[]): Promise<ConfirmResult[]> => {
      const api = getFileApiClientV2();
      const results: ConfirmResult[] = [];
      const queue = [...fileIds];
      abortRef.current = false;

      const processNext = async (): Promise<void> => {
        while (queue.length > 0 && !abortRef.current) {
          const fileId = queue.shift()!;

          const response = await api.confirmFile(batchId, fileId);

          if (response.success) {
            markFileConfirmed(fileId, response.data.batchProgress);
            results.push({ fileId, success: true });

            // Clean up localStorage when batch completes
            if (response.data.batchProgress.isComplete) {
              localStorage.removeItem(BATCH_LOCALSTORAGE_KEY);
            }
          } else {
            const errMsg = response.error.message;
            markFileFailed(fileId, errMsg);
            results.push({ fileId, success: false, error: errMsg });
          }
        }
      };

      // Run with concurrency limit
      const workers = Array.from(
        { length: Math.min(CONFIRM_CONCURRENCY, fileIds.length) },
        () => processNext()
      );
      await Promise.all(workers);

      return results;
    },
    [markFileConfirmed, markFileFailed]
  );

  const abort = useCallback(() => {
    abortRef.current = true;
  }, []);

  return { confirmFiles, abort };
}
