/**
 * BatchUploadOrchestratorV2 Tests (PRD-03)
 *
 * Tests the unified 3-phase atomic upload pipeline: manifest validation,
 * topological folder sorting, transaction integrity, duplicate detection,
 * and file confirmation with batch progress tracking.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// Mocks (Hoisted)
// ============================================================================

// Mock logger
vi.mock('@/shared/utils/logger', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock Prisma client
vi.mock('@/infrastructure/database/prisma', () => ({
  prisma: {
    $transaction: vi.fn(),
    $executeRaw: vi.fn(),
    upload_batches: {
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    files: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

// Mock FileUploadService (singleton instance)
const mockFileUploadServiceInstance = {
  generateSasUrlForBulkUpload: vi.fn(),
  blobExists: vi.fn(),
};

vi.mock('@/services/files/FileUploadService', () => ({
  getFileUploadService: () => mockFileUploadServiceInstance,
}));

// Mock MessageQueue (singleton instance)
const mockMessageQueueInstance = {
  addFileProcessingJob: vi.fn(),
  addFileProcessingFlow: vi.fn(),
};

vi.mock('@/infrastructure/queue', () => ({
  getMessageQueue: () => mockMessageQueueInstance,
}));

// Mock DuplicateDetectionServiceV2
vi.mock('@/services/files/DuplicateDetectionServiceV2', () => ({
  DuplicateDetectionServiceV2: vi.fn().mockImplementation(() => ({
    checkDuplicates: vi.fn(),
  })),
}));

// Import service AFTER mocks
import { BATCH_STATUS, PIPELINE_STATUS } from '@bc-agent/shared';
import type {
  CreateBatchRequest,
  ManifestFileItem,
  ManifestFolderItem,
} from '@bc-agent/shared';
import { BatchUploadOrchestratorV2 } from '@/services/files/batch/BatchUploadOrchestratorV2';
import {
  BatchNotFoundError,
  BatchExpiredError,
  BatchCancelledError,
  BatchAlreadyCompleteError,
  FileNotInBatchError,
  FileAlreadyConfirmedError,
  BlobNotFoundError,
  ConcurrentModificationError,
  InvalidTargetFolderError,
  ManifestValidationError,
} from '@/services/files/batch/errors';
import { prisma } from '@/infrastructure/database/prisma';
import { getFileUploadService } from '@/services/files/FileUploadService';
import { getMessageQueue } from '@/infrastructure/queue';
import { DuplicateDetectionServiceV2 } from '@/services/files/DuplicateDetectionServiceV2';

// ============================================================================
// Test Constants
// ============================================================================

const TEST_USER_ID = 'USER-12345678-1234-1234-1234-123456789ABC';
const TEST_BATCH_ID = 'BATCH-1234-5678-9ABC-DEF012345678';
const TEST_FILE_ID = 'FILE-AAAA-BBBB-CCCC-DDDDEEEEEEEE';
const TEST_FOLDER_ID = 'FOLD-1111-2222-3333-444455555555';

// ============================================================================
// Tests
// ============================================================================

describe('BatchUploadOrchestratorV2', () => {
  let orchestrator: BatchUploadOrchestratorV2;
  let mockPrisma: any;
  let mockTx: any;
  let mockFileUploadService: any;
  let mockMessageQueue: any;
  let mockCheckDuplicates: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Get mocked instances
    mockPrisma = vi.mocked(prisma);
    mockFileUploadService = mockFileUploadServiceInstance;
    mockMessageQueue = mockMessageQueueInstance;

    // Create mock transaction object
    mockTx = {
      upload_batches: {
        create: vi.fn(),
        findFirst: vi.fn(),
        update: vi.fn(),
      },
      files: {
        create: vi.fn(),
        findFirst: vi.fn(),
        findMany: vi.fn(),
        updateMany: vi.fn(),
      },
    };

    // Configure $transaction to execute the callback
    mockPrisma.$transaction.mockImplementation(async (cb: Function) => cb(mockTx));

    // Default mock returns for createBatch flow
    mockTx.upload_batches.create.mockResolvedValue({
      id: TEST_BATCH_ID,
      user_id: TEST_USER_ID,
      status: BATCH_STATUS.ACTIVE,
      total_files: 1,
      confirmed_count: 0,
      expires_at: new Date(Date.now() + 4 * 60 * 60 * 1000),
      metadata: null,
    });

    mockTx.files.create.mockResolvedValue({
      id: TEST_FILE_ID,
      user_id: TEST_USER_ID,
      name: 'test.pdf',
      mime_type: 'application/pdf',
      size_bytes: BigInt(1024),
      blob_path: 'users/USER/files/test.pdf',
      source_type: 'blob_storage',
      is_folder: false,
      pipeline_status: PIPELINE_STATUS.REGISTERED,
      parent_folder_id: null,
      batch_id: TEST_BATCH_ID,
      content_hash: null,
    });

    mockFileUploadService.generateSasUrlForBulkUpload.mockResolvedValue({
      sasUrl: 'https://test.blob.core.windows.net/sas',
      blobPath: 'users/USER/files/test.pdf',
      expiresAt: '2024-12-31T00:00:00.000Z',
    });

    // Mock DuplicateDetectionServiceV2 instance
    mockCheckDuplicates = vi.fn().mockResolvedValue({
      results: [],
      summary: {
        totalDuplicates: 0,
        totalChecked: 0,
        byScope: { storage: 0, pipeline: 0, upload: 0 },
        byMatchType: { name: 0, content: 0, name_and_content: 0 },
      },
    });

    vi.mocked(DuplicateDetectionServiceV2).mockImplementation(() => ({
      checkDuplicates: mockCheckDuplicates,
    }) as any);

    // Default mock returns for confirmFile flow
    mockPrisma.upload_batches.findFirst.mockResolvedValue({
      id: TEST_BATCH_ID,
      user_id: TEST_USER_ID,
      status: BATCH_STATUS.ACTIVE,
      total_files: 1,
      confirmed_count: 0,
      expires_at: new Date(Date.now() + 4 * 60 * 60 * 1000),
      created_at: new Date(),
    });

    mockPrisma.files.findFirst.mockResolvedValue({
      id: TEST_FILE_ID,
      user_id: TEST_USER_ID,
      name: 'test.pdf',
      mime_type: 'application/pdf',
      size_bytes: BigInt(1024),
      blob_path: 'users/USER/files/test.pdf',
      pipeline_status: PIPELINE_STATUS.REGISTERED,
      batch_id: TEST_BATCH_ID,
    });

    mockFileUploadService.blobExists.mockResolvedValue(true);

    mockPrisma.files.updateMany.mockResolvedValue({ count: 1 });

    mockPrisma.$executeRaw.mockResolvedValue(undefined);

    orchestrator = new BatchUploadOrchestratorV2(mockPrisma as any);
  });

  // ==========================================================================
  // Manifest Validation
  // ==========================================================================

  describe('Manifest Validation', () => {
    it('rejects duplicate tempIds within files', async () => {
      const request: CreateBatchRequest = {
        files: [
          {
            tempId: 'f1',
            fileName: 'file1.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 1024,
          },
          {
            tempId: 'f1', // Duplicate
            fileName: 'file2.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 2048,
          },
        ],
      };

      await expect(orchestrator.createBatch(TEST_USER_ID, request)).rejects.toThrow(
        ManifestValidationError,
      );
      await expect(orchestrator.createBatch(TEST_USER_ID, request)).rejects.toThrow(
        'Duplicate tempId in files: f1',
      );
    });

    it('rejects duplicate tempIds across files and folders', async () => {
      const request: CreateBatchRequest = {
        files: [
          {
            tempId: 'shared-id',
            fileName: 'file.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 1024,
          },
        ],
        folders: [
          {
            tempId: 'shared-id', // Duplicate with file
            folderName: 'Documents',
          },
        ],
      };

      await expect(orchestrator.createBatch(TEST_USER_ID, request)).rejects.toThrow(
        ManifestValidationError,
      );
      await expect(orchestrator.createBatch(TEST_USER_ID, request)).rejects.toThrow(
        'Duplicate tempId across files/folders: shared-id',
      );
    });

    it('rejects file referencing non-existent folder parentTempId', async () => {
      const request: CreateBatchRequest = {
        files: [
          {
            tempId: 'f1',
            fileName: 'file.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 1024,
            parentTempId: 'non-existent-folder',
          },
        ],
      };

      await expect(orchestrator.createBatch(TEST_USER_ID, request)).rejects.toThrow(
        ManifestValidationError,
      );
      await expect(orchestrator.createBatch(TEST_USER_ID, request)).rejects.toThrow(
        'references non-existent folder tempId: non-existent-folder',
      );
    });

    it('rejects circular folder references', async () => {
      const request: CreateBatchRequest = {
        files: [
          {
            tempId: 'f1',
            fileName: 'file.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 1024,
          },
        ],
        folders: [
          {
            tempId: 'folder-a',
            folderName: 'Folder A',
            parentTempId: 'folder-b',
          },
          {
            tempId: 'folder-b',
            folderName: 'Folder B',
            parentTempId: 'folder-a', // Circular
          },
        ],
      };

      await expect(orchestrator.createBatch(TEST_USER_ID, request)).rejects.toThrow(
        ManifestValidationError,
      );
      await expect(orchestrator.createBatch(TEST_USER_ID, request)).rejects.toThrow(
        'Circular folder reference detected',
      );
    });

    it('accepts valid manifest with nested folders', async () => {
      const request: CreateBatchRequest = {
        files: [
          {
            tempId: 'f1',
            fileName: 'file.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 1024,
            parentTempId: 'folder-c',
          },
        ],
        folders: [
          {
            tempId: 'folder-a',
            folderName: 'Folder A',
          },
          {
            tempId: 'folder-b',
            folderName: 'Folder B',
            parentTempId: 'folder-a',
          },
          {
            tempId: 'folder-c',
            folderName: 'Folder C',
            parentTempId: 'folder-b',
          },
        ],
      };

      // Should not throw
      await orchestrator.createBatch(TEST_USER_ID, request);

      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });

    it('rejects folder referencing non-existent parent folder', async () => {
      const request: CreateBatchRequest = {
        files: [
          {
            tempId: 'f1',
            fileName: 'file.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 1024,
          },
        ],
        folders: [
          {
            tempId: 'folder-a',
            folderName: 'Folder A',
            parentTempId: 'non-existent-parent',
          },
        ],
      };

      await expect(orchestrator.createBatch(TEST_USER_ID, request)).rejects.toThrow(
        ManifestValidationError,
      );
      await expect(orchestrator.createBatch(TEST_USER_ID, request)).rejects.toThrow(
        'references non-existent parent tempId: non-existent-parent',
      );
    });
  });

  // ==========================================================================
  // Topological Sort
  // ==========================================================================

  describe('Topological Sort', () => {
    it('sorts parents before children', async () => {
      const request: CreateBatchRequest = {
        files: [
          {
            tempId: 'f1',
            fileName: 'file.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 1024,
          },
        ],
        folders: [
          {
            tempId: 'folder-child',
            folderName: 'Child',
            parentTempId: 'folder-parent',
          },
          {
            tempId: 'folder-parent',
            folderName: 'Parent',
          },
        ],
      };

      await orchestrator.createBatch(TEST_USER_ID, request);

      // Verify folder creation order: parent before child
      const folderCalls = mockTx.files.create.mock.calls.filter(
        (call) => call[0].data.is_folder === true,
      );

      expect(folderCalls).toHaveLength(2);
      expect(folderCalls[0][0].data.name).toBe('Parent');
      expect(folderCalls[1][0].data.name).toBe('Child');
    });

    it('sorts deep hierarchy (3 levels) correctly', async () => {
      const request: CreateBatchRequest = {
        files: [
          {
            tempId: 'f1',
            fileName: 'file.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 1024,
          },
        ],
        folders: [
          {
            tempId: 'folder-grandchild',
            folderName: 'Grandchild',
            parentTempId: 'folder-child',
          },
          {
            tempId: 'folder-child',
            folderName: 'Child',
            parentTempId: 'folder-grandparent',
          },
          {
            tempId: 'folder-grandparent',
            folderName: 'Grandparent',
          },
        ],
      };

      await orchestrator.createBatch(TEST_USER_ID, request);

      const folderCalls = mockTx.files.create.mock.calls.filter(
        (call) => call[0].data.is_folder === true,
      );

      expect(folderCalls).toHaveLength(3);
      expect(folderCalls[0][0].data.name).toBe('Grandparent');
      expect(folderCalls[1][0].data.name).toBe('Child');
      expect(folderCalls[2][0].data.name).toBe('Grandchild');
    });

    it('handles multiple root folders', async () => {
      const request: CreateBatchRequest = {
        files: [
          {
            tempId: 'f1',
            fileName: 'file.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 1024,
          },
        ],
        folders: [
          {
            tempId: 'folder-root-a',
            folderName: 'Root A',
          },
          {
            tempId: 'folder-root-b',
            folderName: 'Root B',
          },
        ],
      };

      await orchestrator.createBatch(TEST_USER_ID, request);

      const folderCalls = mockTx.files.create.mock.calls.filter(
        (call) => call[0].data.is_folder === true,
      );

      expect(folderCalls).toHaveLength(2);
      // Both should have null parent_folder_id
      expect(folderCalls[0][0].data.parent_folder_id).toBeNull();
      expect(folderCalls[1][0].data.parent_folder_id).toBeNull();
    });

    it('detects cycles and throws ManifestValidationError', async () => {
      const request: CreateBatchRequest = {
        files: [
          {
            tempId: 'f1',
            fileName: 'file.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 1024,
          },
        ],
        folders: [
          {
            tempId: 'folder-a',
            folderName: 'Folder A',
            parentTempId: 'folder-b',
          },
          {
            tempId: 'folder-b',
            folderName: 'Folder B',
            parentTempId: 'folder-a',
          },
        ],
      };

      await expect(orchestrator.createBatch(TEST_USER_ID, request)).rejects.toThrow(
        ManifestValidationError,
      );
    });
  });

  // ==========================================================================
  // createBatch
  // ==========================================================================

  describe('createBatch', () => {
    it('creates batch + folders + files in transaction, returns correct shape', async () => {
      const request: CreateBatchRequest = {
        files: [
          {
            tempId: 'temp-f1',
            fileName: 'report.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 2048,
            contentHash: 'abc123def456',
          },
        ],
        folders: [
          {
            tempId: 'temp-fold1',
            folderName: 'Documents',
          },
        ],
      };

      const result = await orchestrator.createBatch(TEST_USER_ID, request);

      // Verify shape
      expect(result).toMatchObject({
        batchId: TEST_BATCH_ID,
        status: BATCH_STATUS.ACTIVE,
        files: expect.arrayContaining([
          expect.objectContaining({
            tempId: 'temp-f1',
            fileId: expect.any(String),
            sasUrl: expect.any(String),
            blobPath: expect.any(String),
          }),
        ]),
        folders: expect.arrayContaining([
          expect.objectContaining({
            tempId: 'temp-fold1',
            folderId: expect.any(String),
          }),
        ]),
        expiresAt: expect.any(String),
      });

      // Verify transaction was used
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('runs duplicate check inside transaction with tx client', async () => {
      const request: CreateBatchRequest = {
        files: [
          {
            tempId: 'temp-f1',
            fileName: 'test.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 1024,
          },
        ],
      };

      await orchestrator.createBatch(TEST_USER_ID, request);

      // Verify DuplicateDetectionServiceV2 was constructed (mocked class)
      expect(mockCheckDuplicates).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            tempId: 'temp-f1',
            fileName: 'test.pdf',
            fileSize: 1024,
          }),
        ]),
        TEST_USER_ID,
      );
    });

    it('skips duplicate check when skipDuplicateCheck is true', async () => {
      const request: CreateBatchRequest = {
        files: [
          {
            tempId: 'temp-f1',
            fileName: 'test.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 1024,
          },
        ],
        skipDuplicateCheck: true,
      };

      await orchestrator.createBatch(TEST_USER_ID, request);

      // Verify checkDuplicates was NOT called
      expect(mockCheckDuplicates).not.toHaveBeenCalled();
    });

    it('resolves folder hierarchy correctly', async () => {
      // Mock folder creation to return sequential IDs
      let folderCreateCallCount = 0;
      mockTx.files.create.mockImplementation((args: any) => {
        if (args.data.is_folder) {
          folderCreateCallCount++;
          return Promise.resolve({
            id: `FOLDER-ID-${folderCreateCallCount}`,
            ...args.data,
          });
        }
        return Promise.resolve({
          id: TEST_FILE_ID,
          ...args.data,
        });
      });

      const request: CreateBatchRequest = {
        files: [
          {
            tempId: 'temp-f1',
            fileName: 'file.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 1024,
            parentTempId: 'temp-folder-child',
          },
        ],
        folders: [
          {
            tempId: 'temp-folder-parent',
            folderName: 'Parent',
          },
          {
            tempId: 'temp-folder-child',
            folderName: 'Child',
            parentTempId: 'temp-folder-parent',
          },
        ],
      };

      await orchestrator.createBatch(TEST_USER_ID, request);

      const fileCalls = mockTx.files.create.mock.calls;

      // Find parent folder creation
      const parentFolderCall = fileCalls.find(
        (call) => call[0].data.is_folder && call[0].data.name === 'Parent',
      );
      expect(parentFolderCall![0].data.parent_folder_id).toBeNull();

      // Find child folder creation
      const childFolderCall = fileCalls.find(
        (call) => call[0].data.is_folder && call[0].data.name === 'Child',
      );
      expect(childFolderCall![0].data.parent_folder_id).toBe('FOLDER-ID-1'); // Parent ID

      // Find file creation
      const fileCall = fileCalls.find((call) => !call[0].data.is_folder);
      expect(fileCall![0].data.parent_folder_id).toBe('FOLDER-ID-2'); // Child ID
    });

    it('generates SAS URLs via FileUploadService', async () => {
      const request: CreateBatchRequest = {
        files: [
          {
            tempId: 'temp-f1',
            fileName: 'document.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 3072,
          },
        ],
      };

      await orchestrator.createBatch(TEST_USER_ID, request);

      expect(mockFileUploadService.generateSasUrlForBulkUpload).toHaveBeenCalledWith(
        TEST_USER_ID,
        'document.pdf',
        'application/pdf',
        3072,
        240, // SAS_EXPIRY_MINUTES
      );
    });

    it('all IDs are UPPERCASE', async () => {
      mockTx.upload_batches.create.mockResolvedValue({
        id: 'batch-lowercase-id',
      });

      mockTx.files.create.mockImplementation((args: any) => {
        if (args.data.is_folder) {
          return Promise.resolve({ id: 'folder-lowercase-id', ...args.data });
        }
        return Promise.resolve({ id: 'file-lowercase-id', ...args.data });
      });

      const request: CreateBatchRequest = {
        files: [
          {
            tempId: 'temp-f1',
            fileName: 'test.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 1024,
          },
        ],
        folders: [
          {
            tempId: 'temp-fold1',
            folderName: 'Docs',
          },
        ],
      };

      const result = await orchestrator.createBatch(TEST_USER_ID, request);

      // All IDs should be uppercase
      expect(result.batchId).toBe('BATCH-LOWERCASE-ID');
      expect(result.files[0].fileId).toBe('FILE-LOWERCASE-ID');
      expect(result.folders[0].folderId).toBe('FOLDER-LOWERCASE-ID');
    });
  });

  // ==========================================================================
  // confirmFile
  // ==========================================================================

  describe('confirmFile', () => {
    it('happy path: transitions + enqueues + increments counter', async () => {
      // Mock updated batch after counter increment
      mockPrisma.upload_batches.findFirst.mockResolvedValueOnce({
        id: TEST_BATCH_ID,
        status: BATCH_STATUS.ACTIVE,
        total_files: 3,
        confirmed_count: 0,
        expires_at: new Date(Date.now() + 4 * 60 * 60 * 1000),
      }).mockResolvedValueOnce({
        id: TEST_BATCH_ID,
        status: BATCH_STATUS.ACTIVE,
        total_files: 3,
        confirmed_count: 1, // Incremented
        expires_at: new Date(Date.now() + 4 * 60 * 60 * 1000),
      });

      const result = await orchestrator.confirmFile(TEST_USER_ID, TEST_BATCH_ID, TEST_FILE_ID);

      expect(result).toMatchObject({
        fileId: TEST_FILE_ID,
        pipelineStatus: PIPELINE_STATUS.QUEUED,
        batchProgress: {
          total: 3,
          confirmed: 1,
          isComplete: false,
        },
      });

      // Verify status transition
      expect(mockPrisma.files.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: TEST_FILE_ID,
            pipeline_status: PIPELINE_STATUS.REGISTERED,
          }),
          data: {
            pipeline_status: PIPELINE_STATUS.QUEUED,
          },
        }),
      );

      // Verify counter increment
      expect(mockPrisma.$executeRaw).toHaveBeenCalled();

      // Verify job enqueued
      expect(mockMessageQueue.addFileProcessingFlow).toHaveBeenCalledWith(
        expect.objectContaining({
          fileId: TEST_FILE_ID,
          userId: TEST_USER_ID,
          mimeType: 'application/pdf',
          blobPath: 'users/USER/files/test.pdf',
          fileName: 'test.pdf',
        }),
      );
    });

    it('auto-completes batch when last file confirmed', async () => {
      // Reset blobExists to return true
      mockFileUploadService.blobExists.mockResolvedValue(true);

      // Reset updateMany to succeed
      mockPrisma.files.updateMany.mockResolvedValue({ count: 1 });

      // Mock batch with total_files=1, confirmed_count becomes 1 after increment
      mockPrisma.upload_batches.findFirst
        .mockResolvedValueOnce({
          id: TEST_BATCH_ID,
          status: BATCH_STATUS.ACTIVE,
          total_files: 1,
          confirmed_count: 0,
          expires_at: new Date(Date.now() + 4 * 60 * 60 * 1000),
        })
        .mockResolvedValueOnce({
          id: TEST_BATCH_ID,
          status: BATCH_STATUS.COMPLETED,
          total_files: 1,
          confirmed_count: 1,
          expires_at: new Date(Date.now() + 4 * 60 * 60 * 1000),
        });

      const result = await orchestrator.confirmFile(TEST_USER_ID, TEST_BATCH_ID, TEST_FILE_ID);

      expect(result.batchProgress.isComplete).toBe(true);
      expect(result.batchProgress.confirmed).toBe(1);
      expect(result.batchProgress.total).toBe(1);
    });

    it('rejects if blob not found', async () => {
      // Reset to ACTIVE status (in case previous tests changed it)
      mockPrisma.upload_batches.findFirst.mockResolvedValue({
        id: TEST_BATCH_ID,
        user_id: TEST_USER_ID,
        status: BATCH_STATUS.ACTIVE,
        total_files: 1,
        confirmed_count: 0,
        expires_at: new Date(Date.now() + 4 * 60 * 60 * 1000),
        created_at: new Date(),
      });

      mockFileUploadService.blobExists.mockResolvedValue(false);

      const error = await orchestrator
        .confirmFile(TEST_USER_ID, TEST_BATCH_ID, TEST_FILE_ID)
        .catch((e) => e);

      expect(error).toBeInstanceOf(BlobNotFoundError);
      expect(error.message).toContain(`Blob not found for file ${TEST_FILE_ID}`);

      // Should not proceed to update status
      expect(mockPrisma.files.updateMany).not.toHaveBeenCalled();
    });

    it('rejects if file already confirmed', async () => {
      mockPrisma.files.findFirst.mockResolvedValue({
        id: TEST_FILE_ID,
        pipeline_status: PIPELINE_STATUS.QUEUED, // Already confirmed
        batch_id: TEST_BATCH_ID,
        user_id: TEST_USER_ID,
        name: 'test.pdf',
        mime_type: 'application/pdf',
        blob_path: 'users/USER/files/test.pdf',
      });

      const error = await orchestrator
        .confirmFile(TEST_USER_ID, TEST_BATCH_ID, TEST_FILE_ID)
        .catch((e) => e);

      expect(error).toBeInstanceOf(FileAlreadyConfirmedError);
      expect(error.message).toContain(`already confirmed (current status: ${PIPELINE_STATUS.QUEUED})`);
    });

    it('rejects if batch cancelled', async () => {
      mockPrisma.upload_batches.findFirst.mockResolvedValue({
        id: TEST_BATCH_ID,
        status: BATCH_STATUS.CANCELLED,
        total_files: 1,
        confirmed_count: 0,
        expires_at: new Date(Date.now() + 4 * 60 * 60 * 1000),
      });

      await expect(
        orchestrator.confirmFile(TEST_USER_ID, TEST_BATCH_ID, TEST_FILE_ID),
      ).rejects.toThrow(BatchCancelledError);
    });

    it('rejects if batch not found', async () => {
      mockPrisma.upload_batches.findFirst.mockResolvedValue(null);

      await expect(
        orchestrator.confirmFile(TEST_USER_ID, TEST_BATCH_ID, TEST_FILE_ID),
      ).rejects.toThrow(BatchNotFoundError);
    });

    it('rejects if batch expired', async () => {
      mockPrisma.upload_batches.findFirst.mockResolvedValue({
        id: TEST_BATCH_ID,
        status: BATCH_STATUS.EXPIRED,
        total_files: 1,
        confirmed_count: 0,
        expires_at: new Date(Date.now() - 1000), // Past
      });

      await expect(
        orchestrator.confirmFile(TEST_USER_ID, TEST_BATCH_ID, TEST_FILE_ID),
      ).rejects.toThrow(BatchExpiredError);
    });

    it('rejects if file not in batch', async () => {
      mockPrisma.files.findFirst.mockResolvedValue(null);

      await expect(
        orchestrator.confirmFile(TEST_USER_ID, TEST_BATCH_ID, TEST_FILE_ID),
      ).rejects.toThrow(FileNotInBatchError);
    });

    it('throws ConcurrentModificationError if CAS update fails', async () => {
      // Reset to ACTIVE status
      mockPrisma.upload_batches.findFirst.mockResolvedValue({
        id: TEST_BATCH_ID,
        user_id: TEST_USER_ID,
        status: BATCH_STATUS.ACTIVE,
        total_files: 1,
        confirmed_count: 0,
        expires_at: new Date(Date.now() + 4 * 60 * 60 * 1000),
        created_at: new Date(),
      });

      mockFileUploadService.blobExists.mockResolvedValue(true);

      // Simulate CAS failure (updateMany returns count: 0)
      mockPrisma.files.updateMany.mockResolvedValue({ count: 0 });

      const error = await orchestrator
        .confirmFile(TEST_USER_ID, TEST_BATCH_ID, TEST_FILE_ID)
        .catch((e) => e);

      expect(error).toBeInstanceOf(ConcurrentModificationError);
      expect(error.message).toContain(`Concurrent modification detected for file ${TEST_FILE_ID}`);
    });
  });

  // ==========================================================================
  // cancelBatch
  // ==========================================================================

  describe('cancelBatch', () => {
    it('soft-deletes unconfirmed files, returns count', async () => {
      mockPrisma.upload_batches.findFirst.mockResolvedValue({
        id: TEST_BATCH_ID,
        status: BATCH_STATUS.ACTIVE,
        total_files: 5,
        confirmed_count: 2,
        expires_at: new Date(Date.now() + 4 * 60 * 60 * 1000),
      });

      mockPrisma.upload_batches.update.mockResolvedValue({
        id: TEST_BATCH_ID,
        status: BATCH_STATUS.CANCELLED,
      });

      mockPrisma.files.updateMany.mockResolvedValue({ count: 3 }); // 3 unconfirmed

      const result = await orchestrator.cancelBatch(TEST_USER_ID, TEST_BATCH_ID);

      expect(result).toMatchObject({
        batchId: TEST_BATCH_ID,
        status: BATCH_STATUS.CANCELLED,
        filesAffected: 3,
      });

      // Verify batch status update
      expect(mockPrisma.upload_batches.update).toHaveBeenCalledWith({
        where: { id: TEST_BATCH_ID },
        data: expect.objectContaining({ status: BATCH_STATUS.CANCELLED }),
      });

      // Verify soft delete
      expect(mockPrisma.files.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            batch_id: TEST_BATCH_ID,
            pipeline_status: PIPELINE_STATUS.REGISTERED,
            deletion_status: null,
          }),
          data: expect.objectContaining({
            deletion_status: 'pending',
          }),
        }),
      );
    });

    it('rejects if batch already completed', async () => {
      mockPrisma.upload_batches.findFirst.mockResolvedValue({
        id: TEST_BATCH_ID,
        status: BATCH_STATUS.COMPLETED,
        total_files: 5,
        confirmed_count: 5,
        expires_at: new Date(Date.now() + 4 * 60 * 60 * 1000),
      });

      await expect(orchestrator.cancelBatch(TEST_USER_ID, TEST_BATCH_ID)).rejects.toThrow(
        BatchAlreadyCompleteError,
      );

      // Should not proceed to cancel
      expect(mockPrisma.upload_batches.update).not.toHaveBeenCalled();
    });

    it('rejects if batch not found', async () => {
      mockPrisma.upload_batches.findFirst.mockResolvedValue(null);

      await expect(orchestrator.cancelBatch(TEST_USER_ID, TEST_BATCH_ID)).rejects.toThrow(
        BatchNotFoundError,
      );
    });

    it('rejects if batch already cancelled', async () => {
      mockPrisma.upload_batches.findFirst.mockResolvedValue({
        id: TEST_BATCH_ID,
        status: BATCH_STATUS.CANCELLED,
        total_files: 5,
        confirmed_count: 0,
        expires_at: new Date(Date.now() + 4 * 60 * 60 * 1000),
      });

      await expect(orchestrator.cancelBatch(TEST_USER_ID, TEST_BATCH_ID)).rejects.toThrow(
        BatchCancelledError,
      );
    });
  });

  // ==========================================================================
  // targetFolderId
  // ==========================================================================

  describe('targetFolderId', () => {
    const TARGET_FOLDER_ID = 'AAAA1111-2222-3333-4444-555566667777';

    it('assigns targetFolderId to root-level files and folders', async () => {
      // Mock target folder validation
      mockPrisma.files.findFirst.mockResolvedValue({
        id: TARGET_FOLDER_ID,
      });

      let folderCreateCount = 0;
      mockTx.files.create.mockImplementation((args: any) => {
        if (args.data.is_folder) {
          folderCreateCount++;
          return Promise.resolve({ id: `FOLDER-${folderCreateCount}`, ...args.data });
        }
        return Promise.resolve({ id: TEST_FILE_ID, ...args.data });
      });

      const request: CreateBatchRequest = {
        files: [
          {
            tempId: 'f1',
            fileName: 'report.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 1024,
          },
        ],
        folders: [
          {
            tempId: 'fold1',
            folderName: 'Documents',
          },
        ],
        targetFolderId: TARGET_FOLDER_ID,
      };

      await orchestrator.createBatch(TEST_USER_ID, request);

      // Root folder should have targetFolderId as parent
      const folderCall = mockTx.files.create.mock.calls.find(
        (call: any) => call[0].data.is_folder && call[0].data.name === 'Documents',
      );
      expect(folderCall![0].data.parent_folder_id).toBe(TARGET_FOLDER_ID);

      // Root file should have targetFolderId as parent
      const fileCall = mockTx.files.create.mock.calls.find(
        (call: any) => !call[0].data.is_folder,
      );
      expect(fileCall![0].data.parent_folder_id).toBe(TARGET_FOLDER_ID);
    });

    it('child items use their parent tempId, not targetFolderId', async () => {
      // Mock target folder validation
      mockPrisma.files.findFirst.mockResolvedValue({
        id: TARGET_FOLDER_ID,
      });

      let folderCreateCount = 0;
      mockTx.files.create.mockImplementation((args: any) => {
        if (args.data.is_folder) {
          folderCreateCount++;
          return Promise.resolve({ id: `FOLDER-${folderCreateCount}`, ...args.data });
        }
        return Promise.resolve({ id: TEST_FILE_ID, ...args.data });
      });

      const request: CreateBatchRequest = {
        files: [
          {
            tempId: 'f1',
            fileName: 'nested.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 1024,
            parentTempId: 'fold-child',
          },
        ],
        folders: [
          {
            tempId: 'fold-parent',
            folderName: 'Parent',
          },
          {
            tempId: 'fold-child',
            folderName: 'Child',
            parentTempId: 'fold-parent',
          },
        ],
        targetFolderId: TARGET_FOLDER_ID,
      };

      await orchestrator.createBatch(TEST_USER_ID, request);

      // Root folder "Parent" → parent is targetFolderId
      const parentFolderCall = mockTx.files.create.mock.calls.find(
        (call: any) => call[0].data.is_folder && call[0].data.name === 'Parent',
      );
      expect(parentFolderCall![0].data.parent_folder_id).toBe(TARGET_FOLDER_ID);

      // Child folder "Child" → parent is resolved from Parent's real ID
      const childFolderCall = mockTx.files.create.mock.calls.find(
        (call: any) => call[0].data.is_folder && call[0].data.name === 'Child',
      );
      expect(childFolderCall![0].data.parent_folder_id).toBe('FOLDER-1');

      // File with parentTempId → parent is resolved from Child's real ID
      const fileCall = mockTx.files.create.mock.calls.find(
        (call: any) => !call[0].data.is_folder,
      );
      expect(fileCall![0].data.parent_folder_id).toBe('FOLDER-2');
    });

    it('throws InvalidTargetFolderError for non-existent folder', async () => {
      // Mock target folder not found
      mockPrisma.files.findFirst.mockResolvedValue(null);

      const request: CreateBatchRequest = {
        files: [
          {
            tempId: 'f1',
            fileName: 'test.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 1024,
          },
        ],
        targetFolderId: 'NONEXISTENT-FOLDER-ID-1234-567890ABCDEF',
      };

      await expect(orchestrator.createBatch(TEST_USER_ID, request)).rejects.toThrow(
        InvalidTargetFolderError,
      );
      await expect(orchestrator.createBatch(TEST_USER_ID, request)).rejects.toThrow(
        'Target folder not found or is not a folder',
      );
    });

    it('does not validate when targetFolderId is null/undefined', async () => {
      const request: CreateBatchRequest = {
        files: [
          {
            tempId: 'f1',
            fileName: 'test.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 1024,
          },
        ],
      };

      await orchestrator.createBatch(TEST_USER_ID, request);

      // findFirst should NOT have been called for target folder validation
      // (it's only called inside the transaction for duplicate check, not pre-transaction)
      expect(mockPrisma.files.findFirst).not.toHaveBeenCalled();

      // Files should have null parent_folder_id
      const fileCall = mockTx.files.create.mock.calls.find(
        (call: any) => !call[0].data.is_folder,
      );
      expect(fileCall![0].data.parent_folder_id).toBeNull();
    });
  });
});
