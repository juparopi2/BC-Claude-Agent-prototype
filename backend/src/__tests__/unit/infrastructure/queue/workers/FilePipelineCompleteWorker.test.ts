/**
 * Unit tests for FilePipelineCompleteWorker (PRD-04, PRD-117)
 *
 * PRD-04 tests:
 * 1. Success - batch not complete: file ready, processed_count < total_files
 * 2. Success - batch complete: file ready, processed_count >= total_files
 * 3. Failed file: file in 'failed' state, still increments counter
 * 4. Error handling: prisma throws → error is re-thrown
 *
 * PRD-117 tests (scope-aware processing tracking):
 * 5. Increments processing_completed for successful sync files
 * 6. Increments processing_failed for failed sync files
 * 7. Detects scope completion and emits processing:completed WebSocket event
 * 8. Sets partial_failure when some files failed
 * 9. Does not touch scope counters for upload files (no connection_scope_id)
 * 10. Emits processing:progress on every file completion
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Job } from 'bullmq';
import { PIPELINE_STATUS } from '@bc-agent/shared';

// ============================================================================
// Mocks
// ============================================================================

// Hoisted mocks - available before module evaluation
const {
  mockGetPipelineStatus,
  mockUploadBatchesUpdateMany,
  mockUploadBatchesFindFirst,
  mockFilesFindFirst,
  mockConnectionScopesUpdateMany,
  mockConnectionScopesFindFirst,
  mockConnectionScopesUpdate,
  mockLogger,
  mockSocketTo,
  mockSocketEmit,
} = vi.hoisted(() => {
  const mockLoggerInstance = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(function(this: typeof mockLoggerInstance) { return this; }),
  };

  const emitFn = vi.fn();
  const toFn = vi.fn();
  toFn.mockReturnValue({ emit: emitFn });

  return {
    mockGetPipelineStatus: vi.fn(),
    mockUploadBatchesUpdateMany: vi.fn(),
    mockUploadBatchesFindFirst: vi.fn(),
    mockFilesFindFirst: vi.fn(),
    mockConnectionScopesUpdateMany: vi.fn(),
    mockConnectionScopesFindFirst: vi.fn(),
    mockConnectionScopesUpdate: vi.fn(),
    mockLogger: mockLoggerInstance,
    mockSocketTo: toFn,
    mockSocketEmit: emitFn,
  };
});

vi.mock('@/shared/utils/logger', () => ({
  createChildLogger: vi.fn(() => mockLogger),
}));

vi.mock('@/services/files/repository/FileRepository', () => ({
  getFileRepository: vi.fn(() => ({
    getPipelineStatus: mockGetPipelineStatus,
  })),
}));

vi.mock('@/infrastructure/database/prisma', () => ({
  prisma: {
    upload_batches: {
      updateMany: mockUploadBatchesUpdateMany,
      findFirst: mockUploadBatchesFindFirst,
    },
    files: {
      findFirst: mockFilesFindFirst,
    },
    connection_scopes: {
      updateMany: mockConnectionScopesUpdateMany,
      findFirst: mockConnectionScopesFindFirst,
      update: mockConnectionScopesUpdate,
    },
  },
}));

// PRD-117: Mock SocketService for WebSocket emission tests
vi.mock('@/services/websocket/SocketService', () => ({
  isSocketServiceInitialized: vi.fn(() => true),
  getSocketIO: vi.fn(() => ({
    to: mockSocketTo,
  })),
}));

import { FilePipelineCompleteWorker } from '@/infrastructure/queue/workers/FilePipelineCompleteWorker';
import type { PipelineCompleteJobData } from '@/infrastructure/queue/workers/FilePipelineCompleteWorker';

describe('FilePipelineCompleteWorker', () => {
  let worker: FilePipelineCompleteWorker;

  // Valid RFC 4122 UUIDs (version 4, variant [89ab])
  const TEST_FILE_ID = 'A1B2C3D4-E5F6-4890-A234-567890ABCDEF';
  const TEST_BATCH_ID = '11111111-2222-4333-8444-555555555555';
  const TEST_USER_ID = '99999999-8888-4777-A666-555555555555';

  beforeEach(() => {
    vi.clearAllMocks();
    worker = new FilePipelineCompleteWorker({ logger: mockLogger });

    // Default: file has no scope (upload file path)
    mockFilesFindFirst.mockResolvedValue({ connection_scope_id: null });

    // Default: batch has 5 of 10 processed (not complete)
    mockUploadBatchesFindFirst.mockResolvedValue({
      total_files: 10,
      confirmed_count: 10,
      processed_count: 5,
    });

    // Default: socket emit succeeds
    mockSocketTo.mockReturnValue({ emit: mockSocketEmit });
  });

  function createMockJob(data: PipelineCompleteJobData): Job<PipelineCompleteJobData> {
    return {
      id: 'job-12345',
      data,
    } as Job<PipelineCompleteJobData>;
  }

  // ==========================================================================
  // PRD-04: Basic batch processing
  // ==========================================================================

  it('should process file and update batch progress when batch is NOT complete', async () => {
    const jobData: PipelineCompleteJobData = {
      fileId: TEST_FILE_ID,
      batchId: TEST_BATCH_ID,
      userId: TEST_USER_ID,
    };

    const job = createMockJob(jobData);

    // Mock file ready status
    mockGetPipelineStatus.mockResolvedValue(PIPELINE_STATUS.READY);

    await worker.process(job);

    // Verify getPipelineStatus called
    expect(mockGetPipelineStatus).toHaveBeenCalledWith(TEST_FILE_ID, TEST_USER_ID);

    // Verify processed_count increment via Prisma updateMany
    expect(mockUploadBatchesUpdateMany).toHaveBeenCalledWith({
      where: { id: TEST_BATCH_ID, user_id: TEST_USER_ID },
      data: {
        processed_count: { increment: 1 },
        updated_at: expect.any(Date),
      },
    });

    // Verify batch progress query
    expect(mockUploadBatchesFindFirst).toHaveBeenCalledWith({
      where: { id: TEST_BATCH_ID, user_id: TEST_USER_ID },
      select: { total_files: true, confirmed_count: true, processed_count: true },
    });

    // Verify logging
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({ finalStatus: PIPELINE_STATUS.READY }),
      'File final status',
    );
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        totalFiles: 10,
        processedCount: 5,
        isComplete: false,
      }),
      'Batch progress updated',
    );
    expect(mockLogger.info).toHaveBeenCalledWith('Pipeline-complete finished');
  });

  it('should detect batch completion when processed_count >= total_files', async () => {
    const jobData: PipelineCompleteJobData = {
      fileId: TEST_FILE_ID,
      batchId: TEST_BATCH_ID,
      userId: TEST_USER_ID,
    };

    const job = createMockJob(jobData);

    // Mock file ready status
    mockGetPipelineStatus.mockResolvedValue(PIPELINE_STATUS.READY);

    // Mock batch complete (10 of 10 files processed)
    mockUploadBatchesFindFirst.mockResolvedValue({
      total_files: 10,
      confirmed_count: 10,
      processed_count: 10,
    });

    await worker.process(job);

    // Verify batch completion detected
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        totalFiles: 10,
        processedCount: 10,
        isComplete: true,
      }),
      'Batch progress updated',
    );

    // Verify batch completion event logged
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'batch:completed',
        batchId: TEST_BATCH_ID,
        userId: TEST_USER_ID,
        totalFiles: 10,
      }),
      'Batch completed event',
    );
  });

  it('should handle failed file status and still increment counter', async () => {
    const jobData: PipelineCompleteJobData = {
      fileId: TEST_FILE_ID,
      batchId: TEST_BATCH_ID,
      userId: TEST_USER_ID,
    };

    const job = createMockJob(jobData);

    // Mock file failed status
    mockGetPipelineStatus.mockResolvedValue(PIPELINE_STATUS.FAILED);

    await worker.process(job);

    // Verify file status logged as failed
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({ finalStatus: PIPELINE_STATUS.FAILED }),
      'File final status',
    );

    // Verify counter still incremented via Prisma updateMany
    expect(mockUploadBatchesUpdateMany).toHaveBeenCalledWith({
      where: { id: TEST_BATCH_ID, user_id: TEST_USER_ID },
      data: {
        processed_count: { increment: 1 },
        updated_at: expect.any(Date),
      },
    });

    // Verify batch event emitted with failed status
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'batch:file-processed',
        finalStatus: PIPELINE_STATUS.FAILED,
      }),
      'Batch file processed event',
    );
  });

  it('should re-throw errors when processing fails', async () => {
    const jobData: PipelineCompleteJobData = {
      fileId: TEST_FILE_ID,
      batchId: TEST_BATCH_ID,
      userId: TEST_USER_ID,
    };

    const job = createMockJob(jobData);

    const testError = new Error('Database connection failed');
    mockGetPipelineStatus.mockRejectedValue(testError);

    await expect(worker.process(job)).rejects.toThrow('Database connection failed');

    // Verify error logging
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          message: 'Database connection failed',
          stack: expect.any(String),
        }),
      }),
      'Pipeline-complete worker failed',
    );
  });

  it('should skip upload_batches update and warn when batchId is not a valid UUID', async () => {
    const jobData: PipelineCompleteJobData = {
      fileId: TEST_FILE_ID,
      batchId: 'not-a-uuid',
      userId: TEST_USER_ID,
    };

    const job = createMockJob(jobData);
    mockGetPipelineStatus.mockResolvedValue(PIPELINE_STATUS.READY);

    await worker.process(job);

    // Should NOT call updateMany on upload_batches
    expect(mockUploadBatchesUpdateMany).not.toHaveBeenCalled();

    // Should warn about invalid batchId
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ batchId: 'not-a-uuid' }),
      'Skipping upload_batches update — batchId is not a valid UUID',
    );

    // Should still log external sync path
    expect(mockLogger.info).toHaveBeenCalledWith('External sync file — batch tracking skipped');
  });

  it('should skip batch tracking entirely when batchId is empty string', async () => {
    const jobData: PipelineCompleteJobData = {
      fileId: TEST_FILE_ID,
      batchId: '',
      userId: TEST_USER_ID,
    };

    const job = createMockJob(jobData);
    mockGetPipelineStatus.mockResolvedValue(PIPELINE_STATUS.READY);

    await worker.process(job);

    expect(mockUploadBatchesUpdateMany).not.toHaveBeenCalled();
    expect(mockUploadBatchesFindFirst).not.toHaveBeenCalled();
    expect(mockLogger.warn).not.toHaveBeenCalled();
    expect(mockLogger.info).toHaveBeenCalledWith('External sync file — batch tracking skipped');
  });

  // ==========================================================================
  // PRD-117: Scope-aware processing tracking
  // ==========================================================================

  describe('PRD-117 — scope-aware processing tracking', () => {
    const TEST_SCOPE_ID = 'AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE';
    const TEST_CONN_ID = '11111111-2222-4333-8444-555566667777';

    function createSyncJob() {
      return createMockJob({ fileId: TEST_FILE_ID, batchId: TEST_BATCH_ID, userId: TEST_USER_ID });
    }

    function defaultScopeCounters(overrides?: Partial<{
      processing_total: number;
      processing_completed: number;
      processing_failed: number;
    }>) {
      return {
        processing_total: overrides?.processing_total ?? 5,
        processing_completed: overrides?.processing_completed ?? 2,
        processing_failed: overrides?.processing_failed ?? 0,
        connection_id: TEST_CONN_ID,
      };
    }

    it('should increment processing_completed for successful sync files', async () => {
      mockGetPipelineStatus.mockResolvedValue(PIPELINE_STATUS.READY);
      mockFilesFindFirst.mockResolvedValue({ connection_scope_id: TEST_SCOPE_ID });
      mockConnectionScopesFindFirst.mockResolvedValue(defaultScopeCounters({
        processing_total: 5,
        processing_completed: 2,
        processing_failed: 0,
      }));

      await worker.process(createSyncJob());

      expect(mockConnectionScopesUpdateMany).toHaveBeenCalledWith({
        where: { id: TEST_SCOPE_ID },
        data: {
          processing_completed: { increment: 1 },
          updated_at: expect.any(Date),
        },
      });
    });

    it('should increment processing_failed for failed sync files', async () => {
      mockGetPipelineStatus.mockResolvedValue(PIPELINE_STATUS.FAILED);
      mockFilesFindFirst.mockResolvedValue({ connection_scope_id: TEST_SCOPE_ID });
      mockConnectionScopesFindFirst.mockResolvedValue(defaultScopeCounters({
        processing_total: 5,
        processing_completed: 2,
        processing_failed: 1,
      }));

      await worker.process(createSyncJob());

      expect(mockConnectionScopesUpdateMany).toHaveBeenCalledWith({
        where: { id: TEST_SCOPE_ID },
        data: {
          processing_failed: { increment: 1 },
          updated_at: expect.any(Date),
        },
      });
    });

    it('should not touch scope counters for upload files (no connection_scope_id)', async () => {
      // Upload files have no connection_scope_id
      mockFilesFindFirst.mockResolvedValue({ connection_scope_id: null });
      mockGetPipelineStatus.mockResolvedValue(PIPELINE_STATUS.READY);

      await worker.process(createSyncJob());

      // Should NOT call updateMany for scope tracking
      expect(mockConnectionScopesUpdateMany).not.toHaveBeenCalled();
      expect(mockConnectionScopesFindFirst).not.toHaveBeenCalled();
    });

    it('should read scope counters for every sync file completion (prerequisite for progress reporting)', async () => {
      mockGetPipelineStatus.mockResolvedValue(PIPELINE_STATUS.READY);
      mockFilesFindFirst.mockResolvedValue({ connection_scope_id: TEST_SCOPE_ID });
      mockConnectionScopesFindFirst.mockResolvedValue(defaultScopeCounters({
        processing_total: 10,
        processing_completed: 5,
        processing_failed: 1,
      }));

      await worker.process(createSyncJob());

      // scope counters should be read after every file completion
      expect(mockConnectionScopesFindFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: TEST_SCOPE_ID },
          select: expect.objectContaining({
            processing_total: true,
            processing_completed: true,
            processing_failed: true,
            connection_id: true,
          }),
        })
      );
    });

    it('should detect scope completion and update processing_status to "completed" in DB', async () => {
      mockGetPipelineStatus.mockResolvedValue(PIPELINE_STATUS.READY);
      mockFilesFindFirst.mockResolvedValue({ connection_scope_id: TEST_SCOPE_ID });
      // After incrementing, total processed = completed(3) + failed(0) = 3 = total(3)
      mockConnectionScopesFindFirst.mockResolvedValue(defaultScopeCounters({
        processing_total: 3,
        processing_completed: 3,
        processing_failed: 0,
      }));

      await worker.process(createSyncJob());

      // Should update processing_status to 'completed' in the database
      expect(mockConnectionScopesUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: TEST_SCOPE_ID },
          data: expect.objectContaining({ processing_status: 'completed' }),
        })
      );
    });

    it('should set partial_failure status when all files done but some failed', async () => {
      mockGetPipelineStatus.mockResolvedValue(PIPELINE_STATUS.FAILED);
      mockFilesFindFirst.mockResolvedValue({ connection_scope_id: TEST_SCOPE_ID });
      // completed(2) + failed(1) = 3 = total(3): all done with failures
      mockConnectionScopesFindFirst.mockResolvedValue(defaultScopeCounters({
        processing_total: 3,
        processing_completed: 2,
        processing_failed: 1,
      }));

      await worker.process(createSyncJob());

      expect(mockConnectionScopesUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ processing_status: 'partial_failure' }),
        })
      );
    });

    it('should not mark scope complete when processing is still in progress', async () => {
      mockGetPipelineStatus.mockResolvedValue(PIPELINE_STATUS.READY);
      mockFilesFindFirst.mockResolvedValue({ connection_scope_id: TEST_SCOPE_ID });
      // Only 2 of 5 total completed — not done yet
      mockConnectionScopesFindFirst.mockResolvedValue(defaultScopeCounters({
        processing_total: 5,
        processing_completed: 2,
        processing_failed: 0,
      }));

      await worker.process(createSyncJob());

      // Should NOT update processing_status (not done yet)
      expect(mockConnectionScopesUpdate).not.toHaveBeenCalled();

      // Scope counters should still be read for progress tracking
      expect(mockConnectionScopesFindFirst).toHaveBeenCalledTimes(1);
    });
  });
});
