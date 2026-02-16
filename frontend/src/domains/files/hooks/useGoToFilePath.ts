/**
 * useGoToFilePath Hook
 *
 * Hook for navigating to a file's location in the file browser.
 * Fetches file metadata, builds the full breadcrumb path,
 * expands the folder tree, navigates to parent folder, selects the file,
 * and ensures the file sidebar is visible.
 *
 * @module domains/files/hooks/useGoToFilePath
 */

import { useCallback, useState } from 'react';
import { getFileApiClient } from '@/src/infrastructure/api';
import { useFolderNavigation } from './useFolderNavigation';
import { useFileSelection } from './useFileSelection';
import { useUIPreferencesStore } from '@/src/domains/ui';
import { useFolderTreeStore } from '../stores/folderTreeStore';
import { buildPathToFolderAsync } from '../utils/folderPathBuilder';
import type { ParsedFile } from '@bc-agent/shared';

/**
 * Return type for useGoToFilePath hook
 */
export interface UseGoToFilePathReturn {
  /** Navigate to a file's location in the file browser */
  goToFilePath: (fileId: string) => Promise<boolean>;
  /** Whether navigation is in progress */
  isNavigating: boolean;
  /** Error message if navigation failed */
  error: string | null;
}

/**
 * Hook for navigating to a file's location in the file browser
 *
 * @example
 * ```tsx
 * function FileActions({ fileId }) {
 *   const { goToFilePath, isNavigating } = useGoToFilePath();
 *
 *   const handleGoToPath = async () => {
 *     const success = await goToFilePath(fileId);
 *     if (success) {
 *       // File browser now shows the file's location
 *     }
 *   };
 *
 *   return (
 *     <Button onClick={handleGoToPath} disabled={isNavigating}>
 *       Go to file location
 *     </Button>
 *   );
 * }
 * ```
 */
export function useGoToFilePath(): UseGoToFilePathReturn {
  const [isNavigating, setIsNavigating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { setCurrentFolder, toggleFolderExpanded } = useFolderNavigation();
  const { selectFile } = useFileSelection();
  const setFileSidebarVisible = useUIPreferencesStore((s) => s.setFileSidebarVisible);

  const goToFilePath = useCallback(
    async (fileId: string): Promise<boolean> => {
      setIsNavigating(true);
      setError(null);

      try {
        const fileApi = getFileApiClient();

        // 1. Fetch file metadata to get parentFolderId
        const result = await fileApi.getFile(fileId);

        if (!result.success) {
          const errorMessage = result.error?.message || 'Failed to fetch file metadata';
          setError(errorMessage);
          console.error('[useGoToFilePath] Failed to fetch file:', result.error);
          return false;
        }

        const file = result.data.file;

        // 2. Build the full breadcrumb path from root to parent folder
        let path: ParsedFile[] = [];

        if (file.parentFolderId) {
          // Fetch the parent folder's metadata so we can walk up the tree
          const parentResult = await fileApi.getFile(file.parentFolderId);
          if (parentResult.success) {
            const parentFolder = parentResult.data.file;

            // Fetch folder to build API fallback for uncached ancestors
            const fetchFolder = async (folderId: string): Promise<ParsedFile | null> => {
              const folderResult = await fileApi.getFile(folderId);
              return folderResult.success ? folderResult.data.file : null;
            };

            const { treeFolders } = useFolderTreeStore.getState();
            path = await buildPathToFolderAsync(parentFolder, treeFolders, fetchFolder);
          }
        }

        // 3. Navigate to parent folder with correct breadcrumb
        setCurrentFolder(file.parentFolderId, path);

        // 4. Expand all folders in the path so the sidebar reflects navigation
        for (const folder of path) {
          toggleFolderExpanded(folder.id, true);
        }

        // 5. Select the file (replace current selection)
        selectFile(fileId, false);

        // 6. Ensure file sidebar is visible
        setFileSidebarVisible(true);

        return true;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        setError(errorMessage);
        console.error('[useGoToFilePath] Error navigating to file:', err);
        return false;
      } finally {
        setIsNavigating(false);
      }
    },
    [setCurrentFolder, toggleFolderExpanded, selectFile, setFileSidebarVisible]
  );

  return {
    goToFilePath,
    isNavigating,
    error,
  };
}
