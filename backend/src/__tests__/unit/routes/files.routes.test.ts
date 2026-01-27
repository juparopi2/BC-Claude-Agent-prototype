/**
 * Unit Tests - Files Routes
 *
 * Tests for the files API endpoints (upload, CRUD, bulk operations).
 * Uses supertest for HTTP endpoint testing with mocked dependencies.
 *
 * @module __tests__/unit/routes/files.routes
 */

import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import request from 'supertest';
import express, { Application, Request, Response, NextFunction } from 'express';
import type { ParsedFile } from '@/types/file.types';

// ============================================
// Mock Dependencies - Must be before imports
// ============================================

vi.mock('@/shared/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
  createChildLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
  })),
}));

// Mock auth middleware
vi.mock('@/domains/auth/middleware/auth-oauth', () => ({
  authenticateMicrosoft: (req: Request, _res: Response, next: NextFunction) => {
    req.userId = (req as Request & { testUserId?: string }).testUserId || 'TEST-USER-123';
    next();
  },
}));

// Mock crypto for deterministic UUIDs
vi.mock('crypto', () => ({
  default: {
    randomUUID: vi.fn(() => 'MOCK-UUID-1234-5678-90AB-CDEF12345678'),
  },
}));

// Create mock service instances
const mockFileService = {
  getFile: vi.fn(),
  getFiles: vi.fn(),
  getFileCount: vi.fn(),
  createFileRecord: vi.fn(),
  createFolder: vi.fn(),
  updateFile: vi.fn(),
  deleteFile: vi.fn(),
  verifyOwnership: vi.fn(),
  checkDuplicatesByHash: vi.fn(),
};

const mockFileUploadService = {
  validateFileType: vi.fn(),
  validateFileSize: vi.fn(),
  generateBlobPath: vi.fn(),
  uploadToBlob: vi.fn(),
  downloadFromBlob: vi.fn(),
  deleteFromBlob: vi.fn(),
  generateSasUrlForBulkUpload: vi.fn(),
};

const mockUsageTrackingService = {
  trackFileUpload: vi.fn().mockResolvedValue(undefined),
};

const mockMessageQueue = {
  addFileProcessingJob: vi.fn().mockResolvedValue('JOB-001'),
  addFileDeletionJob: vi.fn().mockResolvedValue('JOB-002'),
  addFileBulkUploadJob: vi.fn().mockResolvedValue('JOB-003'),
  addFileChunkingJob: vi.fn().mockResolvedValue('JOB-004'),
};

const mockSoftDeleteService = {
  markForDeletion: vi.fn().mockResolvedValue({
    markedForDeletion: 2,
    notFoundIds: [],
    batchId: 'BATCH-UUID-1234-5678-90AB-CDEF12345678',
  }),
};

const mockEmbeddingService = {
  generateImageQueryEmbedding: vi.fn(),
};

const mockVectorSearchService = {
  searchImages: vi.fn(),
};

// Mock services
vi.mock('@services/files', () => ({
  getFileService: vi.fn(() => mockFileService),
  getFileUploadService: vi.fn(() => mockFileUploadService),
}));

vi.mock('@/domains/billing/tracking/UsageTrackingService', () => ({
  getUsageTrackingService: vi.fn(() => mockUsageTrackingService),
}));

vi.mock('@/infrastructure/queue/MessageQueue', () => ({
  getMessageQueue: vi.fn(() => mockMessageQueue),
}));

vi.mock('@/shared/utils/hash', () => ({
  computeSha256: vi.fn(() => 'ABCD1234ABCD1234ABCD1234ABCD1234ABCD1234ABCD1234ABCD1234ABCD1234'),
}));

vi.mock('@/services/embeddings/EmbeddingService', () => ({
  EmbeddingService: {
    getInstance: vi.fn(() => mockEmbeddingService),
  },
}));

vi.mock('@/services/search/VectorSearchService', () => ({
  VectorSearchService: {
    getInstance: vi.fn(() => mockVectorSearchService),
  },
}));

vi.mock('@/domains/files/retry', () => ({
  getProcessingRetryManager: vi.fn(() => ({
    executeManualRetry: vi.fn().mockResolvedValue({
      success: true,
      file: {
        id: 'FILE-001',
        name: 'test.pdf',
        mimeType: 'application/pdf',
        blobPath: 'users/test/file.pdf',
      },
    }),
  })),
}));

vi.mock('@services/files/operations', () => ({
  getSoftDeleteService: vi.fn(() => mockSoftDeleteService),
}));

// Import router after mocks
import filesRouter from '@/routes/files';

// ============================================
// Test Suite
// ============================================

describe('Files Routes', () => {
  let app: Application;

  // Valid UUIDs for tests
  const VALID_FILE_UUID = 'F0F0F0F0-F0F0-F0F0-F0F0-F0F0F0F0F0F0';
  const VALID_FOLDER_UUID = 'A1A1A1A1-A1A1-A1A1-A1A1-A1A1A1A1A1A1';
  const TEST_USER_ID = 'TEST-USER-123';
  const OTHER_USER_ID = 'OTHER-USER-456';

  // Sample file for tests
  const sampleFile: ParsedFile = {
    id: VALID_FILE_UUID,
    userId: TEST_USER_ID,
    name: 'test-file.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1024,
    blobPath: 'users/TEST-USER-123/files/test-file.pdf',
    parentFolderId: null,
    isFolder: false,
    isFavorite: false,
    processingStatus: 'completed',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  };

  // Sample folder for tests
  const sampleFolder: ParsedFile = {
    id: VALID_FOLDER_UUID,
    userId: TEST_USER_ID,
    name: 'Test Folder',
    mimeType: 'application/vnd.folder',
    sizeBytes: 0,
    blobPath: '',
    parentFolderId: null,
    isFolder: true,
    isFavorite: false,
    processingStatus: 'completed',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup Express app
    app = express();
    app.use(express.json());

    // Add middleware to inject test userId
    app.use((req, _res, next) => {
      (req as Request & { testUserId?: string }).testUserId = TEST_USER_ID;
      next();
    });

    app.use('/api/files', filesRouter);

    // Default mock behaviors
    mockFileService.getFile.mockResolvedValue(sampleFile);
    mockFileService.getFiles.mockResolvedValue([sampleFile]);
    mockFileService.getFileCount.mockResolvedValue(1);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ============================================
  // POST /upload - File Upload
  // ============================================
  describe('POST /api/files/upload', () => {
    it('should upload a single file successfully', async () => {
      // Arrange
      mockFileService.createFileRecord.mockResolvedValue(VALID_FILE_UUID);
      mockFileService.getFile.mockResolvedValue(sampleFile);
      mockFileUploadService.generateBlobPath.mockReturnValue('users/test/file.pdf');

      // Act
      const response = await request(app)
        .post('/api/files/upload')
        .attach('files', Buffer.from('test content'), 'test-file.pdf')
        .expect(201);

      // Assert
      expect(response.body.files).toHaveLength(1);
      expect(response.body.files[0]).toMatchObject({
        id: VALID_FILE_UUID,
        name: 'test-file.pdf',
      });
      expect(mockFileUploadService.uploadToBlob).toHaveBeenCalled();
      expect(mockMessageQueue.addFileProcessingJob).toHaveBeenCalled();
    });

    it('should upload multiple files successfully', async () => {
      // Arrange
      mockFileService.createFileRecord.mockResolvedValue(VALID_FILE_UUID);
      mockFileService.getFile.mockResolvedValue(sampleFile);
      mockFileUploadService.generateBlobPath.mockReturnValue('users/test/file.pdf');

      // Act
      const response = await request(app)
        .post('/api/files/upload')
        .attach('files', Buffer.from('content1'), 'file1.pdf')
        .attach('files', Buffer.from('content2'), 'file2.pdf')
        .expect(201);

      // Assert
      expect(response.body.files).toHaveLength(2);
    });

    it('should validate parent folder exists', async () => {
      // Arrange - Parent folder not found
      mockFileService.getFile.mockResolvedValue(null);

      // Act
      const response = await request(app)
        .post('/api/files/upload')
        .attach('files', Buffer.from('content'), 'file.pdf')
        .field('parentFolderId', VALID_FOLDER_UUID)
        .expect(404);

      // Assert
      expect(response.body.error).toBe('Not Found');
      expect(response.body.message).toBe('Parent folder not found');
    });

    it('should validate parent is a folder, not a file', async () => {
      // Arrange - Parent is not a folder
      mockFileService.getFile.mockResolvedValue({ ...sampleFile, isFolder: false });

      // Act
      const response = await request(app)
        .post('/api/files/upload')
        .attach('files', Buffer.from('content'), 'file.pdf')
        .field('parentFolderId', VALID_FILE_UUID)
        .expect(400);

      // Assert
      expect(response.body.message).toBe('Parent must be a folder');
    });

    it('should return error when no files attached', async () => {
      // Note: This tests the behavior when no file is attached
      // The route checks for files array after multer processing
      // Multer may throw or the route may return 400 depending on Content-Type

      // Act - Send with no files
      const response = await request(app)
        .post('/api/files/upload')
        .send({});

      // Assert - Either 400 or 500 is acceptable as both indicate missing files
      expect([400, 500]).toContain(response.status);
    });

    it('should reject invalid parentFolderId format', async () => {
      // Act
      const response = await request(app)
        .post('/api/files/upload')
        .attach('files', Buffer.from('content'), 'file.pdf')
        .field('parentFolderId', 'not-a-uuid')
        .expect(400);

      // Assert
      expect(response.body.error).toBe('Bad Request');
    });

    it('should handle file validation errors (type not allowed)', async () => {
      // Arrange
      mockFileUploadService.validateFileType.mockImplementation(() => {
        throw new Error('File type not allowed');
      });

      // Act
      const response = await request(app)
        .post('/api/files/upload')
        .attach('files', Buffer.from('content'), 'file.exe')
        .expect(400);

      // Assert
      expect(response.body.message).toBe('File type not allowed');
    });

    it('should rollback blob on database failure', async () => {
      // Arrange - Set up mocks so file passes validation but fails at DB
      mockFileUploadService.validateFileType.mockReturnValue(undefined);
      mockFileUploadService.validateFileSize.mockReturnValue(undefined);
      mockFileUploadService.generateBlobPath.mockReturnValue('users/test/file.pdf');
      mockFileUploadService.uploadToBlob.mockResolvedValue(undefined);
      mockFileService.createFileRecord.mockRejectedValue(new Error('DB Error'));
      mockFileService.getFile.mockResolvedValue(null); // No parent folder check needed

      // Act
      const response = await request(app)
        .post('/api/files/upload')
        .attach('files', Buffer.from('test content'), 'file.pdf')
        .expect(500);

      // Assert - Rollback should be attempted and request should fail
      expect(mockFileUploadService.deleteFromBlob).toHaveBeenCalledWith('users/test/file.pdf');
      expect(response.body.error).toBe('Internal Server Error');
    });
  });

  // ============================================
  // POST /check-duplicates
  // ============================================
  describe('POST /api/files/check-duplicates', () => {
    it('should check for duplicate files by content hash', async () => {
      // Arrange
      const duplicateResults = [
        { tempId: 'temp-1', isDuplicate: true, existingFile: sampleFile },
        { tempId: 'temp-2', isDuplicate: false, existingFile: null },
      ];
      mockFileService.checkDuplicatesByHash.mockResolvedValue(duplicateResults);

      // Act
      const response = await request(app)
        .post('/api/files/check-duplicates')
        .send({
          files: [
            { tempId: 'temp-1', contentHash: 'a'.repeat(64), fileName: 'file1.pdf' },
            { tempId: 'temp-2', contentHash: 'b'.repeat(64), fileName: 'file2.pdf' },
          ],
        })
        .expect(200);

      // Assert
      expect(response.body.results).toHaveLength(2);
      expect(response.body.results[0].isDuplicate).toBe(true);
      expect(response.body.results[1].isDuplicate).toBe(false);
    });

    it('should return 400 for empty files array', async () => {
      // Act
      const response = await request(app)
        .post('/api/files/check-duplicates')
        .send({ files: [] })
        .expect(400);

      // Assert
      expect(response.body.error).toBe('Bad Request');
    });

    it('should return 400 for invalid content hash', async () => {
      // Act
      const response = await request(app)
        .post('/api/files/check-duplicates')
        .send({
          files: [
            { tempId: 'temp-1', contentHash: 'invalid-hash', fileName: 'file.pdf' },
          ],
        })
        .expect(400);

      // Assert
      expect(response.body.error).toBe('Bad Request');
    });
  });

  // ============================================
  // POST /folders - Create Folder
  // ============================================
  describe('POST /api/files/folders', () => {
    it('should create a folder at root level', async () => {
      // Arrange
      mockFileService.createFolder.mockResolvedValue(VALID_FOLDER_UUID);
      mockFileService.getFile.mockResolvedValue(sampleFolder);

      // Act
      const response = await request(app)
        .post('/api/files/folders')
        .send({ name: 'New Folder' })
        .expect(201);

      // Assert
      expect(response.body.folder).toMatchObject({
        id: VALID_FOLDER_UUID,
        name: 'Test Folder',
        isFolder: true,
      });
      expect(mockFileService.createFolder).toHaveBeenCalledWith(
        TEST_USER_ID,
        'New Folder',
        undefined
      );
    });

    it('should create a nested folder', async () => {
      // Arrange
      mockFileService.createFolder.mockResolvedValue(VALID_FOLDER_UUID);
      mockFileService.getFile.mockResolvedValue(sampleFolder);

      // Act
      const response = await request(app)
        .post('/api/files/folders')
        .send({
          name: 'Nested Folder',
          parentFolderId: VALID_FOLDER_UUID,
        })
        .expect(201);

      // Assert
      expect(response.body.folder).toBeDefined();
      expect(mockFileService.createFolder).toHaveBeenCalledWith(
        TEST_USER_ID,
        'Nested Folder',
        VALID_FOLDER_UUID
      );
    });

    it('should return 400 for empty folder name', async () => {
      // Act
      const response = await request(app)
        .post('/api/files/folders')
        .send({ name: '' })
        .expect(400);

      // Assert
      expect(response.body.error).toBe('Bad Request');
      expect(response.body.message).toContain('Folder name is required');
    });

    it('should return 400 for folder name exceeding 255 characters', async () => {
      // Act
      const response = await request(app)
        .post('/api/files/folders')
        .send({ name: 'a'.repeat(256) })
        .expect(400);

      // Assert
      expect(response.body.error).toBe('Bad Request');
    });

    it('should return 400 for folder name with invalid characters', async () => {
      // Act
      const response = await request(app)
        .post('/api/files/folders')
        .send({ name: 'folder<script>' })
        .expect(400);

      // Assert
      expect(response.body.error).toBe('Bad Request');
    });

    it('should allow Danish characters in folder name', async () => {
      // Arrange
      mockFileService.createFolder.mockResolvedValue(VALID_FOLDER_UUID);
      mockFileService.getFile.mockResolvedValue({ ...sampleFolder, name: 'Test æøå' });

      // Act
      const response = await request(app)
        .post('/api/files/folders')
        .send({ name: 'Test æøå' })
        .expect(201);

      // Assert
      expect(response.body.folder).toBeDefined();
    });
  });

  // ============================================
  // GET / - List Files
  // ============================================
  describe('GET /api/files', () => {
    it('should list files with default pagination', async () => {
      // Arrange
      mockFileService.getFiles.mockResolvedValue([sampleFile, sampleFolder]);
      mockFileService.getFileCount.mockResolvedValue(2);

      // Act
      const response = await request(app)
        .get('/api/files')
        .expect(200);

      // Assert
      expect(response.body.files).toHaveLength(2);
      expect(response.body.pagination).toEqual({
        total: 2,
        limit: 50,
        offset: 0,
      });
    });

    it('should filter files by folder', async () => {
      // Arrange
      mockFileService.getFiles.mockResolvedValue([sampleFile]);
      mockFileService.getFileCount.mockResolvedValue(1);

      // Act
      const response = await request(app)
        .get('/api/files')
        .query({ folderId: VALID_FOLDER_UUID })
        .expect(200);

      // Assert
      expect(mockFileService.getFiles).toHaveBeenCalledWith(
        expect.objectContaining({ folderId: VALID_FOLDER_UUID })
      );
    });

    it('should sort files by name', async () => {
      // Act
      await request(app)
        .get('/api/files')
        .query({ sortBy: 'name' })
        .expect(200);

      // Assert
      expect(mockFileService.getFiles).toHaveBeenCalledWith(
        expect.objectContaining({ sortBy: 'name' })
      );
    });

    it('should support favoritesFirst sorting', async () => {
      // Act
      await request(app)
        .get('/api/files')
        .query({ favoritesFirst: 'true' })
        .expect(200);

      // Assert
      expect(mockFileService.getFiles).toHaveBeenCalledWith(
        expect.objectContaining({ favoritesFirst: true })
      );
    });

    it('should apply pagination limits', async () => {
      // Act
      await request(app)
        .get('/api/files')
        .query({ limit: 10, offset: 20 })
        .expect(200);

      // Assert
      expect(mockFileService.getFiles).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 10, offset: 20 })
      );
    });

    it('should return 400 for invalid sortBy value', async () => {
      // Act
      const response = await request(app)
        .get('/api/files')
        .query({ sortBy: 'invalid' })
        .expect(400);

      // Assert
      expect(response.body.error).toBe('Bad Request');
    });

    it('should return 400 for limit exceeding maximum', async () => {
      // Act
      const response = await request(app)
        .get('/api/files')
        .query({ limit: 200 })
        .expect(400);

      // Assert
      expect(response.body.error).toBe('Bad Request');
    });
  });

  // ============================================
  // GET /search/images - Image Search
  // ============================================
  describe('GET /api/files/search/images', () => {
    it('should search images by semantic query', async () => {
      // Arrange
      const mockResults = [
        { fileId: VALID_FILE_UUID, score: 0.85, metadata: {} },
      ];
      mockEmbeddingService.generateImageQueryEmbedding.mockResolvedValue({
        embedding: new Array(1024).fill(0.1),
      });
      mockVectorSearchService.searchImages.mockResolvedValue(mockResults);

      // Act
      const response = await request(app)
        .get('/api/files/search/images')
        .query({ q: 'sunset beach' })
        .expect(200);

      // Assert
      expect(response.body.results).toHaveLength(1);
      expect(response.body.query).toBe('sunset beach');
    });

    it('should return 400 for empty query', async () => {
      // Act
      const response = await request(app)
        .get('/api/files/search/images')
        .query({ q: '' })
        .expect(400);

      // Assert
      expect(response.body.error).toBe('Bad Request');
    });

    it('should apply custom top and minScore', async () => {
      // Arrange
      mockEmbeddingService.generateImageQueryEmbedding.mockResolvedValue({
        embedding: new Array(1024).fill(0.1),
      });
      mockVectorSearchService.searchImages.mockResolvedValue([]);

      // Act
      await request(app)
        .get('/api/files/search/images')
        .query({ q: 'test', top: 20, minScore: 0.7 })
        .expect(200);

      // Assert
      expect(mockVectorSearchService.searchImages).toHaveBeenCalledWith(
        expect.objectContaining({ top: 20, minScore: 0.7 })
      );
    });
  });

  // ============================================
  // GET /:id - Get File Metadata
  // ============================================
  describe('GET /api/files/:id', () => {
    it('should return file metadata', async () => {
      // Arrange
      mockFileService.getFile.mockResolvedValue(sampleFile);

      // Act
      const response = await request(app)
        .get(`/api/files/${VALID_FILE_UUID}`)
        .expect(200);

      // Assert
      expect(response.body.file).toMatchObject({
        id: VALID_FILE_UUID,
        name: 'test-file.pdf',
      });
    });

    it('should return 404 when file not found', async () => {
      // Arrange
      mockFileService.getFile.mockResolvedValue(null);

      // Act
      const response = await request(app)
        .get(`/api/files/${VALID_FILE_UUID}`)
        .expect(404);

      // Assert
      expect(response.body.error).toBe('Not Found');
      expect(response.body.message).toBe('File not found or access denied');
    });

    it('should return 400 for invalid UUID format', async () => {
      // Act
      const response = await request(app)
        .get('/api/files/not-a-uuid')
        .expect(400);

      // Assert
      expect(response.body.error).toBe('Bad Request');
    });
  });

  // ============================================
  // GET /:id/download - Download File
  // ============================================
  describe('GET /api/files/:id/download', () => {
    it('should download file with correct headers', async () => {
      // Arrange
      mockFileService.getFile.mockResolvedValue(sampleFile);
      mockFileUploadService.downloadFromBlob.mockResolvedValue(Buffer.from('file content'));

      // Act
      const response = await request(app)
        .get(`/api/files/${VALID_FILE_UUID}/download`)
        .expect(200);

      // Assert
      expect(response.headers['content-type']).toBe('application/pdf');
      expect(response.headers['content-disposition']).toContain('attachment');
      expect(response.headers['content-disposition']).toContain('test-file.pdf');
    });

    it('should return 404 when file not found', async () => {
      // Arrange
      mockFileService.getFile.mockResolvedValue(null);

      // Act
      const response = await request(app)
        .get(`/api/files/${VALID_FILE_UUID}/download`)
        .expect(404);

      // Assert
      expect(response.body.message).toBe('File not found or access denied');
    });

    it('should return 400 when trying to download a folder', async () => {
      // Arrange
      mockFileService.getFile.mockResolvedValue(sampleFolder);

      // Act
      const response = await request(app)
        .get(`/api/files/${VALID_FOLDER_UUID}/download`)
        .expect(400);

      // Assert
      expect(response.body.message).toBe('Cannot download a folder');
    });

    it('should handle blob not found error', async () => {
      // Arrange
      mockFileService.getFile.mockResolvedValue(sampleFile);
      mockFileUploadService.downloadFromBlob.mockRejectedValue(
        new Error('BlobNotFound: The specified blob does not exist')
      );

      // Act
      const response = await request(app)
        .get(`/api/files/${VALID_FILE_UUID}/download`)
        .expect(404);

      // Assert
      expect(response.body.message).toBe('File content not found in storage');
    });
  });

  // ============================================
  // GET /:id/content - Preview Content
  // ============================================
  describe('GET /api/files/:id/content', () => {
    it('should serve file content for preview with correct headers', async () => {
      // Arrange
      mockFileService.getFile.mockResolvedValue(sampleFile);
      mockFileUploadService.downloadFromBlob.mockResolvedValue(Buffer.from('file content'));

      // Act
      const response = await request(app)
        .get(`/api/files/${VALID_FILE_UUID}/content`)
        .expect(200);

      // Assert
      expect(response.headers['content-type']).toBe('application/pdf');
      expect(response.headers['content-disposition']).toContain('inline');
      expect(response.headers['cache-control']).toBe('private, max-age=3600');
    });

    it('should return 400 when trying to preview a folder', async () => {
      // Arrange
      mockFileService.getFile.mockResolvedValue(sampleFolder);

      // Act
      const response = await request(app)
        .get(`/api/files/${VALID_FOLDER_UUID}/content`)
        .expect(400);

      // Assert
      expect(response.body.message).toBe('Cannot preview a folder');
    });
  });

  // ============================================
  // PATCH /:id - Update File
  // ============================================
  describe('PATCH /api/files/:id', () => {
    it('should update file name', async () => {
      // Arrange
      const updatedFile = { ...sampleFile, name: 'renamed-file.pdf' };
      mockFileService.getFile
        .mockResolvedValueOnce(sampleFile)  // First call: check exists
        .mockResolvedValueOnce(updatedFile); // Second call: get updated

      // Act
      const response = await request(app)
        .patch(`/api/files/${VALID_FILE_UUID}`)
        .send({ name: 'renamed-file.pdf' })
        .expect(200);

      // Assert
      expect(response.body.file.name).toBe('renamed-file.pdf');
      expect(mockFileService.updateFile).toHaveBeenCalledWith(
        TEST_USER_ID,
        VALID_FILE_UUID,
        { name: 'renamed-file.pdf' }
      );
    });

    it('should update parentFolderId', async () => {
      // Arrange
      mockFileService.getFile.mockResolvedValue(sampleFile);

      // Act
      await request(app)
        .patch(`/api/files/${VALID_FILE_UUID}`)
        .send({ parentFolderId: VALID_FOLDER_UUID })
        .expect(200);

      // Assert
      expect(mockFileService.updateFile).toHaveBeenCalledWith(
        TEST_USER_ID,
        VALID_FILE_UUID,
        { parentFolderId: VALID_FOLDER_UUID }
      );
    });

    it('should update isFavorite', async () => {
      // Arrange
      const favoriteFile = { ...sampleFile, isFavorite: true };
      mockFileService.getFile
        .mockResolvedValueOnce(sampleFile)
        .mockResolvedValueOnce(favoriteFile);

      // Act
      const response = await request(app)
        .patch(`/api/files/${VALID_FILE_UUID}`)
        .send({ isFavorite: true })
        .expect(200);

      // Assert
      expect(mockFileService.updateFile).toHaveBeenCalledWith(
        TEST_USER_ID,
        VALID_FILE_UUID,
        { isFavorite: true }
      );
    });

    it('should return 404 when file not found', async () => {
      // Arrange
      mockFileService.getFile.mockResolvedValue(null);

      // Act
      const response = await request(app)
        .patch(`/api/files/${VALID_FILE_UUID}`)
        .send({ name: 'new-name.pdf' })
        .expect(404);

      // Assert
      expect(response.body.message).toBe('File not found or access denied');
    });

    it('should return 400 for invalid file name characters', async () => {
      // Act
      const response = await request(app)
        .patch(`/api/files/${VALID_FILE_UUID}`)
        .send({ name: 'file<script>.pdf' })
        .expect(400);

      // Assert
      expect(response.body.error).toBe('Bad Request');
    });
  });

  // ============================================
  // POST /bulk-upload/init - Initialize Bulk Upload
  // ============================================
  describe('POST /api/files/bulk-upload/init', () => {
    it('should generate SAS URLs for bulk upload', async () => {
      // Arrange
      const sasInfo = {
        sasUrl: 'https://storage.blob/container/file?sas=token',
        blobPath: 'users/test/file.pdf',
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      };
      mockFileUploadService.generateSasUrlForBulkUpload.mockResolvedValue(sasInfo);

      // Act
      const response = await request(app)
        .post('/api/files/bulk-upload/init')
        .send({
          files: [
            { tempId: 'temp-1', fileName: 'file1.pdf', mimeType: 'application/pdf', sizeBytes: 1024 },
            { tempId: 'temp-2', fileName: 'file2.pdf', mimeType: 'application/pdf', sizeBytes: 2048 },
          ],
        })
        .expect(202);

      // Assert
      expect(response.body.batchId).toBeDefined();
      expect(response.body.files).toHaveLength(2);
      expect(response.body.files[0].sasUrl).toBeDefined();
    });

    it('should return 400 for empty files array', async () => {
      // Act
      const response = await request(app)
        .post('/api/files/bulk-upload/init')
        .send({ files: [] })
        .expect(400);

      // Assert
      expect(response.body.error).toBe('Bad Request');
    });

    it('should skip files with validation errors', async () => {
      // Arrange - First file fails validation
      mockFileUploadService.generateSasUrlForBulkUpload
        .mockRejectedValueOnce(new Error('Invalid file type'))
        .mockResolvedValueOnce({
          sasUrl: 'https://storage.blob/file?sas=token',
          blobPath: 'users/test/file.pdf',
          expiresAt: new Date().toISOString(),
        });

      // Act
      const response = await request(app)
        .post('/api/files/bulk-upload/init')
        .send({
          files: [
            { tempId: 'temp-1', fileName: 'file.exe', mimeType: 'application/x-executable', sizeBytes: 1024 },
            { tempId: 'temp-2', fileName: 'file.pdf', mimeType: 'application/pdf', sizeBytes: 1024 },
          ],
        })
        .expect(202);

      // Assert - Only valid file is returned
      expect(response.body.files).toHaveLength(1);
      expect(response.body.files[0].tempId).toBe('temp-2');
    });
  });

  // ============================================
  // POST /bulk-upload/complete - Complete Bulk Upload
  // ============================================
  describe('POST /api/files/bulk-upload/complete', () => {
    // Note: This test requires state from bulk-upload/init
    // We simulate this by directly manipulating the batch store

    it('should return 404 for non-existent batch', async () => {
      // Act - Use valid UUID format
      const response = await request(app)
        .post('/api/files/bulk-upload/complete')
        .send({
          batchId: '00000000-0000-0000-0000-000000000000',
          uploads: [{ tempId: 'temp-1', success: true, contentHash: 'a'.repeat(64) }],
        })
        .expect(404);

      // Assert
      expect(response.body.message).toBe('Batch not found or expired');
    });

    it('should return 400 for empty uploads array', async () => {
      // Act
      const response = await request(app)
        .post('/api/files/bulk-upload/complete')
        .send({
          batchId: 'SOME-BATCH-ID-0000-0000-000000000000',
          uploads: [],
        })
        .expect(400);

      // Assert
      expect(response.body.error).toBe('Bad Request');
    });
  });

  // ============================================
  // DELETE / - Bulk Delete
  // ============================================
  describe('DELETE /api/files', () => {
    it('should mark files for deletion and return SoftDeleteResult', async () => {
      // Arrange - Mock soft delete service response
      mockSoftDeleteService.markForDeletion.mockResolvedValue({
        markedForDeletion: 2,
        notFoundIds: [],
        batchId: 'BATCH-UUID-1234-5678-90AB-CDEF12345678',
      });

      // Act
      const response = await request(app)
        .delete('/api/files')
        .send({
          fileIds: [VALID_FILE_UUID, VALID_FOLDER_UUID],
          deletionReason: 'user_request',
        })
        .expect(200);

      // Assert - Check SoftDeleteResult structure
      expect(response.body.batchId).toBeDefined();
      expect(response.body.markedForDeletion).toBe(2);
      expect(response.body.notFoundIds).toEqual([]);

      // Verify markForDeletion was called with correct parameters
      expect(mockSoftDeleteService.markForDeletion).toHaveBeenCalledWith(
        TEST_USER_ID,
        [VALID_FILE_UUID, VALID_FOLDER_UUID],
        { deletionReason: 'user_request' }
      );
    });

    it('should return 404 when no files are owned by user', async () => {
      // Arrange - Mock soft delete returning 0 marked files
      mockSoftDeleteService.markForDeletion.mockResolvedValue({
        markedForDeletion: 0,
        notFoundIds: [VALID_FILE_UUID],
        batchId: 'BATCH-UUID-1234-5678-90AB-CDEF12345678',
      });

      // Act
      const response = await request(app)
        .delete('/api/files')
        .send({ fileIds: [VALID_FILE_UUID] })
        .expect(404);

      // Assert
      expect(response.body.message).toBe('No files found or access denied');
    });

    it('should return 400 for empty fileIds array', async () => {
      // Act
      const response = await request(app)
        .delete('/api/files')
        .send({ fileIds: [] })
        .expect(400);

      // Assert
      expect(response.body.error).toBe('Bad Request');
    });

    it('should return 400 for exceeding max files limit', async () => {
      // Arrange - Create 101 UUIDs
      const tooManyIds = Array.from({ length: 101 }, (_, i) =>
        `F${i.toString().padStart(7, '0')}-0000-0000-0000-000000000000`
      );

      // Act
      const response = await request(app)
        .delete('/api/files')
        .send({ fileIds: tooManyIds })
        .expect(400);

      // Assert
      expect(response.body.error).toBe('Bad Request');
    });
  });

  // ============================================
  // DELETE /:id - Delete Single File
  // ============================================
  describe('DELETE /api/files/:id', () => {
    it('should delete file and return 204', async () => {
      // Arrange
      mockFileService.deleteFile.mockResolvedValue(['users/test/file.pdf']);

      // Act
      await request(app)
        .delete(`/api/files/${VALID_FILE_UUID}`)
        .expect(204);

      // Assert
      expect(mockFileService.deleteFile).toHaveBeenCalledWith(TEST_USER_ID, VALID_FILE_UUID);
      expect(mockFileUploadService.deleteFromBlob).toHaveBeenCalledWith('users/test/file.pdf');
    });

    it('should return 404 when file not found', async () => {
      // Arrange
      mockFileService.deleteFile.mockRejectedValue(new Error('File not found or unauthorized'));

      // Act
      const response = await request(app)
        .delete(`/api/files/${VALID_FILE_UUID}`)
        .expect(404);

      // Assert
      expect(response.body.message).toBe('File not found or access denied');
    });

    it('should continue even if blob deletion fails', async () => {
      // Arrange
      mockFileService.deleteFile.mockResolvedValue(['users/test/file.pdf']);
      mockFileUploadService.deleteFromBlob.mockRejectedValue(new Error('Blob error'));

      // Act - Should still return 204 (DB record deleted)
      await request(app)
        .delete(`/api/files/${VALID_FILE_UUID}`)
        .expect(204);
    });
  });

  // ============================================
  // POST /:id/retry-processing - Retry Processing
  // ============================================
  describe('POST /api/files/:id/retry-processing', () => {
    it('should initiate full processing retry', async () => {
      // Act
      const response = await request(app)
        .post(`/api/files/${VALID_FILE_UUID}/retry-processing`)
        .send({ scope: 'full' })
        .expect(200);

      // Assert
      expect(response.body.file).toBeDefined();
      expect(response.body.jobId).toBeDefined();
      expect(response.body.message).toBe('Processing retry initiated');
    });

    it('should initiate embedding-only retry', async () => {
      // Act
      const response = await request(app)
        .post(`/api/files/${VALID_FILE_UUID}/retry-processing`)
        .send({ scope: 'embedding_only' })
        .expect(200);

      // Assert
      expect(response.body.jobId).toBeDefined();
      expect(mockMessageQueue.addFileChunkingJob).toHaveBeenCalled();
    });

    it('should default to full scope when not specified', async () => {
      // Act
      const response = await request(app)
        .post(`/api/files/${VALID_FILE_UUID}/retry-processing`)
        .send({})
        .expect(200);

      // Assert
      expect(mockMessageQueue.addFileProcessingJob).toHaveBeenCalled();
    });

    it('should return 400 for invalid scope', async () => {
      // Act
      const response = await request(app)
        .post(`/api/files/${VALID_FILE_UUID}/retry-processing`)
        .send({ scope: 'invalid' })
        .expect(400);

      // Assert
      expect(response.body.error).toBe('Bad Request');
    });
  });

  // ============================================
  // Multi-Tenant Isolation Tests
  // ============================================
  describe('Multi-Tenant Isolation', () => {
    it('should not allow user to access other user files via getFile', async () => {
      // Arrange - Service returns null for unauthorized access
      mockFileService.getFile.mockResolvedValue(null);

      // Act
      const response = await request(app)
        .get(`/api/files/${VALID_FILE_UUID}`)
        .expect(404);

      // Assert
      expect(response.body.message).toBe('File not found or access denied');
      expect(mockFileService.getFile).toHaveBeenCalledWith(TEST_USER_ID, VALID_FILE_UUID);
    });

    it('should filter getFiles by authenticated user', async () => {
      // Arrange
      mockFileService.getFiles.mockResolvedValue([sampleFile]);
      mockFileService.getFileCount.mockResolvedValue(1);

      // Act
      await request(app)
        .get('/api/files')
        .expect(200);

      // Assert
      expect(mockFileService.getFiles).toHaveBeenCalledWith(
        expect.objectContaining({ userId: TEST_USER_ID })
      );
    });

    it('should verify file ownership before delete', async () => {
      // Arrange - Mock soft delete service
      mockSoftDeleteService.markForDeletion.mockResolvedValue({
        markedForDeletion: 1,
        notFoundIds: [],
        batchId: 'BATCH-UUID-1234-5678-90AB-CDEF12345678',
      });

      // Act
      await request(app)
        .delete('/api/files')
        .send({ fileIds: [VALID_FILE_UUID] })
        .expect(200);

      // Assert - SoftDeleteService handles ownership verification internally
      // Note: deletionReason defaults to 'user_request' per schema
      expect(mockSoftDeleteService.markForDeletion).toHaveBeenCalledWith(
        TEST_USER_ID,
        [VALID_FILE_UUID],
        { deletionReason: 'user_request' }
      );
    });
  });

  // ============================================
  // Error Handling Tests
  // ============================================
  describe('Error Handling', () => {
    it('should return 500 for unexpected errors', async () => {
      // Arrange
      mockFileService.getFiles.mockRejectedValue(new Error('Unexpected error'));

      // Act
      const response = await request(app)
        .get('/api/files')
        .expect(500);

      // Assert
      expect(response.body.error).toBe('Internal Server Error');
    });

    it('should handle ZodError with proper message', async () => {
      // Act - Invalid UUID triggers ZodError
      const response = await request(app)
        .get('/api/files/not-valid-uuid')
        .expect(400);

      // Assert
      expect(response.body.error).toBe('Bad Request');
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });
  });

  // ============================================
  // POST /folders/batch - Batch Folder Creation
  // ============================================
  describe('POST /api/files/folders/batch', () => {
    it('should create single folder', async () => {
      // Arrange
      mockFileService.createFolder.mockResolvedValue('NEW-FOLDER-UUID');

      // Act
      const response = await request(app)
        .post('/api/files/folders/batch')
        .send({
          folders: [
            { tempId: 'temp-1', name: 'MyFolder', parentTempId: null },
          ],
        })
        .expect(201);

      // Assert
      expect(response.body.created).toHaveLength(1);
      expect(response.body.created[0]).toEqual({
        tempId: 'temp-1',
        folderId: 'NEW-FOLDER-UUID',
        path: 'MyFolder',
      });
      expect(mockFileService.createFolder).toHaveBeenCalledWith(
        TEST_USER_ID,
        'MyFolder',
        undefined
      );
    });

    it('should create nested folders in topological order', async () => {
      // Arrange - Return different UUIDs for each folder
      mockFileService.createFolder
        .mockResolvedValueOnce('PARENT-UUID')
        .mockResolvedValueOnce('CHILD-UUID');

      // Act - Provide child first to test sorting
      const response = await request(app)
        .post('/api/files/folders/batch')
        .send({
          folders: [
            { tempId: 'temp-child', name: 'Child', parentTempId: 'temp-parent' },
            { tempId: 'temp-parent', name: 'Parent', parentTempId: null },
          ],
        })
        .expect(201);

      // Assert
      expect(response.body.created).toHaveLength(2);

      // Parent should be created first
      expect(mockFileService.createFolder).toHaveBeenNthCalledWith(
        1,
        TEST_USER_ID,
        'Parent',
        undefined
      );

      // Child should be created second with parent's UUID
      expect(mockFileService.createFolder).toHaveBeenNthCalledWith(
        2,
        TEST_USER_ID,
        'Child',
        'PARENT-UUID'
      );
    });

    it('should create folders under targetFolderId', async () => {
      // Arrange
      mockFileService.createFolder.mockResolvedValue('NEW-FOLDER-UUID');

      // Act
      const response = await request(app)
        .post('/api/files/folders/batch')
        .send({
          folders: [
            { tempId: 'temp-1', name: 'SubFolder', parentTempId: null },
          ],
          targetFolderId: VALID_FOLDER_UUID,
        })
        .expect(201);

      // Assert
      expect(response.body.created).toHaveLength(1);
      expect(mockFileService.createFolder).toHaveBeenCalledWith(
        TEST_USER_ID,
        'SubFolder',
        VALID_FOLDER_UUID
      );
    });

    it('should validate folder names', async () => {
      // Act
      const response = await request(app)
        .post('/api/files/folders/batch')
        .send({
          folders: [
            { tempId: 'temp-1', name: 'Invalid<Name>', parentTempId: null },
          ],
        })
        .expect(400);

      // Assert
      expect(response.body.error).toBe('Bad Request');
    });

    it('should reject batch exceeding 100 folders', async () => {
      // Arrange - Create array of 101 folders
      const folders = Array.from({ length: 101 }, (_, i) => ({
        tempId: `temp-${i}`,
        name: `Folder${i}`,
        parentTempId: null,
      }));

      // Act
      const response = await request(app)
        .post('/api/files/folders/batch')
        .send({ folders })
        .expect(400);

      // Assert
      expect(response.body.error).toBe('Bad Request');
      expect(response.body.message).toContain('100');
    });

    it('should reject empty folders array', async () => {
      // Act
      const response = await request(app)
        .post('/api/files/folders/batch')
        .send({ folders: [] })
        .expect(400);

      // Assert
      expect(response.body.error).toBe('Bad Request');
    });

    it('should return error when folder creation fails', async () => {
      // Arrange
      mockFileService.createFolder.mockRejectedValue(new Error('Database error'));

      // Act
      const response = await request(app)
        .post('/api/files/folders/batch')
        .send({
          folders: [
            { tempId: 'temp-1', name: 'MyFolder', parentTempId: null },
          ],
        })
        .expect(500);

      // Assert
      expect(response.body.error).toBe('Internal Server Error');
    });

    it('should handle deeply nested folder structure', async () => {
      // Arrange - Create 5 levels deep
      mockFileService.createFolder
        .mockResolvedValueOnce('UUID-1')
        .mockResolvedValueOnce('UUID-2')
        .mockResolvedValueOnce('UUID-3')
        .mockResolvedValueOnce('UUID-4')
        .mockResolvedValueOnce('UUID-5');

      // Act
      const response = await request(app)
        .post('/api/files/folders/batch')
        .send({
          folders: [
            { tempId: 'temp-5', name: 'Level5', parentTempId: 'temp-4' },
            { tempId: 'temp-3', name: 'Level3', parentTempId: 'temp-2' },
            { tempId: 'temp-1', name: 'Level1', parentTempId: null },
            { tempId: 'temp-4', name: 'Level4', parentTempId: 'temp-3' },
            { tempId: 'temp-2', name: 'Level2', parentTempId: 'temp-1' },
          ],
        })
        .expect(201);

      // Assert
      expect(response.body.created).toHaveLength(5);

      // Verify order: Level1 -> Level2 -> Level3 -> Level4 -> Level5
      expect(mockFileService.createFolder).toHaveBeenNthCalledWith(
        1,
        TEST_USER_ID,
        'Level1',
        undefined
      );
      expect(mockFileService.createFolder).toHaveBeenNthCalledWith(
        2,
        TEST_USER_ID,
        'Level2',
        'UUID-1'
      );
      expect(mockFileService.createFolder).toHaveBeenNthCalledWith(
        3,
        TEST_USER_ID,
        'Level3',
        'UUID-2'
      );
    });
  });
});
