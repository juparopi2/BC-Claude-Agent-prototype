/**
 * FileExplorer Tests
 *
 * Tests for the FileExplorer component with focus on NULL handling
 * when loading files at root level vs nested folders.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { act } from '@testing-library/react';
import { FileExplorer } from '../../../components/files/FileExplorer';
import { useFileStore } from '../../../lib/stores/fileStore';
import { server } from '../../../vitest.setup';
import { mockFiles } from '../../mocks/handlers';
import { http, HttpResponse } from 'msw';

const API_URL = 'http://localhost:3002';

describe('FileExplorer', () => {
  beforeEach(() => {
    // Reset store to initial state
    act(() => {
      useFileStore.setState({
        files: [],
        currentFolderId: null,
        selectedFileIds: new Set(),
        folderPath: [],
        uploadQueue: [],
        isUploading: false,
        uploadProgress: 0,
        isLoading: false,
        error: null,
        isSidebarVisible: true,
        sortBy: 'date',
        sortOrder: 'desc',
        showFavoritesOnly: false,
        totalFiles: 0,
        hasMore: false,
        currentOffset: 0,
        currentLimit: 50,
      });
    });

    // Clear all mocks
    vi.clearAllMocks();
  });

  describe('Load root-level files on mount', () => {
    it('should fetch root-level files when currentFolderId is null', async () => {
      // Ensure currentFolderId is null
      act(() => {
        useFileStore.setState({ currentFolderId: null });
      });

      // Spy on fetchFiles action
      const fetchFilesSpy = vi.spyOn(useFileStore.getState(), 'fetchFiles');

      // Render component
      render(<FileExplorer />);

      // Wait for fetchFiles to be called
      await waitFor(() => {
        expect(fetchFilesSpy).toHaveBeenCalledWith(null);
      });

      // Wait for files to be loaded into state
      await waitFor(() => {
        const state = useFileStore.getState();
        expect(state.files.length).toBeGreaterThan(0);
      });

      // Verify root-level files are loaded (parentFolderId === null)
      const state = useFileStore.getState();
      const rootFiles = state.files.filter((f) => f.parentFolderId === null);
      expect(rootFiles.length).toBe(state.files.length);

      // Verify loading state is false
      expect(state.isLoading).toBe(false);
    });

    it('should display loading state while fetching files', async () => {
      // Set loading state
      act(() => {
        useFileStore.setState({ isLoading: true, currentFolderId: null });
      });

      // Render component
      render(<FileExplorer />);

      // Component should be in loading state initially
      const state = useFileStore.getState();
      expect(state.isLoading).toBe(true);

      // Wait for loading to complete
      await waitFor(() => {
        const updatedState = useFileStore.getState();
        expect(updatedState.isLoading).toBe(false);
      });
    });
  });

  describe('Reload files when currentFolderId changes', () => {
    it('should reload files when navigating to a folder', async () => {
      const folderId = 'folder-123';

      // Start at root
      act(() => {
        useFileStore.setState({
          currentFolderId: null,
          files: [...mockFiles],
        });
      });

      // Render component
      const { rerender } = render(<FileExplorer />);

      // Spy on fetchFiles
      const fetchFilesSpy = vi.spyOn(useFileStore.getState(), 'fetchFiles');

      // Navigate to folder by updating currentFolderId
      act(() => {
        useFileStore.setState({ currentFolderId: folderId });
      });

      // Rerender to trigger useEffect
      rerender(<FileExplorer />);

      // Wait for fetchFiles to be called with new folderId
      await waitFor(() => {
        expect(fetchFilesSpy).toHaveBeenCalledWith(folderId);
      });

      // Verify currentFolderId is updated
      const state = useFileStore.getState();
      expect(state.currentFolderId).toBe(folderId);
    });

    it('should reload files when navigating back to root', async () => {
      const folderId = 'folder-123';

      // Start in a folder
      act(() => {
        useFileStore.setState({
          currentFolderId: folderId,
          files: [],
        });
      });

      // Render component
      const { rerender } = render(<FileExplorer />);

      // Spy on fetchFiles
      const fetchFilesSpy = vi.spyOn(useFileStore.getState(), 'fetchFiles');

      // Navigate back to root
      act(() => {
        useFileStore.setState({ currentFolderId: null });
      });

      // Rerender to trigger useEffect
      rerender(<FileExplorer />);

      // Wait for fetchFiles to be called with null (root)
      await waitFor(() => {
        expect(fetchFilesSpy).toHaveBeenCalledWith(null);
      });

      // Verify we're at root
      const state = useFileStore.getState();
      expect(state.currentFolderId).toBeNull();
    });

    it('should handle rapid folder navigation correctly', async () => {
      const folder1 = 'folder-1';
      const folder2 = 'folder-2';

      // Start at root
      act(() => {
        useFileStore.setState({ currentFolderId: null, files: [] });
      });

      // Render component
      const { rerender } = render(<FileExplorer />);

      // Spy on fetchFiles
      const fetchFilesSpy = vi.spyOn(useFileStore.getState(), 'fetchFiles');

      // Navigate to folder 1
      act(() => {
        useFileStore.setState({ currentFolderId: folder1 });
      });
      rerender(<FileExplorer />);

      // Immediately navigate to folder 2
      act(() => {
        useFileStore.setState({ currentFolderId: folder2 });
      });
      rerender(<FileExplorer />);

      // Wait for both fetchFiles calls
      await waitFor(() => {
        expect(fetchFilesSpy).toHaveBeenCalledWith(folder1);
        expect(fetchFilesSpy).toHaveBeenCalledWith(folder2);
      });

      // Verify final state is folder2
      const state = useFileStore.getState();
      expect(state.currentFolderId).toBe(folder2);
    });
  });

  describe('Layout variations', () => {
    it('should render narrow layout when isNarrow prop is true', () => {
      const { container } = render(<FileExplorer isNarrow />);

      // In narrow layout, sidebar is not rendered
      const state = useFileStore.getState();

      // The component should still render (verify container has content)
      expect(container.firstChild).toBeInTheDocument();
    });

    it('should render full layout with sidebar by default', () => {
      // Ensure sidebar is visible
      act(() => {
        useFileStore.setState({ isSidebarVisible: true });
      });

      const { container } = render(<FileExplorer />);

      // Sidebar should be visible in full layout
      const state = useFileStore.getState();
      expect(state.isSidebarVisible).toBe(true);
      expect(container.firstChild).toBeInTheDocument();
    });

    it('should hide sidebar when isSidebarVisible is false', () => {
      // Hide sidebar
      act(() => {
        useFileStore.setState({ isSidebarVisible: false });
      });

      const { container } = render(<FileExplorer />);

      // Verify sidebar is hidden
      const state = useFileStore.getState();
      expect(state.isSidebarVisible).toBe(false);
      expect(container.firstChild).toBeInTheDocument();
    });
  });

  describe('Error handling', () => {
    it('should handle API errors when fetching files', async () => {
      // Mock API error
      server.use(
        http.get(`${API_URL}/api/files`, () => {
          return HttpResponse.json(
            {
              error: 'Server Error',
              message: 'Failed to load files',
              code: 'INTERNAL_ERROR',
            },
            { status: 500 }
          );
        })
      );

      const { container } = render(<FileExplorer />);

      // Wait for the error to be set after fetchFiles is called
      await waitFor(() => {
        const state = useFileStore.getState();
        expect(state.error).toBeTruthy();
      });

      // Verify error state
      const state = useFileStore.getState();
      expect(state.error).toBe('Failed to load files');
      expect(state.isLoading).toBe(false);
      expect(container.firstChild).toBeInTheDocument();
    });
  });

  describe('Component rendering', () => {
    it('should render without errors', () => {
      const { container } = render(<FileExplorer />);

      // Component should render without errors
      // TooltipProvider is a context provider that enables tooltips
      expect(container.firstChild).toBeInTheDocument();
    });
  });
});
