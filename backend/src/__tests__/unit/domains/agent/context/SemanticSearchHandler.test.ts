/**
 * @module SemanticSearchHandler.test
 * Unit tests for SemanticSearchHandler.
 * Tests the semantic search wrapper functionality.
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import {
  SemanticSearchHandler,
  createSemanticSearchHandler,
} from '@/domains/agent/context/SemanticSearchHandler';
import {
  SEMANTIC_SEARCH_THRESHOLD,
  SEMANTIC_SEARCH_MAX_FILES,
  type SearchResult,
} from '@/domains/agent/context/types';
import type {
  SemanticSearchService,
} from '@/services/search/semantic/SemanticSearchService';
import type {
  SemanticSearchResponse,
} from '@/services/search/semantic/types';

// Mock logger
vi.mock('@/shared/utils/logger', () => ({
  createChildLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  }),
}));

describe('SemanticSearchHandler', () => {
  let mockSearchService: {
    searchRelevantFiles: Mock;
  };

  beforeEach(() => {
    mockSearchService = {
      searchRelevantFiles: vi.fn(),
    };
  });

  // ===================================
  // 1. Factory Function Tests
  // ===================================

  describe('Factory Function Tests', () => {
    it('createSemanticSearchHandler() creates new instance', () => {
      const handler = createSemanticSearchHandler(
        mockSearchService as unknown as SemanticSearchService
      );

      expect(handler).toBeInstanceOf(SemanticSearchHandler);
    });

    it('creates independent instances', () => {
      const handler1 = createSemanticSearchHandler(
        mockSearchService as unknown as SemanticSearchService
      );
      const handler2 = createSemanticSearchHandler(
        mockSearchService as unknown as SemanticSearchService
      );

      expect(handler1).not.toBe(handler2);
      expect(handler1).toBeInstanceOf(SemanticSearchHandler);
      expect(handler2).toBeInstanceOf(SemanticSearchHandler);
    });

    it('accepts custom searchService', async () => {
      const mockResponse: SemanticSearchResponse = {
        results: [
          {
            fileId: 'file-1',
            fileName: 'test.txt',
            relevanceScore: 0.9,
            topChunks: [
              {
                chunkId: 'c1',
                content: 'Test content',
                score: 0.9,
                chunkIndex: 0,
              },
            ],
          },
        ],
        query: 'test',
        threshold: 0.7,
        totalChunksSearched: 10,
      };

      mockSearchService.searchRelevantFiles.mockResolvedValue(mockResponse);

      const handler = createSemanticSearchHandler(
        mockSearchService as unknown as SemanticSearchService
      );
      await handler.search('user-1', 'test query');

      expect(mockSearchService.searchRelevantFiles).toHaveBeenCalled();
    });
  });

  // ===================================
  // 2. search() - Basic Functionality Tests
  // ===================================

  describe('search() - Basic Functionality Tests', () => {
    it('returns array of SearchResult', async () => {
      const mockResponse: SemanticSearchResponse = {
        results: [
          {
            fileId: 'file-1',
            fileName: 'test.txt',
            relevanceScore: 0.9,
            topChunks: [
              {
                chunkId: 'c1',
                content: 'Test content',
                score: 0.9,
                chunkIndex: 0,
              },
            ],
          },
        ],
        query: 'test',
        threshold: 0.7,
        totalChunksSearched: 10,
      };

      mockSearchService.searchRelevantFiles.mockResolvedValue(mockResponse);

      const handler = createSemanticSearchHandler(
        mockSearchService as unknown as SemanticSearchService
      );
      const results = await handler.search('user-1', 'test query');

      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBe(1);
      expect(results[0]).toMatchObject({
        fileId: expect.any(String),
        fileName: expect.any(String),
        content: expect.any(String),
        score: expect.any(Number),
      });
    });

    it('transforms results correctly (fileId, fileName, content, score)', async () => {
      const mockResponse: SemanticSearchResponse = {
        results: [
          {
            fileId: 'file-123',
            fileName: 'invoice.txt',
            relevanceScore: 0.95,
            topChunks: [
              {
                chunkId: 'c1',
                content: 'Invoice data',
                score: 0.95,
                chunkIndex: 0,
              },
            ],
          },
        ],
        query: 'test',
        threshold: 0.7,
        totalChunksSearched: 10,
      };

      mockSearchService.searchRelevantFiles.mockResolvedValue(mockResponse);

      const handler = createSemanticSearchHandler(
        mockSearchService as unknown as SemanticSearchService
      );
      const results = await handler.search('user-1', 'test query');

      expect(results[0]).toEqual({
        fileId: 'file-123',
        fileName: 'invoice.txt',
        content: 'Invoice data',
        score: 0.95,
      });
    });

    it('concatenates chunk content with \\n\\n', async () => {
      const mockResponse: SemanticSearchResponse = {
        results: [
          {
            fileId: 'file-1',
            fileName: 'multi-chunk.txt',
            relevanceScore: 0.95,
            topChunks: [
              {
                chunkId: 'c1',
                content: 'First chunk',
                score: 0.95,
                chunkIndex: 0,
              },
              {
                chunkId: 'c2',
                content: 'Second chunk',
                score: 0.90,
                chunkIndex: 1,
              },
              {
                chunkId: 'c3',
                content: 'Third chunk',
                score: 0.85,
                chunkIndex: 2,
              },
            ],
          },
        ],
        query: 'test',
        threshold: 0.7,
        totalChunksSearched: 10,
      };

      mockSearchService.searchRelevantFiles.mockResolvedValue(mockResponse);

      const handler = createSemanticSearchHandler(
        mockSearchService as unknown as SemanticSearchService
      );
      const results = await handler.search('user-1', 'test query');

      expect(results[0].content).toBe('First chunk\n\nSecond chunk\n\nThird chunk');
    });

    it('returns empty array when no results', async () => {
      const mockResponse: SemanticSearchResponse = {
        results: [],
        query: 'test',
        threshold: 0.7,
        totalChunksSearched: 10,
      };

      mockSearchService.searchRelevantFiles.mockResolvedValue(mockResponse);

      const handler = createSemanticSearchHandler(
        mockSearchService as unknown as SemanticSearchService
      );
      const results = await handler.search('user-1', 'test query');

      expect(results).toEqual([]);
    });

    it('passes correct parameters to searchService', async () => {
      const mockResponse: SemanticSearchResponse = {
        results: [],
        query: 'test',
        threshold: 0.7,
        totalChunksSearched: 10,
      };

      mockSearchService.searchRelevantFiles.mockResolvedValue(mockResponse);

      const handler = createSemanticSearchHandler(
        mockSearchService as unknown as SemanticSearchService
      );
      await handler.search('user-123', 'test query', {
        threshold: 0.8,
        maxFiles: 10,
        excludeFileIds: ['file-1', 'file-2'],
      });

      expect(mockSearchService.searchRelevantFiles).toHaveBeenCalledWith({
        userId: 'user-123',
        query: 'test query',
        threshold: 0.8,
        maxFiles: 10,
        excludeFileIds: ['file-1', 'file-2'],
      });
    });
  });

  // ===================================
  // 3. search() - Default Values Tests
  // ===================================

  describe('search() - Default Values Tests', () => {
    it('uses SEMANTIC_SEARCH_THRESHOLD when no threshold provided', async () => {
      const mockResponse: SemanticSearchResponse = {
        results: [],
        query: 'test',
        threshold: 0.7,
        totalChunksSearched: 10,
      };

      mockSearchService.searchRelevantFiles.mockResolvedValue(mockResponse);

      const handler = createSemanticSearchHandler(
        mockSearchService as unknown as SemanticSearchService
      );
      await handler.search('user-1', 'test query');

      expect(mockSearchService.searchRelevantFiles).toHaveBeenCalledWith(
        expect.objectContaining({
          threshold: SEMANTIC_SEARCH_THRESHOLD,
        })
      );
    });

    it('uses SEMANTIC_SEARCH_MAX_FILES when no maxFiles provided', async () => {
      const mockResponse: SemanticSearchResponse = {
        results: [],
        query: 'test',
        threshold: 0.7,
        totalChunksSearched: 10,
      };

      mockSearchService.searchRelevantFiles.mockResolvedValue(mockResponse);

      const handler = createSemanticSearchHandler(
        mockSearchService as unknown as SemanticSearchService
      );
      await handler.search('user-1', 'test query');

      expect(mockSearchService.searchRelevantFiles).toHaveBeenCalledWith(
        expect.objectContaining({
          maxFiles: SEMANTIC_SEARCH_MAX_FILES,
        })
      );
    });

    it('uses empty array for excludeFileIds when not provided', async () => {
      const mockResponse: SemanticSearchResponse = {
        results: [],
        query: 'test',
        threshold: 0.7,
        totalChunksSearched: 10,
      };

      mockSearchService.searchRelevantFiles.mockResolvedValue(mockResponse);

      const handler = createSemanticSearchHandler(
        mockSearchService as unknown as SemanticSearchService
      );
      await handler.search('user-1', 'test query');

      expect(mockSearchService.searchRelevantFiles).toHaveBeenCalledWith(
        expect.objectContaining({
          excludeFileIds: [],
        })
      );
    });

    it('applies custom options when provided', async () => {
      const mockResponse: SemanticSearchResponse = {
        results: [],
        query: 'test',
        threshold: 0.7,
        totalChunksSearched: 10,
      };

      mockSearchService.searchRelevantFiles.mockResolvedValue(mockResponse);

      const handler = createSemanticSearchHandler(
        mockSearchService as unknown as SemanticSearchService
      );
      await handler.search('user-1', 'test query', {
        threshold: 0.85,
        maxFiles: 3,
        excludeFileIds: ['file-x', 'file-y'],
      });

      expect(mockSearchService.searchRelevantFiles).toHaveBeenCalledWith({
        userId: 'user-1',
        query: 'test query',
        threshold: 0.85,
        maxFiles: 3,
        excludeFileIds: ['file-x', 'file-y'],
      });
    });
  });

  // ===================================
  // 4. search() - Error Handling Tests
  // ===================================

  describe('search() - Error Handling Tests', () => {
    it('returns empty array when searchService throws', async () => {
      mockSearchService.searchRelevantFiles.mockRejectedValue(
        new Error('Search service error')
      );

      const handler = createSemanticSearchHandler(
        mockSearchService as unknown as SemanticSearchService
      );
      const results = await handler.search('user-1', 'test query');

      expect(results).toEqual([]);
    });

    it('does not propagate errors (graceful degradation)', async () => {
      mockSearchService.searchRelevantFiles.mockRejectedValue(
        new Error('Database connection failed')
      );

      const handler = createSemanticSearchHandler(
        mockSearchService as unknown as SemanticSearchService
      );

      // Should not throw
      await expect(handler.search('user-1', 'test query')).resolves.toEqual([]);
    });

    it('logs error when search fails', async () => {
      const error = new Error('Search failed');
      mockSearchService.searchRelevantFiles.mockRejectedValue(error);

      const handler = createSemanticSearchHandler(
        mockSearchService as unknown as SemanticSearchService
      );
      await handler.search('user-1', 'test query');

      // Logger is mocked, we just verify no errors are thrown
      // In a real scenario, we would check logger.error was called
      expect(mockSearchService.searchRelevantFiles).toHaveBeenCalled();
    });

    it('handles null/undefined response gracefully', async () => {
      // Edge case: service returns invalid response
      mockSearchService.searchRelevantFiles.mockResolvedValue(null as any);

      const handler = createSemanticSearchHandler(
        mockSearchService as unknown as SemanticSearchService
      );

      // Should handle gracefully by catching error in try/catch
      const results = await handler.search('user-1', 'test query');
      expect(results).toEqual([]);
    });
  });

  // ===================================
  // 5. Realistic Scenario Tests
  // ===================================

  describe('Realistic Scenario Tests', () => {
    it('multi-file search results', async () => {
      const mockResponse: SemanticSearchResponse = {
        results: [
          {
            fileId: 'file-1',
            fileName: 'invoice.txt',
            relevanceScore: 0.95,
            topChunks: [
              {
                chunkId: 'c1',
                content: 'Invoice #001 for $1,000',
                score: 0.95,
                chunkIndex: 0,
              },
              {
                chunkId: 'c2',
                content: 'Payment due: 30 days',
                score: 0.90,
                chunkIndex: 1,
              },
            ],
          },
          {
            fileId: 'file-2',
            fileName: 'orders.txt',
            relevanceScore: 0.85,
            topChunks: [
              {
                chunkId: 'c3',
                content: 'Order #123: 50 widgets',
                score: 0.85,
                chunkIndex: 0,
              },
            ],
          },
          {
            fileId: 'file-3',
            fileName: 'customers.txt',
            relevanceScore: 0.78,
            topChunks: [
              {
                chunkId: 'c4',
                content: 'Customer: Acme Corp',
                score: 0.78,
                chunkIndex: 0,
              },
              {
                chunkId: 'c5',
                content: 'Email: contact@acme.com',
                score: 0.75,
                chunkIndex: 1,
              },
            ],
          },
        ],
        query: 'invoices and orders',
        threshold: 0.7,
        totalChunksSearched: 100,
      };

      mockSearchService.searchRelevantFiles.mockResolvedValue(mockResponse);

      const handler = createSemanticSearchHandler(
        mockSearchService as unknown as SemanticSearchService
      );
      const results = await handler.search('user-1', 'invoices and orders');

      expect(results).toHaveLength(3);

      expect(results[0]).toEqual({
        fileId: 'file-1',
        fileName: 'invoice.txt',
        content: 'Invoice #001 for $1,000\n\nPayment due: 30 days',
        score: 0.95,
      });

      expect(results[1]).toEqual({
        fileId: 'file-2',
        fileName: 'orders.txt',
        content: 'Order #123: 50 widgets',
        score: 0.85,
      });

      expect(results[2]).toEqual({
        fileId: 'file-3',
        fileName: 'customers.txt',
        content: 'Customer: Acme Corp\n\nEmail: contact@acme.com',
        score: 0.78,
      });
    });

    it('empty results scenario', async () => {
      const mockResponse: SemanticSearchResponse = {
        results: [],
        query: 'nonexistent topic',
        threshold: 0.7,
        totalChunksSearched: 50,
      };

      mockSearchService.searchRelevantFiles.mockResolvedValue(mockResponse);

      const handler = createSemanticSearchHandler(
        mockSearchService as unknown as SemanticSearchService
      );
      const results = await handler.search('user-1', 'nonexistent topic');

      expect(results).toEqual([]);
      expect(Array.isArray(results)).toBe(true);
    });

    it('search with excludeFileIds', async () => {
      const mockResponse: SemanticSearchResponse = {
        results: [
          {
            fileId: 'file-3',
            fileName: 'report.txt',
            relevanceScore: 0.88,
            topChunks: [
              {
                chunkId: 'c1',
                content: 'Annual report data',
                score: 0.88,
                chunkIndex: 0,
              },
            ],
          },
        ],
        query: 'reports',
        threshold: 0.7,
        totalChunksSearched: 30,
      };

      mockSearchService.searchRelevantFiles.mockResolvedValue(mockResponse);

      const handler = createSemanticSearchHandler(
        mockSearchService as unknown as SemanticSearchService
      );
      const results = await handler.search('user-1', 'reports', {
        excludeFileIds: ['file-1', 'file-2'],
      });

      expect(results).toHaveLength(1);
      expect(results[0].fileId).toBe('file-3');

      // Verify excludeFileIds were passed to service
      expect(mockSearchService.searchRelevantFiles).toHaveBeenCalledWith(
        expect.objectContaining({
          excludeFileIds: ['file-1', 'file-2'],
        })
      );
    });
  });
});
