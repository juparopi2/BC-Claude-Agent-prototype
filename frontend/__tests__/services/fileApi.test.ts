/**
 * File API Client Tests
 *
 * Tests for fileApi service focusing on parameter serialization.
 * Specifically verifies that null/undefined parameters are properly
 * omitted from query strings and request bodies.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import {
  FileApiClient,
  getFileApiClient,
  resetFileApiClient,
} from '@/src/infrastructure/api';
import { server } from '../../vitest.setup';
import type {
  FilesListResponse,
  FolderResponse,
  UploadFilesResponse,
  ParsedFile,
} from '@bc-agent/shared';

// Base URL for mocking
const API_URL = 'http://localhost:3002';

// Mock data
const mockFile: ParsedFile = {
  id: 'file-123',
  userId: 'user-123',
  parentFolderId: null,
  name: 'document.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 1024000,
  blobPath: 'users/user-123/files/document.pdf',
  isFolder: false,
  isFavorite: false,
  processingStatus: 'completed',
  embeddingStatus: 'completed',
  hasExtractedText: true,
  createdAt: '2024-01-15T10:30:00.000Z',
  updatedAt: '2024-01-15T10:30:00.000Z',
};

const mockFolder: ParsedFile = {
  id: 'folder-123',
  userId: 'user-123',
  parentFolderId: null,
  name: 'My Documents',
  mimeType: 'inode/directory',
  sizeBytes: 0,
  blobPath: '',
  isFolder: true,
  isFavorite: false,
  processingStatus: 'completed',
  embeddingStatus: 'completed',
  hasExtractedText: false,
  createdAt: '2024-01-15T10:00:00.000Z',
  updatedAt: '2024-01-15T10:00:00.000Z',
};

const mockFilesResponse: FilesListResponse = {
  files: [mockFile, mockFolder],
  pagination: {
    total: 2,
    limit: 50,
    offset: 0,
  },
};

describe('FileApiClient - Parameter Serialization', () => {
  let api: FileApiClient;

  beforeEach(() => {
    resetFileApiClient();
    api = getFileApiClient();
  });

  describe('getFiles() - Query Parameter Handling', () => {
    it('Test 1: should OMIT folderId when null', async () => {
      let capturedUrl = '';

      // Mock handler that captures the request URL
      server.use(
        http.get(`${API_URL}/api/files`, ({ request }) => {
          capturedUrl = request.url;
          return HttpResponse.json(mockFilesResponse);
        })
      );

      // Call with explicit null
      await api.getFiles({ folderId: null });

      // Verify folderId is NOT in query string
      expect(capturedUrl).not.toContain('folderId');
      expect(capturedUrl).toBe(`${API_URL}/api/files`);
    });

    it('Test 2: should OMIT folderId when undefined', async () => {
      let capturedUrl = '';

      server.use(
        http.get(`${API_URL}/api/files`, ({ request }) => {
          capturedUrl = request.url;
          return HttpResponse.json(mockFilesResponse);
        })
      );

      // Call with explicit undefined
      await api.getFiles({ folderId: undefined });

      // Verify folderId is NOT in query string
      expect(capturedUrl).not.toContain('folderId');
      expect(capturedUrl).toBe(`${API_URL}/api/files`);
    });

    it('Test 3: should OMIT folderId when options object omits it', async () => {
      let capturedUrl = '';

      server.use(
        http.get(`${API_URL}/api/files`, ({ request }) => {
          capturedUrl = request.url;
          return HttpResponse.json(mockFilesResponse);
        })
      );

      // Call with no folderId in options
      await api.getFiles({});

      // Verify folderId is NOT in query string
      expect(capturedUrl).not.toContain('folderId');
      expect(capturedUrl).toBe(`${API_URL}/api/files`);
    });

    it('Test 4: should INCLUDE folderId when it is a valid UUID', async () => {
      let capturedUrl = '';

      server.use(
        http.get(`${API_URL}/api/files`, ({ request }) => {
          capturedUrl = request.url;
          return HttpResponse.json(mockFilesResponse);
        })
      );

      // Call with valid folder ID
      await api.getFiles({ folderId: 'folder-456' });

      // Verify folderId IS in query string
      expect(capturedUrl).toContain('folderId=folder-456');
      expect(capturedUrl).toBe(`${API_URL}/api/files?folderId=folder-456`);
    });

    it('Test 5: should combine folderId with other parameters correctly', async () => {
      let capturedUrl = '';

      server.use(
        http.get(`${API_URL}/api/files`, ({ request }) => {
          capturedUrl = request.url;
          return HttpResponse.json(mockFilesResponse);
        })
      );

      // Call with multiple parameters
      await api.getFiles({
        folderId: 'folder-789',
        sortBy: 'date',
        favoritesFirst: true,
        limit: 20,
        offset: 10,
      });

      // Verify all parameters are in query string
      expect(capturedUrl).toContain('folderId=folder-789');
      expect(capturedUrl).toContain('sortBy=date');
      expect(capturedUrl).toContain('favoritesFirst=true');
      expect(capturedUrl).toContain('limit=20');
      expect(capturedUrl).toContain('offset=10');

      // Parse URL to verify exact parameters
      const url = new URL(capturedUrl);
      expect(url.searchParams.get('folderId')).toBe('folder-789');
      expect(url.searchParams.get('sortBy')).toBe('date');
      expect(url.searchParams.get('favoritesFirst')).toBe('true');
      expect(url.searchParams.get('limit')).toBe('20');
      expect(url.searchParams.get('offset')).toBe('10');
    });
  });

  describe('createFolder() - Request Body Handling', () => {
    it('Test 6: should OMIT parentFolderId when creating root folder', async () => {
      let capturedBody: unknown = null;

      server.use(
        http.post(`${API_URL}/api/files/folders`, async ({ request }) => {
          capturedBody = await request.json();
          return HttpResponse.json(
            { folder: mockFolder },
            { status: 201 }
          );
        })
      );

      // Create root-level folder (no parentFolderId)
      await api.createFolder({ name: 'Root Folder' });

      // Verify parentFolderId is NOT in body
      expect(capturedBody).toEqual({ name: 'Root Folder' });
      expect(capturedBody).not.toHaveProperty('parentFolderId');
    });

    it('Test 7: should INCLUDE parentFolderId when creating nested folder', async () => {
      let capturedBody: unknown = null;

      const nestedFolder: ParsedFile = {
        ...mockFolder,
        id: 'folder-nested',
        name: 'Nested Folder',
        parentFolderId: 'folder-parent',
      };

      server.use(
        http.post(`${API_URL}/api/files/folders`, async ({ request }) => {
          capturedBody = await request.json();
          return HttpResponse.json(
            { folder: nestedFolder },
            { status: 201 }
          );
        })
      );

      // Create nested folder (with parentFolderId)
      await api.createFolder({
        name: 'Nested Folder',
        parentFolderId: 'folder-parent',
      });

      // Verify parentFolderId IS in body
      expect(capturedBody).toEqual({
        name: 'Nested Folder',
        parentFolderId: 'folder-parent',
      });
    });
  });

  describe('uploadFiles() - FormData Handling', () => {
    it('Test 8: should OMIT parentFolderId when uploading to root', async () => {
      let capturedFormData: FormData | null = null;

      server.use(
        http.post(`${API_URL}/api/files/upload`, async ({ request }) => {
          capturedFormData = await request.formData();
          const response: UploadFilesResponse = {
            files: [mockFile],
          };
          return HttpResponse.json(response);
        })
      );

      // Create mock file
      const mockFileBlob = new File(['test content'], 'test.txt', {
        type: 'text/plain',
      });

      // Upload without parentFolderId (undefined)
      await api.uploadFiles([mockFileBlob], undefined);

      // Verify parentFolderId is NOT in FormData
      expect(capturedFormData).not.toBeNull();
      expect(capturedFormData!.has('parentFolderId')).toBe(false);
      expect(capturedFormData!.has('files')).toBe(true);
    });

    it('Test 9: should INCLUDE parentFolderId when uploading to subfolder', async () => {
      let capturedFormData: FormData | null = null;

      server.use(
        http.post(`${API_URL}/api/files/upload`, async ({ request }) => {
          capturedFormData = await request.formData();
          const response: UploadFilesResponse = {
            files: [{ ...mockFile, parentFolderId: 'folder-upload' }],
          };
          return HttpResponse.json(response);
        })
      );

      // Create mock file
      const mockFileBlob = new File(['test content'], 'test.txt', {
        type: 'text/plain',
      });

      // Upload with parentFolderId
      await api.uploadFiles([mockFileBlob], 'folder-upload');

      // Verify parentFolderId IS in FormData
      expect(capturedFormData).not.toBeNull();
      expect(capturedFormData!.has('parentFolderId')).toBe(true);
      expect(capturedFormData!.get('parentFolderId')).toBe('folder-upload');
      expect(capturedFormData!.has('files')).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('Test 10: should handle API error responses gracefully', async () => {
      server.use(
        http.get(`${API_URL}/api/files`, () => {
          return HttpResponse.json(
            {
              error: 'Internal Server Error',
              message: 'Database connection failed',
              code: 'INTERNAL_ERROR',
            },
            { status: 500 }
          );
        })
      );

      const result = await api.getFiles({ folderId: null });

      // Verify error response structure
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.error).toBe('Internal Server Error');
        expect(result.error.message).toBe('Database connection failed');
        expect(result.error.code).toBe('INTERNAL_ERROR');
      }
    });
  });

  describe('Singleton Pattern', () => {
    it('should return the same instance', () => {
      const instance1 = getFileApiClient();
      const instance2 = getFileApiClient();

      expect(instance1).toBe(instance2);
    });

    it('should reset singleton correctly', () => {
      const instance1 = getFileApiClient();
      resetFileApiClient();
      const instance2 = getFileApiClient();

      expect(instance1).not.toBe(instance2);
    });
  });
});
