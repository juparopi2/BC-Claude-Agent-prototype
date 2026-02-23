/**
 * RecoveryAndCleanup.integration.test.ts
 *
 * Integration tests for PRD-05 file recovery, batch timeout, and orphan cleanup services.
 *
 * Tests:
 * - StuckFileRecoveryService: detects stuck files, re-enqueues or permanently fails them
 * - BatchTimeoutService: expires batches past expires_at, deletes unconfirmed files
 * - OrphanCleanupService: cleans abandoned uploads and old failures
 *
 * @module __tests__/integration/files/RecoveryAndCleanup.integration.test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupDatabaseForTests } from '../helpers';
import { PipelineTestHelper, createPipelineTestHelper } from '../helpers/PipelineTestHelper';
import { executeQuery } from '@/infrastructure/database/database';
import { PIPELINE_STATUS, BATCH_STATUS } from '@bc-agent/shared';

// Mock logger
vi.mock('@/shared/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
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

// Mock FileUploadService
const mockDeleteFromBlob = vi.fn().mockResolvedValue(undefined);
const mockListBlobs = vi.fn().mockResolvedValue([]);
vi.mock('@/services/files/FileUploadService', () => ({
  getFileUploadService: vi.fn(() => ({
    deleteFromBlob: mockDeleteFromBlob,
    listBlobs: mockListBlobs,
  })),
}));

// Mock MessageQueue
const mockAddFileProcessingFlow = vi.fn().mockResolvedValue(undefined);
vi.mock('@/infrastructure/queue/MessageQueue', () => ({
  getMessageQueue: vi.fn(() => ({
    addFileProcessingFlow: mockAddFileProcessingFlow,
  })),
  hasMessageQueueInstance: vi.fn(() => true),
}));

// Import services AFTER mocks
import { StuckFileRecoveryService } from '@/domains/files/recovery/StuckFileRecoveryService';
import { BatchTimeoutService } from '@/domains/files/cleanup/BatchTimeoutService';
import { OrphanCleanupService } from '@/domains/files/cleanup/OrphanCleanupService';

describe('Recovery and Cleanup Integration (PRD-05)', () => {
  setupDatabaseForTests();

  let helper: PipelineTestHelper;
  let userId: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    helper = createPipelineTestHelper();

    const user = await helper.createTestUser();
    userId = user.id;
  });

  afterEach(async () => {
    await helper.cleanup();
  });

  describe('StuckFileRecoveryService', () => {
    it(
      'should detect files stuck in extracting >15min',
      async () => {
        // Create file stuck at 'extracting' with updated_at = 20min ago
        const stuckFile = await helper.createFileWithPipelineStatus(userId, {
          pipelineStatus: PIPELINE_STATUS.EXTRACTING,
        });
        await helper.setFileUpdatedAt(stuckFile.id, new Date(Date.now() - 20 * 60 * 1000));

        // Create fresh file at 'extracting' (just now)
        const freshFile = await helper.createFileWithPipelineStatus(userId, {
          pipelineStatus: PIPELINE_STATUS.EXTRACTING,
        });

        const service = new StuckFileRecoveryService();
        const metrics = await service.run(15 * 60 * 1000, 3);

        // Only the old one should be detected
        expect(metrics.totalStuck).toBe(1);
        expect(metrics.reEnqueued).toBe(1);
        expect(metrics.permanentlyFailed).toBe(0);

        // Verify fresh file is still extracting
        const freshStatus = await helper.getFileStatus(freshFile.id);
        expect(freshStatus).toBe(PIPELINE_STATUS.EXTRACTING);
      },
      15000
    );

    it(
      'should re-enqueue files with retry_count < 3',
      async () => {
        // Create stuck extracting file with pipeline_retry_count=0
        const stuckFile = await helper.createFileWithPipelineStatus(userId, {
          pipelineStatus: PIPELINE_STATUS.EXTRACTING,
          pipelineRetryCount: 0,
        });
        await helper.setFileUpdatedAt(stuckFile.id, new Date(Date.now() - 20 * 60 * 1000));

        const service = new StuckFileRecoveryService();
        const metrics = await service.run(15 * 60 * 1000, 3);

        expect(metrics.reEnqueued).toBe(1);
        expect(metrics.permanentlyFailed).toBe(0);

        // Verify file is now at 'queued' status, pipeline_retry_count=1
        const file = await helper.getFile(stuckFile.id);
        expect(file?.pipeline_status).toBe(PIPELINE_STATUS.QUEUED);
        expect(file?.pipeline_retry_count).toBe(1);

        // Verify mockAddFileProcessingFlow was called (case-insensitive check)
        expect(mockAddFileProcessingFlow).toHaveBeenCalledTimes(1);
        const callArgs = mockAddFileProcessingFlow.mock.calls[0][0];
        expect(callArgs.fileId.toUpperCase()).toBe(stuckFile.id);
        expect(callArgs.userId.toUpperCase()).toBe(userId);
      },
      15000
    );

    it(
      'should permanently fail files with retry_count >= 3',
      async () => {
        // Create stuck extracting file with pipeline_retry_count=3
        const stuckFile = await helper.createFileWithPipelineStatus(userId, {
          pipelineStatus: PIPELINE_STATUS.EXTRACTING,
          pipelineRetryCount: 3,
        });
        await helper.setFileUpdatedAt(stuckFile.id, new Date(Date.now() - 20 * 60 * 1000));

        const service = new StuckFileRecoveryService();
        const metrics = await service.run(15 * 60 * 1000, 3);

        expect(metrics.permanentlyFailed).toBe(1);
        expect(metrics.reEnqueued).toBe(0);

        // Verify file is now at 'failed' status
        const status = await helper.getFileStatus(stuckFile.id);
        expect(status).toBe(PIPELINE_STATUS.FAILED);

        // Verify mockAddFileProcessingFlow was NOT called
        expect(mockAddFileProcessingFlow).not.toHaveBeenCalled();
      },
      15000
    );

    it(
      'should return accurate metrics',
      async () => {
        // Create 2 stuck files: one recoverable (retry_count=1), one max retries (retry_count=3)
        const recoverableFile = await helper.createFileWithPipelineStatus(userId, {
          pipelineStatus: PIPELINE_STATUS.EXTRACTING,
          pipelineRetryCount: 1,
        });
        await helper.setFileUpdatedAt(
          recoverableFile.id,
          new Date(Date.now() - 20 * 60 * 1000)
        );

        const maxRetriesFile = await helper.createFileWithPipelineStatus(userId, {
          pipelineStatus: PIPELINE_STATUS.EXTRACTING,
          pipelineRetryCount: 3,
        });
        await helper.setFileUpdatedAt(maxRetriesFile.id, new Date(Date.now() - 20 * 60 * 1000));

        const service = new StuckFileRecoveryService();
        const metrics = await service.run(15 * 60 * 1000, 3);

        expect(metrics.totalStuck).toBe(2);
        expect(metrics.reEnqueued).toBe(1);
        expect(metrics.permanentlyFailed).toBe(1);

        // Verify byStatus breakdown
        expect(metrics.byStatus).toEqual(
          expect.objectContaining({
            extracting: 2,
          })
        );
      },
      15000
    );

    it(
      'should handle no stuck files gracefully',
      async () => {
        // No files in DB
        const service = new StuckFileRecoveryService();
        const metrics = await service.run(15 * 60 * 1000, 3);

        expect(metrics.totalStuck).toBe(0);
        expect(metrics.reEnqueued).toBe(0);
        expect(metrics.permanentlyFailed).toBe(0);
      },
      15000
    );

    it(
      'should not touch terminal states (ready, failed)',
      async () => {
        // Create 'ready' file with old updated_at
        const readyFile = await helper.createFileWithPipelineStatus(userId, {
          pipelineStatus: PIPELINE_STATUS.READY,
        });
        await helper.setFileUpdatedAt(readyFile.id, new Date(Date.now() - 20 * 60 * 1000));

        // Create 'failed' file with old updated_at
        const failedFile = await helper.createFileWithPipelineStatus(userId, {
          pipelineStatus: PIPELINE_STATUS.FAILED,
        });
        await helper.setFileUpdatedAt(failedFile.id, new Date(Date.now() - 20 * 60 * 1000));

        const service = new StuckFileRecoveryService();
        const metrics = await service.run(15 * 60 * 1000, 3);

        // Neither should be detected
        expect(metrics.totalStuck).toBe(0);

        // Verify files are unchanged
        const readyStatus = await helper.getFileStatus(readyFile.id);
        expect(readyStatus).toBe(PIPELINE_STATUS.READY);

        const failedStatus = await helper.getFileStatus(failedFile.id);
        expect(failedStatus).toBe(PIPELINE_STATUS.FAILED);
      },
      15000
    );
  });

  describe('BatchTimeoutService', () => {
    it(
      'should expire active batch past expires_at',
      async () => {
        // Create batch with status='active', expires_at = 1 hour ago
        const batch = await helper.createBatch(userId, {
          status: BATCH_STATUS.ACTIVE,
          expiresAt: new Date(Date.now() - 3600000),
        });

        const service = new BatchTimeoutService();
        const metrics = await service.run();

        expect(metrics.expiredBatches).toBe(1);

        // Verify batch status='expired' in DB
        const batchRow = await helper.getBatch(batch.id);
        expect(batchRow?.status).toBe(BATCH_STATUS.EXPIRED);
      },
      15000
    );

    it(
      'should delete unconfirmed files from expired batch',
      async () => {
        // Create batch + 2 files at 'registered' linked to batch
        const batch = await helper.createBatch(userId, {
          status: BATCH_STATUS.ACTIVE,
          totalFiles: 2,
          confirmedCount: 0,
        });

        const file1 = await helper.createFileWithPipelineStatus(userId, {
          batchId: batch.id,
          pipelineStatus: PIPELINE_STATUS.REGISTERED,
        });

        const file2 = await helper.createFileWithPipelineStatus(userId, {
          batchId: batch.id,
          pipelineStatus: PIPELINE_STATUS.REGISTERED,
        });

        // Set batch expires_at to past
        await executeQuery(
          `UPDATE upload_batches SET expires_at = @expiresAt WHERE id = @batchId`,
          {
            batchId: batch.id,
            expiresAt: new Date(Date.now() - 3600000),
          }
        );

        const service = new BatchTimeoutService();
        const metrics = await service.run();

        expect(metrics.deletedFiles).toBe(2);

        // Verify files are hard-deleted from DB
        const file1Row = await helper.getFile(file1.id);
        expect(file1Row).toBeNull();

        const file2Row = await helper.getFile(file2.id);
        expect(file2Row).toBeNull();

        // Verify mockDeleteFromBlob was called for each file
        expect(mockDeleteFromBlob).toHaveBeenCalledTimes(2);
      },
      15000
    );

    it(
      'should preserve confirmed files (queued/extracting in expired batch)',
      async () => {
        // Create batch + 2 files: one at 'registered', one at 'queued'
        const batch = await helper.createBatch(userId, {
          status: BATCH_STATUS.ACTIVE,
          totalFiles: 2,
          confirmedCount: 1,
        });

        const registeredFile = await helper.createFileWithPipelineStatus(userId, {
          batchId: batch.id,
          pipelineStatus: PIPELINE_STATUS.REGISTERED,
        });

        const queuedFile = await helper.createFileWithPipelineStatus(userId, {
          batchId: batch.id,
          pipelineStatus: PIPELINE_STATUS.QUEUED,
        });

        // Set batch expires_at to past
        await executeQuery(
          `UPDATE upload_batches SET expires_at = @expiresAt WHERE id = @batchId`,
          {
            batchId: batch.id,
            expiresAt: new Date(Date.now() - 3600000),
          }
        );

        const service = new BatchTimeoutService();
        const metrics = await service.run();

        expect(metrics.deletedFiles).toBe(1);

        // Verify the 'queued' file still exists in DB
        const queuedFileRow = await helper.getFile(queuedFile.id);
        expect(queuedFileRow).not.toBeNull();
        expect(queuedFileRow?.pipeline_status).toBe(PIPELINE_STATUS.QUEUED);

        // Verify the 'registered' file is deleted
        const registeredFileRow = await helper.getFile(registeredFile.id);
        expect(registeredFileRow).toBeNull();
      },
      15000
    );

    it(
      'should not affect non-expired batches',
      async () => {
        // Create batch with expires_at in the future
        const batch = await helper.createBatch(userId, {
          status: BATCH_STATUS.ACTIVE,
          expiresAt: new Date(Date.now() + 3600000),
        });

        const service = new BatchTimeoutService();
        const metrics = await service.run();

        expect(metrics.expiredBatches).toBe(0);

        // Verify batch is still active
        const batchRow = await helper.getBatch(batch.id);
        expect(batchRow?.status).toBe(BATCH_STATUS.ACTIVE);
      },
      15000
    );
  });

  describe('OrphanCleanupService — abandoned uploads', () => {
    it(
      'should delete files stuck in registered >24h',
      async () => {
        // Create file at 'registered' with created_at = 25 hours ago
        const abandonedFile = await helper.createFileWithPipelineStatus(userId, {
          pipelineStatus: PIPELINE_STATUS.REGISTERED,
        });
        await helper.setFileCreatedAt(
          abandonedFile.id,
          new Date(Date.now() - 25 * 60 * 60 * 1000)
        );

        const service = new OrphanCleanupService();
        const metrics = await service.run({
          abandonedThresholdMs: 24 * 60 * 60 * 1000,
          skipOrphanBlobs: true,
        });

        expect(metrics.abandonedUploadsDeleted).toBe(1);

        // Verify file is hard-deleted from DB
        const fileRow = await helper.getFile(abandonedFile.id);
        expect(fileRow).toBeNull();

        // Verify mockDeleteFromBlob called
        expect(mockDeleteFromBlob).toHaveBeenCalledTimes(1);
        expect(mockDeleteFromBlob).toHaveBeenCalledWith(abandonedFile.blobPath);
      },
      15000
    );

    it(
      'should not delete recently registered files',
      async () => {
        // Create file at 'registered' just now
        const recentFile = await helper.createFileWithPipelineStatus(userId, {
          pipelineStatus: PIPELINE_STATUS.REGISTERED,
        });

        const service = new OrphanCleanupService();
        const metrics = await service.run({
          abandonedThresholdMs: 24 * 60 * 60 * 1000,
          skipOrphanBlobs: true,
        });

        expect(metrics.abandonedUploadsDeleted).toBe(0);

        // Verify file still exists
        const fileRow = await helper.getFile(recentFile.id);
        expect(fileRow).not.toBeNull();
      },
      15000
    );
  });

  describe('OrphanCleanupService — old failures', () => {
    it(
      'should delete failed files >30 days old',
      async () => {
        // Create file at 'failed' with updated_at = 31 days ago
        const oldFailedFile = await helper.createFileWithPipelineStatus(userId, {
          pipelineStatus: PIPELINE_STATUS.FAILED,
        });
        await helper.setFileUpdatedAt(
          oldFailedFile.id,
          new Date(Date.now() - 31 * 24 * 60 * 60 * 1000)
        );

        const service = new OrphanCleanupService();
        const metrics = await service.run({
          failureRetentionDays: 30,
          skipOrphanBlobs: true,
        });

        expect(metrics.oldFailuresDeleted).toBe(1);

        // Verify file is hard-deleted
        const fileRow = await helper.getFile(oldFailedFile.id);
        expect(fileRow).toBeNull();

        // Verify mockDeleteFromBlob called
        expect(mockDeleteFromBlob).toHaveBeenCalledTimes(1);
      },
      15000
    );

    it(
      'should not delete recent failures or ready files',
      async () => {
        // Create file at 'failed' just now
        const recentFailedFile = await helper.createFileWithPipelineStatus(userId, {
          pipelineStatus: PIPELINE_STATUS.FAILED,
        });

        // Create file at 'ready' with old updated_at
        const oldReadyFile = await helper.createFileWithPipelineStatus(userId, {
          pipelineStatus: PIPELINE_STATUS.READY,
        });
        await helper.setFileUpdatedAt(
          oldReadyFile.id,
          new Date(Date.now() - 31 * 24 * 60 * 60 * 1000)
        );

        const service = new OrphanCleanupService();
        const metrics = await service.run({
          failureRetentionDays: 30,
          skipOrphanBlobs: true,
        });

        expect(metrics.oldFailuresDeleted).toBe(0);

        // Verify recent failure still exists
        const recentFailedRow = await helper.getFile(recentFailedFile.id);
        expect(recentFailedRow).not.toBeNull();

        // Verify ready file still exists (not affected by old failure cleanup)
        const oldReadyRow = await helper.getFile(oldReadyFile.id);
        expect(oldReadyRow).not.toBeNull();
      },
      15000
    );
  });
});
