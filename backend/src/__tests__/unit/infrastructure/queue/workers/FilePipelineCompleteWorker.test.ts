/**
 * Unit tests for FilePipelineCompleteWorker (PRD-04)
 *
 * Tests:
 * 1. Success - batch not complete: file ready, processed_count < total_files
 * 2. Success - batch complete: file ready, processed_count >= total_files
 * 3. Failed file: file in 'failed' state, still increments counter
 * 4. Error handling: prisma throws → error is re-thrown
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Job } from 'bullmq';
import { PIPELINE_STATUS } from '@bc-agent/shared';

// ============================================================================
// Mocks
// ============================================================================

// Hoisted mocks - available before module evaluation
const { mockGetPipelineStatus, mockExecuteRaw, mockFindFirst, mockLogger } = vi.hoisted(() => {
  const mockLoggerInstance = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(function(this: typeof mockLoggerInstance) { return this; }),
  };

  return {
    mockGetPipelineStatus: vi.fn(),
    mockExecuteRaw: vi.fn(),
    mockFindFirst: vi.fn(),
    mockLogger: mockLoggerInstance,
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
    $executeRaw: mockExecuteRaw,
    upload_batches: {
      findFirst: mockFindFirst,
    },
  },
}));

import { FilePipelineCompleteWorker } from '@/infrastructure/queue/workers/FilePipelineCompleteWorker';
import type { PipelineCompleteJobData } from '@/infrastructure/queue/workers/FilePipelineCompleteWorker';

describe('FilePipelineCompleteWorker', () => {
  let worker: FilePipelineCompleteWorker;

  const TEST_FILE_ID = 'FILE-A1B2C3D4-E5F6-7890-1234-567890ABCDEF';
  const TEST_BATCH_ID = 'BATCH-11111111-2222-3333-4444-555555555555';
  const TEST_USER_ID = 'USER-99999999-8888-7777-6666-555555555555';

  beforeEach(() => {
    vi.clearAllMocks();
    worker = new FilePipelineCompleteWorker({ logger: mockLogger });
  });

  function createMockJob(data: PipelineCompleteJobData): Job<PipelineCompleteJobData> {
    return {
      id: 'job-12345',
      data,
    } as Job<PipelineCompleteJobData>;
  }

  it('should process file and update batch progress when batch is NOT complete', async () => {
    const jobData: PipelineCompleteJobData = {
      fileId: TEST_FILE_ID,
      batchId: TEST_BATCH_ID,
      userId: TEST_USER_ID,
    };

    const job = createMockJob(jobData);

    // Mock file ready status
    mockGetPipelineStatus.mockResolvedValue(PIPELINE_STATUS.READY);

    // Mock batch not complete (5 of 10 files processed)
    mockFindFirst.mockResolvedValue({
      total_files: 10,
      confirmed_count: 10,
      processed_count: 5,
    });

    await worker.process(job);

    // Verify getPipelineStatus called
    expect(mockGetPipelineStatus).toHaveBeenCalledWith(TEST_FILE_ID, TEST_USER_ID);

    // Verify processed_count increment (tagged template)
    expect(mockExecuteRaw).toHaveBeenCalledWith(
      expect.any(Array), // Tagged template strings array
      TEST_BATCH_ID,
      TEST_USER_ID,
    );

    // Verify batch progress query
    expect(mockFindFirst).toHaveBeenCalledWith({
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
    mockFindFirst.mockResolvedValue({
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

    // Mock batch progress
    mockFindFirst.mockResolvedValue({
      total_files: 10,
      confirmed_count: 10,
      processed_count: 3,
    });

    await worker.process(job);

    // Verify file status logged as failed
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({ finalStatus: PIPELINE_STATUS.FAILED }),
      'File final status',
    );

    // Verify counter still incremented (tagged template)
    expect(mockExecuteRaw).toHaveBeenCalledWith(
      expect.any(Array), // Tagged template strings array
      TEST_BATCH_ID,
      TEST_USER_ID,
    );

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
});
