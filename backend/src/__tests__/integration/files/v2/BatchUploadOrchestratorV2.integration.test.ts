import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupDatabaseForTests } from '../../helpers';
import { V2PipelineTestHelper, createV2PipelineTestHelper } from '../../helpers/V2PipelineTestHelper';
import { PIPELINE_STATUS, BATCH_STATUS } from '@bc-agent/shared';
import type { CreateBatchRequest } from '@bc-agent/shared';
import { executeQuery } from '@/infrastructure/database/database';

// Mock logger
vi.mock('@/shared/utils/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), trace: vi.fn(), fatal: vi.fn(), child: vi.fn() },
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

// Mock FileUploadService (Azure Blob Storage)
const mockGenerateSasUrl = vi.fn().mockImplementation(async (userId: string, fileName: string) => ({
  sasUrl: `https://fake.blob.core/container/users/${userId}/files/${fileName}?sig=xxx`,
  blobPath: `users/${userId}/files/${fileName}`,
}));
const mockBlobExists = vi.fn().mockResolvedValue(true);
const mockDeleteFromBlob = vi.fn().mockResolvedValue(undefined);

vi.mock('@/services/files/FileUploadService', () => ({
  getFileUploadService: vi.fn(() => ({
    generateSasUrlForBulkUpload: mockGenerateSasUrl,
    blobExists: mockBlobExists,
    deleteFromBlob: mockDeleteFromBlob,
  })),
}));

// Mock MessageQueue
const mockAddFileProcessingFlow = vi.fn().mockResolvedValue(undefined);
vi.mock('@/infrastructure/queue', () => ({
  getMessageQueue: vi.fn(() => ({
    addFileProcessingFlow: mockAddFileProcessingFlow,
  })),
}));

// Import orchestrator and errors AFTER mocks
import { BatchUploadOrchestratorV2 } from '@/services/files/batch/BatchUploadOrchestratorV2';
import {
  BatchNotFoundError,
  BatchExpiredError,
  BatchCancelledError,
  BatchAlreadyCompleteError,
  FileNotInBatchError,
  FileAlreadyConfirmedError,
  BlobNotFoundError,
  ManifestValidationError,
} from '@/services/files/batch/errors';

describe('BatchUploadOrchestratorV2 — Integration (PRD-03)', () => {
  setupDatabaseForTests();

  let helper: V2PipelineTestHelper;
  let orchestrator: BatchUploadOrchestratorV2;

  // Random user IDs per test (avoids stale data + MERGE issues with fixed IDs)
  let TEST_USER_A: string;
  let TEST_USER_B: string;

  beforeEach(async () => {
    helper = createV2PipelineTestHelper();

    // Create fresh random users per test — no collisions, no stale data
    const userA = await helper.createTestUser();
    const userB = await helper.createTestUser();
    TEST_USER_A = userA.id;
    TEST_USER_B = userB.id;

    orchestrator = new BatchUploadOrchestratorV2();

    // Reset mocks
    vi.clearAllMocks();
    mockBlobExists.mockResolvedValue(true);
    mockGenerateSasUrl.mockImplementation(async (userId: string, fileName: string) => ({
      sasUrl: `https://fake.blob.core/container/users/${userId}/files/${fileName}?sig=xxx`,
      blobPath: `users/${userId}/files/${fileName}`,
    }));
    mockAddFileProcessingFlow.mockResolvedValue(undefined);
  }, 15000);

  afterEach(async () => {
    // Aggressively clean ALL data for both test users (not just helper-tracked)
    // The orchestrator creates files/batches that the helper doesn't track
    for (const userId of [TEST_USER_A, TEST_USER_B]) {
      if (!userId) continue;
      await executeQuery('DELETE FROM file_chunks WHERE file_id IN (SELECT id FROM files WHERE user_id = @userId)', { userId });
      await executeQuery('DELETE FROM files WHERE user_id = @userId', { userId });
      await executeQuery('DELETE FROM upload_batches WHERE user_id = @userId', { userId });
    }
    // Now safely delete users (no FK dependencies)
    await helper.cleanup();
  }, 30000);

  describe('Phase A — createBatch', () => {
    it('should atomically create batch + files', async () => {
      const request: CreateBatchRequest = {
        files: [
          { tempId: 'temp1', fileName: 'file1.pdf', mimeType: 'application/pdf', sizeBytes: 1024 },
          { tempId: 'temp2', fileName: 'file2.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', sizeBytes: 2048 },
          { tempId: 'temp3', fileName: 'file3.txt', mimeType: 'text/plain', sizeBytes: 512 },
        ],
      };

      const response = await orchestrator.createBatch(TEST_USER_A, request);


      // Verify response structure
      expect(response.batchId).toBeTruthy();
      expect(response.status).toBe(BATCH_STATUS.ACTIVE);
      expect(response.files).toHaveLength(3);

      // Verify batch in DB
      const batch = await helper.getBatch(response.batchId);
      expect(batch).toBeDefined();
      expect(batch?.user_id).toBe(TEST_USER_A);
      expect(batch?.status).toBe(BATCH_STATUS.ACTIVE);
      expect(batch?.total_files).toBe(3);
      expect(batch?.confirmed_count).toBe(0);

      // Verify all files in DB
      for (const fileResult of response.files) {
        const file = await helper.getFile(fileResult.fileId);
        expect(file).toBeDefined();
        expect(file?.pipeline_status).toBe(PIPELINE_STATUS.REGISTERED);
        expect(file?.batch_id).toBe(response.batchId);
        expect(file?.user_id).toBe(TEST_USER_A);
      }
    }, 15000);

    it('should create batch + folders + files with parent relationships', async () => {
      const request: CreateBatchRequest = {
        folders: [
          { tempId: 'folder1', folderName: 'Documents' },
        ],
        files: [
          { tempId: 'file1', fileName: 'root.txt', mimeType: 'text/plain', sizeBytes: 100 },
          { tempId: 'file2', fileName: 'nested.pdf', mimeType: 'application/pdf', sizeBytes: 200, parentTempId: 'folder1' },
        ],
      };

      const response = await orchestrator.createBatch(TEST_USER_A, request);


      expect(response.folders).toHaveLength(1);
      expect(response.files).toHaveLength(2);

      // Verify folder
      const folder = await helper.getFile(response.folders![0].folderId);
      expect(folder).toBeDefined();
      expect(folder?.is_folder).toBe(true);
      expect(folder?.name).toBe('Documents');

      // Verify root file (tempId = 'file1')
      const rootFileResult = response.files.find(f => f.tempId === 'file1');
      expect(rootFileResult).toBeDefined();
      const rootFileDb = await helper.getFile(rootFileResult!.fileId);
      expect(rootFileDb?.parent_folder_id).toBeNull();

      // Verify nested file (tempId = 'file2')
      const nestedFileResult = response.files.find(f => f.tempId === 'file2');
      expect(nestedFileResult).toBeDefined();
      const nestedFileDb = await helper.getFile(nestedFileResult!.fileId);
      expect(nestedFileDb?.parent_folder_id).toBe(response.folders![0].folderId);
    }, 15000);

    it('should return SAS URLs for all files', async () => {
      const request: CreateBatchRequest = {
        files: [
          { tempId: 'temp1', fileName: 'test.pdf', mimeType: 'application/pdf', sizeBytes: 1024 },
        ],
      };

      const response = await orchestrator.createBatch(TEST_USER_A, request);


      expect(response.files[0].sasUrl).toBeTruthy();
      expect(response.files[0].sasUrl).toContain('https://fake.blob.core');
      expect(response.files[0].blobPath).toBeTruthy();
      expect(response.files[0].blobPath).toContain(TEST_USER_A);
    }, 15000);

    it('should set correct expires_at (~4h), confirmed_count=0, status=active', async () => {
      const request: CreateBatchRequest = {
        files: [
          { tempId: 'temp1', fileName: 'test.txt', mimeType: 'text/plain', sizeBytes: 100 },
        ],
      };

      const beforeCreate = new Date();
      const response = await orchestrator.createBatch(TEST_USER_A, request);

      const afterCreate = new Date();

      const batch = await helper.getBatch(response.batchId);
      expect(batch?.status).toBe(BATCH_STATUS.ACTIVE);
      expect(batch?.confirmed_count).toBe(0);

      // Verify expires_at is ~4 hours from now
      const expiresAt = new Date(batch!.expires_at);
      const expectedMin = new Date(beforeCreate.getTime() + 3.5 * 60 * 60 * 1000); // 3.5h
      const expectedMax = new Date(afterCreate.getTime() + 4.5 * 60 * 60 * 1000); // 4.5h
      expect(expiresAt.getTime()).toBeGreaterThan(expectedMin.getTime());
      expect(expiresAt.getTime()).toBeLessThan(expectedMax.getTime());
    }, 15000);

    it('should detect duplicates when skipDuplicateCheck=false', async () => {
      // Pre-create a 'ready' file with known name
      const existingFile = await helper.createFileWithPipelineStatus(TEST_USER_A, {
        name: 'duplicate.pdf',
        pipelineStatus: PIPELINE_STATUS.READY,
      });

      const request: CreateBatchRequest = {
        files: [
          { tempId: 'temp1', fileName: 'duplicate.pdf', mimeType: 'application/pdf', sizeBytes: 1024 },
          { tempId: 'temp2', fileName: 'unique.txt', mimeType: 'text/plain', sizeBytes: 512 },
        ],
        skipDuplicateCheck: false,
      };

      const response = await orchestrator.createBatch(TEST_USER_A, request);


      expect(response.duplicates).toBeDefined();
      expect(response.duplicates).toHaveLength(1);
      expect(response.duplicates![0].existingFile?.fileName).toBe('duplicate.pdf');
      expect(response.duplicates![0].existingFile?.fileId.toUpperCase()).toBe(existingFile.id);
    }, 15000);

    it('should skip duplicate check when skipDuplicateCheck=true', async () => {
      // Pre-create a 'ready' file with known name
      await helper.createFileWithPipelineStatus(TEST_USER_A, {
        name: 'duplicate.pdf',
        pipelineStatus: PIPELINE_STATUS.READY,
      });

      const request: CreateBatchRequest = {
        files: [
          { tempId: 'temp1', fileName: 'duplicate.pdf', mimeType: 'application/pdf', sizeBytes: 1024 },
        ],
        skipDuplicateCheck: true,
      };

      const response = await orchestrator.createBatch(TEST_USER_A, request);


      expect(response.duplicates).toBeUndefined();
    }, 15000);

    it('should return all file IDs in UPPERCASE', async () => {
      const request: CreateBatchRequest = {
        files: [
          { tempId: 'temp1', fileName: 'test1.pdf', mimeType: 'application/pdf', sizeBytes: 1024 },
          { tempId: 'temp2', fileName: 'test2.pdf', mimeType: 'application/pdf', sizeBytes: 2048 },
        ],
      };

      const response = await orchestrator.createBatch(TEST_USER_A, request);


      expect(response.batchId).toMatch(/^[A-F0-9-]+$/);
      for (const file of response.files) {
        expect(file.fileId).toMatch(/^[A-F0-9-]+$/);
      }
    }, 15000);
  });

  describe('Phase A — rollback', () => {
    it('should leave no partial data on SAS URL generation failure', async () => {
      // Snapshot counts BEFORE the failed call
      const batchesBefore = await executeQuery<{ count: number }>(
        'SELECT COUNT(*) as count FROM upload_batches WHERE user_id = @userId',
        { userId: TEST_USER_A }
      );
      const filesBefore = await executeQuery<{ count: number }>(
        'SELECT COUNT(*) as count FROM files WHERE user_id = @userId AND pipeline_status = @status',
        { userId: TEST_USER_A, status: PIPELINE_STATUS.REGISTERED }
      );

      // Mock to succeed on first call, fail on second
      let callCount = 0;
      mockGenerateSasUrl.mockImplementation(async (userId: string, fileName: string) => {
        callCount++;
        if (callCount === 2) {
          throw new Error('Simulated SAS URL generation failure');
        }
        return {
          sasUrl: `https://fake.blob.core/container/users/${userId}/files/${fileName}?sig=xxx`,
          blobPath: `users/${userId}/files/${fileName}`,
        };
      });

      const request: CreateBatchRequest = {
        files: [
          { tempId: 'temp1', fileName: 'file1.pdf', mimeType: 'application/pdf', sizeBytes: 1024 },
          { tempId: 'temp2', fileName: 'file2.pdf', mimeType: 'application/pdf', sizeBytes: 2048 },
          { tempId: 'temp3', fileName: 'file3.pdf', mimeType: 'application/pdf', sizeBytes: 3072 },
        ],
      };

      // Expect error to be thrown
      await expect(orchestrator.createBatch(TEST_USER_A, request)).rejects.toThrow('Simulated SAS URL generation failure');

      // Verify no NEW registered files created (transaction rolled back)
      const filesAfter = await executeQuery<{ count: number }>(
        'SELECT COUNT(*) as count FROM files WHERE user_id = @userId AND pipeline_status = @status',
        { userId: TEST_USER_A, status: PIPELINE_STATUS.REGISTERED }
      );
      expect(filesAfter.recordset[0].count).toBe(filesBefore.recordset[0].count);

      // Verify no NEW batches created
      const batchesAfter = await executeQuery<{ count: number }>(
        'SELECT COUNT(*) as count FROM upload_batches WHERE user_id = @userId',
        { userId: TEST_USER_A }
      );
      expect(batchesAfter.recordset[0].count).toBe(batchesBefore.recordset[0].count);
    }, 15000);
  });

  describe('Phase A — manifest validation', () => {
    it('should reject duplicate tempIds', async () => {
      const request: CreateBatchRequest = {
        files: [
          { tempId: 'temp1', fileName: 'file1.pdf', mimeType: 'application/pdf', sizeBytes: 1024 },
          { tempId: 'temp1', fileName: 'file2.pdf', mimeType: 'application/pdf', sizeBytes: 2048 },
        ],
      };

      await expect(orchestrator.createBatch(TEST_USER_A, request)).rejects.toThrow(ManifestValidationError);
    }, 15000);

    it('should reject file referencing non-existent folder tempId', async () => {
      const request: CreateBatchRequest = {
        files: [
          { tempId: 'file1', fileName: 'test.pdf', mimeType: 'application/pdf', sizeBytes: 1024, parentTempId: 'nonexistent' },
        ],
      };

      await expect(orchestrator.createBatch(TEST_USER_A, request)).rejects.toThrow(ManifestValidationError);
    }, 15000);

    it('should reject circular folder references', async () => {
      const request: CreateBatchRequest = {
        folders: [
          { tempId: 'folderA', folderName: 'FolderA', parentTempId: 'folderB' },
          { tempId: 'folderB', folderName: 'FolderB', parentTempId: 'folderA' },
        ],
        files: [],
      };

      await expect(orchestrator.createBatch(TEST_USER_A, request)).rejects.toThrow(ManifestValidationError);
    }, 15000);
  });

  describe('Phase C — confirmFile', () => {
    it('should transition registered → queued', async () => {
      const request: CreateBatchRequest = {
        files: [
          { tempId: 'temp1', fileName: 'test.pdf', mimeType: 'application/pdf', sizeBytes: 1024 },
        ],
      };

      const createResponse = await orchestrator.createBatch(TEST_USER_A, request);

      const fileId = createResponse.files[0].fileId;

      await orchestrator.confirmFile(TEST_USER_A, createResponse.batchId, fileId);

      const file = await helper.getFile(fileId);
      expect(file?.pipeline_status).toBe(PIPELINE_STATUS.QUEUED);
    }, 15000);

    it('should increment confirmed_count', async () => {
      const request: CreateBatchRequest = {
        files: [
          { tempId: 'temp1', fileName: 'file1.pdf', mimeType: 'application/pdf', sizeBytes: 1024 },
          { tempId: 'temp2', fileName: 'file2.pdf', mimeType: 'application/pdf', sizeBytes: 2048 },
          { tempId: 'temp3', fileName: 'file3.pdf', mimeType: 'application/pdf', sizeBytes: 3072 },
        ],
      };

      const createResponse = await orchestrator.createBatch(TEST_USER_A, request);


      await orchestrator.confirmFile(TEST_USER_A, createResponse.batchId, createResponse.files[0].fileId);

      const statusResponse = await orchestrator.getBatchStatus(TEST_USER_A, createResponse.batchId);
      expect(statusResponse.confirmedCount).toBe(1);
    }, 15000);

    it('should auto-complete batch when all files confirmed', async () => {
      const request: CreateBatchRequest = {
        files: [
          { tempId: 'temp1', fileName: 'single.pdf', mimeType: 'application/pdf', sizeBytes: 1024 },
        ],
      };

      const createResponse = await orchestrator.createBatch(TEST_USER_A, request);


      await orchestrator.confirmFile(TEST_USER_A, createResponse.batchId, createResponse.files[0].fileId);

      const batch = await helper.getBatch(createResponse.batchId);
      expect(batch?.status).toBe(BATCH_STATUS.COMPLETED);
    }, 15000);

    it('should enqueue addFileProcessingFlow with correct params', async () => {
      const request: CreateBatchRequest = {
        files: [
          { tempId: 'temp1', fileName: 'test.pdf', mimeType: 'application/pdf', sizeBytes: 1024 },
        ],
      };

      const createResponse = await orchestrator.createBatch(TEST_USER_A, request);

      const fileResult = createResponse.files[0];

      await orchestrator.confirmFile(TEST_USER_A, createResponse.batchId, fileResult.fileId);

      expect(mockAddFileProcessingFlow).toHaveBeenCalledWith(
        expect.objectContaining({
          fileId: fileResult.fileId,
          batchId: createResponse.batchId,
          userId: TEST_USER_A,
          mimeType: 'application/pdf',
          blobPath: expect.stringContaining(TEST_USER_A),
          fileName: 'test.pdf',
        })
      );
    }, 15000);

    it('should return batch progress', async () => {
      const request: CreateBatchRequest = {
        files: [
          { tempId: 'temp1', fileName: 'file1.pdf', mimeType: 'application/pdf', sizeBytes: 1024 },
          { tempId: 'temp2', fileName: 'file2.pdf', mimeType: 'application/pdf', sizeBytes: 2048 },
        ],
      };

      const createResponse = await orchestrator.createBatch(TEST_USER_A, request);


      const confirmResponse = await orchestrator.confirmFile(TEST_USER_A, createResponse.batchId, createResponse.files[0].fileId);

      expect(confirmResponse.batchProgress).toBeDefined();
      expect(confirmResponse.batchProgress.total).toBe(2);
      expect(confirmResponse.batchProgress.confirmed).toBe(1);
      expect(confirmResponse.batchProgress.isComplete).toBe(false);
    }, 15000);
  });

  describe('Phase C — error cases', () => {
    it('should throw BatchNotFoundError for non-existent batch', async () => {
      const fakeBatchId = 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA';
      const fakeFileId = 'BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB';

      await expect(
        orchestrator.confirmFile(TEST_USER_A, fakeBatchId, fakeFileId)
      ).rejects.toThrow(BatchNotFoundError);
    }, 15000);

    it('should throw BatchExpiredError for expired batch', async () => {
      const request: CreateBatchRequest = {
        files: [
          { tempId: 'temp1', fileName: 'test.pdf', mimeType: 'application/pdf', sizeBytes: 1024 },
        ],
      };

      const createResponse = await orchestrator.createBatch(TEST_USER_A, request);


      // Manually set expires_at to past
      await executeQuery(
        'UPDATE upload_batches SET expires_at = DATEADD(HOUR, -1, GETUTCDATE()) WHERE id = @batchId',
        { batchId: createResponse.batchId }
      );

      await expect(
        orchestrator.confirmFile(TEST_USER_A, createResponse.batchId, createResponse.files[0].fileId)
      ).rejects.toThrow(BatchExpiredError);
    }, 15000);

    it('should throw BatchCancelledError for cancelled batch', async () => {
      const request: CreateBatchRequest = {
        files: [
          { tempId: 'temp1', fileName: 'test.pdf', mimeType: 'application/pdf', sizeBytes: 1024 },
        ],
      };

      const createResponse = await orchestrator.createBatch(TEST_USER_A, request);


      await orchestrator.cancelBatch(TEST_USER_A, createResponse.batchId);

      await expect(
        orchestrator.confirmFile(TEST_USER_A, createResponse.batchId, createResponse.files[0].fileId)
      ).rejects.toThrow(BatchCancelledError);
    }, 15000);

    it('should throw BatchAlreadyCompleteError for completed batch', async () => {
      const request: CreateBatchRequest = {
        files: [
          { tempId: 'temp1', fileName: 'test.pdf', mimeType: 'application/pdf', sizeBytes: 1024 },
        ],
      };

      const createResponse = await orchestrator.createBatch(TEST_USER_A, request);


      // Confirm the single file (completes batch)
      await orchestrator.confirmFile(TEST_USER_A, createResponse.batchId, createResponse.files[0].fileId);

      // Try to confirm a non-existent file in the completed batch
      const fakeFileId = 'CCCCCCCC-CCCC-4CCC-8CCC-CCCCCCCCCCCC';
      await expect(
        orchestrator.confirmFile(TEST_USER_A, createResponse.batchId, fakeFileId)
      ).rejects.toThrow(BatchAlreadyCompleteError);
    }, 15000);

    it('should throw FileNotInBatchError for file not in batch', async () => {
      const request: CreateBatchRequest = {
        files: [
          { tempId: 'temp1', fileName: 'test.pdf', mimeType: 'application/pdf', sizeBytes: 1024 },
        ],
      };

      const createResponse = await orchestrator.createBatch(TEST_USER_A, request);


      const randomFileId = 'DDDDDDDD-DDDD-4DDD-8DDD-DDDDDDDDDDDD';

      await expect(
        orchestrator.confirmFile(TEST_USER_A, createResponse.batchId, randomFileId)
      ).rejects.toThrow(FileNotInBatchError);
    }, 15000);

    it('should throw FileAlreadyConfirmedError for already-confirmed file', async () => {
      const request: CreateBatchRequest = {
        files: [
          { tempId: 'temp1', fileName: 'test.pdf', mimeType: 'application/pdf', sizeBytes: 1024 },
          { tempId: 'temp2', fileName: 'test2.pdf', mimeType: 'application/pdf', sizeBytes: 2048 },
        ],
      };

      const createResponse = await orchestrator.createBatch(TEST_USER_A, request);

      const fileId = createResponse.files[0].fileId;

      // Confirm once
      await orchestrator.confirmFile(TEST_USER_A, createResponse.batchId, fileId);

      // Try to confirm again
      await expect(
        orchestrator.confirmFile(TEST_USER_A, createResponse.batchId, fileId)
      ).rejects.toThrow(FileAlreadyConfirmedError);
    }, 15000);

    it('should throw BlobNotFoundError when blob does not exist', async () => {
      const request: CreateBatchRequest = {
        files: [
          { tempId: 'temp1', fileName: 'test.pdf', mimeType: 'application/pdf', sizeBytes: 1024 },
        ],
      };

      const createResponse = await orchestrator.createBatch(TEST_USER_A, request);


      // Mock blobExists to return false
      mockBlobExists.mockResolvedValueOnce(false);

      await expect(
        orchestrator.confirmFile(TEST_USER_A, createResponse.batchId, createResponse.files[0].fileId)
      ).rejects.toThrow(BlobNotFoundError);
    }, 15000);

    it('should throw FileAlreadyConfirmedError when file already queued', async () => {
      const request: CreateBatchRequest = {
        files: [
          { tempId: 'temp1', fileName: 'test.pdf', mimeType: 'application/pdf', sizeBytes: 1024 },
        ],
      };

      const createResponse = await orchestrator.createBatch(TEST_USER_A, request);

      const fileId = createResponse.files[0].fileId;

      // Manually set file to 'queued' via raw SQL (simulating a race condition)
      await executeQuery(
        'UPDATE files SET pipeline_status = @status WHERE id = @fileId',
        { status: PIPELINE_STATUS.QUEUED, fileId }
      );

      // confirmFile checks pipeline_status !== REGISTERED first → FileAlreadyConfirmedError
      await expect(
        orchestrator.confirmFile(TEST_USER_A, createResponse.batchId, fileId)
      ).rejects.toThrow(FileAlreadyConfirmedError);
    }, 15000);
  });

  describe('getBatchStatus', () => {
    it('should return complete batch info with file statuses', async () => {
      const request: CreateBatchRequest = {
        files: [
          { tempId: 'temp1', fileName: 'file1.pdf', mimeType: 'application/pdf', sizeBytes: 1024 },
          { tempId: 'temp2', fileName: 'file2.pdf', mimeType: 'application/pdf', sizeBytes: 2048 },
        ],
      };

      const createResponse = await orchestrator.createBatch(TEST_USER_A, request);


      const statusResponse = await orchestrator.getBatchStatus(TEST_USER_A, createResponse.batchId);

      expect(statusResponse.batchId).toBe(createResponse.batchId);
      expect(statusResponse.status).toBe(BATCH_STATUS.ACTIVE);
      expect(statusResponse.totalFiles).toBe(2);
      expect(statusResponse.confirmedCount).toBe(0);
      expect(statusResponse.createdAt).toBeDefined();
      expect(statusResponse.expiresAt).toBeDefined();
      expect(statusResponse.files).toHaveLength(2);
      expect(statusResponse.files[0]).toHaveProperty('fileId');
      expect(statusResponse.files[0]).toHaveProperty('name');
      expect(statusResponse.files[0]).toHaveProperty('pipelineStatus');
    }, 15000);

    it('should throw BatchNotFoundError for non-existent batch', async () => {
      const fakeBatchId = 'EEEEEEEE-EEEE-4EEE-8EEE-EEEEEEEEEEEE';

      await expect(
        orchestrator.getBatchStatus(TEST_USER_A, fakeBatchId)
      ).rejects.toThrow(BatchNotFoundError);
    }, 15000);
  });

  describe('cancelBatch', () => {
    it('should mark batch as cancelled', async () => {
      const request: CreateBatchRequest = {
        files: [
          { tempId: 'temp1', fileName: 'test.pdf', mimeType: 'application/pdf', sizeBytes: 1024 },
        ],
      };

      const createResponse = await orchestrator.createBatch(TEST_USER_A, request);


      await orchestrator.cancelBatch(TEST_USER_A, createResponse.batchId);

      const batch = await helper.getBatch(createResponse.batchId);
      expect(batch?.status).toBe(BATCH_STATUS.CANCELLED);
    }, 15000);

    it('should soft-delete unconfirmed files (registered)', async () => {
      const request: CreateBatchRequest = {
        files: [
          { tempId: 'temp1', fileName: 'file1.pdf', mimeType: 'application/pdf', sizeBytes: 1024 },
          { tempId: 'temp2', fileName: 'file2.pdf', mimeType: 'application/pdf', sizeBytes: 2048 },
        ],
      };

      const createResponse = await orchestrator.createBatch(TEST_USER_A, request);


      // Confirm only the first file
      await orchestrator.confirmFile(TEST_USER_A, createResponse.batchId, createResponse.files[0].fileId);

      // Cancel batch
      await orchestrator.cancelBatch(TEST_USER_A, createResponse.batchId);

      // Verify first file (confirmed/queued) is NOT soft-deleted
      const confirmedFile = await helper.getFile(createResponse.files[0].fileId);
      expect(confirmedFile?.deletion_status).toBeNull();

      // Verify second file (unconfirmed/registered) IS soft-deleted
      const unconfirmedFile = await helper.getFile(createResponse.files[1].fileId);
      expect(unconfirmedFile?.deletion_status).toBe('pending');
    }, 15000);

    it('should preserve confirmed files (queued/extracting/etc.)', async () => {
      const request: CreateBatchRequest = {
        files: [
          { tempId: 'temp1', fileName: 'confirmed.pdf', mimeType: 'application/pdf', sizeBytes: 1024 },
          { tempId: 'temp2', fileName: 'unconfirmed.pdf', mimeType: 'application/pdf', sizeBytes: 2048 },
        ],
      };

      const createResponse = await orchestrator.createBatch(TEST_USER_A, request);


      // Confirm first file
      await orchestrator.confirmFile(TEST_USER_A, createResponse.batchId, createResponse.files[0].fileId);

      // Cancel batch
      await orchestrator.cancelBatch(TEST_USER_A, createResponse.batchId);

      // Verify confirmed file still exists and is not deleted
      const confirmedFile = await helper.getFile(createResponse.files[0].fileId);
      expect(confirmedFile).toBeDefined();
      expect(confirmedFile?.pipeline_status).toBe(PIPELINE_STATUS.QUEUED);
      expect(confirmedFile?.deletion_status).toBeNull();
    }, 15000);
  });

  describe('Multi-tenant isolation', () => {
    it('should prevent UserB from confirming UserA batch', async () => {
      const request: CreateBatchRequest = {
        files: [
          { tempId: 'temp1', fileName: 'test.pdf', mimeType: 'application/pdf', sizeBytes: 1024 },
        ],
      };

      const createResponse = await orchestrator.createBatch(TEST_USER_A, request);


      // User B tries to confirm User A's batch
      await expect(
        orchestrator.confirmFile(TEST_USER_B, createResponse.batchId, createResponse.files[0].fileId)
      ).rejects.toThrow(BatchNotFoundError);
    }, 15000);

    it('should prevent UserB from cancelling UserA batch', async () => {
      const request: CreateBatchRequest = {
        files: [
          { tempId: 'temp1', fileName: 'test.pdf', mimeType: 'application/pdf', sizeBytes: 1024 },
        ],
      };

      const createResponse = await orchestrator.createBatch(TEST_USER_A, request);


      // User B tries to cancel User A's batch
      await expect(
        orchestrator.cancelBatch(TEST_USER_B, createResponse.batchId)
      ).rejects.toThrow(BatchNotFoundError);
    }, 15000);

    it('should prevent UserB from viewing UserA batch', async () => {
      const request: CreateBatchRequest = {
        files: [
          { tempId: 'temp1', fileName: 'test.pdf', mimeType: 'application/pdf', sizeBytes: 1024 },
        ],
      };

      const createResponse = await orchestrator.createBatch(TEST_USER_A, request);


      // User B tries to view User A's batch
      await expect(
        orchestrator.getBatchStatus(TEST_USER_B, createResponse.batchId)
      ).rejects.toThrow(BatchNotFoundError);
    }, 15000);
  });
});
