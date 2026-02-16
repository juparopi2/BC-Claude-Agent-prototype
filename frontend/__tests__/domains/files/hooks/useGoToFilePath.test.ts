/**
 * useGoToFilePath Hook Tests
 *
 * Tests for the "Go to file path" navigation hook that fetches file metadata,
 * builds breadcrumb path, expands folder tree, and selects the file.
 *
 * @module __tests__/domains/files/hooks/useGoToFilePath
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useGoToFilePath } from '@/src/domains/files/hooks/useGoToFilePath';
import { resetFolderTreeStore, useFolderTreeStore } from '@/src/domains/files/stores/folderTreeStore';
import { getFileApiClient } from '@/src/infrastructure/api';
import { createMockFile, createMockFolder } from '@/__tests__/fixtures/FileFixture';

// Mock dependencies
vi.mock('@/src/infrastructure/api', () => ({
  getFileApiClient: vi.fn(),
  resetFileApiClient: vi.fn(),
}));

vi.mock('@/src/domains/files/hooks/useFileSelection', () => ({
  useFileSelection: () => ({
    selectFile: mockSelectFile,
  }),
}));

vi.mock('@/src/domains/ui', () => ({
  useUIPreferencesStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ setFileSidebarVisible: mockSetFileSidebarVisible }),
}));

// Mock callbacks
const mockSelectFile = vi.fn();
const mockSetFileSidebarVisible = vi.fn();

// Mock API client
const mockFileApi = {
  getFile: vi.fn(),
};

describe('useGoToFilePath', () => {
  beforeEach(() => {
    resetFolderTreeStore();
    vi.clearAllMocks();
    (getFileApiClient as Mock).mockReturnValue(mockFileApi);
  });

  describe('initial state', () => {
    it('should start with isNavigating false', () => {
      const { result } = renderHook(() => useGoToFilePath());
      expect(result.current.isNavigating).toBe(false);
    });

    it('should start with no error', () => {
      const { result } = renderHook(() => useGoToFilePath());
      expect(result.current.error).toBeNull();
    });
  });

  describe('goToFilePath - root level file', () => {
    it('should navigate to root when file has no parentFolderId', async () => {
      const rootFile = createMockFile({
        id: 'FILE-001',
        parentFolderId: null,
      });

      mockFileApi.getFile.mockResolvedValue({
        success: true,
        data: { file: rootFile },
      });

      const { result } = renderHook(() => useGoToFilePath());

      let success: boolean = false;
      await act(async () => {
        success = await result.current.goToFilePath('FILE-001');
      });

      expect(success).toBe(true);
      // Should set currentFolderId to null (root)
      const state = useFolderTreeStore.getState();
      expect(state.currentFolderId).toBeNull();
      expect(state.folderPath).toEqual([]);
      // Should select the file
      expect(mockSelectFile).toHaveBeenCalledWith('FILE-001', false);
      // Should show sidebar
      expect(mockSetFileSidebarVisible).toHaveBeenCalledWith(true);
    });
  });

  describe('goToFilePath - nested file', () => {
    it('should build correct breadcrumb and expand folder tree', async () => {
      // Setup: file in Folder B (child of Folder A at root)
      const folderA = createMockFolder({
        id: 'FOLDER-A',
        name: 'Folder A',
        parentFolderId: null,
      });
      const folderB = createMockFolder({
        id: 'FOLDER-B',
        name: 'Folder B',
        parentFolderId: 'FOLDER-A',
      });
      const file = createMockFile({
        id: 'FILE-001',
        name: 'document.pdf',
        parentFolderId: 'FOLDER-B',
      });

      // Pre-populate cache with root folders
      act(() => {
        useFolderTreeStore.getState().setTreeFolders('root', [folderA]);
        useFolderTreeStore.getState().setTreeFolders('FOLDER-A', [folderB]);
      });

      // Mock API: first call returns file, second returns parent folder B
      mockFileApi.getFile
        .mockResolvedValueOnce({ success: true, data: { file } })
        .mockResolvedValueOnce({ success: true, data: { file: folderB } });

      const { result } = renderHook(() => useGoToFilePath());

      let success: boolean = false;
      await act(async () => {
        success = await result.current.goToFilePath('FILE-001');
      });

      expect(success).toBe(true);

      // Verify breadcrumb path: [Folder A, Folder B]
      const state = useFolderTreeStore.getState();
      expect(state.currentFolderId).toBe('FOLDER-B');
      expect(state.folderPath).toHaveLength(2);
      expect(state.folderPath[0].id).toBe('FOLDER-A');
      expect(state.folderPath[1].id).toBe('FOLDER-B');

      // Verify folders are expanded in the tree sidebar
      expect(state.expandedFolderIds).toContain('FOLDER-A');
      expect(state.expandedFolderIds).toContain('FOLDER-B');

      // Verify file is selected
      expect(mockSelectFile).toHaveBeenCalledWith('FILE-001', false);
    });

    it('should use API fallback when parent is not in cache', async () => {
      // Setup: file in a deep folder, nothing in cache
      const folderA = createMockFolder({
        id: 'FOLDER-A',
        name: 'Folder A',
        parentFolderId: null,
      });
      const folderB = createMockFolder({
        id: 'FOLDER-B',
        name: 'Folder B',
        parentFolderId: 'FOLDER-A',
      });
      const file = createMockFile({
        id: 'FILE-001',
        parentFolderId: 'FOLDER-B',
      });

      // Mock API: file -> parent folder B -> grandparent folder A (via async path builder)
      mockFileApi.getFile
        .mockResolvedValueOnce({ success: true, data: { file } })         // getFile(FILE-001)
        .mockResolvedValueOnce({ success: true, data: { file: folderB } }) // getFile(FOLDER-B)
        .mockResolvedValueOnce({ success: true, data: { file: folderA } }); // getFile(FOLDER-A) via buildPathToFolderAsync

      const { result } = renderHook(() => useGoToFilePath());

      let success: boolean = false;
      await act(async () => {
        success = await result.current.goToFilePath('FILE-001');
      });

      expect(success).toBe(true);

      const state = useFolderTreeStore.getState();
      expect(state.currentFolderId).toBe('FOLDER-B');
      // Path should include both folders
      expect(state.folderPath).toHaveLength(2);
      expect(state.folderPath[0].id).toBe('FOLDER-A');
      expect(state.folderPath[1].id).toBe('FOLDER-B');
    });
  });

  describe('goToFilePath - error handling', () => {
    it('should return false and set error when file fetch fails', async () => {
      mockFileApi.getFile.mockResolvedValue({
        success: false,
        error: { message: 'File not found' },
      });

      const { result } = renderHook(() => useGoToFilePath());

      let success: boolean = true;
      await act(async () => {
        success = await result.current.goToFilePath('MISSING-FILE');
      });

      expect(success).toBe(false);
      expect(result.current.error).toBe('File not found');
      expect(result.current.isNavigating).toBe(false);
    });

    it('should return false and set error on API exception', async () => {
      mockFileApi.getFile.mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => useGoToFilePath());

      let success: boolean = true;
      await act(async () => {
        success = await result.current.goToFilePath('FILE-001');
      });

      expect(success).toBe(false);
      expect(result.current.error).toBe('Network error');
      expect(result.current.isNavigating).toBe(false);
    });

    it('should handle parent folder fetch failure gracefully', async () => {
      const file = createMockFile({
        id: 'FILE-001',
        parentFolderId: 'FOLDER-B',
      });

      // File fetch succeeds, but parent folder fetch fails
      mockFileApi.getFile
        .mockResolvedValueOnce({ success: true, data: { file } })
        .mockResolvedValueOnce({ success: false, error: { message: 'Folder not found' } });

      const { result } = renderHook(() => useGoToFilePath());

      let success: boolean = false;
      await act(async () => {
        success = await result.current.goToFilePath('FILE-001');
      });

      // Should still succeed - navigation works even with empty breadcrumb
      expect(success).toBe(true);
      const state = useFolderTreeStore.getState();
      expect(state.currentFolderId).toBe('FOLDER-B');
      // Path will be empty since parent couldn't be fetched
      expect(state.folderPath).toEqual([]);
    });
  });

  describe('isNavigating state', () => {
    it('should be true during navigation', async () => {
      let resolveGetFile: ((value: unknown) => void) | undefined;
      const pendingPromise = new Promise((resolve) => {
        resolveGetFile = resolve;
      });
      mockFileApi.getFile.mockReturnValue(pendingPromise);

      const { result } = renderHook(() => useGoToFilePath());

      // Start navigation (don't await)
      let navigationPromise: Promise<boolean>;
      act(() => {
        navigationPromise = result.current.goToFilePath('FILE-001');
      });

      // Should be navigating
      expect(result.current.isNavigating).toBe(true);

      // Resolve the API call
      await act(async () => {
        resolveGetFile!({
          success: true,
          data: { file: createMockFile({ id: 'FILE-001', parentFolderId: null }) },
        });
        await navigationPromise!;
      });

      // Should no longer be navigating
      expect(result.current.isNavigating).toBe(false);
    });
  });
});
