/**
 * useFiles Hook
 *
 * Hook for file list functionality with sorting and API operations.
 * Combines fileListStore and sortFilterStore for sorted file display.
 *
 * @module domains/files/hooks/useFiles
 */

import { useMemo, useCallback } from 'react';
import { useFileListStore } from '../stores/fileListStore';
import { useSortFilterStore } from '../stores/sortFilterStore';
import { useFolderTreeStore } from '../stores/folderTreeStore';
import { getFileApiClient } from '@/src/infrastructure/api';
import type { ParsedFile, FileSortBy, SortOrder } from '@bc-agent/shared';

/**
 * useFiles return type
 */
export interface UseFilesReturn {
  /** Files sorted by current sort preferences (folders first) */
  sortedFiles: ParsedFile[];
  /** Loading state */
  isLoading: boolean;
  /** Error message if any */
  error: string | null;
  /** Whether more files can be loaded */
  hasMore: boolean;
  /** Total file count */
  totalFiles: number;
  /** Current sort field */
  sortBy: FileSortBy;
  /** Current sort order */
  sortOrder: SortOrder;
  /** Whether showing only favorites */
  showFavoritesOnly: boolean;
  /** Set sort field and optionally order */
  setSort: (sortBy: FileSortBy, sortOrder?: SortOrder) => void;
  /** Toggle sort order */
  toggleSortOrder: () => void;
  /** Toggle favorites filter */
  toggleFavoritesFilter: () => void;
  /** Fetch files from API for a folder */
  fetchFiles: (folderId?: string | null) => Promise<void>;
  /** Refresh current folder */
  refreshCurrentFolder: () => Promise<void>;
  /** Toggle favorite status for a file */
  toggleFavorite: (fileId: string) => Promise<void>;
}

/**
 * Sort files with folders first, then by specified field
 */
function sortFiles(
  files: ParsedFile[],
  sortBy: FileSortBy,
  sortOrder: SortOrder
): ParsedFile[] {
  return [...files].sort((a, b) => {
    // Folders always first
    if (a.isFolder && !b.isFolder) return -1;
    if (!a.isFolder && b.isFolder) return 1;

    // Apply sort field
    let comparison = 0;
    switch (sortBy) {
      case 'name':
        comparison = a.name.localeCompare(b.name);
        break;
      case 'date':
        comparison = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
        break;
      case 'size':
        comparison = a.sizeBytes - b.sizeBytes;
        break;
    }

    return sortOrder === 'asc' ? comparison : -comparison;
  });
}

/**
 * Hook for managing file list with sorting
 *
 * Provides sorted files and sort controls.
 * Sorting is done client-side for immediate response.
 *
 * @example
 * ```tsx
 * function FileList() {
 *   const {
 *     sortedFiles,
 *     isLoading,
 *     sortBy,
 *     setSort
 *   } = useFiles();
 *
 *   if (isLoading) return <Spinner />;
 *
 *   return (
 *     <>
 *       <SortControls sortBy={sortBy} onSort={setSort} />
 *       {sortedFiles.map(file => <FileItem key={file.id} file={file} />)}
 *     </>
 *   );
 * }
 * ```
 */
export function useFiles(): UseFilesReturn {
  // Get file list state
  const files = useFileListStore((state) => state.files);
  const isLoading = useFileListStore((state) => state.isLoading);
  const error = useFileListStore((state) => state.error);
  const hasMore = useFileListStore((state) => state.hasMore);
  const totalFiles = useFileListStore((state) => state.totalFiles);

  // Get file list actions
  const setFiles = useFileListStore((state) => state.setFiles);
  const setLoading = useFileListStore((state) => state.setLoading);
  const setError = useFileListStore((state) => state.setError);
  const updateFile = useFileListStore((state) => state.updateFile);

  // Get current folder from folder tree store
  const currentFolderId = useFolderTreeStore((state) => state.currentFolderId);

  // Get sort/filter state and actions
  const sortBy = useSortFilterStore((state) => state.sortBy);
  const sortOrder = useSortFilterStore((state) => state.sortOrder);
  const showFavoritesOnly = useSortFilterStore((state) => state.showFavoritesOnly);
  const setSort = useSortFilterStore((state) => state.setSort);
  const toggleSortOrder = useSortFilterStore((state) => state.toggleSortOrder);
  const toggleFavoritesFilter = useSortFilterStore((state) => state.toggleFavoritesFilter);

  // Memoize sorted files
  const sortedFiles = useMemo(
    () => sortFiles(files, sortBy, sortOrder),
    [files, sortBy, sortOrder]
  );

  // Fetch files from API
  const fetchFiles = useCallback(
    async (folderId?: string | null) => {
      setLoading(true);
      setError(null);
      try {
        const fileApi = getFileApiClient();
        const result = await fileApi.getFiles({
          folderId: folderId ?? undefined,
        });
        if (result.success) {
          const { files: fetchedFiles, pagination } = result.data;
          const hasMoreFiles = pagination.offset + fetchedFiles.length < pagination.total;
          setFiles(
            fetchedFiles,
            pagination.total,
            hasMoreFiles
          );
        } else {
          setError(result.error.message);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch files');
      } finally {
        setLoading(false);
      }
    },
    [setFiles, setLoading, setError]
  );

  // Refresh current folder
  const refreshCurrentFolder = useCallback(async () => {
    await fetchFiles(currentFolderId);
  }, [fetchFiles, currentFolderId]);

  // Toggle favorite status
  const toggleFavorite = useCallback(
    async (fileId: string) => {
      const file = files.find((f) => f.id === fileId);
      if (!file) return;

      try {
        const fileApi = getFileApiClient();
        const result = await fileApi.updateFile(fileId, {
          isFavorite: !file.isFavorite,
        });
        if (result.success) {
          updateFile(fileId, { isFavorite: result.data.file.isFavorite });
        }
      } catch (err) {
        console.error('Failed to toggle favorite:', err);
      }
    },
    [files, updateFile]
  );

  return {
    sortedFiles,
    isLoading,
    error,
    hasMore,
    totalFiles,
    sortBy,
    sortOrder,
    showFavoritesOnly,
    setSort,
    toggleSortOrder,
    toggleFavoritesFilter,
    fetchFiles,
    refreshCurrentFolder,
    toggleFavorite,
  };
}
