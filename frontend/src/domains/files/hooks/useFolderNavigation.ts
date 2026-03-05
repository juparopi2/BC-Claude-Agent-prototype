/**
 * useFolderNavigation Hook
 *
 * Hook for folder navigation functionality with API operations.
 * Wraps folderTreeStore for navigation state and tree management.
 *
 * @module domains/files/hooks/useFolderNavigation
 */

import { useCallback } from 'react';
import { useFolderTreeStore } from '../stores/folderTreeStore';
import { useSortFilterStore } from '../stores/sortFilterStore';
import { getFileApiClient } from '@/src/infrastructure/api';
import { buildPathToFolder } from '../utils/folderPathBuilder';
import type { ParsedFile } from '@bc-agent/shared';

const EMPTY_FOLDERS: ParsedFile[] = [];

/**
 * useFolderNavigation return type
 */
export interface UseFolderNavigationReturn {
  /** Current folder ID (null = root) */
  currentFolderId: string | null;
  /** Breadcrumb path from root to current */
  folderPath: ParsedFile[];
  /** Root level folders */
  rootFolders: ParsedFile[];
  /** IDs of expanded folders in sidebar */
  expandedFolderIds: string[];
  /** Navigate to a folder */
  setCurrentFolder: (folderId: string | null, path: ParsedFile[]) => void;
  /** Navigate up to parent folder */
  navigateUp: () => void;
  /** Toggle folder expansion in sidebar (with lazy-loading) */
  toggleFolderExpanded: (folderId: string, forceState?: boolean) => void;
  /** Cache folder children */
  setTreeFolders: (parentId: string, folders: ParsedFile[]) => void;
  /** Set loading state for folder */
  setLoadingFolder: (folderId: string, isLoading: boolean) => void;
  /** Check if folder is expanded */
  isFolderExpanded: (folderId: string) => boolean;
  /** Check if folder is loading */
  isFolderLoading: (folderId: string) => boolean;
  /** Get children of a folder from cache */
  getChildFolders: (parentId: string) => ParsedFile[];
  /** Initialize folder tree by loading root folders */
  initFolderTree: () => Promise<void>;
  /** Navigate to folder with optional folder data for breadcrumb path */
  navigateToFolder: (folderId: string | null, folderData?: ParsedFile) => void;
  /** Add or update a folder in the cached children of a parent */
  upsertTreeFolder: (parentId: string, folder: ParsedFile) => void;
  /** Remove a folder from the cached children of a parent */
  removeTreeFolder: (parentId: string, folderId: string) => void;
  /** Invalidate cached children for a parent, forcing re-fetch on next expand */
  invalidateTreeFolder: (parentId: string) => void;
}

/**
 * Hook for managing folder navigation
 *
 * Provides folder tree state and navigation actions.
 * API calls for loading folder contents should be handled externally.
 *
 * @example
 * ```tsx
 * function FolderTree() {
 *   const {
 *     rootFolders,
 *     expandedFolderIds,
 *     toggleFolderExpanded,
 *     getChildFolders
 *   } = useFolderNavigation();
 *
 *   return (
 *     <TreeView>
 *       {rootFolders.map(folder => (
 *         <FolderNode
 *           key={folder.id}
 *           folder={folder}
 *           isExpanded={expandedFolderIds.includes(folder.id)}
 *           onToggle={() => toggleFolderExpanded(folder.id)}
 *           children={getChildFolders(folder.id)}
 *         />
 *       ))}
 *     </TreeView>
 *   );
 * }
 * ```
 */
export function useFolderNavigation(): UseFolderNavigationReturn {
  // Get state from store
  const currentFolderId = useFolderTreeStore((state) => state.currentFolderId);
  const folderPath = useFolderTreeStore((state) => state.folderPath);
  const expandedFolderIds = useFolderTreeStore((state) => state.expandedFolderIds);

  // Get action functions
  const setCurrentFolderAction = useFolderTreeStore((state) => state.setCurrentFolder);
  const navigateUpAction = useFolderTreeStore((state) => state.navigateUp);
  const toggleFolderExpandedAction = useFolderTreeStore((state) => state.toggleFolderExpanded);
  const setTreeFoldersAction = useFolderTreeStore((state) => state.setTreeFolders);
  const setLoadingFolderAction = useFolderTreeStore((state) => state.setLoadingFolder);
  const rootFolders = useFolderTreeStore((state) => state.treeFolders['root'] ?? EMPTY_FOLDERS);
  const isFolderExpandedFn = useFolderTreeStore((state) => state.isFolderExpanded);
  const isFolderLoadingFn = useFolderTreeStore((state) => state.isFolderLoading);
  const getChildFoldersFn = useFolderTreeStore((state) => state.getChildFolders);
  const upsertTreeFolderAction = useFolderTreeStore((state) => state.upsertTreeFolder);
  const removeTreeFolderAction = useFolderTreeStore((state) => state.removeTreeFolder);
  const invalidateTreeFolderAction = useFolderTreeStore((state) => state.invalidateTreeFolder);

  // Wrap actions in useCallback for stable references
  const setCurrentFolder = useCallback(
    (folderId: string | null, path: ParsedFile[]) => {
      setCurrentFolderAction(folderId, path);
    },
    [setCurrentFolderAction]
  );

  const navigateUp = useCallback(() => {
    navigateUpAction();
  }, [navigateUpAction]);

  const toggleFolderExpanded = useCallback(
    (folderId: string, forceState?: boolean) => {
      toggleFolderExpandedAction(folderId, forceState);
    },
    [toggleFolderExpandedAction]
  );

  const setTreeFolders = useCallback(
    (parentId: string, folders: ParsedFile[]) => {
      setTreeFoldersAction(parentId, folders);
    },
    [setTreeFoldersAction]
  );

  const setLoadingFolder = useCallback(
    (folderId: string, isLoading: boolean) => {
      setLoadingFolderAction(folderId, isLoading);
    },
    [setLoadingFolderAction]
  );

  const isFolderExpanded = useCallback(
    (folderId: string) => {
      return isFolderExpandedFn(folderId);
    },
    [isFolderExpandedFn]
  );

  const isFolderLoading = useCallback(
    (folderId: string) => {
      return isFolderLoadingFn(folderId);
    },
    [isFolderLoadingFn]
  );

  const getChildFolders = useCallback(
    (parentId: string) => {
      return getChildFoldersFn(parentId);
    },
    [getChildFoldersFn]
  );

  const upsertTreeFolder = useCallback(
    (parentId: string, folder: ParsedFile) => {
      upsertTreeFolderAction(parentId, folder);
    },
    [upsertTreeFolderAction]
  );

  const removeTreeFolder = useCallback(
    (parentId: string, folderId: string) => {
      removeTreeFolderAction(parentId, folderId);
    },
    [removeTreeFolderAction]
  );

  const invalidateTreeFolder = useCallback(
    (parentId: string) => {
      invalidateTreeFolderAction(parentId);
    },
    [invalidateTreeFolderAction]
  );

  // Initialize folder tree by loading root folders from API
  const initFolderTree = useCallback(async () => {
    setLoadingFolderAction('root', true);
    try {
      const fileApi = getFileApiClient();
      const showFavoritesOnly = useSortFilterStore.getState().showFavoritesOnly;
      const result = await fileApi.getFiles({
        folderId: null,
        ...(showFavoritesOnly ? { favoritesOnly: true } : {}),
      });
      if (result.success) {
        const folders = result.data.files.filter((f) => f.isFolder);
        setTreeFoldersAction('root', folders);
      }
    } catch (err) {
      console.error('Failed to load folder tree:', err);
    } finally {
      setLoadingFolderAction('root', false);
    }
  }, [setLoadingFolderAction, setTreeFoldersAction]);

  // Navigate to folder with optional folder data for breadcrumb path construction
  const navigateToFolder = useCallback(
    (folderId: string | null, folderData?: ParsedFile) => {
      if (folderId === null) {
        setCurrentFolderAction(null, []);
        return;
      }

      if (folderData) {
        const { treeFolders, folderPath: currentPath, currentFolderId } =
          useFolderTreeStore.getState();
        const cachedPath = buildPathToFolder(folderData, treeFolders);

        const isPathComplete =
          cachedPath.length > 0 && cachedPath[0].parentFolderId === null;

        if (isPathComplete) {
          setCurrentFolderAction(folderId, cachedPath);
        } else if (folderData.parentFolderId === currentFolderId) {
          setCurrentFolderAction(folderId, [...currentPath, folderData]);
        } else {
          setCurrentFolderAction(folderId, cachedPath);
        }
      } else {
        // No folder data provided - keep current path
        // This is a fallback for cases where folder data isn't available
        const currentPath = useFolderTreeStore.getState().folderPath;
        setCurrentFolderAction(folderId, currentPath);
      }
    },
    [setCurrentFolderAction]
  );

  return {
    currentFolderId,
    folderPath,
    rootFolders,
    expandedFolderIds,
    setCurrentFolder,
    navigateUp,
    toggleFolderExpanded,
    setTreeFolders,
    setLoadingFolder,
    isFolderExpanded,
    isFolderLoading,
    getChildFolders,
    initFolderTree,
    navigateToFolder,
    upsertTreeFolder,
    removeTreeFolder,
    invalidateTreeFolder,
  };
}
