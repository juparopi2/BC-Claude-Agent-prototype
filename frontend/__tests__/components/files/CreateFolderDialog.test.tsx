/**
 * CreateFolderDialog Tests
 *
 * Tests for the CreateFolderDialog component with focus on NULL handling
 * when creating folders at root level vs nested folders.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { act } from '@testing-library/react';
import { CreateFolderDialog } from '../../../components/files/CreateFolderDialog';
import { useFileStore } from '../../../lib/stores/fileStore';
import { server } from '../../../vitest.setup';
import { http, HttpResponse } from 'msw';

// Mock sonner toast
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { toast } from 'sonner';

const API_URL = 'http://localhost:3002';

describe('CreateFolderDialog', () => {
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

  describe('Create root-level folder', () => {
    it('should create folder at root level when currentFolderId is null', async () => {
      const user = userEvent.setup();

      // Ensure currentFolderId is null
      act(() => {
        useFileStore.setState({ currentFolderId: null });
      });

      // Render component
      render(<CreateFolderDialog />);

      // Open dialog
      const trigger = screen.getByRole('button', { name: /new folder/i });
      await user.click(trigger);

      // Wait for dialog to open
      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });

      // Type folder name
      const input = screen.getByLabelText(/what are you saving here/i);
      await user.type(input, 'Root Folder');

      // Click create button
      const createButton = screen.getByRole('button', { name: /^create$/i });
      await user.click(createButton);

      // Wait for API call and toast
      await waitFor(() => {
        expect(toast.success).toHaveBeenCalledWith('Folder "Root Folder" created');
      });

      // Verify folder was added to store
      const state = useFileStore.getState();
      expect(state.files).toHaveLength(1);
      expect(state.files[0]?.name).toBe('Root Folder');
      expect(state.files[0]?.parentFolderId).toBeNull();
      expect(state.files[0]?.isFolder).toBe(true);

      // Dialog should close
      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      });
    });
  });

  describe('Create nested folder', () => {
    it('should create folder inside parent when currentFolderId is set', async () => {
      const user = userEvent.setup();
      const parentFolderId = 'parent-folder-123';

      // Set currentFolderId to a parent folder
      act(() => {
        useFileStore.setState({ currentFolderId: parentFolderId });
      });

      // Render component
      render(<CreateFolderDialog />);

      // Open dialog
      const trigger = screen.getByRole('button', { name: /new folder/i });
      await user.click(trigger);

      // Wait for dialog to open
      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });

      // Type folder name
      const input = screen.getByLabelText(/what are you saving here/i);
      await user.type(input, 'Nested Folder');

      // Click create button
      const createButton = screen.getByRole('button', { name: /^create$/i });
      await user.click(createButton);

      // Wait for API call and toast
      await waitFor(() => {
        expect(toast.success).toHaveBeenCalledWith('Folder "Nested Folder" created');
      });

      // Verify folder was added to store with correct parent
      const state = useFileStore.getState();
      expect(state.files).toHaveLength(1);
      expect(state.files[0]?.name).toBe('Nested Folder');
      expect(state.files[0]?.parentFolderId).toBe(parentFolderId);
      expect(state.files[0]?.isFolder).toBe(true);
    });
  });

  describe('Validation', () => {
    it('should disable create button when folder name is empty', async () => {
      const user = userEvent.setup();

      render(<CreateFolderDialog />);

      // Open dialog
      const trigger = screen.getByRole('button', { name: /new folder/i });
      await user.click(trigger);

      // Wait for dialog to open
      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });

      // Create button should be disabled when input is empty
      const createButton = screen.getByRole('button', { name: /^create$/i });
      expect(createButton).toBeDisabled();

      // Dialog should remain open
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('should validate folder name format and reject special characters', async () => {
      const user = userEvent.setup();

      render(<CreateFolderDialog />);

      // Open dialog
      const trigger = screen.getByRole('button', { name: /new folder/i });
      await user.click(trigger);

      // Wait for dialog to open
      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });

      // Type invalid folder name with special characters
      const input = screen.getByLabelText(/what are you saving here/i);
      await user.type(input, 'Invalid/Folder*Name');

      // Try to create
      const createButton = screen.getByRole('button', { name: /^create$/i });
      await user.click(createButton);

      // Should show validation error (updated to include commas and periods for Danish business names)
      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith(
          'Folder name can only contain letters, numbers, spaces, hyphens, underscores, commas, and periods'
        );
      });

      // Dialog should remain open
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });

  describe('Error handling', () => {
    it('should handle API errors gracefully', async () => {
      const user = userEvent.setup();

      // Mock API error
      server.use(
        http.post(`${API_URL}/api/files/folders`, () => {
          return HttpResponse.json(
            {
              error: 'Bad Request',
              message: 'Folder name already exists',
              code: 'VALIDATION_ERROR',
            },
            { status: 400 }
          );
        })
      );

      render(<CreateFolderDialog />);

      // Open dialog
      const trigger = screen.getByRole('button', { name: /new folder/i });
      await user.click(trigger);

      // Wait for dialog to open
      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });

      // Type folder name
      const input = screen.getByLabelText(/what are you saving here/i);
      await user.type(input, 'Duplicate Folder');

      // Click create button
      const createButton = screen.getByRole('button', { name: /^create$/i });
      await user.click(createButton);

      // Should show error toast
      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith('Failed to create folder');
      });

      // Dialog should remain open for retry
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });

  describe('Enter key support', () => {
    it('should create folder when Enter key is pressed', async () => {
      const user = userEvent.setup();

      render(<CreateFolderDialog />);

      // Open dialog
      const trigger = screen.getByRole('button', { name: /new folder/i });
      await user.click(trigger);

      // Wait for dialog to open
      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });

      // Type folder name and press Enter
      const input = screen.getByLabelText(/what are you saving here/i);
      await user.type(input, 'Quick Folder{Enter}');

      // Wait for API call and toast
      await waitFor(() => {
        expect(toast.success).toHaveBeenCalledWith('Folder "Quick Folder" created');
      });

      // Verify folder was created
      const state = useFileStore.getState();
      expect(state.files).toHaveLength(1);
      expect(state.files[0]?.name).toBe('Quick Folder');

      // Dialog should close
      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      });
    });
  });
});
