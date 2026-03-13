/**
 * FileExtractWorker Unit Tests
 *
 * Tests the text extraction worker that processes files through the pipeline:
 * queued → extracting → chunking (or → failed on error).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FileExtractWorker } from '@/infrastructure/queue/workers/FileExtractWorker';
import type { ExtractJobData } from '@/infrastructure/queue/workers/FileExtractWorker';
import type { Job } from 'bullmq';

// ============================================================================
// MOCKS
// ============================================================================

const mockTransitionStatus = vi.fn();
const mockProcessFile = vi.fn();
const mockAddToDeadLetter = vi.fn();
const mockHandlePermanentFailure = vi.fn();

vi.mock('@/services/files/repository/FileRepository', () => ({
  getFileRepository: vi.fn(() => ({
    transitionStatus: mockTransitionStatus,
  })),
}));

vi.mock('@/services/files/FileProcessingService', () => ({
  getFileProcessingService: vi.fn(() => ({
    processFile: mockProcessFile,
  })),
}));

vi.mock('@/services/queue/DLQService', () => ({
  getDLQService: vi.fn(() => ({
    addToDeadLetter: mockAddToDeadLetter,
  })),
}));

vi.mock('@/domains/files/retry/ProcessingRetryManager', () => ({
  getProcessingRetryManager: vi.fn(() => ({
    handlePermanentFailure: mockHandlePermanentFailure,
  })),
}));

// ============================================================================
// HELPERS
// ============================================================================

const SAMPLE_JOB_DATA: ExtractJobData = {
  fileId: 'FILE-0001-0001-0001-000000000001',
  batchId: 'BATCH-0001-0001-0001-000000000001',
  userId: 'USER-0001-0001-0001-000000000001',
  mimeType: 'application/pdf',
  blobPath: 'uploads/test.pdf',
  fileName: 'test.pdf',
};

function createMockJob(overrides?: Partial<ExtractJobData>): Job<ExtractJobData> {
  return {
    id: 'job-1',
    data: {
      ...SAMPLE_JOB_DATA,
      ...overrides,
    },
    attemptsMade: 0,
    name: `extract:${SAMPLE_JOB_DATA.fileId}`,
  } as unknown as Job<ExtractJobData>;
}

// ============================================================================
// TEST SUITE
// ============================================================================

describe('FileExtractWorker', () => {
  let worker: FileExtractWorker;

  beforeEach(() => {
    vi.clearAllMocks();
    mockTransitionStatus.mockReset();
    mockProcessFile.mockReset();
    mockAddToDeadLetter.mockReset();
    mockHandlePermanentFailure.mockReset();

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

    // Default: transitions succeed
    mockTransitionStatus.mockResolvedValue({ success: true });
    mockProcessFile.mockResolvedValue(undefined);
    mockAddToDeadLetter.mockResolvedValue(undefined);
    mockHandlePermanentFailure.mockResolvedValue(undefined);
  });

  describe('successful extraction', () => {
    it('transitions queued → extracting → processes → advances to chunking', async () => {
      const job = createMockJob();

      await worker.process(job);

      // CAS claim: queued → extracting
      expect(mockTransitionStatus).toHaveBeenCalledWith(
        SAMPLE_JOB_DATA.fileId,
        SAMPLE_JOB_DATA.userId,
        'queued',
        'extracting',
      );

      // Process file
      expect(mockProcessFile).toHaveBeenCalledWith({
        fileId: SAMPLE_JOB_DATA.fileId,
        userId: SAMPLE_JOB_DATA.userId,
        mimeType: SAMPLE_JOB_DATA.mimeType,
        blobPath: SAMPLE_JOB_DATA.blobPath,
        fileName: SAMPLE_JOB_DATA.fileName,
      });

      // Advance: extracting → chunking
      expect(mockTransitionStatus).toHaveBeenCalledWith(
        SAMPLE_JOB_DATA.fileId,
        SAMPLE_JOB_DATA.userId,
        'extracting',
        'chunking',
      );

      // Exactly two CAS transitions in the happy path
      expect(mockTransitionStatus).toHaveBeenCalledTimes(2);
    });
  });

  describe('CAS claim failure', () => {
    it('skips processing when another worker already claimed the file', async () => {
      mockTransitionStatus.mockResolvedValueOnce({
        success: false,
        error: 'Status mismatch',
        previousStatus: 'extracting',
      });

      const job = createMockJob();
      await worker.process(job);

      expect(mockProcessFile).not.toHaveBeenCalled();
    });
  });

  describe('processing error', () => {
    it('transitions to FAILED and adds to DLQ on processing error', async () => {
      const processingError = new Error('PDF parsing failed');
      mockProcessFile.mockRejectedValueOnce(processingError);

      const job = createMockJob();

      await expect(worker.process(job)).rejects.toThrow('PDF parsing failed');

      // Should transition to failed
      expect(mockTransitionStatus).toHaveBeenCalledWith(
        SAMPLE_JOB_DATA.fileId,
        SAMPLE_JOB_DATA.userId,
        'extracting',
        'failed',
      );

      // Should add to DLQ
      expect(mockAddToDeadLetter).toHaveBeenCalledWith(
        expect.objectContaining({
          fileId: SAMPLE_JOB_DATA.fileId,
          stage: 'extract',
          error: 'PDF parsing failed',
        }),
      );
    });

    it('emits failure WebSocket events via ProcessingRetryManager', async () => {
      const processingError = new Error('Extraction timeout');
      mockProcessFile.mockRejectedValueOnce(processingError);

      const job = createMockJob();

      await expect(worker.process(job)).rejects.toThrow('Extraction timeout');

      expect(mockHandlePermanentFailure).toHaveBeenCalledWith(
        SAMPLE_JOB_DATA.userId,
        SAMPLE_JOB_DATA.fileId,
        'Extraction timeout',
      );
    });

    it('continues to re-throw even if failure event emission fails', async () => {
      const processingError = new Error('Bad file');
      mockProcessFile.mockRejectedValueOnce(processingError);
      mockHandlePermanentFailure.mockRejectedValueOnce(new Error('WebSocket down'));

      const job = createMockJob();

      // Should still re-throw the original error
      await expect(worker.process(job)).rejects.toThrow('Bad file');
    });
  });
});
