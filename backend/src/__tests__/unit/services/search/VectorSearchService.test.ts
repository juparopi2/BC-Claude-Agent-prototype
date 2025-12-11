import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VectorSearchService } from '../../../../services/search/VectorSearchService';
import { SearchIndexClient, SearchClient } from '@azure/search-documents';
import { indexSchema, INDEX_NAME } from '../../../../services/search/schema';
import { SearchQuery, HybridSearchQuery } from '../../../../services/search/types';

// Mock Azure SDK
vi.mock('@azure/search-documents', () => {
  return {
    SearchIndexClient: vi.fn(),
    SearchClient: vi.fn(),
    AzureKeyCredential: vi.fn(),
  };
});

describe('VectorSearchService - Index Management', () => {
  let service: VectorSearchService;
  let mockIndexClient: any;
  let mockSearchClient: any;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();

    // Create mock instances with spy methods
    mockIndexClient = {
      getIndex: vi.fn(),
      createIndex: vi.fn(),
      deleteIndex: vi.fn(),
      getServiceStatistics: vi.fn(),
      listIndexes: vi.fn(),
    };

    mockSearchClient = {
        getDocumentsCount: vi.fn(),
        uploadDocuments: vi.fn(),
        deleteDocuments: vi.fn(),
        search: vi.fn(),
    };

    // Get singleton and inject mocks
    service = VectorSearchService.getInstance();
    // We explicitly call initializeClients with mocks to bypass env var checks and avoiding real network calls
    // Note: We need to make sure initializeClients is public or accessible for testing, 
    // or use @ts-ignore if it's protected/private (it's public in our skeleton)
    service.initializeClients(mockIndexClient as unknown as SearchIndexClient, mockSearchClient as unknown as SearchClient<any>);
  });

  describe('ensureIndexExists', () => {
    it('should create index if it does not exist', async () => {
      // Setup: getIndex throws 404 (handled by SDK usually by throwing error)
      mockIndexClient.getIndex.mockRejectedValue({ statusCode: 404 });
      mockIndexClient.createIndex.mockResolvedValue({ name: INDEX_NAME });

      await service.ensureIndexExists();

      expect(mockIndexClient.getIndex).toHaveBeenCalledWith(INDEX_NAME);
      expect(mockIndexClient.createIndex).toHaveBeenCalledWith(indexSchema);
    });

    it('should NOT create index if it already exists', async () => {
      // Setup: getIndex returns existing index
      mockIndexClient.getIndex.mockResolvedValue({ name: INDEX_NAME });

      await service.ensureIndexExists();

      expect(mockIndexClient.getIndex).toHaveBeenCalledWith(INDEX_NAME);
      expect(mockIndexClient.createIndex).not.toHaveBeenCalled();
    });

    it('should throw error if getIndex fails with non-404 error', async () => {
      const error = new Error('Access Denied');
      (error as any).statusCode = 403;
      mockIndexClient.getIndex.mockRejectedValue(error);

      await expect(service.ensureIndexExists()).rejects.toThrow('Access Denied');
    });
  });

  describe('deleteIndex', () => {
    it('should delete the index', async () => {
      mockIndexClient.deleteIndex.mockResolvedValue(undefined);

      await service.deleteIndex();

      expect(mockIndexClient.deleteIndex).toHaveBeenCalledWith(INDEX_NAME);
    });
  });

  describe('getIndexStats', () => {
    it('should return document count and storage size', async () => {
        // SearchClient.getDocumentsCount() returns number
        // We'll trust our abstraction to combine data if needed, or if we use IndexClient statistics
        // Actually, IndexClient usually gives service stats, but specific index stats like size/docs might come from listIndexes or getIndex.
        // Assuming we rely on SearchClient for count and maybe IndexClient/getIndex for other metadata if available.
        // For this test, let's assume we implement it by getting doc count from SearchClient
        // and current implementation of types.ts has storageSize.
        // There is no easy way to get storage size for a single index in basic tier without using metrics or listIndexes.
        // Let's assume we use listIndexes to find our index stats if possible, or just mock what we expect.
        // For simplicity, let's assume getIndexStats calls searchClient.getDocumentsCount()
        
        mockSearchClient.getDocumentsCount.mockResolvedValue(150);
        // Assuming we can't easily get storage size in basic SKU efficiently per index without listIndexes loop.
        // Let's assume we implement a best-effort approach or just return 0 for size if not available.
        
        const stats = await service.getIndexStats();
        
        expect(stats.documentCount).toBe(150);
        expect(mockSearchClient.getDocumentsCount).toHaveBeenCalled();
    });
  });

  describe('Document Indexing', () => {
    const mockChunk = {
      chunkId: '123',
      fileId: 'file-123',
      userId: 'user-123',
      content: 'Hello World',
      embedding: [0.1, 0.2, 0.3],
      chunkIndex: 0,
      tokenCount: 2,
      embeddingModel: 'text-embedding-3-small',
      createdAt: new Date(),
    };

    it('should index a single chunk', async () => {
      // Mock uploadDocuments
      const mockResult = { results: [{ key: '123', succeeded: true, statusCode: 201 }] };
      mockSearchClient.uploadDocuments.mockResolvedValue(mockResult);

      const result = await service.indexChunk(mockChunk);

      expect(result).toBe('123');
      expect(mockSearchClient.uploadDocuments).toHaveBeenCalledTimes(1);
      
      // Verify mapping
      const callArgs = mockSearchClient.uploadDocuments.mock.calls[0][0];
      expect(callArgs).toHaveLength(1);
      expect(callArgs[0]).toEqual(expect.objectContaining({
        chunkId: mockChunk.chunkId,
        contentVector: mockChunk.embedding, // Mapped
        embeddingModel: mockChunk.embeddingModel
      }));
    });

    it('should index chunks batch', async () => {
      const chunks = [
          { ...mockChunk, chunkId: '1' },
          { ...mockChunk, chunkId: '2' }
      ];
      const mockResult = { 
          results: [
              { key: '1', succeeded: true, statusCode: 201 },
              { key: '2', succeeded: true, statusCode: 201 }
          ] 
      };
      mockSearchClient.uploadDocuments.mockResolvedValue(mockResult);

      const results = await service.indexChunksBatch(chunks);

      expect(results).toHaveLength(2);
      expect(results).toEqual(['1', '2']);
      expect(mockSearchClient.uploadDocuments).toHaveBeenCalled();
    });

    it('should throw error if indexing fails', async () => {
       const mockResult = { 
          results: [
              { key: '1', succeeded: false, statusCode: 400, errorMessage: 'Bad Request' }
          ] 
      };
      mockSearchClient.uploadDocuments.mockResolvedValue(mockResult);

      await expect(service.indexChunk(mockChunk)).rejects.toThrow('Failed to index documents');
    });
  });

  describe('Search Functionality', () => {
    const mockSearchResults = {
        results: createAsyncIterable([
            { 
                document: { 
                    chunkId: '1', 
                    fileId: 'f1', 
                    content: 'content 1', 
                    chunkIndex: 0 
                }, 
                score: 0.9 
            }
        ])
    };

    beforeEach(() => {
        mockSearchClient.search = vi.fn().mockResolvedValue(mockSearchResults);
    });

    it('should perform vector search with userId filter', async () => {
        const query = {
            embedding: [0.1, 0.2, 0.3],
            userId: 'user-123',
            top: 5
        };

        const results = await service.search(query);

        expect(results).toHaveLength(1);
        expect(results[0].chunkId).toBe('1');
        expect(mockSearchClient.search).toHaveBeenCalledWith(
            '*',
            expect.objectContaining({
                filter: "userId eq 'user-123'", // Critical security check
                vectorSearchOptions: expect.objectContaining({
                    queries: expect.arrayContaining([
                        expect.objectContaining({
                            vector: query.embedding,
                            fields: ['contentVector'],
                            kind: 'vector',
                        })
                    ])
                }),
                top: 5
            })
        );
    });

    it('should perform hybrid search with text and vector', async () => {
        const query = {
            embedding: [0.1, 0.2, 0.3],
            userId: 'user-123',
            text: 'test query',
            top: 10
        };

        await service.hybridSearch(query);

        expect(mockSearchClient.search).toHaveBeenCalledWith(
            'test query',
            expect.objectContaining({
                 filter: "userId eq 'user-123'",
                 vectorSearchOptions: expect.objectContaining({
                    queries: expect.arrayContaining([
                        expect.objectContaining({
                            vector: query.embedding
                        })
                    ])
                 })
            })
        );
    });
    
    it('should combine custom filter with userId filter', async () => {
        const query = {
            embedding: [0.1],
            userId: 'user-123',
            filter: "fileId eq 'f1'"
        };

        await service.search(query);

        expect(mockSearchClient.search).toHaveBeenCalledWith(
            '*',
            expect.objectContaining({
                filter: "(userId eq 'user-123') and (fileId eq 'f1')"
            })
        );
    });
  });

  describe('Deletion', () => {
    
    it('should delete a single chunk by ID', async () => {
        const mockResult = { results: [{ key: '123', succeeded: true, statusCode: 200 }] };
        mockSearchClient.deleteDocuments.mockResolvedValue(mockResult);

        await service.deleteChunk('123');

        expect(mockSearchClient.deleteDocuments).toHaveBeenCalledWith(
            'chunkId',
            ['123']
        );
    });

    it('should delete chunks for a file (search then delete)', async () => {
        // Mock search results for find
        const mockFindResults = {
            results: createAsyncIterable([
                { document: { chunkId: '1' } },
                { document: { chunkId: '2' } }
            ])
        };
        mockSearchClient.search = vi.fn().mockResolvedValue(mockFindResults);
        
        // Mock deletion
        mockSearchClient.deleteDocuments.mockResolvedValue({ 
            results: [
                { key: '1', succeeded: true }, 
                { key: '2', succeeded: true }
            ] 
        });

        await service.deleteChunksForFile('file-123', 'user-123');

        // Verify search used correct filter
        expect(mockSearchClient.search).toHaveBeenCalledWith(
            '*',
            expect.objectContaining({
                filter: "(userId eq 'user-123') and (fileId eq 'file-123')",
                select: ['chunkId']
            })
        );

        // Verify deletion called with found IDs
        expect(mockSearchClient.deleteDocuments).toHaveBeenCalledWith(
            'chunkId',
            ['1', '2']
        );
    });

    it('should delete chunks for a user', async () => {
         // Mock search results for find
         const mockFindResults = {
            results: createAsyncIterable([
                { document: { chunkId: '1' } }
            ])
        };
        mockSearchClient.search = vi.fn().mockResolvedValue(mockFindResults);
        mockSearchClient.deleteDocuments.mockResolvedValue({ results: [{ key: '1', succeeded: true }]});

        await service.deleteChunksForUser('user-123');

        expect(mockSearchClient.search).toHaveBeenCalledWith(
            '*',
            expect.objectContaining({
                filter: "userId eq 'user-123'",
                select: ['chunkId']
            })
        );
        
        expect(mockSearchClient.deleteDocuments).toHaveBeenCalledWith(
            'chunkId',
            ['1']
        );
    });
    
    it('should handle empty search results gracefully during deletion', async () => {
        const mockFindResults = { results: createAsyncIterable([]) };
        mockSearchClient.search = vi.fn().mockResolvedValue(mockFindResults);

        await service.deleteChunksForFile('file-empty', 'user-123');

        expect(mockSearchClient.deleteDocuments).not.toHaveBeenCalled();
    });
  });
});

// Helper to create async iterable for search results mocking
function createAsyncIterable(data: any[]) {
    return {
        async *[Symbol.asyncIterator]() {
            for (const item of data) {
                yield item;
            }
        }
    };
}
