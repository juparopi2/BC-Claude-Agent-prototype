/**
 * useGoToFilePath Hook
 *
 * Hook for navigating to a file's location in the file browser.
 * Fetches file metadata, navigates to parent folder, selects the file,
 * and ensures the file sidebar is visible.
 *
 * @module domains/files/hooks/useGoToFilePath
 */

import { useCallback, useState } from 'react';
import { getFileApiClient } from '@/src/infrastructure/api';
import { useFolderNavigation } from './useFolderNavigation';
import { useFileSelection } from './useFileSelection';
import { useUIPreferencesStore } from '@/src/domains/ui';

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

  const { setCurrentFolder } = useFolderNavigation();
  const { selectFile } = useFileSelection();
  const setFileSidebarVisible = useUIPreferencesStore((s) => s.setFileSidebarVisible);

  const goToFilePath = useCallback(
    async (fileId: string): Promise<boolean> => {
      setIsNavigating(true);
      setError(null);

      try {
        // 1. Fetch file metadata to get parentFolderId
        const fileApi = getFileApiClient();
        const result = await fileApi.getFile(fileId);

        if (!result.success) {
          const errorMessage = result.error?.message || 'Failed to fetch file metadata';
          setError(errorMessage);
          console.error('[useGoToFilePath] Failed to fetch file:', result.error);
          return false;
        }

        const file = result.data.file;

        // 2. Navigate to parent folder
        // If parentFolderId is null, we're at root level
        // Build a minimal path array for the breadcrumb
        const path = file.parentFolderId ? [] : [];
        setCurrentFolder(file.parentFolderId, path);

        // 3. Select the file (replace current selection)
        selectFile(fileId, false);

        // 4. Ensure file sidebar is visible
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
    [setCurrentFolder, selectFile, setFileSidebarVisible]
  );

  return {
    goToFilePath,
    isNavigating,
    error,
  };
}
