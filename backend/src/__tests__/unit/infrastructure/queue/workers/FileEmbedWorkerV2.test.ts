/**
 * Unit tests for FileEmbedWorker (PRD-04)
 *
 * Tests the embedding generation worker that:
 * - Verifies file is in 'embedding' state
 * - Loads chunks from DB
 * - Generates embeddings via EmbeddingService
 * - Indexes chunks in Azure AI Search
 * - Transitions to 'ready' state
 * - Handles special cases (0 chunks, wrong state, errors)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Job } from 'bullmq';
import {
  PIPELINE_STATUS,
  FILE_READINESS_STATE,
} from '@bc-agent/shared';
import {
  FileEmbedWorker,
  type EmbedJobData,
  getFileEmbedWorker,
} from '@/infrastructure/queue/workers/FileEmbedWorker';

// Sample test data
const SAMPLE_JOB_DATA: EmbedJobData = {
  fileId: 'FILE-0001-0001-0001-000000000001',
  batchId: 'BATCH-0001-0001-0001-000000000001',
  userId: 'USER-0001-0001-0001-000000000001',
};

// Mock data
const SAMPLE_CHUNKS = [
  { id: 'chunk-1', chunk_text: 'First chunk text', chunk_index: 0, chunk_tokens: 50 },
  { id: 'chunk-2', chunk_text: 'Second chunk text', chunk_index: 1, chunk_tokens: 60 },
  { id: 'chunk-3', chunk_text: 'Third chunk text', chunk_index: 2, chunk_tokens: 55 },
];

const SAMPLE_EMBEDDINGS = [
  { embedding: [0.1, 0.2, 0.3], model: 'text-embedding-3-small' },
  { embedding: [0.4, 0.5, 0.6], model: 'text-embedding-3-small' },
  { embedding: [0.7, 0.8, 0.9], model: 'text-embedding-3-small' },
];

const SAMPLE_SEARCH_IDS = ['search-1', 'search-2', 'search-3'];

// Mock functions
const mockTransitionStatus = vi.fn();
const mockGetPipelineStatus = vi.fn();
const mockExecuteQuery = vi.fn();
const mockGenerateEmbeddings = vi.fn();
const mockIndexChunksBatch = vi.fn();
const mockEmitReadiness = vi.fn();

// Mock logger
const mockLogger = {
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
};

// Setup mocks
vi.mock('@/services/files/repository/FileRepository', () => ({
  getFileRepository: vi.fn(() => ({
    transitionStatus: mockTransitionStatus,
    getPipelineStatus: mockGetPipelineStatus,
  })),
}));

vi.mock('@/infrastructure/database/database', () => ({
  executeQuery: mockExecuteQuery,
}));

vi.mock('@/services/embeddings/EmbeddingService', () => ({
  EmbeddingService: {
    getInstance: vi.fn(() => ({
      generateTextEmbeddingsBatch: mockGenerateEmbeddings,
    })),
  },
}));

vi.mock('@/services/search/VectorSearchService', () => ({
  VectorSearchService: {
    getInstance: vi.fn(() => ({
      indexChunksBatch: mockIndexChunksBatch,
    })),
  },
}));

vi.mock('@/domains/files/emission', () => ({
  getFileEventEmitter: vi.fn(() => ({
    emitReadinessChanged: mockEmitReadiness,
  })),
}));

describe('FileEmbedWorker', () => {
  let worker: FileEmbedWorker;
  let mockJob: Job<EmbedJobData>;

  beforeEach(() => {
    vi.clearAllMocks();

    worker = new FileEmbedWorker({ logger: mockLogger });

    mockJob = {
      id: 'job-123',
      data: SAMPLE_JOB_DATA,
      attemptsMade: 0,
    } as Job<EmbedJobData>;
  });

  describe('Success cases', () => {
    it('should successfully process file with chunks', async () => {
      // Setup mocks
      mockGetPipelineStatus.mockResolvedValue(PIPELINE_STATUS.EMBEDDING);

      // Mock executeQuery calls in sequence
      mockExecuteQuery
        .mockResolvedValueOnce({ recordset: SAMPLE_CHUNKS }) // 1st: load chunks
        .mockResolvedValueOnce({ recordset: [{ mime_type: 'application/pdf' }] }) // 2nd: get mimeType
        .mockResolvedValue({ recordset: [] }); // 3rd+: update file_chunks

      mockGenerateEmbeddings.mockResolvedValue(SAMPLE_EMBEDDINGS);
      mockIndexChunksBatch.mockResolvedValue(SAMPLE_SEARCH_IDS);

      mockTransitionStatus.mockResolvedValue({
        success: true,
        currentStatus: PIPELINE_STATUS.READY,
      });

      // Execute
      await worker.process(mockJob);

      // Verify state check
      expect(mockGetPipelineStatus).toHaveBeenCalledWith(
        SAMPLE_JOB_DATA.fileId,
        SAMPLE_JOB_DATA.userId,
      );

      // Verify chunks loaded
      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('SELECT id, chunk_text, chunk_index, chunk_tokens'),
        { fileId: SAMPLE_JOB_DATA.fileId, userId: SAMPLE_JOB_DATA.userId },
      );

      // Verify embeddings generated
      expect(mockGenerateEmbeddings).toHaveBeenCalledWith(
        ['First chunk text', 'Second chunk text', 'Third chunk text'],
        SAMPLE_JOB_DATA.userId,
        SAMPLE_JOB_DATA.fileId,
      );

      // Verify mimeType query
      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('SELECT mime_type, file_modified_at, name, size_bytes FROM files'),
        { fileId: SAMPLE_JOB_DATA.fileId, userId: SAMPLE_JOB_DATA.userId },
      );

      // Verify search indexing
      expect(mockIndexChunksBatch).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            chunkId: 'chunk-1',
            fileId: SAMPLE_JOB_DATA.fileId,
            userId: SAMPLE_JOB_DATA.userId,
            content: 'First chunk text',
            embedding: [0.1, 0.2, 0.3],
            chunkIndex: 0,
            tokenCount: 50,
            embeddingModel: 'text-embedding-3-small',
            mimeType: 'application/pdf',
          }),
        ]),
      );

      // Verify file_chunks updates (3 calls for 3 chunks)
      expect(mockExecuteQuery).toHaveBeenCalledWith(
        'UPDATE file_chunks SET search_document_id = @searchId WHERE id = @chunkId',
        { searchId: 'search-1', chunkId: 'chunk-1' },
      );
      expect(mockExecuteQuery).toHaveBeenCalledWith(
        'UPDATE file_chunks SET search_document_id = @searchId WHERE id = @chunkId',
        { searchId: 'search-2', chunkId: 'chunk-2' },
      );
      expect(mockExecuteQuery).toHaveBeenCalledWith(
        'UPDATE file_chunks SET search_document_id = @searchId WHERE id = @chunkId',
        { searchId: 'search-3', chunkId: 'chunk-3' },
      );

      // Verify state transition to ready
      expect(mockTransitionStatus).toHaveBeenCalledWith(
        SAMPLE_JOB_DATA.fileId,
        SAMPLE_JOB_DATA.userId,
        PIPELINE_STATUS.EMBEDDING,
        PIPELINE_STATUS.READY,
      );

      // Verify readiness event emitted
      await vi.waitFor(() => {
        expect(mockEmitReadiness).toHaveBeenCalledWith(
          { fileId: SAMPLE_JOB_DATA.fileId, userId: SAMPLE_JOB_DATA.userId },
          {
            previousState: FILE_READINESS_STATE.PROCESSING,
            newState: FILE_READINESS_STATE.READY,
          },
        );
      });
    });

    it('should handle zero chunks (image file) and skip embedding', async () => {
      // Setup mocks
      mockGetPipelineStatus.mockResolvedValue(PIPELINE_STATUS.EMBEDDING);
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [] }); // No chunks

      mockTransitionStatus.mockResolvedValue({
        success: true,
        currentStatus: PIPELINE_STATUS.READY,
      });

      // Execute
      await worker.process(mockJob);

      // Verify state check
      expect(mockGetPipelineStatus).toHaveBeenCalledWith(
        SAMPLE_JOB_DATA.fileId,
        SAMPLE_JOB_DATA.userId,
      );

      // Verify chunks query executed
      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('SELECT id, chunk_text, chunk_index, chunk_tokens'),
        { fileId: SAMPLE_JOB_DATA.fileId, userId: SAMPLE_JOB_DATA.userId },
      );

      // Verify embedding generation NOT called
      expect(mockGenerateEmbeddings).not.toHaveBeenCalled();

      // Verify search indexing NOT called
      expect(mockIndexChunksBatch).not.toHaveBeenCalled();

      // Verify state transition to ready
      expect(mockTransitionStatus).toHaveBeenCalledWith(
        SAMPLE_JOB_DATA.fileId,
        SAMPLE_JOB_DATA.userId,
        PIPELINE_STATUS.EMBEDDING,
        PIPELINE_STATUS.READY,
      );

      // Verify readiness event emitted
      await vi.waitFor(() => {
        expect(mockEmitReadiness).toHaveBeenCalledWith(
          { fileId: SAMPLE_JOB_DATA.fileId, userId: SAMPLE_JOB_DATA.userId },
          {
            previousState: FILE_READINESS_STATE.PROCESSING,
            newState: FILE_READINESS_STATE.READY,
          },
        );
      });
    });
  });

  describe('State validation', () => {
    it('should skip processing if file not in embedding state', async () => {
      mockGetPipelineStatus.mockResolvedValue(PIPELINE_STATUS.CHUNKING);

      await worker.process(mockJob);

      // Verify state check
      expect(mockGetPipelineStatus).toHaveBeenCalledWith(
        SAMPLE_JOB_DATA.fileId,
        SAMPLE_JOB_DATA.userId,
      );

      // Verify warning logged
      const childLogger = mockLogger.child();
      expect(childLogger.warn).toHaveBeenCalledWith(
        {
          expectedStatus: PIPELINE_STATUS.EMBEDDING,
          actualStatus: PIPELINE_STATUS.CHUNKING,
        },
        'File not in expected embedding state — skipping',
      );

      // Verify no further processing
      expect(mockExecuteQuery).not.toHaveBeenCalled();
      expect(mockGenerateEmbeddings).not.toHaveBeenCalled();
      expect(mockTransitionStatus).not.toHaveBeenCalled();
    });
  });

  describe('Error handling', () => {
    it('should transition to failed state on embedding generation error', async () => {
      const testError = new Error('Embedding API failed');

      mockGetPipelineStatus.mockResolvedValue(PIPELINE_STATUS.EMBEDDING);
      mockExecuteQuery.mockResolvedValueOnce({ recordset: SAMPLE_CHUNKS });
      mockGenerateEmbeddings.mockRejectedValue(testError);

      mockTransitionStatus.mockResolvedValue({
        success: true,
        currentStatus: PIPELINE_STATUS.FAILED,
      });

      // Execute and expect error
      await expect(worker.process(mockJob)).rejects.toThrow('Embedding API failed');

      // Verify transition to failed
      expect(mockTransitionStatus).toHaveBeenCalledWith(
        SAMPLE_JOB_DATA.fileId,
        SAMPLE_JOB_DATA.userId,
        PIPELINE_STATUS.EMBEDDING,
        PIPELINE_STATUS.FAILED,
      );
    });

    it('should throw error on embedding count mismatch', async () => {
      mockGetPipelineStatus.mockResolvedValue(PIPELINE_STATUS.EMBEDDING);
      mockExecuteQuery.mockResolvedValueOnce({ recordset: SAMPLE_CHUNKS }); // 3 chunks

      // Return only 2 embeddings (mismatch)
      mockGenerateEmbeddings.mockResolvedValue([
        { embedding: [0.1, 0.2, 0.3], model: 'text-embedding-3-small' },
        { embedding: [0.4, 0.5, 0.6], model: 'text-embedding-3-small' },
      ]);

      mockTransitionStatus.mockResolvedValue({
        success: true,
        currentStatus: PIPELINE_STATUS.FAILED,
      });

      // Execute and expect error
      await expect(worker.process(mockJob)).rejects.toThrow(
        'Embedding count mismatch: expected 3, got 2',
      );

      // Verify transition to failed
      expect(mockTransitionStatus).toHaveBeenCalledWith(
        SAMPLE_JOB_DATA.fileId,
        SAMPLE_JOB_DATA.userId,
        PIPELINE_STATUS.EMBEDDING,
        PIPELINE_STATUS.FAILED,
      );
    });

    it('should throw error if state transition to ready fails', async () => {
      mockGetPipelineStatus.mockResolvedValue(PIPELINE_STATUS.EMBEDDING);

      mockExecuteQuery
        .mockResolvedValueOnce({ recordset: SAMPLE_CHUNKS })
        .mockResolvedValueOnce({ recordset: [{ mime_type: 'application/pdf' }] })
        .mockResolvedValue({ recordset: [] });

      mockGenerateEmbeddings.mockResolvedValue(SAMPLE_EMBEDDINGS);
      mockIndexChunksBatch.mockResolvedValue(SAMPLE_SEARCH_IDS);

      // Transition fails
      mockTransitionStatus.mockResolvedValue({
        success: false,
        error: 'Concurrent modification detected',
      });

      // Execute and expect error
      await expect(worker.process(mockJob)).rejects.toThrow(
        'State advance to ready failed: Concurrent modification detected',
      );

      // Verify second transition to failed was attempted
      expect(mockTransitionStatus).toHaveBeenCalledWith(
        SAMPLE_JOB_DATA.fileId,
        SAMPLE_JOB_DATA.userId,
        PIPELINE_STATUS.EMBEDDING,
        PIPELINE_STATUS.FAILED,
      );
    });
  });

  describe('Factory function', () => {
    it('should create instance via factory', () => {
      const instance = getFileEmbedWorker({ logger: mockLogger });
      expect(instance).toBeInstanceOf(FileEmbedWorker);
    });

    it('should create instance with default logger', () => {
      const instance = getFileEmbedWorker();
      expect(instance).toBeInstanceOf(FileEmbedWorker);
    });
  });
});
