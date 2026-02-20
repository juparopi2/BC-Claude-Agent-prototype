/**
 * useFolderDuplicateResolutionV2 Hook
 *
 * Bridges folder duplicate store V2 with the upload flow.
 * Calls API, opens modal if needed, waits for user resolution.
 *
 * @module domains/files/hooks/v2/useFolderDuplicateResolutionV2
 */

import { useCallback } from 'react';
import type { FolderDuplicateCheckInput } from '@bc-agent/shared';
import { getFileApiClientV2 } from '@/src/infrastructure/api/fileApiClientV2';
import { useFolderDuplicateStoreV2 } from '../../stores/v2/folderDuplicateStoreV2';

export interface FolderDuplicateResolutionResult {
  /** Map of tempId -> renamed folder name (for keep_both) */
  keepBothRenames: Map<string, string>;
  /** Map of tempId -> existingFolderId (for replace) */
  replaceFolderIds: Map<string, string>;
  /** Set of tempIds to remove from manifest (for skip) */
  skippedFolderIds: Set<string>;
}

/**
 * Hook for V2 folder duplicate detection and resolution flow
 */
export function useFolderDuplicateResolutionV2() {
  const setResults = useFolderDuplicateStoreV2((s) => s.setResults);

  const checkAndResolveFolders = useCallback(
    async (
      folders: FolderDuplicateCheckInput[],
      targetFolderId?: string | null,
    ): Promise<FolderDuplicateResolutionResult | null> => {
      if (folders.length === 0) {
        return { keepBothRenames: new Map(), replaceFolderIds: new Map(), skippedFolderIds: new Set() };
      }

      const api = getFileApiClientV2();
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
          const state = useFolderDuplicateStoreV2.getState();

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
