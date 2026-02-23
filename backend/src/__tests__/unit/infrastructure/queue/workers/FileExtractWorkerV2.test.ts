/**
 * FileExtractWorker Unit Tests (PRD-04)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FileExtractWorker } from '@/infrastructure/queue/workers/FileExtractWorker';
import type { Job } from 'bullmq';
import type { ExtractJobData } from '@/infrastructure/queue/workers/FileExtractWorker';

// Create mock functions that will be reused
const mockTransitionStatus = vi.fn();
const mockProcessFile = vi.fn();
const mockGetQueue = vi.fn();

// Mock dependencies
vi.mock('@/services/files/repository/FileRepository', () => ({
  getFileRepository: vi.fn(() => ({
    transitionStatus: mockTransitionStatus,
    getPipelineStatus: vi.fn(),
  })),
}));

vi.mock('@/services/files/FileProcessingService', () => ({
  getFileProcessingService: vi.fn(() => ({
    processFile: mockProcessFile,
  })),
}));

vi.mock('@/infrastructure/queue/MessageQueue', () => ({
  getMessageQueue: vi.fn(() => ({
    queueManager: { getQueue: mockGetQueue },
  })),
}));

const createMockJob = (data: ExtractJobData, overrides?: Partial<Job<ExtractJobData>>): Job<ExtractJobData> => ({
  id: 'test-job-id',
  data,
  attemptsMade: 0,
  name: `extract:${data.fileId}`,
  ...overrides,
} as unknown as Job<ExtractJobData>);

const SAMPLE_JOB_DATA: ExtractJobData = {
  fileId: 'FILE-0001-0001-0001-000000000001',
  batchId: 'BATCH-0001-0001-0001-000000000001',
  userId: 'USER-0001-0001-0001-000000000001',
  mimeType: 'application/pdf',
  blobPath: 'users/USER-0001/files/test.pdf',
  fileName: 'test.pdf',
};

describe('FileExtractWorker', () => {
  let worker: FileExtractWorker;

  beforeEach(() => {
    vi.clearAllMocks();
    mockTransitionStatus.mockReset();
    mockProcessFile.mockReset();
    mockGetQueue.mockReset();

    worker = new FileExtractWorker({
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        child: vi.fn().mockReturnValue({
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
          debug: vi.fn(),
          child: vi.fn(),
        }),
      },
    });
  });

  it('should claim file and process extraction successfully', async () => {
    // CAS claim succeeds
    mockTransitionStatus
      .mockResolvedValueOnce({ success: true, previousStatus: 'queued' }) // queued → extracting
      .mockResolvedValueOnce({ success: true, previousStatus: 'extracting' }); // extracting → chunking

    mockProcessFile.mockResolvedValue(undefined);

    const job = createMockJob(SAMPLE_JOB_DATA);
    await worker.process(job);

    // Verify CAS transitions
    expect(mockTransitionStatus).toHaveBeenCalledWith(
      SAMPLE_JOB_DATA.fileId,
      SAMPLE_JOB_DATA.userId,
      'queued',
      'extracting',
    );
    expect(mockTransitionStatus).toHaveBeenCalledWith(
      SAMPLE_JOB_DATA.fileId,
      SAMPLE_JOB_DATA.userId,
      'extracting',
      'chunking',
    );

    // Verify service called with correct job data
    expect(mockProcessFile).toHaveBeenCalledWith(
      expect.objectContaining({
        fileId: SAMPLE_JOB_DATA.fileId,
        userId: SAMPLE_JOB_DATA.userId,
        mimeType: SAMPLE_JOB_DATA.mimeType,
      }),
    );
  });

  it('should skip processing when CAS claim fails (concurrent modification)', async () => {
    // CAS claim fails
    mockTransitionStatus.mockResolvedValueOnce({
      success: false,
      previousStatus: 'extracting',
      error: 'Concurrent modification',
    });

    const job = createMockJob(SAMPLE_JOB_DATA);
    await worker.process(job);

    // Should NOT have called the processing service
    expect(mockProcessFile).not.toHaveBeenCalled();
  });

  it('should transition to FAILED state when extraction throws', async () => {
    // CAS claim succeeds
    mockTransitionStatus
      .mockResolvedValueOnce({ success: true, previousStatus: 'queued' }) // claim
      .mockResolvedValueOnce({ success: true, previousStatus: 'extracting' }); // → failed

    mockProcessFile.mockRejectedValue(new Error('OCR service unavailable'));

    const job = createMockJob(SAMPLE_JOB_DATA);

    await expect(worker.process(job)).rejects.toThrow('OCR service unavailable');

    // Should have tried to transition to FAILED
    expect(mockTransitionStatus).toHaveBeenCalledWith(
      SAMPLE_JOB_DATA.fileId,
      SAMPLE_JOB_DATA.userId,
      'extracting',
      'failed',
    );
  });

  it('should throw when state advance to chunking fails after extraction', async () => {
    // CAS claim succeeds, but state advance fails
    mockTransitionStatus
      .mockResolvedValueOnce({ success: true, previousStatus: 'queued' }) // claim
      .mockResolvedValueOnce({ success: false, previousStatus: 'extracting', error: 'Lost CAS race' }) // advance fails
      .mockResolvedValueOnce({ success: true, previousStatus: 'extracting' }); // → failed

    mockProcessFile.mockResolvedValue(undefined);

    const job = createMockJob(SAMPLE_JOB_DATA);

    await expect(worker.process(job)).rejects.toThrow('State advance failed');
  });
});
