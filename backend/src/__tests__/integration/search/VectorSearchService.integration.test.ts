import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { VectorSearchService } from '../../../services/search/VectorSearchService';
import { env } from '../../../config/environment';

// Skippable integration test suite
// Run only if Azure Search credentials are provided
const runIntegrationTests = env.AZURE_SEARCH_ENDPOINT && env.AZURE_SEARCH_KEY;

describe.skipIf(!runIntegrationTests)('VectorSearchService Integration', () => {
    let service: VectorSearchService;
    const testUserId = 'integration-test-user';
    const testFileId = 'integration-test-file';

    beforeAll(async () => {
        service = VectorSearchService.getInstance();
        await service.ensureIndexExists();
    });

    afterAll(async () => {
        // Cleanup
        try {
            await service.deleteChunksForUser(testUserId);
            // Optional: Delete index if dedicated for testing
            // await service.deleteIndex(); 
        } catch (error) {
            console.error('Cleanup failed', error);
        }
    });

    it('should index, search, and delete chunks end-to-end', async () => {
        const chunk = {
            chunkId: 'integration-1',
            fileId: testFileId,
            userId: testUserId,
            content: 'Integration test content',
            embedding: new Array(1536).fill(0.1), // Mock embedding
            chunkIndex: 0,
            tokenCount: 3,
            embeddingModel: 'text-embedding-3-small',
            createdAt: new Date()
        };

        // 1. Index
        const key = await service.indexChunk(chunk);
        expect(key).toBe('integration-1');
        
        // Wait for indexing (Azure Search has eventual consistency)
        await new Promise(resolve => setTimeout(resolve, 2000));

        // 2. Search
        const results = await service.search({
            embedding: chunk.embedding,
            userId: testUserId,
            top: 1
        });

        expect(results.length).toBeGreaterThan(0);
        expect(results[0].chunkId).toBe('integration-1');
        expect(results[0].content).toBe('Integration test content');

        // 3. Delete
        await service.deleteChunk('integration-1');

        await new Promise(resolve => setTimeout(resolve, 2000));

        const resultsAfterDelete = await service.search({
            embedding: chunk.embedding,
            userId: testUserId,
            top: 1
        });
        
        expect(resultsAfterDelete).toHaveLength(0);
    });
});
