import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupDatabaseForTests } from '../../helpers';
import { V2PipelineTestHelper, createV2PipelineTestHelper } from '../../helpers/V2PipelineTestHelper';
import { executeQuery } from '@/infrastructure/database/database';
import { PIPELINE_STATUS, type CreateBatchRequest } from '@bc-agent/shared';

// Mock logger
vi.mock('@/shared/utils/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), trace: vi.fn(), fatal: vi.fn(), child: vi.fn() },
  createChildLogger: vi.fn(() => ({
    info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), trace: vi.fn(), fatal: vi.fn(), child: vi.fn(),
  })),
}));

// Mock FileUploadService
const mockGenerateSasUrl = vi.fn().mockImplementation(async (userId: string, fileName: string) => ({
  sasUrl: `https://fake.blob.core/container/users/${userId}/files/${fileName}?sig=xxx`,
  blobPath: `users/${userId}/files/${fileName}`,
}));
const mockBlobExists = vi.fn().mockResolvedValue(true);

vi.mock('@/services/files/FileUploadService', () => ({
  getFileUploadService: vi.fn(() => ({
    generateSasUrlForBulkUpload: mockGenerateSasUrl,
    blobExists: mockBlobExists,
    deleteFromBlob: vi.fn().mockResolvedValue(undefined),
  })),
}));

// Mock MessageQueue
const mockAddFileProcessingFlow = vi.fn().mockResolvedValue(undefined);
vi.mock('@/infrastructure/queue', () => ({
  getMessageQueue: vi.fn(() => ({
    addFileProcessingFlow: mockAddFileProcessingFlow,
  })),
}));

// Also mock for dynamic import path used by DLQService and StuckFileRecoveryService
vi.mock('@/infrastructure/queue/MessageQueue', () => ({
  getMessageQueue: vi.fn(() => ({
    addFileProcessingFlow: mockAddFileProcessingFlow,
  })),
  hasMessageQueueInstance: vi.fn(() => true),
}));

import { BatchUploadOrchestratorV2 } from '@/services/files/batch/BatchUploadOrchestratorV2';
import { FileRepositoryV2 } from '@/services/files/repository/FileRepositoryV2';
import { FileAlreadyConfirmedError } from '@/services/files/batch/errors';
import { StuckFileRecoveryService } from '@/domains/files/recovery/StuckFileRecoveryService';

describe('V2 Pipeline Regression — Original Bug Scenarios', () => {
  setupDatabaseForTests();

  let helper: V2PipelineTestHelper;
  let userId: string;
  const createdBatchIds: string[] = [];

  beforeEach(async () => {
    vi.clearAllMocks();
    mockBlobExists.mockResolvedValue(true);
    mockGenerateSasUrl.mockImplementation(async (uid: string, fileName: string) => ({
      sasUrl: `https://fake.blob.core/container/users/${uid}/files/${fileName}?sig=xxx`,
      blobPath: `users/${uid}/files/${fileName}`,
    }));

    helper = createV2PipelineTestHelper();
    const user = await helper.createTestUser();
    userId = user.id;
  });

  afterEach(async () => {
    if (createdBatchIds.length > 0) {
      const placeholders = createdBatchIds.map((_, i) => `@batchId${i}`).join(', ');
      const params = createdBatchIds.reduce((acc, id, i) => {
        acc[`batchId${i}`] = id;
        return acc;
      }, {} as Record<string, string>);

      await executeQuery(
        `DELETE FROM files WHERE batch_id IN (${placeholders})`,
        params
      );
      await executeQuery(
        `DELETE FROM upload_batches WHERE id IN (${placeholders})`,
        params
      );
    }
    await helper.cleanup();
  });

  describe('BUG: Non-atomic transitions → now impossible', () => {
    it('No partial data after transaction failure', { timeout: 15000 }, async () => {
      const orchestrator = new BatchUploadOrchestratorV2();

      // Mock to succeed first call, fail second
      mockGenerateSasUrl
        .mockResolvedValueOnce({ sasUrl: 'https://fake/1?sig=x', blobPath: 'users/x/files/1' })
        .mockRejectedValueOnce(new Error('SAS URL generation failed'));

      const request: CreateBatchRequest = {
        files: [
          { tempId: 'temp1', fileName: 'file1.pdf', mimeType: 'application/pdf', sizeBytes: 1000 },
          { tempId: 'temp2', fileName: 'file2.pdf', mimeType: 'application/pdf', sizeBytes: 2000 },
          { tempId: 'temp3', fileName: 'file3.pdf', mimeType: 'application/pdf', sizeBytes: 3000 },
        ],
        skipDuplicateCheck: true,
      };

      await expect(
        orchestrator.createBatch(userId, request)
      ).rejects.toThrow('SAS URL generation failed');

      // Verify no files exist for this user
      const result = await executeQuery<{ count: number }>(
        `SELECT COUNT(*) as count FROM files WHERE user_id = @userId`,
        { userId }
      );
      expect(result.recordset[0].count).toBe(0);

      // Verify no batches exist
      const batchResult = await executeQuery<{ count: number }>(
        `SELECT COUNT(*) as count FROM upload_batches WHERE user_id = @userId`,
        { userId }
      );
      expect(batchResult.recordset[0].count).toBe(0);
    });

    it('CAS prevents partial status updates', { timeout: 15000 }, async () => {
      const repo = new FileRepositoryV2();
      const file = await helper.createFileWithPipelineStatus(userId, {
        pipelineStatus: PIPELINE_STATUS.QUEUED,
      });

      // Two concurrent transitions
      const results = await Promise.allSettled([
        repo.transitionStatus(file.id, userId, PIPELINE_STATUS.QUEUED, PIPELINE_STATUS.EXTRACTING),
        repo.transitionStatus(file.id, userId, PIPELINE_STATUS.QUEUED, PIPELINE_STATUS.EXTRACTING),
      ]);

      // Both should fulfill (transitionStatus returns { success: boolean }, doesn't throw)
      expect(results[0].status).toBe('fulfilled');
      expect(results[1].status).toBe('fulfilled');

      const result1 = results[0].status === 'fulfilled' ? results[0].value : null;
      const result2 = results[1].status === 'fulfilled' ? results[1].value : null;

      // Exactly one should have success=true
      const successCount = [result1?.success, result2?.success].filter(Boolean).length;
      expect(successCount).toBe(1);

      // Verify file is in extracting state (not corrupted)
      const fileResult = await executeQuery<{ pipeline_status: string }>(
        `SELECT pipeline_status FROM files WHERE id = @fileId`,
        { fileId: file.id }
      );
      expect(fileResult.recordset[0].pipeline_status).toBe(PIPELINE_STATUS.EXTRACTING);
    });
  });

  describe('BUG: File loss → verify zero-loss', () => {
    it('Every file from batch creation exists in DB with pipeline_status set', { timeout: 15000 }, async () => {
      const orchestrator = new BatchUploadOrchestratorV2();

      const request: CreateBatchRequest = {
        files: [
          { tempId: 'temp1', fileName: 'file1.pdf', mimeType: 'application/pdf', sizeBytes: 1000 },
          { tempId: 'temp2', fileName: 'file2.pdf', mimeType: 'application/pdf', sizeBytes: 2000 },
          { tempId: 'temp3', fileName: 'file3.pdf', mimeType: 'application/pdf', sizeBytes: 3000 },
          { tempId: 'temp4', fileName: 'file4.pdf', mimeType: 'application/pdf', sizeBytes: 4000 },
          { tempId: 'temp5', fileName: 'file5.pdf', mimeType: 'application/pdf', sizeBytes: 5000 },
        ],
        skipDuplicateCheck: true,
      };

      const batch = await orchestrator.createBatch(userId, request);
      createdBatchIds.push(batch.batchId);

      // Query DB for count
      const result = await executeQuery<{ count: number }>(
        `SELECT COUNT(*) as count FROM files WHERE batch_id = @batchId`,
        { batchId: batch.batchId }
      );
      expect(result.recordset[0].count).toBe(5);

      // Verify each has pipeline_status='registered'
      const statusResult = await executeQuery<{ pipeline_status: string }>(
        `SELECT pipeline_status FROM files WHERE batch_id = @batchId`,
        { batchId: batch.batchId }
      );
      expect(statusResult.recordset).toHaveLength(5);
      statusResult.recordset.forEach(row => {
        expect(row.pipeline_status).toBe(PIPELINE_STATUS.REGISTERED);
      });
    });

    it('batch.total_files === count of files with that batch_id', { timeout: 15000 }, async () => {
      const orchestrator = new BatchUploadOrchestratorV2();

      const request: CreateBatchRequest = {
        files: [
          { tempId: 'temp1', fileName: 'file1.pdf', mimeType: 'application/pdf', sizeBytes: 1000 },
          { tempId: 'temp2', fileName: 'file2.pdf', mimeType: 'application/pdf', sizeBytes: 2000 },
          { tempId: 'temp3', fileName: 'file3.pdf', mimeType: 'application/pdf', sizeBytes: 3000 },
        ],
        skipDuplicateCheck: true,
      };

      const batch = await orchestrator.createBatch(userId, request);
      createdBatchIds.push(batch.batchId);

      // Get batch record
      const batchResult = await executeQuery<{ total_files: number }>(
        `SELECT total_files FROM upload_batches WHERE id = @batchId`,
        { batchId: batch.batchId }
      );

      // Count files
      const fileCountResult = await executeQuery<{ count: number }>(
        `SELECT COUNT(*) as count FROM files WHERE batch_id = @batchId`,
        { batchId: batch.batchId }
      );

      expect(batchResult.recordset[0].total_files).toBe(fileCountResult.recordset[0].count);
      expect(batch.files.length).toBe(fileCountResult.recordset[0].count);
    });
  });

  describe('BUG: Concurrent confirmations → CAS prevents double-processing', () => {
    it('Second confirmation throws FileAlreadyConfirmedError', { timeout: 15000 }, async () => {
      const orchestrator = new BatchUploadOrchestratorV2();

      const request: CreateBatchRequest = {
        files: [
          { tempId: 'temp1', fileName: 'file1.pdf', mimeType: 'application/pdf', sizeBytes: 1000 },
          { tempId: 'temp2', fileName: 'file2.pdf', mimeType: 'application/pdf', sizeBytes: 2000 },
        ],
        skipDuplicateCheck: true,
      };
      const batch = await orchestrator.createBatch(userId, request);
      createdBatchIds.push(batch.batchId);

      const fileId = batch.files[0].fileId;

      // First confirmation (batch stays active: 1/2 confirmed)
      await orchestrator.confirmFile(userId, batch.batchId, fileId);

      // Second confirmation of same file should throw
      await expect(
        orchestrator.confirmFile(userId, batch.batchId, fileId)
      ).rejects.toThrow(FileAlreadyConfirmedError);
    });

    it('Parallel confirms — exactly one succeeds', { timeout: 15000 }, async () => {
      const orchestrator = new BatchUploadOrchestratorV2();

      const request: CreateBatchRequest = {
        files: [{ tempId: 'temp1', fileName: 'file1.pdf', mimeType: 'application/pdf', sizeBytes: 1000 }],
        skipDuplicateCheck: true,
      };
      const batch = await orchestrator.createBatch(userId, request);
      createdBatchIds.push(batch.batchId);

      const fileId = batch.files[0].fileId;

      // Parallel confirmations
      const results = await Promise.allSettled([
        orchestrator.confirmFile(userId, batch.batchId, fileId),
        orchestrator.confirmFile(userId, batch.batchId, fileId),
      ]);

      const succeeded = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.filter(r => r.status === 'rejected').length;

      expect(succeeded).toBe(1);
      expect(failed).toBe(1);

      // Verify file is queued (not in registered state anymore)
      const fileResult = await executeQuery<{ pipeline_status: string }>(
        `SELECT pipeline_status FROM files WHERE id = @fileId`,
        { fileId }
      );
      expect(fileResult.recordset[0].pipeline_status).toBe(PIPELINE_STATUS.QUEUED);
    });

    it('addFileProcessingFlow called exactly once', { timeout: 15000 }, async () => {
      const orchestrator = new BatchUploadOrchestratorV2();

      const request: CreateBatchRequest = {
        files: [{ tempId: 'temp1', fileName: 'file1.pdf', mimeType: 'application/pdf', sizeBytes: 1000 }],
        skipDuplicateCheck: true,
      };
      const batch = await orchestrator.createBatch(userId, request);
      createdBatchIds.push(batch.batchId);

      const fileId = batch.files[0].fileId;

      mockAddFileProcessingFlow.mockClear();

      // Parallel confirmations
      await Promise.allSettled([
        orchestrator.confirmFile(userId, batch.batchId, fileId),
        orchestrator.confirmFile(userId, batch.batchId, fileId),
      ]);

      // Flow should be enqueued exactly once
      expect(mockAddFileProcessingFlow).toHaveBeenCalledTimes(1);
    });
  });

  describe('BUG: Server crash during processing → recovery', () => {
    // StuckFileRecoveryService.run() operates globally (no userId filter) by design.
    // Clear stale stuck files from previous test runs to avoid polluting count assertions.
    beforeEach(async () => {
      await executeQuery(
        `UPDATE files SET pipeline_status = @targetStatus
         WHERE pipeline_status IN ('queued', 'extracting', 'chunking', 'embedding')
         AND updated_at < DATEADD(MINUTE, -15, GETDATE())`,
        { targetStatus: PIPELINE_STATUS.FAILED }
      );
    });

    it('Stuck file in extracting recovered by StuckFileRecoveryService', { timeout: 15000 }, async () => {
      const file = await helper.createFileWithPipelineStatus(userId, {
        pipelineStatus: PIPELINE_STATUS.EXTRACTING,
        pipelineRetryCount: 0,
      });

      // Set updated_at to 20 minutes ago
      await helper.setFileUpdatedAt(file.id, new Date(Date.now() - 20 * 60 * 1000));

      const service = new StuckFileRecoveryService();
      const result = await service.run(15 * 60 * 1000, 3); // 15 min threshold, max 3 retries

      expect(result.reEnqueued).toBe(1);

      // Verify file is now queued
      const fileResult = await executeQuery<{ pipeline_status: string }>(
        `SELECT pipeline_status FROM files WHERE id = @fileId`,
        { fileId: file.id }
      );
      expect(fileResult.recordset[0].pipeline_status).toBe(PIPELINE_STATUS.QUEUED);
    });

    it('Files stuck in multiple states all recovered', { timeout: 15000 }, async () => {
      const file1 = await helper.createFileWithPipelineStatus(userId, {
        pipelineStatus: PIPELINE_STATUS.EXTRACTING,
        pipelineRetryCount: 0,
      });
      const file2 = await helper.createFileWithPipelineStatus(userId, {
        pipelineStatus: PIPELINE_STATUS.CHUNKING,
        pipelineRetryCount: 1,
      });
      const file3 = await helper.createFileWithPipelineStatus(userId, {
        pipelineStatus: PIPELINE_STATUS.EMBEDDING,
        pipelineRetryCount: 0,
      });

      // Set all updated_at to 20 minutes ago
      const oldDate = new Date(Date.now() - 20 * 60 * 1000);
      await helper.setFileUpdatedAt(file1.id, oldDate);
      await helper.setFileUpdatedAt(file2.id, oldDate);
      await helper.setFileUpdatedAt(file3.id, oldDate);

      const service = new StuckFileRecoveryService();
      const result = await service.run(15 * 60 * 1000, 3);

      expect(result.totalStuck).toBe(3);
      expect(result.reEnqueued).toBe(3);

      // Verify all are queued
      const fileResults = await executeQuery<{ id: string; pipeline_status: string }>(
        `SELECT id, pipeline_status FROM files WHERE id IN (@file1, @file2, @file3)`,
        { file1: file1.id, file2: file2.id, file3: file3.id }
      );

      expect(fileResults.recordset).toHaveLength(3);
      fileResults.recordset.forEach(row => {
        expect(row.pipeline_status).toBe(PIPELINE_STATUS.QUEUED);
      });
    });

    it('Max retries exceeded → permanently failed (not infinite loop)', { timeout: 15000 }, async () => {
      const file = await helper.createFileWithPipelineStatus(userId, {
        pipelineStatus: PIPELINE_STATUS.EXTRACTING,
        pipelineRetryCount: 3, // Already at max
      });

      // Set updated_at to 20 minutes ago
      await helper.setFileUpdatedAt(file.id, new Date(Date.now() - 20 * 60 * 1000));

      const service = new StuckFileRecoveryService();
      const result = await service.run(15 * 60 * 1000, 3); // Max 3 retries

      expect(result.permanentlyFailed).toBe(1);

      // Verify file is failed (not stuck in infinite retry loop)
      const fileResult = await executeQuery<{ pipeline_status: string }>(
        `SELECT pipeline_status FROM files WHERE id = @fileId`,
        { fileId: file.id }
      );
      expect(fileResult.recordset[0].pipeline_status).toBe(PIPELINE_STATUS.FAILED);
    });
  });

  describe('BUG: Silent failures → all tracked', () => {
    it('Failed files discoverable via findByStatus(FAILED)', { timeout: 15000 }, async () => {
      const repo = new FileRepositoryV2();

      const file = await helper.createFileWithPipelineStatus(userId, {
        pipelineStatus: PIPELINE_STATUS.QUEUED,
      });

      // Transition to failed
      await repo.transitionStatus(file.id, userId, PIPELINE_STATUS.QUEUED, PIPELINE_STATUS.FAILED);

      // Find failed files
      const failedFiles = await repo.findByStatus(PIPELINE_STATUS.FAILED, { userId });

      expect(failedFiles.length).toBeGreaterThanOrEqual(1);
      expect(failedFiles.some(f => f.id.toUpperCase() === file.id)).toBe(true);
    });

    it('Failed files retryable via DLQ retryFile (failed → queued)', { timeout: 15000 }, async () => {
      const repo = new FileRepositoryV2();

      const file = await helper.createFileWithPipelineStatus(userId, {
        pipelineStatus: PIPELINE_STATUS.FAILED,
      });

      // Retry transition (this is what DLQService.retryFile does)
      const result = await repo.transitionStatus(file.id, userId, PIPELINE_STATUS.FAILED, PIPELINE_STATUS.QUEUED);

      expect(result.success).toBe(true);

      // Verify file is now queued
      const fileResult = await executeQuery<{ pipeline_status: string }>(
        `SELECT pipeline_status FROM files WHERE id = @fileId`,
        { fileId: file.id }
      );
      expect(fileResult.recordset[0].pipeline_status).toBe(PIPELINE_STATUS.QUEUED);
    });
  });
});
