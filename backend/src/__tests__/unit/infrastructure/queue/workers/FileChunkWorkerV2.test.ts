/**
 * FileChunkWorker Unit Tests (PRD-04)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FileChunkWorker } from '@/infrastructure/queue/workers/FileChunkWorker';
import type { Job } from 'bullmq';
import type { ChunkJobData } from '@/infrastructure/queue/workers/FileChunkWorker';

// Create mock functions that will be reused
const mockGetPipelineStatus = vi.fn();
const mockTransitionStatus = vi.fn();
const mockProcessFileChunks = vi.fn();

// Mock dependencies
vi.mock('@/services/files/repository/FileRepository', () => ({
  getFileRepository: vi.fn(() => ({
    getPipelineStatus: mockGetPipelineStatus,
    transitionStatus: mockTransitionStatus,
  })),
}));

vi.mock('@/services/files/FileChunkingService', () => ({
  getFileChunkingService: vi.fn(() => ({
    processFileChunks: mockProcessFileChunks,
  })),
}));

const createMockJob = (data: ChunkJobData, overrides?: Partial<Job<ChunkJobData>>): Job<ChunkJobData> => ({
  id: 'test-job-id',
  data,
  attemptsMade: 0,
  name: `chunk:${data.fileId}`,
  ...overrides,
} as unknown as Job<ChunkJobData>);

const SAMPLE_JOB_DATA: ChunkJobData = {
  fileId: 'FILE-0001-0001-0001-000000000001',
  batchId: 'BATCH-0001-0001-0001-000000000001',
  userId: 'USER-0001-0001-0001-000000000001',
  mimeType: 'application/pdf',
};

describe('FileChunkWorker', () => {
  let worker: FileChunkWorker;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPipelineStatus.mockReset();
    mockTransitionStatus.mockReset();
    mockProcessFileChunks.mockReset();

    worker = new FileChunkWorker({
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

  it('should verify state, process chunks, and advance to embedding', async () => {
    // File is in chunking state
    mockGetPipelineStatus.mockResolvedValue('chunking');

    // Processing succeeds
    mockProcessFileChunks.mockResolvedValue(undefined);

    // State advance succeeds
    mockTransitionStatus.mockResolvedValue({ success: true, previousStatus: 'chunking' });

    const job = createMockJob(SAMPLE_JOB_DATA);
    await worker.process(job);

    // Verify state check
    expect(mockGetPipelineStatus).toHaveBeenCalledWith(
      SAMPLE_JOB_DATA.fileId,
      SAMPLE_JOB_DATA.userId,
    );

    // Verify service called with correct job data
    expect(mockProcessFileChunks).toHaveBeenCalledWith(
      expect.objectContaining({
        fileId: SAMPLE_JOB_DATA.fileId,
        userId: SAMPLE_JOB_DATA.userId,
        mimeType: SAMPLE_JOB_DATA.mimeType,
      }),
    );

    // Verify state transition
    expect(mockTransitionStatus).toHaveBeenCalledWith(
      SAMPLE_JOB_DATA.fileId,
      SAMPLE_JOB_DATA.userId,
      'chunking',
      'embedding',
    );
  });

  it('should skip processing when file is not in chunking state', async () => {
    // File is in wrong state
    mockGetPipelineStatus.mockResolvedValue('extracting');

    const job = createMockJob(SAMPLE_JOB_DATA);
    await worker.process(job);

    // Should NOT have called the chunking service
    expect(mockProcessFileChunks).not.toHaveBeenCalled();

    // Should NOT have tried to transition state
    expect(mockTransitionStatus).not.toHaveBeenCalled();
  });

  it('should transition to FAILED state when chunking throws', async () => {
    // File is in chunking state
    mockGetPipelineStatus.mockResolvedValue('chunking');

    // Processing fails
    mockProcessFileChunks.mockRejectedValue(new Error('Chunking service unavailable'));

    // Transition to failed succeeds
    mockTransitionStatus.mockResolvedValue({ success: true, previousStatus: 'chunking' });

    const job = createMockJob(SAMPLE_JOB_DATA);

    await expect(worker.process(job)).rejects.toThrow('Chunking service unavailable');

    // Should have tried to transition to FAILED
    expect(mockTransitionStatus).toHaveBeenCalledWith(
      SAMPLE_JOB_DATA.fileId,
      SAMPLE_JOB_DATA.userId,
      'chunking',
      'failed',
    );
  });

  it('should throw when state advance to embedding fails after chunking', async () => {
    // File is in chunking state
    mockGetPipelineStatus.mockResolvedValue('chunking');

    // Processing succeeds
    mockProcessFileChunks.mockResolvedValue(undefined);

    // State advance fails
    mockTransitionStatus.mockResolvedValue({
      success: false,
      previousStatus: 'chunking',
      error: 'Lost CAS race',
    });

    const job = createMockJob(SAMPLE_JOB_DATA);

    await expect(worker.process(job)).rejects.toThrow('State advance failed');

    // Should have called processFileChunks
    expect(mockProcessFileChunks).toHaveBeenCalled();

    // Should have tried to transition to embedding
    expect(mockTransitionStatus).toHaveBeenCalledWith(
      SAMPLE_JOB_DATA.fileId,
      SAMPLE_JOB_DATA.userId,
      'chunking',
      'embedding',
    );
  });
});
