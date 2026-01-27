/**
 * useFileActions Hook
 *
 * Hook for file CRUD operations: create folder, delete, rename, download.
 * Coordinates with fileListStore and folderTreeStore for state updates.
 *
 * @module domains/files/hooks/useFileActions
 */

import { useState, useCallback } from 'react';
import { useFileListStore } from '../stores/fileListStore';
import { useFolderTreeStore } from '../stores/folderTreeStore';
import { getFileApiClient } from '@/src/infrastructure/api';
import type { ParsedFile } from '@bc-agent/shared';

/**
 * useFileActions return type
 */
export interface UseFileActionsReturn {
  /** Create a new folder */
  createFolder: (name: string, parentFolderId: string | null) => Promise<ParsedFile | null>;
  /** Delete files or folders by IDs */
  deleteFiles: (fileIds: string[]) => Promise<boolean>;
  /** Rename a file or folder */
  renameFile: (fileId: string, newName: string) => Promise<ParsedFile | null>;
  /** Download a file */
  downloadFile: (fileId: string, fileName: string) => Promise<void>;
  /** Loading state */
  isLoading: boolean;
  /** Error message if any */
  error: string | null;
  /** Clear error */
  clearError: () => void;
}

/**
 * Hook for file CRUD operations
 *
 * Provides methods for creating folders, deleting files, renaming, and downloading.
 * Automatically updates fileListStore and folderTreeStore after successful operations.
 *
 * @example
 * ```tsx
 * function FileActions() {
 *   const { createFolder, deleteFiles, isLoading, error } = useFileActions();
 *
 *   const handleCreateFolder = async () => {
 *     const folder = await createFolder('New Folder', currentFolderId);
 *     if (folder) {
 *       console.log('Created:', folder.name);
 *     }
 *   };
 *
 *   const handleDelete = async (ids: string[]) => {
 *     if (await deleteFiles(ids)) {
 *       console.log('Deleted successfully');
 *     }
 *   };
 *
 *   return (
 *     <>
 *       <button onClick={handleCreateFolder} disabled={isLoading}>
 *         New Folder
 *       </button>
 *       {error && <p className="text-red-500">{error}</p>}
 *     </>
 *   );
 * }
 * ```
 */
export function useFileActions(): UseFileActionsReturn {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Get store actions
  const addFile = useFileListStore((state) => state.addFile);
  const updateFileInStore = useFileListStore((state) => state.updateFile);
  const deleteFilesFromStore = useFileListStore((state) => state.deleteFiles);
  const markAsDeleting = useFileListStore((state) => state.markAsDeleting);
  const cancelDeletion = useFileListStore((state) => state.cancelDeletion);
  const files = useFileListStore((state) => state.files);

  // Get folder tree store for updating tree when folders change
  const setTreeFolders = useFolderTreeStore((state) => state.setTreeFolders);
  const getChildFolders = useFolderTreeStore((state) => state.getChildFolders);
  const currentFolderId = useFolderTreeStore((state) => state.currentFolderId);

  /**
   * Clear error state
   */
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  /**
   * Create a new folder
   *
   * @param name - Folder name
   * @param parentFolderId - Parent folder ID (null for root)
   * @returns Created folder or null on error
   */
  const createFolder = useCallback(
    async (name: string, parentFolderId: string | null): Promise<ParsedFile | null> => {
      setIsLoading(true);
      setError(null);

      try {
        const fileApi = getFileApiClient();
        const result = await fileApi.createFolder({
          name,
          parentFolderId: parentFolderId ?? undefined,
        });

        if (result.success) {
          const newFolder = result.data.folder;

          // Add to file list if we're in the same folder
          if (parentFolderId === currentFolderId) {
            addFile(newFolder);
          }

          // Update folder tree cache
          const cacheKey = parentFolderId || 'root';
          const currentChildren = getChildFolders(cacheKey);
          setTreeFolders(cacheKey, [...currentChildren, newFolder]);

          return newFolder;
        } else {
          setError(result.error.message);
          return null;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to create folder';
        setError(message);
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [addFile, setTreeFolders, getChildFolders, currentFolderId]
  );

  /**
   * Delete files or folders (two-phase soft delete)
   *
   * Phase 1 (Synchronous): Marks files for deletion in DB
   * - Files immediately hidden from queries and RAG searches
   * - Returns 200 OK when marking is complete
   *
   * Phase 2 (Async): Physical deletion via queue workers
   * - Deletion status emitted via WebSocket (see useFileDeleteEvents)
   *
   * This eliminates the race condition where files reappear after refresh.
   *
   * @param fileIds - Array of file/folder IDs to delete
   * @returns true if files were marked for deletion, false on error
   */
  const deleteFiles = useCallback(
    async (fileIds: string[]): Promise<boolean> => {
      if (fileIds.length === 0) return true;

      setIsLoading(true);
      setError(null);

      // Mark files as "deleting" in UI (shows overlay)
      markAsDeleting(fileIds);

      try {
        const fileApi = getFileApiClient();

        // Use bulk delete endpoint (returns 200 OK with SoftDeleteResult)
        const result = await fileApi.deleteFilesBatch({ fileIds });

        if (!result.success) {
          // Revert UI state on error
          cancelDeletion(fileIds);
          setError(result.error.message);
          return false;
        }

        // Phase 1 complete - files are now marked for deletion
        // They won't reappear even if user refreshes
        // Phase 2 (physical deletion) happens async via queue workers
        // WebSocket events will notify when each file is actually deleted

        // Find which files are folders before removing from store
        const deletedFolderIds = files
          .filter((f) => fileIds.includes(f.id) && f.isFolder)
          .map((f) => f.id);

        // Remove from file list store (files are hidden from server queries anyway)
        deleteFilesFromStore(fileIds);

        // Update folder tree cache - remove deleted folders from their parents
        if (deletedFolderIds.length > 0) {
          deletedFolderIds.forEach((folderId) => {
            const file = files.find((f) => f.id === folderId);
            if (file) {
              const cacheKey = file.parentFolderId || 'root';
              const currentChildren = getChildFolders(cacheKey);
              setTreeFolders(
                cacheKey,
                currentChildren.filter((f) => f.id !== folderId)
              );
            }
          });
        }

        return true;
      } catch (err) {
        // Revert UI state on error
        cancelDeletion(fileIds);
        const message = err instanceof Error ? err.message : 'Failed to delete files';
        setError(message);
        return false;
      } finally {
        setIsLoading(false);
      }
    },
    [files, markAsDeleting, cancelDeletion, deleteFilesFromStore, setTreeFolders, getChildFolders]
  );

  /**
   * Rename a file or folder
   *
   * @param fileId - File/folder ID
   * @param newName - New name
   * @returns Updated file or null on error
   */
  const renameFile = useCallback(
    async (fileId: string, newName: string): Promise<ParsedFile | null> => {
      setIsLoading(true);
      setError(null);

      try {
        const fileApi = getFileApiClient();
        const result = await fileApi.updateFile(fileId, { name: newName });

        if (result.success) {
          const updatedFile = result.data.file;

          // Update in file list store
          updateFileInStore(fileId, { name: updatedFile.name });

          // If it's a folder, update in tree cache
          const file = files.find((f) => f.id === fileId);
          if (file?.isFolder) {
            const cacheKey = file.parentFolderId || 'root';
            const currentChildren = getChildFolders(cacheKey);
            setTreeFolders(
              cacheKey,
              currentChildren.map((f) =>
                f.id === fileId ? { ...f, name: updatedFile.name } : f
              )
            );
          }

          return updatedFile;
        } else {
          setError(result.error.message);
          return null;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to rename file';
        setError(message);
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [files, updateFileInStore, setTreeFolders, getChildFolders]
  );

  /**
   * Download a file
   *
   * Creates a temporary link and triggers download in browser.
   *
   * @param fileId - File ID to download
   * @param fileName - Name for the downloaded file
   */
  const downloadFile = useCallback(
    async (fileId: string, fileName: string): Promise<void> => {
      setIsLoading(true);
      setError(null);

      try {
        const fileApi = getFileApiClient();
        const result = await fileApi.downloadFile(fileId);

        if (result.success) {
          // Create blob URL and trigger download
          const url = URL.createObjectURL(result.data);
          const a = document.createElement('a');
          a.href = url;
          a.download = fileName;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        } else {
          setError(result.error.message);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to download file';
        setError(message);
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  return {
    createFolder,
    deleteFiles,
    renameFile,
    downloadFile,
    isLoading,
    error,
    clearError,
  };
}
