/**
 * useGoToFilePath Hook
 *
 * Hook for navigating to a file's location in the file browser.
 * Fetches file metadata, builds the full breadcrumb path,
 * expands the folder tree, navigates to parent folder, selects the file,
 * and ensures the file sidebar is visible.
 *
 * For SharePoint files, auto-sets the active site context in the breadcrumb
 * by resolving the site from the connection's scope data.
 *
 * @module domains/files/hooks/useGoToFilePath
 */

import { useCallback, useState } from 'react';
import { getFileApiClient } from '@/src/infrastructure/api';
import { useFolderNavigation } from './useFolderNavigation';
import { useFileSelection } from './useFileSelection';
import { useUIPreferencesStore } from '@/src/domains/ui';
import { useFolderTreeStore } from '../stores/folderTreeStore';
import { useSortFilterStore } from '../stores/sortFilterStore';
import { useIntegrationListStore } from '@/src/domains/integrations';
import { buildPathToFolderAsync } from '../utils/folderPathBuilder';
import { FILE_SOURCE_TYPE, CONNECTIONS_API, PROVIDER_ID } from '@bc-agent/shared';
import { env } from '@/lib/config/env';
import type { ParsedFile, ConnectionScopeDetail } from '@bc-agent/shared';

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
 * Attempt to resolve a SharePoint site context from the connection scopes.
 * Returns the site context if determinable (single site or cached site list),
 * or null if the site cannot be determined.
 */
async function resolveSPSiteContext(
  connectionId: string
): Promise<{ siteId: string; siteName: string } | null> {
  try {
    const response = await fetch(
      `${env.apiUrl}${CONNECTIONS_API.BASE}/${connectionId}/scopes`,
      { credentials: 'include' }
    );

    if (!response.ok) return null;

    const data = (await response.json()) as { scopes: ConnectionScopeDetail[] };
    const scopes = data.scopes ?? [];

    // Collect unique sites from scopes that have a site ID
    const siteMap = new Map<string, string>();
    for (const scope of scopes) {
      if (scope.scopeSiteId) {
        // Use scopeDisplayName as a fallback site name carrier — for library/folder scopes
        // the displayName often includes "Site / Library" format; extract site part if possible
        if (!siteMap.has(scope.scopeSiteId)) {
          // Try to get site name from the store cache first
          const cachedSites = useFolderTreeStore.getState().sharepointSiteCache;
          const cachedSite = cachedSites.find((s) => s.siteId === scope.scopeSiteId);
          const siteName = cachedSite?.displayName ?? scope.scopeDisplayName ?? scope.scopeSiteId;
          siteMap.set(scope.scopeSiteId, siteName);
        }
      }
    }

    if (siteMap.size === 1) {
      // Only one site configured — unambiguously set it
      const [[siteId, siteName]] = [...siteMap.entries()];
      return { siteId, siteName };
    }

    // Multiple sites — cannot determine which site the file belongs to
    // without a siteId on ParsedFile. Return null to avoid incorrect context.
    return null;
  } catch {
    return null;
  }
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

  const { setCurrentFolder, toggleFolderExpanded, setActiveSiteContext } = useFolderNavigation();
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

        // Sync source type filter to match the file's source
        const targetSourceFilter =
          file.sourceType === FILE_SOURCE_TYPE.LOCAL ? null : file.sourceType;
        useSortFilterStore.getState().setSourceTypeFilter(targetSourceFilter);

        // Auto-expand the correct folder tree section
        const folderTreeState = useFolderTreeStore.getState();
        if (targetSourceFilter === FILE_SOURCE_TYPE.ONEDRIVE) {
          folderTreeState.setSectionExpanded('onedrive', true);
        } else if (targetSourceFilter === FILE_SOURCE_TYPE.SHAREPOINT) {
          folderTreeState.setSectionExpanded('sharepoint', true);
        } else {
          folderTreeState.setSectionExpanded('local', true);
        }

        // 1b. For SharePoint files, attempt to resolve and set the site context
        if (targetSourceFilter === FILE_SOURCE_TYPE.SHAREPOINT) {
          const connections = useIntegrationListStore.getState().connections;
          const spConnection = connections.find((c) => c.provider === PROVIDER_ID.SHAREPOINT);
          if (spConnection) {
            const siteContext = await resolveSPSiteContext(spConnection.id);
            setActiveSiteContext(siteContext);
          } else {
            setActiveSiteContext(null);
          }
        } else {
          // Clear site context for non-SP files
          setActiveSiteContext(null);
        }

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
    [setCurrentFolder, toggleFolderExpanded, selectFile, setFileSidebarVisible, setActiveSiteContext]
  );

  return {
    goToFilePath,
    isNavigating,
    error,
  };
}
