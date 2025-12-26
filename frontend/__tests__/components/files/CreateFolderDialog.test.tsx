/**
 * CreateFolderDialog Tests
 *
 * Tests for the CreateFolderDialog component with focus on NULL handling
 * when creating folders at root level vs nested folders.
 *
 * Updated to use new domain hooks (useFileActions, useFolderNavigation).
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { act } from '@testing-library/react';
import { CreateFolderDialog } from '../../../components/files/CreateFolderDialog';
import {
  resetFileListStore,
  useFileListStore,
} from '@/src/domains/files/stores/fileListStore';
import {
  resetFolderTreeStore,
  useFolderTreeStore,
} from '@/src/domains/files/stores/folderTreeStore';

// Mock sonner toast
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock the fileApi client
vi.mock('@/lib/services/fileApi', () => ({
  getFileApiClient: vi.fn(() => ({
    createFolder: vi.fn(),
  })),
  resetFileApiClient: vi.fn(),
}));

import { toast } from 'sonner';
import { getFileApiClient } from '@/lib/services/fileApi';

describe('CreateFolderDialog', () => {
  beforeEach(() => {
    // Reset domain stores
    resetFileListStore();
    resetFolderTreeStore();

    // Clear all mocks
    vi.clearAllMocks();
  });

  describe('Create root-level folder', () => {
    it('should create folder at root level when currentFolderId is null', async () => {
      const user = userEvent.setup();

      // Ensure currentFolderId is null (root)
      act(() => {
        useFolderTreeStore.getState().setCurrentFolder(null, []);
      });

      // Mock successful folder creation
      const newFolder = {
        id: 'new-folder-123',
        name: 'Root Folder',
        isFolder: true,
        parentFolderId: null,
        mimeType: 'application/folder',
        sizeBytes: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      (getFileApiClient as Mock).mockReturnValue({
        createFolder: vi.fn().mockResolvedValue({
          success: true,
          data: { folder: newFolder },
        }),
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
      const files = useFileListStore.getState().files;
      expect(files).toHaveLength(1);
      expect(files[0]?.name).toBe('Root Folder');
      expect(files[0]?.parentFolderId).toBeNull();
      expect(files[0]?.isFolder).toBe(true);

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
        useFolderTreeStore.getState().setCurrentFolder(parentFolderId, [
          { id: parentFolderId, name: 'Parent Folder' },
        ]);
      });

      // Mock successful folder creation
      const newFolder = {
        id: 'new-folder-456',
        name: 'Nested Folder',
        isFolder: true,
        parentFolderId: parentFolderId,
        mimeType: 'application/folder',
        sizeBytes: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      (getFileApiClient as Mock).mockReturnValue({
        createFolder: vi.fn().mockResolvedValue({
          success: true,
          data: { folder: newFolder },
        }),
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
      const files = useFileListStore.getState().files;
      expect(files).toHaveLength(1);
      expect(files[0]?.name).toBe('Nested Folder');
      expect(files[0]?.parentFolderId).toBe(parentFolderId);
      expect(files[0]?.isFolder).toBe(true);
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
      (getFileApiClient as Mock).mockReturnValue({
        createFolder: vi.fn().mockResolvedValue({
          success: false,
          error: { message: 'Folder name already exists' },
        }),
      });

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

      // Should show error toast (component shows fallback message because error state isn't available synchronously)
      await waitFor(() => {
        expect(toast.error).toHaveBeenCalled();
      });

      // Dialog should remain open for retry
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });

  describe('Enter key support', () => {
    it('should create folder when Enter key is pressed', async () => {
      const user = userEvent.setup();

      // Ensure at root
      act(() => {
        useFolderTreeStore.getState().setCurrentFolder(null, []);
      });

      // Mock successful folder creation
      const newFolder = {
        id: 'quick-folder-123',
        name: 'Quick Folder',
        isFolder: true,
        parentFolderId: null,
        mimeType: 'application/folder',
        sizeBytes: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      (getFileApiClient as Mock).mockReturnValue({
        createFolder: vi.fn().mockResolvedValue({
          success: true,
          data: { folder: newFolder },
        }),
      });

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
      const files = useFileListStore.getState().files;
      expect(files).toHaveLength(1);
      expect(files[0]?.name).toBe('Quick Folder');

      // Dialog should close
      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      });
    });
  });
});
