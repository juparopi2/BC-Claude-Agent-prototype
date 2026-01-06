/**
 * Files Domain Integration Tests
 *
 * Tests that verify correct coordination between hooks and stores.
 * These tests ensure the domain layer works correctly as a whole.
 *
 * @module __tests__/domains/files/integration/fileFlow
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Hooks
import { useFiles } from '@/src/domains/files/hooks/useFiles';
import { useFileUpload } from '@/src/domains/files/hooks/useFileUpload';
import { useFileSelection } from '@/src/domains/files/hooks/useFileSelection';
import { useFolderNavigation } from '@/src/domains/files/hooks/useFolderNavigation';

// Stores and reset functions
import { useFileListStore, resetFileListStore } from '@/src/domains/files/stores/fileListStore';
import { useUploadStore, resetUploadStore } from '@/src/domains/files/stores/uploadStore';
import { useSortFilterStore, resetSortFilterStore } from '@/src/domains/files/stores/sortFilterStore';
import { useSelectionStore, resetSelectionStore } from '@/src/domains/files/stores/selectionStore';
import { useFolderTreeStore, resetFolderTreeStore } from '@/src/domains/files/stores/folderTreeStore';

// Test fixtures
import { createMockFile, createMockFolder } from '@/__tests__/fixtures/FileFixture';

describe('Files Domain Integration', () => {
  beforeEach(() => {
    resetFileListStore();
    resetUploadStore();
    resetSortFilterStore();
    resetSelectionStore();
    resetFolderTreeStore();
  });

  describe('useFiles + fileListStore + sortFilterStore', () => {
    it('should return sorted files combining fileListStore and sortFilterStore', () => {
      // Set up files in fileListStore
      const files = [
        createMockFile({ id: 'file-3', name: 'charlie.txt' }),
        createMockFile({ id: 'file-1', name: 'alpha.txt' }),
        createMockFile({ id: 'file-2', name: 'bravo.txt' }),
      ];

      act(() => {
        useFileListStore.getState().setFiles(files, 3, false);
        useSortFilterStore.getState().setSort('name', 'asc');
      });

      const { result } = renderHook(() => useFiles());

      // Files should be sorted by name ascending
      expect(result.current.sortedFiles[0].name).toBe('alpha.txt');
      expect(result.current.sortedFiles[1].name).toBe('bravo.txt');
      expect(result.current.sortedFiles[2].name).toBe('charlie.txt');
    });

    it('should expose showFavoritesFirst state for component display', () => {
      const files = [
        createMockFile({ id: 'file-1', name: 'favorite.txt', isFavorite: true }),
        createMockFile({ id: 'file-2', name: 'normal.txt', isFavorite: false }),
        createMockFile({ id: 'file-3', name: 'favorite2.txt', isFavorite: true }),
      ];

      act(() => {
        useFileListStore.getState().setFiles(files, 3, false);
        useSortFilterStore.getState().setShowFavoritesFirst(true);
      });

      const { result } = renderHook(() => useFiles());

      // Hook exposes the favorites-first state
      expect(result.current.showFavoritesFirst).toBe(true);

      // With favorites-first, favorites should be sorted first
      const favoriteFiles = result.current.sortedFiles.filter((f) => f.isFavorite);
      expect(favoriteFiles).toHaveLength(2);
      expect(favoriteFiles.every((f) => f.isFavorite)).toBe(true);
    });

    it('should put folders first regardless of sort field', () => {
      const files = [
        createMockFile({ id: 'file-1', name: 'zebra.txt' }),
        createMockFolder({ id: 'folder-1', name: 'alpha-folder' }),
        createMockFile({ id: 'file-2', name: 'apple.txt' }),
        createMockFolder({ id: 'folder-2', name: 'beta-folder' }),
      ];

      act(() => {
        useFileListStore.getState().setFiles(files, 4, false);
        useSortFilterStore.getState().setSort('name', 'asc');
      });

      const { result } = renderHook(() => useFiles());

      // First two should be folders
      expect(result.current.sortedFiles[0].isFolder).toBe(true);
      expect(result.current.sortedFiles[1].isFolder).toBe(true);
      // Folders should be sorted among themselves
      expect(result.current.sortedFiles[0].name).toBe('alpha-folder');
      expect(result.current.sortedFiles[1].name).toBe('beta-folder');
    });
  });

  describe('useFileUpload + uploadStore + fileListStore', () => {
    it('should update fileListStore when upload completes via uploadStore', () => {
      const uploadedFile = createMockFile({ id: 'uploaded-1', name: 'uploaded.txt' });

      // Simulate initial file list
      act(() => {
        useFileListStore.getState().setFiles([createMockFile({ id: 'existing-1' })], 1, false);
      });

      // Render both hooks
      const { result: filesResult } = renderHook(() => useFiles());
      const { result: uploadResult } = renderHook(() => useFileUpload());

      // Simulate upload process via store (as hook would do)
      act(() => {
        const mockFile = new File(['test'], 'uploaded.txt', { type: 'text/plain' });
        useUploadStore.getState().addToQueue([mockFile]);
      });

      const itemId = useUploadStore.getState().queue[0].id;

      act(() => {
        useUploadStore.getState().startUpload(itemId);
        useUploadStore.getState().updateProgress(itemId, 50);
      });

      expect(uploadResult.current.isUploading).toBe(true);
      expect(uploadResult.current.overallProgress).toBe(50);

      // Complete upload and add to file list
      act(() => {
        useUploadStore.getState().completeUpload(itemId, uploadedFile);
        useFileListStore.getState().addFile(uploadedFile);
      });

      // File list should now include uploaded file
      expect(filesResult.current.sortedFiles).toHaveLength(2);
      expect(filesResult.current.sortedFiles.some((f) => f.id === 'uploaded-1')).toBe(true);
    });

    it('should update upload progress across multiple files', () => {
      const { result: uploadResult } = renderHook(() => useFileUpload());

      act(() => {
        const files = [
          new File(['test1'], 'file1.txt', { type: 'text/plain' }),
          new File(['test2'], 'file2.txt', { type: 'text/plain' }),
        ];
        uploadResult.current.addToQueue(files);
      });

      const queue = useUploadStore.getState().queue;

      // Update progress for first file
      act(() => {
        useUploadStore.getState().updateProgress(queue[0].id, 100);
      });

      // Overall progress should be 50% (1 of 2 files done)
      expect(uploadResult.current.overallProgress).toBe(50);

      // Update progress for second file
      act(() => {
        useUploadStore.getState().updateProgress(queue[1].id, 50);
      });

      // Overall progress should be 75% ((100 + 50) / 2)
      expect(uploadResult.current.overallProgress).toBe(75);
    });
  });

  describe('useFileSelection + selectionStore + fileListStore', () => {
    it('should return full file objects for selected IDs', () => {
      const files = [
        createMockFile({ id: 'file-1', name: 'first.txt' }),
        createMockFile({ id: 'file-2', name: 'second.txt' }),
        createMockFile({ id: 'file-3', name: 'third.txt' }),
      ];

      act(() => {
        useFileListStore.getState().setFiles(files, 3, false);
      });

      const { result } = renderHook(() => useFileSelection());

      // Select two files
      act(() => {
        result.current.selectFile('file-1', false);
        result.current.selectFile('file-2', true); // multi-select
      });

      expect(result.current.selectedFiles).toHaveLength(2);
      expect(result.current.selectedFiles.map((f) => f.name)).toEqual(
        expect.arrayContaining(['first.txt', 'second.txt'])
      );
    });

    it('should clear selection when clearSelection is called', () => {
      const files = [
        createMockFile({ id: 'file-1' }),
        createMockFile({ id: 'file-2' }),
      ];

      act(() => {
        useFileListStore.getState().setFiles(files, 2, false);
      });

      const { result } = renderHook(() => useFileSelection());

      act(() => {
        result.current.selectAll();
      });

      expect(result.current.selectedCount).toBe(2);

      act(() => {
        result.current.clearSelection();
      });

      expect(result.current.selectedCount).toBe(0);
      expect(result.current.hasSelection).toBe(false);
    });
  });

  describe('useFolderNavigation + folderTreeStore', () => {
    it('should lazy-load children when expanding folder', () => {
      const rootFolders = [
        createMockFolder({ id: 'folder-1', name: 'Documents' }),
        createMockFolder({ id: 'folder-2', name: 'Pictures' }),
      ];

      const childFolders = [
        createMockFolder({ id: 'child-1', name: 'Work', parentFolderId: 'folder-1' }),
        createMockFolder({ id: 'child-2', name: 'Personal', parentFolderId: 'folder-1' }),
      ];

      // Set up root folders
      act(() => {
        useFolderTreeStore.getState().setTreeFolders('root', rootFolders);
      });

      const { result } = renderHook(() => useFolderNavigation());

      // Root folders should be available
      expect(result.current.rootFolders).toHaveLength(2);

      // Expand folder-1 and simulate loading children
      act(() => {
        useFolderTreeStore.getState().toggleFolderExpanded('folder-1');
        useFolderTreeStore.getState().setTreeFolders('folder-1', childFolders);
      });

      // Should be able to get children
      expect(result.current.getChildFolders('folder-1')).toHaveLength(2);
      expect(result.current.expandedFolderIds).toContain('folder-1');
    });

    it('should update folder path on navigation', () => {
      const folder = createMockFolder({ id: 'folder-1', name: 'Documents' });
      const subfolder = createMockFolder({
        id: 'folder-2',
        name: 'Work',
        parentFolderId: 'folder-1',
      });

      const { result } = renderHook(() => useFolderNavigation());

      // Navigate to subfolder with path
      act(() => {
        result.current.setCurrentFolder('folder-2', [folder, subfolder]);
      });

      expect(result.current.currentFolderId).toBe('folder-2');
      expect(result.current.folderPath).toHaveLength(2);
      expect(result.current.folderPath[0].name).toBe('Documents');
      expect(result.current.folderPath[1].name).toBe('Work');
    });

    it('should return to root when navigating up from first level', () => {
      const folder = createMockFolder({ id: 'folder-1', name: 'Documents' });

      const { result } = renderHook(() => useFolderNavigation());

      // Navigate to folder
      act(() => {
        result.current.setCurrentFolder('folder-1', [folder]);
      });

      expect(result.current.currentFolderId).toBe('folder-1');

      // Navigate up
      act(() => {
        result.current.navigateUp();
      });

      expect(result.current.currentFolderId).toBeNull();
      expect(result.current.folderPath).toHaveLength(0);
    });
  });
});
