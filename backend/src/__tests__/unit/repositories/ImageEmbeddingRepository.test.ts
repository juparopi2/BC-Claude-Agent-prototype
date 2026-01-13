/**
 * Image Embedding Repository Tests
 *
 * Unit tests for ImageEmbeddingRepository.
 * Tests all CRUD operations with mocked database layer.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { IResult } from 'mssql';

// Mock dependencies before imports
vi.mock('@/infrastructure/database/database', () => ({
  executeQuery: vi.fn(),
}));

vi.mock('@/shared/utils/logger', () => ({
  createChildLogger: vi.fn(() => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

vi.mock('uuid', () => ({
  v4: vi.fn(() => 'mock-uuid-1234-5678-9012-345678901234'),
}));

// Import after mocking
import {
  ImageEmbeddingRepository,
  getImageEmbeddingRepository,
  __resetImageEmbeddingRepository,
  type ImageEmbeddingRecord,
  type UpsertImageEmbeddingParams,
} from '@/repositories/ImageEmbeddingRepository';
import { executeQuery } from '@/infrastructure/database/database';

const mockExecuteQuery = vi.mocked(executeQuery);

describe('ImageEmbeddingRepository', () => {
  let repository: ImageEmbeddingRepository;

  // Test fixtures
  const testUserId = '123e4567-e89b-12d3-a456-426614174000';
  const testFileId = '987fcdeb-51a2-43d7-8765-ba9876543210';
  const testEmbedding = Array.from({ length: 1024 }, (_, i) => i * 0.001);
  const testRecord: ImageEmbeddingRecord = {
    id: 'record-uuid-1234',
    fileId: testFileId,
    userId: testUserId,
    embedding: testEmbedding,
    dimensions: 1024,
    model: 'azure-vision-vectorize-image',
    modelVersion: '2024-02-01',
    createdAt: new Date('2026-01-06T12:00:00Z'),
    updatedAt: null,
    caption: null,
    captionConfidence: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    __resetImageEmbeddingRepository();
    repository = getImageEmbeddingRepository();
  });

  afterEach(() => {
    __resetImageEmbeddingRepository();
  });

  describe('Singleton Pattern', () => {
    it('should return same instance on subsequent calls', () => {
      const instance1 = getImageEmbeddingRepository();
      const instance2 = getImageEmbeddingRepository();

      expect(instance1).toBe(instance2);
    });

    it('should reset singleton with __resetImageEmbeddingRepository', () => {
      const instance1 = getImageEmbeddingRepository();
      __resetImageEmbeddingRepository();
      const instance2 = getImageEmbeddingRepository();

      expect(instance1).not.toBe(instance2);
    });
  });

  describe('upsert', () => {
    const upsertParams: UpsertImageEmbeddingParams = {
      fileId: testFileId,
      userId: testUserId,
      embedding: testEmbedding,
      dimensions: 1024,
      model: 'azure-vision-vectorize-image',
      modelVersion: '2024-02-01',
    };

    it('should insert new record when not exists', async () => {
      // Mock getByFileId to return null (not exists)
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [],
        recordsets: [],
        rowsAffected: [0],
        output: {},
      } as IResult<unknown>);

      // Mock insert
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [],
        recordsets: [],
        rowsAffected: [1],
        output: {},
      } as IResult<unknown>);

      const result = await repository.upsert(upsertParams);

      expect(result).toBe('mock-uuid-1234-5678-9012-345678901234');
      expect(mockExecuteQuery).toHaveBeenCalledTimes(2);

      // Verify SELECT query (check exists)
      expect(mockExecuteQuery).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('SELECT'),
        expect.objectContaining({
          file_id: testFileId,
          user_id: testUserId,
        })
      );

      // Verify INSERT query
      expect(mockExecuteQuery).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('INSERT INTO image_embeddings'),
        expect.objectContaining({
          id: 'mock-uuid-1234-5678-9012-345678901234',
          file_id: testFileId,
          user_id: testUserId,
          embedding: JSON.stringify(testEmbedding),
          dimensions: 1024,
          model: 'azure-vision-vectorize-image',
          model_version: '2024-02-01',
        })
      );
    });

    it('should update existing record when exists', async () => {
      // Mock getByFileId to return existing record
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [
          {
            id: testRecord.id,
            file_id: testRecord.fileId,
            user_id: testRecord.userId,
            embedding: JSON.stringify(testRecord.embedding),
            dimensions: testRecord.dimensions,
            model: testRecord.model,
            model_version: testRecord.modelVersion,
            created_at: testRecord.createdAt,
            updated_at: null,
          },
        ],
        recordsets: [],
        rowsAffected: [1],
        output: {},
      } as IResult<unknown>);

      // Mock update
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [],
        recordsets: [],
        rowsAffected: [1],
        output: {},
      } as IResult<unknown>);

      const newEmbedding = Array.from({ length: 1024 }, (_, i) => i * 0.002);
      const result = await repository.upsert({
        ...upsertParams,
        embedding: newEmbedding,
      });

      expect(result).toBe(testRecord.id);
      expect(mockExecuteQuery).toHaveBeenCalledTimes(2);

      // Verify UPDATE query
      expect(mockExecuteQuery).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('UPDATE image_embeddings'),
        expect.objectContaining({
          file_id: testFileId,
          user_id: testUserId,
          embedding: JSON.stringify(newEmbedding),
        })
      );
    });

    it('should propagate database errors', async () => {
      mockExecuteQuery.mockRejectedValueOnce(new Error('Database connection failed'));

      await expect(repository.upsert(upsertParams)).rejects.toThrow(
        'Database connection failed'
      );
    });
  });

  describe('getByFileId', () => {
    it('should return record when found', async () => {
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [
          {
            id: testRecord.id,
            file_id: testRecord.fileId,
            user_id: testRecord.userId,
            embedding: JSON.stringify(testRecord.embedding),
            dimensions: testRecord.dimensions,
            model: testRecord.model,
            model_version: testRecord.modelVersion,
            created_at: testRecord.createdAt,
            updated_at: testRecord.updatedAt,
            caption: testRecord.caption,
            caption_confidence: testRecord.captionConfidence,
          },
        ],
        recordsets: [],
        rowsAffected: [1],
        output: {},
      } as IResult<unknown>);

      const result = await repository.getByFileId(testFileId, testUserId);

      expect(result).toEqual(testRecord);
      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('SELECT'),
        { file_id: testFileId, user_id: testUserId }
      );
    });

    it('should return null when not found', async () => {
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [],
        recordsets: [],
        rowsAffected: [0],
        output: {},
      } as IResult<unknown>);

      const result = await repository.getByFileId(testFileId, testUserId);

      expect(result).toBeNull();
    });

    it('should parse embedding JSON correctly', async () => {
      const embedding = [0.1, 0.2, 0.3, 0.4];
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [
          {
            id: 'test-id',
            file_id: testFileId,
            user_id: testUserId,
            embedding: JSON.stringify(embedding),
            dimensions: 4,
            model: 'test-model',
            model_version: '1.0',
            created_at: new Date(),
            updated_at: null,
            caption: null,
            caption_confidence: null,
          },
        ],
        recordsets: [],
        rowsAffected: [1],
        output: {},
      } as IResult<unknown>);

      const result = await repository.getByFileId(testFileId, testUserId);

      expect(result?.embedding).toEqual(embedding);
      expect(Array.isArray(result?.embedding)).toBe(true);
    });
  });

  describe('getByUserId', () => {
    it('should return all records for user', async () => {
      const records = [
        {
          id: 'record-1',
          file_id: 'file-1',
          user_id: testUserId,
          embedding: JSON.stringify([0.1, 0.2]),
          dimensions: 2,
          model: 'model-1',
          model_version: '1.0',
          created_at: new Date('2026-01-06T12:00:00Z'),
          updated_at: null,
        },
        {
          id: 'record-2',
          file_id: 'file-2',
          user_id: testUserId,
          embedding: JSON.stringify([0.3, 0.4]),
          dimensions: 2,
          model: 'model-1',
          model_version: '1.0',
          created_at: new Date('2026-01-05T12:00:00Z'),
          updated_at: null,
        },
      ];

      mockExecuteQuery.mockResolvedValueOnce({
        recordset: records,
        recordsets: [],
        rowsAffected: [2],
        output: {},
      } as IResult<unknown>);

      const result = await repository.getByUserId(testUserId);

      expect(result).toHaveLength(2);
      expect(result[0].fileId).toBe('file-1');
      expect(result[1].fileId).toBe('file-2');
      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('WHERE user_id = @user_id'),
        { user_id: testUserId }
      );
    });

    it('should return empty array when no records found', async () => {
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [],
        recordsets: [],
        rowsAffected: [0],
        output: {},
      } as IResult<unknown>);

      const result = await repository.getByUserId(testUserId);

      expect(result).toEqual([]);
    });
  });

  describe('deleteByFileId', () => {
    it('should return true when record deleted', async () => {
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [],
        recordsets: [],
        rowsAffected: [1],
        output: {},
      } as IResult<unknown>);

      const result = await repository.deleteByFileId(testFileId, testUserId);

      expect(result).toBe(true);
      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM image_embeddings'),
        { file_id: testFileId, user_id: testUserId }
      );
    });

    it('should return false when no record found', async () => {
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [],
        recordsets: [],
        rowsAffected: [0],
        output: {},
      } as IResult<unknown>);

      const result = await repository.deleteByFileId(testFileId, testUserId);

      expect(result).toBe(false);
    });
  });

  describe('deleteByUserId', () => {
    it('should return count of deleted records', async () => {
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [],
        recordsets: [],
        rowsAffected: [5],
        output: {},
      } as IResult<unknown>);

      const result = await repository.deleteByUserId(testUserId);

      expect(result).toBe(5);
      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM image_embeddings WHERE user_id'),
        { user_id: testUserId }
      );
    });

    it('should return 0 when no records found', async () => {
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [],
        recordsets: [],
        rowsAffected: [0],
        output: {},
      } as IResult<unknown>);

      const result = await repository.deleteByUserId(testUserId);

      expect(result).toBe(0);
    });
  });

  describe('countByUserId', () => {
    it('should return count of embeddings for user', async () => {
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [{ count: 42 }],
        recordsets: [],
        rowsAffected: [1],
        output: {},
      } as IResult<unknown>);

      const result = await repository.countByUserId(testUserId);

      expect(result).toBe(42);
      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('SELECT COUNT(*) as count'),
        { user_id: testUserId }
      );
    });

    it('should return 0 when no embeddings found', async () => {
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [{ count: 0 }],
        recordsets: [],
        rowsAffected: [1],
        output: {},
      } as IResult<unknown>);

      const result = await repository.countByUserId(testUserId);

      expect(result).toBe(0);
    });

    it('should handle undefined count gracefully', async () => {
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [],
        recordsets: [],
        rowsAffected: [0],
        output: {},
      } as IResult<unknown>);

      const result = await repository.countByUserId(testUserId);

      expect(result).toBe(0);
    });
  });

  describe('Multi-Tenant Security', () => {
    it('should always include userId in queries', async () => {
      // Test getByFileId
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [],
        recordsets: [],
        rowsAffected: [0],
        output: {},
      } as IResult<unknown>);

      await repository.getByFileId(testFileId, testUserId);

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('user_id = @user_id'),
        expect.objectContaining({ user_id: testUserId })
      );
    });

    it('should prevent cross-tenant access in deleteByFileId', async () => {
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [],
        recordsets: [],
        rowsAffected: [0],
        output: {},
      } as IResult<unknown>);

      const otherUserId = 'other-user-id';
      await repository.deleteByFileId(testFileId, otherUserId);

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('user_id = @user_id'),
        expect.objectContaining({ user_id: otherUserId })
      );
    });
  });

  describe('Error Handling', () => {
    it('should propagate database errors in getByFileId', async () => {
      mockExecuteQuery.mockRejectedValueOnce(new Error('Connection timeout'));

      await expect(repository.getByFileId(testFileId, testUserId)).rejects.toThrow(
        'Connection timeout'
      );
    });

    it('should propagate database errors in deleteByUserId', async () => {
      mockExecuteQuery.mockRejectedValueOnce(new Error('Transaction failed'));

      await expect(repository.deleteByUserId(testUserId)).rejects.toThrow(
        'Transaction failed'
      );
    });
  });

  describe('Caption Storage (D26)', () => {
    const upsertParamsWithCaption: UpsertImageEmbeddingParams = {
      fileId: testFileId,
      userId: testUserId,
      embedding: testEmbedding,
      dimensions: 1024,
      model: 'azure-vision-vectorize-image',
      modelVersion: '2024-02-01',
      caption: 'A beautiful sunset over mountains',
      captionConfidence: 0.95,
    };

    it('should store caption when upserting new embedding', async () => {
      // Mock getByFileId to return null (not exists)
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [],
        recordsets: [],
        rowsAffected: [0],
        output: {},
      } as IResult<unknown>);

      // Mock insert
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [],
        recordsets: [],
        rowsAffected: [1],
        output: {},
      } as IResult<unknown>);

      await repository.upsert(upsertParamsWithCaption);

      // Verify INSERT query includes caption
      expect(mockExecuteQuery).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('INSERT INTO image_embeddings'),
        expect.objectContaining({
          caption: 'A beautiful sunset over mountains',
          caption_confidence: 0.95,
        })
      );
    });

    it('should handle null caption gracefully', async () => {
      const paramsNoCaption: UpsertImageEmbeddingParams = {
        fileId: testFileId,
        userId: testUserId,
        embedding: testEmbedding,
        dimensions: 1024,
        model: 'azure-vision-vectorize-image',
        modelVersion: '2024-02-01',
        // No caption or captionConfidence
      };

      // Mock getByFileId to return null (not exists)
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [],
        recordsets: [],
        rowsAffected: [0],
        output: {},
      } as IResult<unknown>);

      // Mock insert
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [],
        recordsets: [],
        rowsAffected: [1],
        output: {},
      } as IResult<unknown>);

      await repository.upsert(paramsNoCaption);

      // Verify INSERT query has null caption
      expect(mockExecuteQuery).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('INSERT INTO image_embeddings'),
        expect.objectContaining({
          caption: null,
          caption_confidence: null,
        })
      );
    });

    it('should retrieve caption when getting by fileId', async () => {
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [
          {
            id: testRecord.id,
            file_id: testRecord.fileId,
            user_id: testRecord.userId,
            embedding: JSON.stringify(testRecord.embedding),
            dimensions: testRecord.dimensions,
            model: testRecord.model,
            model_version: testRecord.modelVersion,
            caption: 'A sunset over mountains',
            caption_confidence: 0.92,
            created_at: testRecord.createdAt,
            updated_at: null,
          },
        ],
        recordsets: [],
        rowsAffected: [1],
        output: {},
      } as IResult<unknown>);

      const result = await repository.getByFileId(testFileId, testUserId);

      expect(result?.caption).toBe('A sunset over mountains');
      expect(result?.captionConfidence).toBe(0.92);
    });

    it('should update existing caption on re-upsert', async () => {
      // Mock getByFileId to return existing record with old caption
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [
          {
            id: testRecord.id,
            file_id: testRecord.fileId,
            user_id: testRecord.userId,
            embedding: JSON.stringify(testRecord.embedding),
            dimensions: testRecord.dimensions,
            model: testRecord.model,
            model_version: testRecord.modelVersion,
            caption: 'Old caption',
            caption_confidence: 0.80,
            created_at: testRecord.createdAt,
            updated_at: null,
          },
        ],
        recordsets: [],
        rowsAffected: [1],
        output: {},
      } as IResult<unknown>);

      // Mock update
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [],
        recordsets: [],
        rowsAffected: [1],
        output: {},
      } as IResult<unknown>);

      await repository.upsert({
        ...upsertParamsWithCaption,
        caption: 'New improved caption',
        captionConfidence: 0.98,
      });

      // Verify UPDATE query includes new caption
      expect(mockExecuteQuery).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('UPDATE image_embeddings'),
        expect.objectContaining({
          caption: 'New improved caption',
          caption_confidence: 0.98,
        })
      );
    });
  });
});
