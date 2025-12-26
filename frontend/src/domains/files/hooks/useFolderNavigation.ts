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
import { getFileApiClient } from '@/lib/services/fileApi';
import type { ParsedFile } from '@bc-agent/shared';

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
  /** Navigate to folder (simplified - just sets ID, use with fetchFiles) */
  navigateToFolder: (folderId: string | null) => void;
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
  const getRootFolders = useFolderTreeStore((state) => state.getRootFolders);
  const isFolderExpandedFn = useFolderTreeStore((state) => state.isFolderExpanded);
  const isFolderLoadingFn = useFolderTreeStore((state) => state.isFolderLoading);
  const getChildFoldersFn = useFolderTreeStore((state) => state.getChildFolders);

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

  // Initialize folder tree by loading root folders from API
  const initFolderTree = useCallback(async () => {
    setLoadingFolderAction('root', true);
    try {
      const fileApi = getFileApiClient();
      const result = await fileApi.getFiles({
        folderId: undefined, // root level
      });
      if (result.success) {
        // Filter only folders for the tree
        const folders = result.data.files.filter((f) => f.isFolder);
        setTreeFoldersAction('root', folders);
      }
    } catch (err) {
      console.error('Failed to load folder tree:', err);
    } finally {
      setLoadingFolderAction('root', false);
    }
  }, [setLoadingFolderAction, setTreeFoldersAction]);

  // Navigate to folder (simplified - just sets the current folder ID and clears path if going to root)
  const navigateToFolder = useCallback(
    (folderId: string | null) => {
      if (folderId === null) {
        setCurrentFolderAction(null, []);
      } else {
        // For now, just set the folder ID without full path
        // Components can update the path as needed
        setCurrentFolderAction(folderId, folderPath);
      }
    },
    [setCurrentFolderAction, folderPath]
  );

  return {
    currentFolderId,
    folderPath,
    rootFolders: getRootFolders(),
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
  };
}
