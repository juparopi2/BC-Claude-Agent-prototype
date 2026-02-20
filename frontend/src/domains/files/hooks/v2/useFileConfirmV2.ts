/**
 * useFileConfirmV2 Hook
 *
 * Confirms file uploads with the backend to trigger processing.
 * Uses a concurrency limiter to avoid overwhelming the server.
 * Supports multiple concurrent batches via per-batch abort flags.
 *
 * @module domains/files/hooks/v2/useFileConfirmV2
 */

import { useCallback, useRef } from 'react';
import { ErrorCode } from '@bc-agent/shared';
import { getFileApiClientV2 } from '@/src/infrastructure/api/fileApiClientV2';
import { useBatchUploadStoreV2 } from '../../stores/v2/batchUploadStoreV2';

const CONFIRM_CONCURRENCY = 5;
const BATCHES_LOCALSTORAGE_KEY = 'v2_activeBatches';

interface ConfirmResult {
  fileId: string;
  success: boolean;
  error?: string;
}

/**
 * Hook for confirming file uploads after blob upload succeeds.
 * Supports per-batch abort via abortMapRef.
 */
export function useFileConfirmV2() {
  const markFileConfirmed = useBatchUploadStoreV2((s) => s.markFileConfirmed);
  const markFileFailed = useBatchUploadStoreV2((s) => s.markFileFailed);
  const abortMapRef = useRef<Map<string, boolean>>(new Map());

  const confirmFiles = useCallback(
    async (batchKey: string, batchId: string, fileIds: string[]): Promise<ConfirmResult[]> => {
      const api = getFileApiClientV2();
      const results: ConfirmResult[] = [];
      const queue = [...fileIds];
      abortMapRef.current.set(batchKey, false);

      const processNext = async (): Promise<void> => {
        while (queue.length > 0 && !abortMapRef.current.get(batchKey)) {
          const fileId = queue.shift()!;

          const response = await api.confirmFile(batchId, fileId);

          if (response.success) {
            markFileConfirmed(batchKey, fileId, response.data.batchProgress);
            results.push({ fileId, success: true });

            // Clean up localStorage when batch completes
            if (response.data.batchProgress.isComplete) {
              removeBatchFromLocalStorage(batchKey);
            }
          } else {
            // 409 STATE_CONFLICT / ALREADY_EXISTS = file already confirmed
            // (race condition during recovery or double-click). Not a real failure.
            const isAlreadyConfirmed = response.error.code === ErrorCode.STATE_CONFLICT
              || response.error.code === ErrorCode.ALREADY_EXISTS;

            if (isAlreadyConfirmed) {
              results.push({ fileId, success: true });
            } else {
              const errMsg = response.error.message;
              markFileFailed(batchKey, fileId, errMsg);
              results.push({ fileId, success: false, error: errMsg });
            }
          }
        }
      };

      // Run with concurrency limit
      const workers = Array.from(
        { length: Math.min(CONFIRM_CONCURRENCY, fileIds.length) },
        () => processNext()
      );
      await Promise.all(workers);

      abortMapRef.current.delete(batchKey);
      return results;
    },
    [markFileConfirmed, markFileFailed]
  );

  const abortByBatchKey = useCallback((batchKey: string) => {
    abortMapRef.current.set(batchKey, true);
  }, []);

  const abortAll = useCallback(() => {
    for (const key of abortMapRef.current.keys()) {
      abortMapRef.current.set(key, true);
    }
  }, []);

  return { confirmFiles, abortByBatchKey, abortAll };
}

/**
 * Remove a single batch reference from the localStorage array.
 */
function removeBatchFromLocalStorage(batchKey: string): void {
  try {
    const raw = localStorage.getItem(BATCHES_LOCALSTORAGE_KEY);
    if (!raw) return;
    const refs: { batchKey: string }[] = JSON.parse(raw);
    const filtered = refs.filter((r) => r.batchKey !== batchKey);
    if (filtered.length === 0) {
      localStorage.removeItem(BATCHES_LOCALSTORAGE_KEY);
    } else {
      localStorage.setItem(BATCHES_LOCALSTORAGE_KEY, JSON.stringify(filtered));
    }
  } catch {
    localStorage.removeItem(BATCHES_LOCALSTORAGE_KEY);
  }
}
