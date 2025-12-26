/**
 * useFileActions Hook Tests
 *
 * Tests for file CRUD operations hook: createFolder, deleteFiles, renameFile, downloadFile.
 *
 * @module __tests__/domains/files/hooks/useFileActions
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { ParsedFile } from '@bc-agent/shared';
import { useFileActions } from '@/src/domains/files/hooks/useFileActions';
import { resetFileListStore, useFileListStore } from '@/src/domains/files/stores/fileListStore';
import { resetFolderTreeStore, useFolderTreeStore } from '@/src/domains/files/stores/folderTreeStore';
import { getFileApiClient, resetFileApiClient } from '@/lib/services/fileApi';

// Mock the file API client
vi.mock('@/lib/services/fileApi', () => ({
  getFileApiClient: vi.fn(),
  resetFileApiClient: vi.fn(),
}));

// Test fixtures
const createMockFile = (overrides: Partial<ParsedFile> = {}): ParsedFile => ({
  id: `file-${Math.random().toString(36).substr(2, 9)}`,
  name: 'test-file.txt',
  mimeType: 'text/plain',
  sizeBytes: 1024,
  isFolder: false,
  isFavorite: false,
  parentFolderId: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  userId: 'user-1',
  processingStatus: 'completed',
  embeddingStatus: 'completed',
  hasExtractedText: false,
  blobPath: null,
  ...overrides,
});

const createMockFolder = (overrides: Partial<ParsedFile> = {}): ParsedFile =>
  createMockFile({
    name: 'test-folder',
    mimeType: 'application/folder',
    sizeBytes: 0,
    isFolder: true,
    ...overrides,
  });

// Mock API client
const mockFileApi = {
  createFolder: vi.fn(),
  deleteFile: vi.fn(),
  updateFile: vi.fn(),
  downloadFile: vi.fn(),
};

describe('useFileActions', () => {
  beforeEach(() => {
    resetFileListStore();
    resetFolderTreeStore();
    vi.clearAllMocks();
    (getFileApiClient as Mock).mockReturnValue(mockFileApi);
  });

  describe('initial state', () => {
    it('should start with isLoading false', () => {
      const { result } = renderHook(() => useFileActions());
      expect(result.current.isLoading).toBe(false);
    });

    it('should start with no error', () => {
      const { result } = renderHook(() => useFileActions());
      expect(result.current.error).toBeNull();
    });
  });

  describe('createFolder', () => {
    it('should create folder and return it on success', async () => {
      const newFolder = createMockFolder({ id: 'folder-new', name: 'My Folder' });
      mockFileApi.createFolder.mockResolvedValue({
        success: true,
        data: { folder: newFolder },
      });

      const { result } = renderHook(() => useFileActions());

      let createdFolder: ParsedFile | null = null;
      await act(async () => {
        createdFolder = await result.current.createFolder('My Folder', null);
      });

      expect(createdFolder).toEqual(newFolder);
      expect(mockFileApi.createFolder).toHaveBeenCalledWith({
        name: 'My Folder',
        parentFolderId: undefined,
      });
    });

    it('should add folder to file list when in same folder', async () => {
      const newFolder = createMockFolder({ id: 'folder-new', name: 'My Folder', parentFolderId: null });
      mockFileApi.createFolder.mockResolvedValue({
        success: true,
        data: { folder: newFolder },
      });

      // Set current folder to root (null)
      act(() => {
        useFolderTreeStore.getState().setCurrentFolder(null, []);
      });

      const { result } = renderHook(() => useFileActions());

      await act(async () => {
        await result.current.createFolder('My Folder', null);
      });

      const files = useFileListStore.getState().files;
      expect(files).toContainEqual(newFolder);
    });

    it('should update folder tree cache', async () => {
      const newFolder = createMockFolder({ id: 'folder-new', name: 'My Folder', parentFolderId: null });
      mockFileApi.createFolder.mockResolvedValue({
        success: true,
        data: { folder: newFolder },
      });

      const { result } = renderHook(() => useFileActions());

      await act(async () => {
        await result.current.createFolder('My Folder', null);
      });

      const rootFolders = useFolderTreeStore.getState().getRootFolders();
      expect(rootFolders).toContainEqual(newFolder);
    });

    it('should handle API error', async () => {
      mockFileApi.createFolder.mockResolvedValue({
        success: false,
        error: { message: 'Folder name already exists' },
      });

      const { result } = renderHook(() => useFileActions());

      let createdFolder: ParsedFile | null = null;
      await act(async () => {
        createdFolder = await result.current.createFolder('My Folder', null);
      });

      expect(createdFolder).toBeNull();
      expect(result.current.error).toBe('Folder name already exists');
    });

    it('should set loading state during operation', async () => {
      let resolvePromise: (value: unknown) => void;
      const promise = new Promise((resolve) => {
        resolvePromise = resolve;
      });
      mockFileApi.createFolder.mockReturnValue(promise);

      const { result } = renderHook(() => useFileActions());

      // Start the operation
      act(() => {
        result.current.createFolder('My Folder', null);
      });

      // Should be loading
      expect(result.current.isLoading).toBe(true);

      // Resolve the promise
      await act(async () => {
        resolvePromise!({
          success: true,
          data: { folder: createMockFolder() },
        });
        await promise;
      });

      // Should not be loading anymore
      expect(result.current.isLoading).toBe(false);
    });
  });

  describe('deleteFiles', () => {
    it('should delete files and return true on success', async () => {
      const file1 = createMockFile({ id: 'file-1' });
      const file2 = createMockFile({ id: 'file-2' });

      // Add files to store
      act(() => {
        useFileListStore.getState().setFiles([file1, file2], 2, false);
      });

      mockFileApi.deleteFile.mockResolvedValue({ success: true });

      const { result } = renderHook(() => useFileActions());

      let success: boolean = false;
      await act(async () => {
        success = await result.current.deleteFiles(['file-1']);
      });

      expect(success).toBe(true);
      expect(mockFileApi.deleteFile).toHaveBeenCalledWith('file-1');
    });

    it('should remove files from store on success', async () => {
      const file1 = createMockFile({ id: 'file-1' });
      const file2 = createMockFile({ id: 'file-2' });

      act(() => {
        useFileListStore.getState().setFiles([file1, file2], 2, false);
      });

      mockFileApi.deleteFile.mockResolvedValue({ success: true });

      const { result } = renderHook(() => useFileActions());

      await act(async () => {
        await result.current.deleteFiles(['file-1']);
      });

      const files = useFileListStore.getState().files;
      expect(files).toHaveLength(1);
      expect(files[0].id).toBe('file-2');
    });

    it('should delete multiple files', async () => {
      const file1 = createMockFile({ id: 'file-1' });
      const file2 = createMockFile({ id: 'file-2' });
      const file3 = createMockFile({ id: 'file-3' });

      act(() => {
        useFileListStore.getState().setFiles([file1, file2, file3], 3, false);
      });

      mockFileApi.deleteFile.mockResolvedValue({ success: true });

      const { result } = renderHook(() => useFileActions());

      await act(async () => {
        await result.current.deleteFiles(['file-1', 'file-2']);
      });

      expect(mockFileApi.deleteFile).toHaveBeenCalledTimes(2);
      const files = useFileListStore.getState().files;
      expect(files).toHaveLength(1);
      expect(files[0].id).toBe('file-3');
    });

    it('should return true for empty array', async () => {
      const { result } = renderHook(() => useFileActions());

      let success: boolean = false;
      await act(async () => {
        success = await result.current.deleteFiles([]);
      });

      expect(success).toBe(true);
      expect(mockFileApi.deleteFile).not.toHaveBeenCalled();
    });

    it('should handle API error and return false', async () => {
      const file1 = createMockFile({ id: 'file-1' });

      act(() => {
        useFileListStore.getState().setFiles([file1], 1, false);
      });

      mockFileApi.deleteFile.mockResolvedValue({
        success: false,
        error: { message: 'Permission denied' },
      });

      const { result } = renderHook(() => useFileActions());

      let success: boolean = true;
      await act(async () => {
        success = await result.current.deleteFiles(['file-1']);
      });

      expect(success).toBe(false);
      expect(result.current.error).toBe('Permission denied');
    });

    it('should update folder tree cache when deleting folders', async () => {
      const folder = createMockFolder({ id: 'folder-1', parentFolderId: null });

      act(() => {
        useFileListStore.getState().setFiles([folder], 1, false);
        useFolderTreeStore.getState().setTreeFolders('root', [folder]);
      });

      mockFileApi.deleteFile.mockResolvedValue({ success: true });

      const { result } = renderHook(() => useFileActions());

      await act(async () => {
        await result.current.deleteFiles(['folder-1']);
      });

      const rootFolders = useFolderTreeStore.getState().getRootFolders();
      expect(rootFolders).not.toContainEqual(expect.objectContaining({ id: 'folder-1' }));
    });
  });

  describe('renameFile', () => {
    it('should rename file and return updated file', async () => {
      const file = createMockFile({ id: 'file-1', name: 'old-name.txt' });
      const updatedFile = { ...file, name: 'new-name.txt' };

      act(() => {
        useFileListStore.getState().setFiles([file], 1, false);
      });

      mockFileApi.updateFile.mockResolvedValue({
        success: true,
        data: { file: updatedFile },
      });

      const { result } = renderHook(() => useFileActions());

      let renamed: ParsedFile | null = null;
      await act(async () => {
        renamed = await result.current.renameFile('file-1', 'new-name.txt');
      });

      expect(renamed?.name).toBe('new-name.txt');
      expect(mockFileApi.updateFile).toHaveBeenCalledWith('file-1', { name: 'new-name.txt' });
    });

    it('should update file in store', async () => {
      const file = createMockFile({ id: 'file-1', name: 'old-name.txt' });
      const updatedFile = { ...file, name: 'new-name.txt' };

      act(() => {
        useFileListStore.getState().setFiles([file], 1, false);
      });

      mockFileApi.updateFile.mockResolvedValue({
        success: true,
        data: { file: updatedFile },
      });

      const { result } = renderHook(() => useFileActions());

      await act(async () => {
        await result.current.renameFile('file-1', 'new-name.txt');
      });

      const files = useFileListStore.getState().files;
      expect(files[0].name).toBe('new-name.txt');
    });

    it('should update folder tree cache when renaming folder', async () => {
      const folder = createMockFolder({ id: 'folder-1', name: 'old-folder', parentFolderId: null });
      const updatedFolder = { ...folder, name: 'new-folder' };

      act(() => {
        useFileListStore.getState().setFiles([folder], 1, false);
        useFolderTreeStore.getState().setTreeFolders('root', [folder]);
      });

      mockFileApi.updateFile.mockResolvedValue({
        success: true,
        data: { file: updatedFolder },
      });

      const { result } = renderHook(() => useFileActions());

      await act(async () => {
        await result.current.renameFile('folder-1', 'new-folder');
      });

      const rootFolders = useFolderTreeStore.getState().getRootFolders();
      const renamedFolder = rootFolders.find((f) => f.id === 'folder-1');
      expect(renamedFolder?.name).toBe('new-folder');
    });

    it('should handle API error', async () => {
      const file = createMockFile({ id: 'file-1', name: 'old-name.txt' });

      act(() => {
        useFileListStore.getState().setFiles([file], 1, false);
      });

      mockFileApi.updateFile.mockResolvedValue({
        success: false,
        error: { message: 'Invalid file name' },
      });

      const { result } = renderHook(() => useFileActions());

      let renamed: ParsedFile | null = null;
      await act(async () => {
        renamed = await result.current.renameFile('file-1', 'new-name.txt');
      });

      expect(renamed).toBeNull();
      expect(result.current.error).toBe('Invalid file name');
    });
  });

  describe('downloadFile', () => {
    it('should download file successfully', async () => {
      const mockBlob = new Blob(['test content'], { type: 'text/plain' });
      mockFileApi.downloadFile.mockResolvedValue({
        success: true,
        data: mockBlob,
      });

      // Render hook first, then set up DOM mocks
      const { result } = renderHook(() => useFileActions());

      // Mock URL and document methods AFTER renderHook
      const mockCreateObjectURL = vi.fn().mockReturnValue('blob:test-url');
      const mockRevokeObjectURL = vi.fn();
      global.URL.createObjectURL = mockCreateObjectURL;
      global.URL.revokeObjectURL = mockRevokeObjectURL;

      const mockAnchor = {
        href: '',
        download: '',
        click: vi.fn(),
        style: {},
      };

      // Use mockImplementation that only intercepts 'a' tag creation
      const originalCreateElement = document.createElement.bind(document);
      vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
        if (tagName === 'a') {
          return mockAnchor as unknown as HTMLElement;
        }
        return originalCreateElement(tagName);
      });
      vi.spyOn(document.body, 'appendChild').mockImplementation((node) => node);
      vi.spyOn(document.body, 'removeChild').mockImplementation((node) => node);

      await act(async () => {
        await result.current.downloadFile('file-1', 'test-file.txt');
      });

      expect(mockFileApi.downloadFile).toHaveBeenCalledWith('file-1');
      expect(mockCreateObjectURL).toHaveBeenCalledWith(mockBlob);
      expect(mockAnchor.download).toBe('test-file.txt');
      expect(mockAnchor.click).toHaveBeenCalled();
      expect(mockRevokeObjectURL).toHaveBeenCalledWith('blob:test-url');

      // Restore mocks
      vi.restoreAllMocks();
    });

    it('should handle download error', async () => {
      mockFileApi.downloadFile.mockResolvedValue({
        success: false,
        error: { message: 'File not found' },
      });

      const { result } = renderHook(() => useFileActions());

      await act(async () => {
        await result.current.downloadFile('file-1', 'test-file.txt');
      });

      expect(result.current.error).toBe('File not found');
    });
  });

  describe('clearError', () => {
    it('should clear error state', async () => {
      mockFileApi.createFolder.mockResolvedValue({
        success: false,
        error: { message: 'Some error' },
      });

      const { result } = renderHook(() => useFileActions());

      // Trigger an error
      await act(async () => {
        await result.current.createFolder('Test', null);
      });

      expect(result.current.error).toBe('Some error');

      // Clear error
      act(() => {
        result.current.clearError();
      });

      expect(result.current.error).toBeNull();
    });
  });
});
