/**
 * File Store Tests
 *
 * Unit tests for the file store (Zustand) focusing on NULL/undefined handling.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act } from '@testing-library/react';
import { useFileStore } from '../../lib/stores/fileStore';
import { server } from '../../vitest.setup';
import { http, HttpResponse } from 'msw';
import type { ParsedFile } from '@bc-agent/shared';

// Base URL for mocking
const API_URL = 'http://localhost:3002';

// Mock files data
const mockRootFolder: ParsedFile = {
  id: 'folder-root-1',
  userId: 'user-123',
  parentFolderId: null,
  name: 'Documents',
  mimeType: 'inode/directory',
  sizeBytes: 0,
  blobPath: '',
  isFolder: true,
  isFavorite: false,
  processingStatus: 'completed',
  embeddingStatus: 'not_started',
  hasExtractedText: false,
  createdAt: '2024-01-01T10:00:00.000Z',
  updatedAt: '2024-01-01T10:00:00.000Z',
};

const mockRootFile: ParsedFile = {
  id: 'file-root-1',
  userId: 'user-123',
  parentFolderId: null,
  name: 'report.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 1024000,
  blobPath: 'user-123/file-root-1.pdf',
  isFolder: false,
  isFavorite: true,
  processingStatus: 'completed',
  embeddingStatus: 'not_started',
  hasExtractedText: true,
  createdAt: '2024-01-01T09:00:00.000Z',
  updatedAt: '2024-01-01T09:00:00.000Z',
};

const mockSubFolder: ParsedFile = {
  id: 'folder-sub-1',
  userId: 'user-123',
  parentFolderId: 'folder-root-1',
  name: 'Invoices',
  mimeType: 'inode/directory',
  sizeBytes: 0,
  blobPath: '',
  isFolder: true,
  isFavorite: false,
  processingStatus: 'completed',
  embeddingStatus: 'not_started',
  hasExtractedText: false,
  createdAt: '2024-01-02T10:00:00.000Z',
  updatedAt: '2024-01-02T10:00:00.000Z',
};

const mockSubFile: ParsedFile = {
  id: 'file-sub-1',
  userId: 'user-123',
  parentFolderId: 'folder-root-1',
  name: 'invoice-001.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 512000,
  blobPath: 'user-123/file-sub-1.pdf',
  isFolder: false,
  isFavorite: false,
  processingStatus: 'completed',
  embeddingStatus: 'not_started',
  hasExtractedText: true,
  createdAt: '2024-01-02T11:00:00.000Z',
  updatedAt: '2024-01-02T11:00:00.000Z',
};

describe('FileStore', () => {
  beforeEach(() => {
    // Reset store to initial state
    act(() => {
      useFileStore.getState().reset();
    });
  });

  describe('fetchFiles() - NULL/undefined handling', () => {
    it('should fetch root files when folderId=null', async () => {
      // Mock API response for root files
      server.use(
        http.get(`${API_URL}/api/files`, ({ request }) => {
          const url = new URL(request.url);
          const folderId = url.searchParams.get('folderId');

          // folderId should NOT be in query params for root
          expect(folderId).toBeNull();

          return HttpResponse.json({
            files: [mockRootFolder, mockRootFile],
            pagination: {
              total: 2,
              limit: 50,
              offset: 0,
            },
          });
        })
      );

      await act(async () => {
        await useFileStore.getState().fetchFiles(null);
      });

      const state = useFileStore.getState();
      expect(state.files).toHaveLength(2);
      expect(state.currentFolderId).toBe(null);
      expect(state.isLoading).toBe(false);
      expect(state.error).toBe(null);
    });

    it('should fetch root files when folderId=undefined', async () => {
      // Mock API response for root files
      server.use(
        http.get(`${API_URL}/api/files`, ({ request }) => {
          const url = new URL(request.url);
          const folderId = url.searchParams.get('folderId');

          // folderId should NOT be in query params
          expect(folderId).toBeNull();

          return HttpResponse.json({
            files: [mockRootFolder, mockRootFile],
            pagination: {
              total: 2,
              limit: 50,
              offset: 0,
            },
          });
        })
      );

      await act(async () => {
        await useFileStore.getState().fetchFiles(undefined);
      });

      const state = useFileStore.getState();
      expect(state.files).toHaveLength(2);
      expect(state.currentFolderId).toBe(null);
    });

    it('should fetch subfolder files when folderId=UUID', async () => {
      const folderId = 'folder-root-1';

      server.use(
        http.get(`${API_URL}/api/files`, ({ request }) => {
          const url = new URL(request.url);
          const folderIdParam = url.searchParams.get('folderId');

          // folderId SHOULD be in query params
          expect(folderIdParam).toBe(folderId);

          return HttpResponse.json({
            files: [mockSubFolder, mockSubFile],
            pagination: {
              total: 2,
              limit: 50,
              offset: 0,
            },
          });
        })
      );

      await act(async () => {
        await useFileStore.getState().fetchFiles(folderId);
      });

      const state = useFileStore.getState();
      expect(state.files).toHaveLength(2);
      expect(state.currentFolderId).toBe(folderId);
    });

    it('should use currentFolderId from state when no parameter provided', async () => {
      const folderId = 'folder-root-1';

      // Set currentFolderId in state
      act(() => {
        useFileStore.setState({ currentFolderId: folderId });
      });

      server.use(
        http.get(`${API_URL}/api/files`, ({ request }) => {
          const url = new URL(request.url);
          const folderIdParam = url.searchParams.get('folderId');

          // Should use currentFolderId from state
          expect(folderIdParam).toBe(folderId);

          return HttpResponse.json({
            files: [mockSubFolder, mockSubFile],
            pagination: {
              total: 2,
              limit: 50,
              offset: 0,
            },
          });
        })
      );

      await act(async () => {
        await useFileStore.getState().fetchFiles();
      });

      const state = useFileStore.getState();
      expect(state.files).toHaveLength(2);
      expect(state.currentFolderId).toBe(folderId);
    });
  });

  describe('createFolder() - NULL/undefined handling', () => {
    it('should create root folder when currentFolderId=null', async () => {
      const newFolder: ParsedFile = {
        id: 'folder-new-1',
        userId: 'user-123',
        parentFolderId: null,
        name: 'New Folder',
        mimeType: 'inode/directory',
        sizeBytes: 0,
        blobPath: '',
        isFolder: true,
        isFavorite: false,
        processingStatus: 'completed',
        embeddingStatus: 'not_started',
        hasExtractedText: false,
        createdAt: '2024-01-03T10:00:00.000Z',
        updatedAt: '2024-01-03T10:00:00.000Z',
      };

      server.use(
        http.post(`${API_URL}/api/files/folders`, async ({ request }) => {
          const body = await request.json() as { name: string; parentFolderId?: string };

          // parentFolderId should NOT be present for root folder
          expect(body.parentFolderId).toBeUndefined();
          expect(body.name).toBe('New Folder');

          return HttpResponse.json({ folder: newFolder });
        })
      );

      // Set currentFolderId to null
      act(() => {
        useFileStore.setState({ currentFolderId: null });
      });

      let result: ParsedFile | null = null;
      await act(async () => {
        result = await useFileStore.getState().createFolder('New Folder');
      });

      expect(result).toEqual(newFolder);
      const state = useFileStore.getState();
      expect(state.files).toContainEqual(newFolder);
    });

    it('should create nested folder when currentFolderId=UUID', async () => {
      const parentFolderId = 'folder-root-1';
      const newFolder: ParsedFile = {
        id: 'folder-nested-1',
        userId: 'user-123',
        parentFolderId: parentFolderId,
        name: 'Nested Folder',
        mimeType: 'inode/directory',
        sizeBytes: 0,
        blobPath: '',
        isFolder: true,
        isFavorite: false,
        processingStatus: 'completed',
        embeddingStatus: 'not_started',
        hasExtractedText: false,
        createdAt: '2024-01-03T11:00:00.000Z',
        updatedAt: '2024-01-03T11:00:00.000Z',
      };

      server.use(
        http.post(`${API_URL}/api/files/folders`, async ({ request }) => {
          const body = await request.json() as { name: string; parentFolderId?: string };

          // parentFolderId SHOULD be present
          expect(body.parentFolderId).toBe(parentFolderId);
          expect(body.name).toBe('Nested Folder');

          return HttpResponse.json({ folder: newFolder });
        })
      );

      // Set currentFolderId
      act(() => {
        useFileStore.setState({ currentFolderId: parentFolderId });
      });

      let result: ParsedFile | null = null;
      await act(async () => {
        result = await useFileStore.getState().createFolder('Nested Folder');
      });

      expect(result).toEqual(newFolder);
      const state = useFileStore.getState();
      expect(state.files).toContainEqual(newFolder);
    });
  });

  describe('navigateToFolder() - NULL/undefined handling', () => {
    it('should navigate to root when folderId=null', async () => {
      server.use(
        http.get(`${API_URL}/api/files`, ({ request }) => {
          const url = new URL(request.url);
          const folderId = url.searchParams.get('folderId');

          // folderId should NOT be in query params
          expect(folderId).toBeNull();

          return HttpResponse.json({
            files: [mockRootFolder, mockRootFile],
            pagination: {
              total: 2,
              limit: 50,
              offset: 0,
            },
          });
        })
      );

      await act(async () => {
        await useFileStore.getState().navigateToFolder(null);
      });

      const state = useFileStore.getState();
      expect(state.currentFolderId).toBe(null);
      expect(state.folderPath).toEqual([]);
      expect(state.files).toHaveLength(2);
    });

    it('should navigate to subfolder with path building', async () => {
      const folderId = 'folder-sub-1';

      // Mock getFile for building path
      server.use(
        http.get(`${API_URL}/api/files/${folderId}`, () => {
          return HttpResponse.json({
            file: mockSubFolder,
          });
        }),
        http.get(`${API_URL}/api/files/folder-root-1`, () => {
          return HttpResponse.json({
            file: mockRootFolder,
          });
        }),
        http.get(`${API_URL}/api/files`, ({ request }) => {
          const url = new URL(request.url);
          const folderIdParam = url.searchParams.get('folderId');

          expect(folderIdParam).toBe(folderId);

          return HttpResponse.json({
            files: [mockSubFile],
            pagination: {
              total: 1,
              limit: 50,
              offset: 0,
            },
          });
        })
      );

      await act(async () => {
        await useFileStore.getState().navigateToFolder(folderId);
      });

      const state = useFileStore.getState();
      expect(state.currentFolderId).toBe(folderId);
      expect(state.folderPath).toHaveLength(2);
      expect(state.folderPath[0]?.id).toBe('folder-root-1');
      expect(state.folderPath[1]?.id).toBe('folder-sub-1');
    });
  });

  describe('uploadFiles() - NULL/undefined handling', () => {
    it('should upload to root when currentFolderId=null', async () => {
      const mockFile = new File(['test content'], 'test.txt', { type: 'text/plain' });
      const uploadedFile: ParsedFile = {
        id: 'file-uploaded-1',
        userId: 'user-123',
        parentFolderId: null,
        name: 'test.txt',
        mimeType: 'text/plain',
        sizeBytes: 12,
        blobPath: 'user-123/file-uploaded-1.txt',
        isFolder: false,
        isFavorite: false,
        processingStatus: 'pending',
        embeddingStatus: 'not_started',
        hasExtractedText: false,
        createdAt: '2024-01-03T12:00:00.000Z',
        updatedAt: '2024-01-03T12:00:00.000Z',
      };

      server.use(
        http.post(`${API_URL}/api/files/upload`, async ({ request }) => {
          const formData = await request.formData();
          const parentFolderId = formData.get('parentFolderId');

          // parentFolderId should NOT be present for root upload
          expect(parentFolderId).toBeNull();

          return HttpResponse.json({ files: [uploadedFile] });
        })
      );

      // Set currentFolderId to null
      act(() => {
        useFileStore.setState({ currentFolderId: null });
      });

      await act(async () => {
        await useFileStore.getState().uploadFiles([mockFile]);
      });

      const state = useFileStore.getState();
      expect(state.files).toContainEqual(uploadedFile);
      expect(state.isUploading).toBe(false);
      expect(state.uploadProgress).toBe(100);
    });

    it('should upload to subfolder when currentFolderId=UUID', async () => {
      const parentFolderId = 'folder-root-1';
      const mockFile = new File(['test content'], 'test.txt', { type: 'text/plain' });
      const uploadedFile: ParsedFile = {
        id: 'file-uploaded-2',
        userId: 'user-123',
        parentFolderId: parentFolderId,
        name: 'test.txt',
        mimeType: 'text/plain',
        sizeBytes: 12,
        blobPath: 'user-123/file-uploaded-2.txt',
        isFolder: false,
        isFavorite: false,
        processingStatus: 'pending',
        embeddingStatus: 'not_started',
        hasExtractedText: false,
        createdAt: '2024-01-03T13:00:00.000Z',
        updatedAt: '2024-01-03T13:00:00.000Z',
      };

      server.use(
        http.post(`${API_URL}/api/files/upload`, async ({ request }) => {
          const formData = await request.formData();
          const parentFolderIdValue = formData.get('parentFolderId');

          // parentFolderId SHOULD be present
          expect(parentFolderIdValue).toBe(parentFolderId);

          return HttpResponse.json({ files: [uploadedFile] });
        })
      );

      // Set currentFolderId
      act(() => {
        useFileStore.setState({ currentFolderId: parentFolderId });
      });

      await act(async () => {
        await useFileStore.getState().uploadFiles([mockFile]);
      });

      const state = useFileStore.getState();
      expect(state.files).toContainEqual(uploadedFile);
      expect(state.isUploading).toBe(false);
    });
  });
});
