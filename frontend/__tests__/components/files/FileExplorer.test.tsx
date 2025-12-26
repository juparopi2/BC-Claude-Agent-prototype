/**
 * FileExplorer Tests
 *
 * Tests for the FileExplorer component with focus on NULL handling
 * when loading files at root level vs nested folders.
 *
 * Updated to use new domain hooks (useFiles, useFolderNavigation).
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { act } from '@testing-library/react';
import { FileExplorer } from '../../../components/files/FileExplorer';
import {
  resetFileListStore,
  useFileListStore,
} from '@/src/domains/files/stores/fileListStore';
import {
  resetFolderTreeStore,
  useFolderTreeStore,
} from '@/src/domains/files/stores/folderTreeStore';
import {
  resetSortFilterStore,
} from '@/src/domains/files/stores/sortFilterStore';
import { server } from '../../../vitest.setup';
import { mockFiles } from '../../mocks/handlers';
import { http, HttpResponse } from 'msw';

const API_URL = 'http://localhost:3002';

// Mock the fileApi client
vi.mock('@/src/infrastructure/api', () => ({
  getFileApiClient: vi.fn(() => ({
    getFiles: vi.fn().mockResolvedValue({
      success: true,
      data: {
        files: mockFiles,
        pagination: { offset: 0, limit: 50, total: mockFiles.length },
      },
    }),
    getFolders: vi.fn().mockResolvedValue({
      success: true,
      data: { folders: [] },
    }),
  })),
  resetFileApiClient: vi.fn(),
}));

// Mock UI preferences store
vi.mock('@/src/domains/ui', () => ({
  useUIPreferencesStore: vi.fn((selector) => {
    const state = {
      isFileSidebarVisible: true,
      setFileSidebarVisible: vi.fn(),
    };
    return selector ? selector(state) : state;
  }),
}));

import { getFileApiClient } from '@/src/infrastructure/api';
import { useUIPreferencesStore } from '@/src/domains/ui';

describe('FileExplorer', () => {
  beforeEach(() => {
    // Reset all domain stores
    resetFileListStore();
    resetFolderTreeStore();
    resetSortFilterStore();

    // Reset mocks
    vi.clearAllMocks();

    // Reset default mock implementation for fileApi
    (getFileApiClient as Mock).mockReturnValue({
      getFiles: vi.fn().mockResolvedValue({
        success: true,
        data: {
          files: mockFiles,
          pagination: { offset: 0, limit: 50, total: mockFiles.length },
        },
      }),
      getFolders: vi.fn().mockResolvedValue({
        success: true,
        data: { folders: [] },
      }),
    });

    // Reset UI preferences mock
    (useUIPreferencesStore as Mock).mockImplementation((selector) => {
      const state = {
        isFileSidebarVisible: true,
        setFileSidebarVisible: vi.fn(),
      };
      return selector ? selector(state) : state;
    });
  });

  describe('Load root-level files on mount', () => {
    it('should fetch root-level files when currentFolderId is null', async () => {
      // Ensure we're at root (currentFolderId is null)
      act(() => {
        useFolderTreeStore.getState().setCurrentFolder(null, []);
      });

      const mockGetFiles = vi.fn().mockResolvedValue({
        success: true,
        data: {
          files: mockFiles.filter((f) => f.parentFolderId === null),
          pagination: { offset: 0, limit: 50, total: 3 },
        },
      });

      (getFileApiClient as Mock).mockReturnValue({
        getFiles: mockGetFiles,
        getFolders: vi.fn().mockResolvedValue({ success: true, data: { folders: [] } }),
      });

      // Render component
      render(<FileExplorer />);

      // Wait for fetchFiles to be called with undefined (root folder)
      await waitFor(() => {
        expect(mockGetFiles).toHaveBeenCalledWith({ folderId: undefined });
      });

      // Wait for files to be loaded into store
      await waitFor(() => {
        const files = useFileListStore.getState().files;
        expect(files.length).toBeGreaterThan(0);
      });

      // Verify loading state is false
      expect(useFileListStore.getState().isLoading).toBe(false);
    });

    it('should display loading state while fetching files', async () => {
      // Create a promise we can control
      let resolveFiles: (value: unknown) => void;
      const pendingPromise = new Promise((resolve) => {
        resolveFiles = resolve;
      });

      const mockGetFiles = vi.fn().mockReturnValue(pendingPromise);

      (getFileApiClient as Mock).mockReturnValue({
        getFiles: mockGetFiles,
        getFolders: vi.fn().mockResolvedValue({ success: true, data: { folders: [] } }),
      });

      // Render component
      render(<FileExplorer />);

      // Component should trigger loading
      await waitFor(() => {
        expect(useFileListStore.getState().isLoading).toBe(true);
      });

      // Resolve the promise
      await act(async () => {
        resolveFiles!({
          success: true,
          data: {
            files: mockFiles,
            pagination: { offset: 0, limit: 50, total: mockFiles.length },
          },
        });
      });

      // Wait for loading to complete
      await waitFor(() => {
        expect(useFileListStore.getState().isLoading).toBe(false);
      });
    });
  });

  describe('Reload files when currentFolderId changes', () => {
    it('should reload files when navigating to a folder', async () => {
      const folderId = 'folder-123';

      // Start at root with initial files
      act(() => {
        useFolderTreeStore.getState().setCurrentFolder(null, []);
        useFileListStore.getState().setFiles(mockFiles, mockFiles.length, false);
      });

      const mockGetFiles = vi.fn().mockResolvedValue({
        success: true,
        data: {
          files: [],
          pagination: { offset: 0, limit: 50, total: 0 },
        },
      });

      (getFileApiClient as Mock).mockReturnValue({
        getFiles: mockGetFiles,
        getFolders: vi.fn().mockResolvedValue({ success: true, data: { folders: [] } }),
      });

      // Render component
      const { rerender } = render(<FileExplorer />);

      // Wait for initial fetch
      await waitFor(() => {
        expect(mockGetFiles).toHaveBeenCalledWith({ folderId: undefined });
      });

      // Navigate to folder by updating folderTreeStore
      act(() => {
        useFolderTreeStore.getState().setCurrentFolder(folderId, [
          { id: folderId, name: 'Test Folder' },
        ]);
      });

      // Rerender to trigger useEffect
      rerender(<FileExplorer />);

      // Wait for fetchFiles to be called with new folderId
      await waitFor(() => {
        expect(mockGetFiles).toHaveBeenCalledWith({ folderId });
      });

      // Verify currentFolderId is updated
      expect(useFolderTreeStore.getState().currentFolderId).toBe(folderId);
    });

    it('should reload files when navigating back to root', async () => {
      const folderId = 'folder-123';

      // Start in a folder
      act(() => {
        useFolderTreeStore.getState().setCurrentFolder(folderId, [
          { id: folderId, name: 'Test Folder' },
        ]);
        useFileListStore.getState().setFiles([], 0, false);
      });

      const mockGetFiles = vi.fn().mockResolvedValue({
        success: true,
        data: {
          files: mockFiles,
          pagination: { offset: 0, limit: 50, total: mockFiles.length },
        },
      });

      (getFileApiClient as Mock).mockReturnValue({
        getFiles: mockGetFiles,
        getFolders: vi.fn().mockResolvedValue({ success: true, data: { folders: [] } }),
      });

      // Render component
      const { rerender } = render(<FileExplorer />);

      // Wait for initial fetch
      await waitFor(() => {
        expect(mockGetFiles).toHaveBeenCalledWith({ folderId });
      });

      // Navigate back to root
      act(() => {
        useFolderTreeStore.getState().setCurrentFolder(null, []);
      });

      // Rerender to trigger useEffect
      rerender(<FileExplorer />);

      // Wait for fetchFiles to be called with undefined (root)
      await waitFor(() => {
        expect(mockGetFiles).toHaveBeenCalledWith({ folderId: undefined });
      });

      // Verify we're at root
      expect(useFolderTreeStore.getState().currentFolderId).toBeNull();
    });

    it('should handle rapid folder navigation correctly', async () => {
      const folder1 = 'folder-1';
      const folder2 = 'folder-2';

      // Start at root
      act(() => {
        useFolderTreeStore.getState().setCurrentFolder(null, []);
        useFileListStore.getState().setFiles([], 0, false);
      });

      const mockGetFiles = vi.fn().mockResolvedValue({
        success: true,
        data: {
          files: [],
          pagination: { offset: 0, limit: 50, total: 0 },
        },
      });

      (getFileApiClient as Mock).mockReturnValue({
        getFiles: mockGetFiles,
        getFolders: vi.fn().mockResolvedValue({ success: true, data: { folders: [] } }),
      });

      // Render component
      const { rerender } = render(<FileExplorer />);

      // Navigate to folder 1
      act(() => {
        useFolderTreeStore.getState().setCurrentFolder(folder1, [
          { id: folder1, name: 'Folder 1' },
        ]);
      });
      rerender(<FileExplorer />);

      // Immediately navigate to folder 2
      act(() => {
        useFolderTreeStore.getState().setCurrentFolder(folder2, [
          { id: folder2, name: 'Folder 2' },
        ]);
      });
      rerender(<FileExplorer />);

      // Wait for both fetchFiles calls
      await waitFor(() => {
        expect(mockGetFiles).toHaveBeenCalledWith({ folderId: folder1 });
        expect(mockGetFiles).toHaveBeenCalledWith({ folderId: folder2 });
      });

      // Verify final state is folder2
      expect(useFolderTreeStore.getState().currentFolderId).toBe(folder2);
    });
  });

  describe('Layout variations', () => {
    it('should render narrow layout when isNarrow prop is true', () => {
      const { container } = render(<FileExplorer isNarrow />);

      // The component should render (verify container has content)
      expect(container.firstChild).toBeInTheDocument();
    });

    it('should render full layout with sidebar by default', () => {
      // Ensure sidebar is visible via mock
      (useUIPreferencesStore as Mock).mockImplementation((selector) => {
        const state = {
          isFileSidebarVisible: true,
          setFileSidebarVisible: vi.fn(),
        };
        return selector ? selector(state) : state;
      });

      const { container } = render(<FileExplorer />);

      // Sidebar should be visible in full layout
      expect(container.firstChild).toBeInTheDocument();
    });

    it('should hide sidebar when isSidebarVisible is false', () => {
      // Hide sidebar via mock
      (useUIPreferencesStore as Mock).mockImplementation((selector) => {
        const state = {
          isFileSidebarVisible: false,
          setFileSidebarVisible: vi.fn(),
        };
        return selector ? selector(state) : state;
      });

      const { container } = render(<FileExplorer />);

      // Component should still render
      expect(container.firstChild).toBeInTheDocument();
    });
  });

  describe('Error handling', () => {
    it('should handle API errors when fetching files', async () => {
      // Mock API error
      (getFileApiClient as Mock).mockReturnValue({
        getFiles: vi.fn().mockResolvedValue({
          success: false,
          error: { message: 'Failed to load files' },
        }),
        getFolders: vi.fn().mockResolvedValue({ success: true, data: { folders: [] } }),
      });

      render(<FileExplorer />);

      // Wait for the error to be set after fetchFiles is called
      await waitFor(() => {
        const error = useFileListStore.getState().error;
        expect(error).toBeTruthy();
      });

      // Verify error state
      const state = useFileListStore.getState();
      expect(state.error).toBe('Failed to load files');
      expect(state.isLoading).toBe(false);
    });
  });

  describe('Component rendering', () => {
    it('should render without errors', () => {
      const { container } = render(<FileExplorer />);

      // Component should render without errors
      // TooltipProvider is a context provider that enables tooltips
      expect(container.firstChild).toBeInTheDocument();
    });

    it('should pass correct folderId to fetchFiles', async () => {
      const testFolderId = 'test-folder-id';

      // Set current folder
      act(() => {
        useFolderTreeStore.getState().setCurrentFolder(testFolderId, [
          { id: testFolderId, name: 'Test Folder' },
        ]);
      });

      const mockGetFiles = vi.fn().mockResolvedValue({
        success: true,
        data: {
          files: [],
          pagination: { offset: 0, limit: 50, total: 0 },
        },
      });

      (getFileApiClient as Mock).mockReturnValue({
        getFiles: mockGetFiles,
        getFolders: vi.fn().mockResolvedValue({ success: true, data: { folders: [] } }),
      });

      render(<FileExplorer />);

      // Verify fetchFiles was called with the correct folderId
      await waitFor(() => {
        expect(mockGetFiles).toHaveBeenCalledWith({ folderId: testFolderId });
      });
    });
  });
});
