import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { VectorSearchService } from '../../../services/search/VectorSearchService';
import { env } from '@/infrastructure/config/environment';

// Skippable integration test suite
// Run only if Azure Search credentials are provided
const runIntegrationTests = env.AZURE_SEARCH_ENDPOINT && env.AZURE_SEARCH_KEY;

describe.skipIf(!runIntegrationTests)('VectorSearchService Integration', () => {
    let service: VectorSearchService;
    const testUserId = 'integration-test-user';
    const testFileId = 'integration-test-file';

    beforeAll(async () => {
        try {
            service = VectorSearchService.getInstance();
            await service.ensureIndexExists();
        } catch (error) {
            console.error('VectorSearchService initialization failed:', error);
            throw error;
        }
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

        // 1. Index (service normalizes IDs to UPPERCASE per CLAUDE.md Section 12)
        const key = await service.indexChunk(chunk);
        expect(key).toBe('INTEGRATION-1');
        
        // Wait for indexing (Azure Search has eventual consistency)
        await new Promise(resolve => setTimeout(resolve, 2000));

        // 2. Search
        const results = await service.search({
            embedding: chunk.embedding,
            userId: testUserId,
            top: 1
        });

        expect(results.length).toBeGreaterThan(0);
        expect(results[0].chunkId).toBe('INTEGRATION-1');
        expect(results[0].content).toBe('Integration test content');

        // 3. Delete (use UPPERCASE as stored)
        await service.deleteChunk('INTEGRATION-1');

        await new Promise(resolve => setTimeout(resolve, 2000));

        const resultsAfterDelete = await service.search({
            embedding: chunk.embedding,
            userId: testUserId,
            top: 1
        });

        expect(resultsAfterDelete).toHaveLength(0);
    });

    describe('Image Search', () => {
        // UPPERCASE per CLAUDE.md Section 12 - service normalizes all IDs
        const testImageFileId = 'INTEGRATION-TEST-IMAGE-FILE';

        afterAll(async () => {
            // Cleanup image documents (documentId format: img_FILEID)
            try {
                await service.deleteChunk(`img_${testImageFileId}`);
            } catch {
                // Ignore cleanup errors
            }
        });

        it('should index image embedding and search via searchImages', async () => {
            // 1. Index image embedding (1024 dimensions for Azure Vision)
            const imageEmbedding = new Array(1024).fill(0.15);

            await service.indexImageEmbedding({
                fileId: testImageFileId,
                userId: testUserId,
                embedding: imageEmbedding,
                fileName: 'test-product.jpg',
            });

            // Wait for indexing (Azure Search eventual consistency)
            await new Promise(resolve => setTimeout(resolve, 2000));

            // 2. Search for the image using similar embedding
            const results = await service.searchImages({
                embedding: imageEmbedding,
                userId: testUserId,
                top: 5,
                minScore: 0.5,
            });

            // 3. Verify
            expect(results.length).toBeGreaterThanOrEqual(1);
            expect(results[0].fileId).toBe(testImageFileId);
            expect(results[0].fileName).toBe('test-product.jpg');
            expect(results[0].isImage).toBe(true);
            expect(results[0].score).toBeGreaterThan(0.5);
        });

        it('should not return images from other users (multi-tenant isolation)', async () => {
            const otherUserId = 'INTEGRATION-TEST-OTHER-USER';
            const otherFileId = 'INTEGRATION-TEST-OTHER-IMAGE';

            // Index image for OTHER user
            await service.indexImageEmbedding({
                fileId: otherFileId,
                userId: otherUserId,
                embedding: new Array(1024).fill(0.25),
                fileName: 'other-user-photo.jpg',
            });

            await new Promise(resolve => setTimeout(resolve, 2000));

            // Search as testUserId (original user)
            const results = await service.searchImages({
                embedding: new Array(1024).fill(0.25),
                userId: testUserId, // NOT otherUserId
                top: 100,
                minScore: 0.0,
            });

            // Should NOT find other user's images (filtering by UPPERCASE fileId)
            const otherUserFiles = results.filter(r => r.fileId === otherFileId);
            expect(otherUserFiles).toHaveLength(0);

            // Cleanup (documentId format: img_FILEID)
            await service.deleteChunk(`img_${otherFileId}`);
        });

        it('should filter images by minScore threshold', async () => {
            // Index two images with different embeddings (UPPERCASE per CLAUDE.md)
            const highMatchFileId = 'INTEGRATION-HIGH-MATCH';
            const lowMatchFileId = 'INTEGRATION-LOW-MATCH';

            // High match: embedding similar to query
            await service.indexImageEmbedding({
                fileId: highMatchFileId,
                userId: testUserId,
                embedding: new Array(1024).fill(0.5),
                fileName: 'high-match.jpg',
            });

            // Low match: very different embedding
            await service.indexImageEmbedding({
                fileId: lowMatchFileId,
                userId: testUserId,
                embedding: new Array(1024).fill(-0.5),
                fileName: 'low-match.jpg',
            });

            await new Promise(resolve => setTimeout(resolve, 2000));

            // Search with high minScore threshold
            const results = await service.searchImages({
                embedding: new Array(1024).fill(0.5), // Similar to highMatchFileId
                userId: testUserId,
                top: 10,
                minScore: 0.8,
            });

            // Should find high match, not low match
            const highMatch = results.find(r => r.fileId === highMatchFileId);
            const lowMatch = results.find(r => r.fileId === lowMatchFileId);

            expect(highMatch).toBeDefined();
            expect(lowMatch).toBeUndefined();

            // Cleanup
            await service.deleteChunk(`img_${highMatchFileId}`);
            await service.deleteChunk(`img_${lowMatchFileId}`);
        });

        it('should delete image embedding', async () => {
            const deleteTestFileId = 'INTEGRATION-DELETE-TEST';

            // Index
            await service.indexImageEmbedding({
                fileId: deleteTestFileId,
                userId: testUserId,
                embedding: new Array(1024).fill(0.3),
                fileName: 'to-delete.jpg',
            });

            await new Promise(resolve => setTimeout(resolve, 2000));

            // Verify indexed
            let results = await service.searchImages({
                embedding: new Array(1024).fill(0.3),
                userId: testUserId,
                top: 5,
            });
            expect(results.find(r => r.fileId === deleteTestFileId)).toBeDefined();

            // Delete
            await service.deleteChunk(`img_${deleteTestFileId}`);
            await new Promise(resolve => setTimeout(resolve, 2000));

            // Verify deleted
            results = await service.searchImages({
                embedding: new Array(1024).fill(0.3),
                userId: testUserId,
                top: 5,
            });
            expect(results.find(r => r.fileId === deleteTestFileId)).toBeUndefined();
        });
    });
});
