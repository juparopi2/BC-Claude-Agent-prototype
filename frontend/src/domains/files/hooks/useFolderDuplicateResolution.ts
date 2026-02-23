/**
 * useFolderDuplicateResolution Hook
 *
 * Bridges folder duplicate store with the upload flow.
 * Calls API, opens modal if needed, waits for user resolution.
 *
 * @module domains/files/hooks/useFolderDuplicateResolution
 */

import { useCallback } from 'react';
import type { FolderDuplicateCheckInput } from '@bc-agent/shared';
import { getUploadApiClient } from '@/src/infrastructure/api/uploadApiClient';
import { useFolderDuplicateStore } from '../stores/folderDuplicateStore';

export interface FolderDuplicateResolutionResult {
  /** Map of tempId -> renamed folder name (for keep_both) */
  keepBothRenames: Map<string, string>;
  /** Map of tempId -> existingFolderId (for replace) */
  replaceFolderIds: Map<string, string>;
  /** Set of tempIds to remove from manifest (for skip) */
  skippedFolderIds: Set<string>;
}

/**
 * Hook for folder duplicate detection and resolution flow
 */
export function useFolderDuplicateResolution() {
  const setResults = useFolderDuplicateStore((s) => s.setResults);

  const checkAndResolveFolders = useCallback(
    async (
      folders: FolderDuplicateCheckInput[],
      targetFolderId?: string | null,
    ): Promise<FolderDuplicateResolutionResult | null> => {
      if (folders.length === 0) {
        return { keepBothRenames: new Map(), replaceFolderIds: new Map(), skippedFolderIds: new Set() };
      }

      const api = getUploadApiClient();
      const response = await api.checkFolderDuplicates({
        folders,
        ...(targetFolderId ? { targetFolderId } : {}),
      });

      if (!response.success) {
        // If check fails, proceed with all folders (best-effort)
        return { keepBothRenames: new Map(), replaceFolderIds: new Map(), skippedFolderIds: new Set() };
      }

      const { results, targetFolderPath } = response.data;
      const hasDuplicates = results.some((r) => r.isDuplicate);

      if (!hasDuplicates) {
        return { keepBothRenames: new Map(), replaceFolderIds: new Map(), skippedFolderIds: new Set() };
      }

      // Open modal and wait for resolution
      setResults(results, targetFolderPath);

      return new Promise<FolderDuplicateResolutionResult | null>((resolve) => {
        const checkResolved = () => {
          const state = useFolderDuplicateStore.getState();

          if (state.isCancelled) {
            state.reset();
            resolve(null);
            return;
          }

          if (state.isAllResolved()) {
            const skippedFolderIds = new Set(state.getSkippedTempIds());
            const keepBothRenames = state.getKeepBothRenames();
            const replaceFolderIds = state.getReplaceFolderIds();
            state.reset();
            resolve({ keepBothRenames, replaceFolderIds, skippedFolderIds });
            return;
          }

          setTimeout(checkResolved, 200);
        };

        checkResolved();
      });
    },
    [setResults]
  );

  return { checkAndResolveFolders };
}
