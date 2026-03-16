/**
 * FileChunkRepository Unit Tests
 *
 * Tests the Prisma-based repository for file_chunks table operations.
 *
 * @module __tests__/unit/services/files/repository/FileChunkRepository.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  FileChunkRepository,
  getFileChunkRepository,
  __resetFileChunkRepository,
} from '@/services/files/repository/FileChunkRepository';

// Hoist mock functions so they can be used in vi.mock factories
const { mockFindMany, mockCreateMany, mockUpdate } = vi.hoisted(() => ({
  mockFindMany: vi.fn(),
  mockCreateMany: vi.fn(),
  mockUpdate: vi.fn(),
}));

let uuidCounter = 0;

// Mock crypto.randomUUID
vi.mock('crypto', () => ({
  randomUUID: vi.fn(() => {
    uuidCounter++;
    return `00000000-0000-0000-0000-${String(uuidCounter).padStart(12, '0')}`;
  }),
}));

// Mock logger
vi.mock('@/shared/utils/logger', () => ({
  createChildLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

// Mock prisma
vi.mock('@/infrastructure/database/prisma', () => ({
  prisma: {
    file_chunks: {
      findMany: mockFindMany,
      createMany: mockCreateMany,
      update: mockUpdate,
    },
  },
}));

describe('FileChunkRepository', () => {
  let repo: FileChunkRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    __resetFileChunkRepository();
    uuidCounter = 0;
    repo = getFileChunkRepository();
  });

  describe('findByFileId', () => {
    it('should return ordered chunks for a file', async () => {
      const mockChunks = [
        { id: 'chunk-1', chunk_text: 'First chunk', chunk_index: 0, chunk_tokens: 50 },
        { id: 'chunk-2', chunk_text: 'Second chunk', chunk_index: 1, chunk_tokens: 60 },
      ];
      mockFindMany.mockResolvedValue(mockChunks);

      const result = await repo.findByFileId('file-1', 'user-1');

      expect(result).toEqual(mockChunks);
      expect(mockFindMany).toHaveBeenCalledWith({
        where: { file_id: 'file-1', user_id: 'user-1' },
        select: {
          id: true,
          chunk_text: true,
          chunk_index: true,
          chunk_tokens: true,
        },
        orderBy: { chunk_index: 'asc' },
      });
    });

    it('should return empty array when no chunks found', async () => {
      mockFindMany.mockResolvedValue([]);

      const result = await repo.findByFileId('file-nonexistent', 'user-1');

      expect(result).toEqual([]);
    });
  });

  describe('createMany', () => {
    it('should generate UPPERCASE UUIDs for each chunk', async () => {
      mockCreateMany.mockResolvedValue({ count: 2 });

      const chunks = [
        { text: 'Chunk A', chunkIndex: 0, tokenCount: 100 },
        { text: 'Chunk B', chunkIndex: 1, tokenCount: 120 },
      ];

      const result = await repo.createMany('file-1', 'user-1', chunks);

      expect(result).toHaveLength(2);
      // Verify UUIDs are uppercase
      for (const record of result) {
        expect(record.id).toBe(record.id.toUpperCase());
      }
    });

    it('should serialize metadata as JSON', async () => {
      mockCreateMany.mockResolvedValue({ count: 1 });

      const chunks = [
        { text: 'Chunk with meta', chunkIndex: 0, tokenCount: 50, metadata: { source: 'test' } },
      ];

      await repo.createMany('file-1', 'user-1', chunks);

      expect(mockCreateMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            file_id: 'file-1',
            user_id: 'user-1',
            chunk_text: 'Chunk with meta',
            chunk_index: 0,
            chunk_tokens: 50,
            metadata: '{"source":"test"}',
          }),
        ],
      });
    });

    it('should pass null for metadata when not provided', async () => {
      mockCreateMany.mockResolvedValue({ count: 1 });

      const chunks = [
        { text: 'Chunk no meta', chunkIndex: 0, tokenCount: 50 },
      ];

      await repo.createMany('file-1', 'user-1', chunks);

      expect(mockCreateMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            metadata: null,
          }),
        ],
      });
    });

    it('should batch at 100 items', async () => {
      mockCreateMany.mockResolvedValue({ count: 100 });

      // Create 150 chunks to trigger 2 batches
      const chunks = Array.from({ length: 150 }, (_, i) => ({
        text: `Chunk ${i}`,
        chunkIndex: i,
        tokenCount: 10,
      }));

      const result = await repo.createMany('file-1', 'user-1', chunks);

      expect(result).toHaveLength(150);
      // Should have called createMany twice (100 + 50)
      expect(mockCreateMany).toHaveBeenCalledTimes(2);
      // First batch should have 100 items
      expect(mockCreateMany.mock.calls[0]![0].data).toHaveLength(100);
      // Second batch should have 50 items
      expect(mockCreateMany.mock.calls[1]![0].data).toHaveLength(50);
    });

    it('should return correct record structure', async () => {
      mockCreateMany.mockResolvedValue({ count: 1 });

      const chunks = [
        { text: 'Test content', chunkIndex: 3, tokenCount: 42 },
      ];

      const result = await repo.createMany('file-1', 'user-1', chunks);

      expect(result[0]).toEqual(expect.objectContaining({
        text: 'Test content',
        chunkIndex: 3,
        tokenCount: 42,
      }));
      expect(result[0]!.id).toBeDefined();
    });
  });

  describe('updateSearchDocumentIds', () => {
    it('should call update for each entry', async () => {
      mockUpdate.mockResolvedValue({});

      const updates = [
        { chunkId: 'chunk-1', searchDocumentId: 'search-1' },
        { chunkId: 'chunk-2', searchDocumentId: 'search-2' },
      ];

      await repo.updateSearchDocumentIds(updates);

      expect(mockUpdate).toHaveBeenCalledTimes(2);
      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: 'chunk-1' },
        data: { search_document_id: 'search-1' },
      });
      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: 'chunk-2' },
        data: { search_document_id: 'search-2' },
      });
    });

    it('should handle null search document IDs', async () => {
      mockUpdate.mockResolvedValue({});

      const updates = [
        { chunkId: 'chunk-1', searchDocumentId: null },
      ];

      await repo.updateSearchDocumentIds(updates);

      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: 'chunk-1' },
        data: { search_document_id: null },
      });
    });

    it('should handle empty updates array', async () => {
      await repo.updateSearchDocumentIds([]);

      expect(mockUpdate).not.toHaveBeenCalled();
    });
  });

  describe('singleton', () => {
    it('should return the same instance', () => {
      const instance1 = getFileChunkRepository();
      const instance2 = getFileChunkRepository();
      expect(instance1).toBe(instance2);
    });

    it('should reset instance correctly', () => {
      const instance1 = getFileChunkRepository();
      __resetFileChunkRepository();
      const instance2 = getFileChunkRepository();
      expect(instance1).not.toBe(instance2);
    });
  });
});
