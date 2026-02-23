/**
 * useDuplicateResolution Hook
 *
 * Bridges duplicate store with the upload flow.
 * Calls API, opens modal if needed, waits for user resolution.
 *
 * @module domains/files/hooks/useDuplicateResolution
 */

import { useCallback } from 'react';
import type { DuplicateCheckInput } from '@bc-agent/shared';
import { getUploadApiClient } from '@/src/infrastructure/api/uploadApiClient';
import { useDuplicateStore } from '../stores/duplicateStore';

interface DuplicateResolutionResult {
  /** Files that should proceed with upload */
  proceed: DuplicateCheckInput[];
  /** TempIds of files skipped by user */
  skipped: string[];
  /** Map of tempId → suggestedName for "Keep Both" files */
  renames: Map<string, string>;
  /** Map of tempId → existingFileId for "Replace" files */
  replacements: Map<string, string>;
}

/**
 * Hook for duplicate detection and resolution flow
 */
export function useDuplicateResolution() {
  const setResults = useDuplicateStore((s) => s.setResults);

  const checkAndResolve = useCallback(
    async (files: DuplicateCheckInput[], targetFolderId?: string | null): Promise<DuplicateResolutionResult | null> => {
      if (files.length === 0) return { proceed: [], skipped: [], renames: new Map(), replacements: new Map() };

      const api = getUploadApiClient();
      const response = await api.checkDuplicates({
        files,
        ...(targetFolderId ? { targetFolderId } : {}),
      });

      if (!response.success) {
        // If check fails, proceed with all files (best-effort)
        return { proceed: files, skipped: [], renames: new Map(), replacements: new Map() };
      }

      const { results, targetFolderPath } = response.data;
      const hasDuplicates = results.some((r) => r.isDuplicate);

      if (!hasDuplicates) {
        return { proceed: files, skipped: [], renames: new Map(), replacements: new Map() };
      }

      // Open modal and wait for resolution
      setResults(results, targetFolderPath);

      return new Promise<DuplicateResolutionResult | null>((resolve) => {
        const checkResolved = () => {
          // Read fresh state directly from the store (avoids stale closures)
          const state = useDuplicateStore.getState();

          if (state.isCancelled) {
            state.reset();
            resolve(null);
            return;
          }

          if (state.isAllResolved()) {
            const skipped = state.getSkippedTempIds();
            const renames = state.getKeepRenames();
            const replacements = state.getReplacementTargets();
            const skippedSet = new Set(skipped);
            const proceed = files.filter((f) => !skippedSet.has(f.tempId));
            state.reset();
            resolve({ proceed, skipped, renames, replacements });
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
