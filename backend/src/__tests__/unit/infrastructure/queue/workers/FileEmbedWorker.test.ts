/**
 * Unit tests for FileEmbedWorker
 *
 * Tests the embedding generation worker that:
 * - Verifies file is in 'embedding' state
 * - Loads chunks from DB
 * - Generates embeddings via CohereEmbeddingService
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

const COHERE_EMBEDDINGS = [
  { embedding: new Array(1536).fill(0.1), model: 'Cohere-embed-v4', inputTokens: 10 },
  { embedding: new Array(1536).fill(0.2), model: 'Cohere-embed-v4', inputTokens: 12 },
  { embedding: new Array(1536).fill(0.3), model: 'Cohere-embed-v4', inputTokens: 11 },
];

const SAMPLE_SEARCH_IDS = ['search-1', 'search-2', 'search-3'];

const SAMPLE_FILE_META = {
  mime_type: 'application/pdf',
  file_modified_at: null,
  name: 'test.pdf',
  size_bytes: null,
  source_type: 'local',
  parent_folder_id: null,
  scope_site_id: null,
};

// Mock functions
const mockTransitionStatus = vi.fn();
const mockGetPipelineStatus = vi.fn();
const mockGetFileWithScopeMetadata = vi.fn();
const mockFindByFileId = vi.fn();
const mockUpdateSearchDocumentIds = vi.fn();
const mockEmbedTextBatch = vi.fn();
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
    getFileWithScopeMetadata: mockGetFileWithScopeMetadata,
  })),
}));

vi.mock('@/services/files/repository/FileChunkRepository', () => ({
  getFileChunkRepository: vi.fn(() => ({
    findByFileId: mockFindByFileId,
    updateSearchDocumentIds: mockUpdateSearchDocumentIds,
  })),
}));

vi.mock('@/services/search/embeddings/CohereEmbeddingService', () => ({
  getCohereEmbeddingService: vi.fn(() => ({
    embedTextBatch: mockEmbedTextBatch,
  })),
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

    // Default: Cohere returns valid embeddings
    mockEmbedTextBatch.mockResolvedValue(COHERE_EMBEDDINGS);
  });

  describe('Success cases', () => {
    it('should successfully process file with chunks using Cohere embeddings', async () => {
      mockGetPipelineStatus.mockResolvedValue(PIPELINE_STATUS.EMBEDDING);
      mockFindByFileId.mockResolvedValue(SAMPLE_CHUNKS);
      mockGetFileWithScopeMetadata.mockResolvedValue(SAMPLE_FILE_META);
      mockIndexChunksBatch.mockResolvedValue(SAMPLE_SEARCH_IDS);
      mockUpdateSearchDocumentIds.mockResolvedValue(undefined);
      mockTransitionStatus.mockResolvedValue({
        success: true,
        currentStatus: PIPELINE_STATUS.READY,
      });

      await worker.process(mockJob);

      // Verify state check
      expect(mockGetPipelineStatus).toHaveBeenCalledWith(
        SAMPLE_JOB_DATA.fileId,
        SAMPLE_JOB_DATA.userId,
      );

      // Verify chunks loaded
      expect(mockFindByFileId).toHaveBeenCalledWith(
        SAMPLE_JOB_DATA.fileId,
        SAMPLE_JOB_DATA.userId,
      );

      // Verify Cohere embeddings called with chunk texts
      expect(mockEmbedTextBatch).toHaveBeenCalledWith(
        ['First chunk text', 'Second chunk text', 'Third chunk text'],
        'search_document',
        { userId: SAMPLE_JOB_DATA.userId, fileId: SAMPLE_JOB_DATA.fileId },
      );

      // Verify file metadata fetched
      expect(mockGetFileWithScopeMetadata).toHaveBeenCalledWith(
        SAMPLE_JOB_DATA.fileId,
        SAMPLE_JOB_DATA.userId,
      );

      // Verify search indexing with correct chunk structure
      expect(mockIndexChunksBatch).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            chunkId: 'chunk-1',
            fileId: SAMPLE_JOB_DATA.fileId,
            userId: SAMPLE_JOB_DATA.userId,
            content: 'First chunk text',
            embedding: COHERE_EMBEDDINGS[0]?.embedding,
            chunkIndex: 0,
            tokenCount: 50,
            embeddingModel: 'Cohere-embed-v4',
            mimeType: 'application/pdf',
          }),
        ]),
      );

      // Verify search document IDs updated
      expect(mockUpdateSearchDocumentIds).toHaveBeenCalledWith([
        { chunkId: 'chunk-1', searchDocumentId: 'search-1' },
        { chunkId: 'chunk-2', searchDocumentId: 'search-2' },
        { chunkId: 'chunk-3', searchDocumentId: 'search-3' },
      ]);

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
      mockGetPipelineStatus.mockResolvedValue(PIPELINE_STATUS.EMBEDDING);
      mockFindByFileId.mockResolvedValue([]); // No chunks
      mockGetFileWithScopeMetadata.mockResolvedValue({ ...SAMPLE_FILE_META, mime_type: 'image/png' });
      mockTransitionStatus.mockResolvedValue({
        success: true,
        currentStatus: PIPELINE_STATUS.READY,
      });

      await worker.process(mockJob);

      expect(mockGetPipelineStatus).toHaveBeenCalledWith(
        SAMPLE_JOB_DATA.fileId,
        SAMPLE_JOB_DATA.userId,
      );
      expect(mockFindByFileId).toHaveBeenCalledWith(
        SAMPLE_JOB_DATA.fileId,
        SAMPLE_JOB_DATA.userId,
      );

      // Embedding must NOT be called for zero chunks
      expect(mockEmbedTextBatch).not.toHaveBeenCalled();
      expect(mockIndexChunksBatch).not.toHaveBeenCalled();

      expect(mockTransitionStatus).toHaveBeenCalledWith(
        SAMPLE_JOB_DATA.fileId,
        SAMPLE_JOB_DATA.userId,
        PIPELINE_STATUS.EMBEDDING,
        PIPELINE_STATUS.READY,
      );

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

    it('embeddings from Cohere have correct shape (embedding + model fields)', async () => {
      mockGetPipelineStatus.mockResolvedValue(PIPELINE_STATUS.EMBEDDING);
      mockFindByFileId.mockResolvedValue(SAMPLE_CHUNKS);
      mockGetFileWithScopeMetadata.mockResolvedValue(SAMPLE_FILE_META);
      mockIndexChunksBatch.mockResolvedValue(SAMPLE_SEARCH_IDS);
      mockUpdateSearchDocumentIds.mockResolvedValue(undefined);
      mockTransitionStatus.mockResolvedValue({ success: true, currentStatus: PIPELINE_STATUS.READY });

      await worker.process(mockJob);

      const indexedChunks = mockIndexChunksBatch.mock.calls[0]?.[0] as Array<Record<string, unknown>>;
      expect(indexedChunks).toHaveLength(3);
      indexedChunks.forEach((chunk, i) => {
        expect(chunk['embedding']).toEqual(COHERE_EMBEDDINGS[i]?.embedding);
        expect(chunk['embeddingModel']).toBe('Cohere-embed-v4');
      });
    });
  });

  describe('State validation', () => {
    it('should skip processing if file not in embedding state', async () => {
      mockGetPipelineStatus.mockResolvedValue(PIPELINE_STATUS.CHUNKING);

      await worker.process(mockJob);

      expect(mockGetPipelineStatus).toHaveBeenCalledWith(
        SAMPLE_JOB_DATA.fileId,
        SAMPLE_JOB_DATA.userId,
      );

      const childLogger = mockLogger.child();
      expect(childLogger.warn).toHaveBeenCalledWith(
        {
          expectedStatus: PIPELINE_STATUS.EMBEDDING,
          actualStatus: PIPELINE_STATUS.CHUNKING,
        },
        'File not in expected embedding state — skipping',
      );

      expect(mockFindByFileId).not.toHaveBeenCalled();
      expect(mockEmbedTextBatch).not.toHaveBeenCalled();
      expect(mockTransitionStatus).not.toHaveBeenCalled();
    });
  });

  describe('Error handling', () => {
    it('should transition to failed state on embedding generation error', async () => {
      const testError = new Error('Embedding API failed');

      mockGetPipelineStatus.mockResolvedValue(PIPELINE_STATUS.EMBEDDING);
      mockFindByFileId.mockResolvedValue(SAMPLE_CHUNKS);
      mockEmbedTextBatch.mockRejectedValue(testError);
      mockTransitionStatus.mockResolvedValue({
        success: true,
        currentStatus: PIPELINE_STATUS.FAILED,
      });

      await expect(worker.process(mockJob)).rejects.toThrow('Embedding API failed');

      expect(mockTransitionStatus).toHaveBeenCalledWith(
        SAMPLE_JOB_DATA.fileId,
        SAMPLE_JOB_DATA.userId,
        PIPELINE_STATUS.EMBEDDING,
        PIPELINE_STATUS.FAILED,
      );
    });

    it('should throw error on embedding count mismatch', async () => {
      mockGetPipelineStatus.mockResolvedValue(PIPELINE_STATUS.EMBEDDING);
      mockFindByFileId.mockResolvedValue(SAMPLE_CHUNKS); // 3 chunks

      // Return only 2 embeddings (mismatch)
      mockEmbedTextBatch.mockResolvedValue([
        { embedding: new Array(1536).fill(0.1), model: 'Cohere-embed-v4', inputTokens: 5 },
        { embedding: new Array(1536).fill(0.2), model: 'Cohere-embed-v4', inputTokens: 5 },
      ]);
      mockTransitionStatus.mockResolvedValue({
        success: true,
        currentStatus: PIPELINE_STATUS.FAILED,
      });

      await expect(worker.process(mockJob)).rejects.toThrow(
        'Embedding count mismatch: expected 3, got 2',
      );

      expect(mockTransitionStatus).toHaveBeenCalledWith(
        SAMPLE_JOB_DATA.fileId,
        SAMPLE_JOB_DATA.userId,
        PIPELINE_STATUS.EMBEDDING,
        PIPELINE_STATUS.FAILED,
      );
    });

    it('should throw error if state transition to ready fails', async () => {
      mockGetPipelineStatus.mockResolvedValue(PIPELINE_STATUS.EMBEDDING);
      mockFindByFileId.mockResolvedValue(SAMPLE_CHUNKS);
      mockGetFileWithScopeMetadata.mockResolvedValue(SAMPLE_FILE_META);
      mockIndexChunksBatch.mockResolvedValue(SAMPLE_SEARCH_IDS);
      mockUpdateSearchDocumentIds.mockResolvedValue(undefined);

      // Transition fails
      mockTransitionStatus.mockResolvedValue({
        success: false,
        error: 'Concurrent modification detected',
      });

      await expect(worker.process(mockJob)).rejects.toThrow(
        'State advance to ready failed: Concurrent modification detected',
      );

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
