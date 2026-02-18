/**
 * useDuplicateResolutionV2 Hook
 *
 * Bridges duplicate store V2 with the upload flow.
 * Calls API, opens modal if needed, waits for user resolution.
 *
 * @module domains/files/hooks/v2/useDuplicateResolutionV2
 */

import { useCallback } from 'react';
import type { DuplicateCheckInputV2 } from '@bc-agent/shared';
import { getFileApiClientV2 } from '@/src/infrastructure/api/fileApiClientV2';
import { useDuplicateStoreV2 } from '../../stores/v2/duplicateStoreV2';

interface DuplicateResolutionResult {
  /** Files that should proceed with upload */
  proceed: DuplicateCheckInputV2[];
  /** TempIds of files skipped by user */
  skipped: string[];
}

/**
 * Hook for V2 duplicate detection and resolution flow
 */
export function useDuplicateResolutionV2() {
  const setResults = useDuplicateStoreV2((s) => s.setResults);

  const checkAndResolve = useCallback(
    async (files: DuplicateCheckInputV2[]): Promise<DuplicateResolutionResult | null> => {
      if (files.length === 0) return { proceed: [], skipped: [] };

      const api = getFileApiClientV2();
      const response = await api.checkDuplicates({ files });

      if (!response.success) {
        // If check fails, proceed with all files (best-effort)
        return { proceed: files, skipped: [] };
      }

      const { results } = response.data;
      const hasDuplicates = results.some((r) => r.isDuplicate);

      if (!hasDuplicates) {
        return { proceed: files, skipped: [] };
      }

      // Open modal and wait for resolution
      setResults(results);

      return new Promise<DuplicateResolutionResult | null>((resolve) => {
        const checkResolved = () => {
          // Read fresh state directly from the store (avoids stale closures)
          const state = useDuplicateStoreV2.getState();

          if (state.isCancelled) {
            state.reset();
            resolve(null);
            return;
          }

          if (state.isAllResolved()) {
            const skipped = state.getSkippedTempIds();
            const skippedSet = new Set(skipped);
            const proceed = files.filter((f) => !skippedSet.has(f.tempId));
            state.reset();
            resolve({ proceed, skipped });
            return;
          }

          // Poll until resolved (modal is open, user is interacting)
          setTimeout(checkResolved, 200);
        };

        checkResolved();
      });
    },
    [setResults] // eslint-disable-line react-hooks/exhaustive-deps
  );

  return { checkAndResolve };
}
