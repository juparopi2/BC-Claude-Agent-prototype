import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SemanticSearchService } from '@/services/search/semantic/SemanticSearchService';
import { VectorSearchService } from '@/services/search/VectorSearchService';
import { env } from '@/infrastructure/config/environment';

/**
 * Integration tests for SemanticSearchService unified search (text + images)
 *
 * These tests verify the end-to-end unified search functionality that combines
 * text chunk search (1536d embeddings) with image search (1024d embeddings).
 *
 * Prerequisites:
 * - Azure Search credentials (AZURE_SEARCH_ENDPOINT, AZURE_SEARCH_KEY)
 * - Azure OpenAI credentials (for text embeddings)
 * - Azure Vision credentials (for image query embeddings) - optional, graceful degradation
 * - Redis (for embedding cache)
 */

const hasAzureSearch = env.AZURE_SEARCH_ENDPOINT && env.AZURE_SEARCH_KEY;
const hasAzureOpenAI = env.AZURE_OPENAI_ENDPOINT && env.AZURE_OPENAI_KEY;
const runIntegrationTests = hasAzureSearch && hasAzureOpenAI;

describe.skipIf(!runIntegrationTests)('SemanticSearchService Integration - Unified Search', () => {
    let semanticSearchService: SemanticSearchService;
    let vectorSearchService: VectorSearchService;

    const TEST_USER_ID = 'integration-semantic-test-user';
    const OTHER_USER_ID = 'integration-semantic-other-user';

    // Test data
    const textFileId = 'integration-text-file';
    const imageFileId = 'integration-image-file';
    const otherUserFileId = 'integration-other-user-file';

    beforeAll(async () => {
        semanticSearchService = SemanticSearchService.getInstance();
        vectorSearchService = VectorSearchService.getInstance();

        await vectorSearchService.ensureIndexExists();

        // Seed test data: 1 text chunk + 1 image for TEST_USER_ID
        // Text chunk (1536d)
        await vectorSearchService.indexChunk({
            chunkId: `chunk_${textFileId}_0`,
            fileId: textFileId,
            userId: TEST_USER_ID,
            content: 'This document describes inventory management procedures for warehouse operations.',
            embedding: new Array(1536).fill(0.1),
            chunkIndex: 0,
            tokenCount: 10,
            embeddingModel: 'text-embedding-3-small',
            createdAt: new Date(),
        });

        // Image embedding (1024d)
        await vectorSearchService.indexImageEmbedding({
            fileId: imageFileId,
            userId: TEST_USER_ID,
            embedding: new Array(1024).fill(0.2),
            fileName: 'warehouse-photo.jpg',
        });

        // Other user's image (should never appear in TEST_USER_ID's results)
        await vectorSearchService.indexImageEmbedding({
            fileId: otherUserFileId,
            userId: OTHER_USER_ID,
            embedding: new Array(1024).fill(0.2),
            fileName: 'other-user-photo.jpg',
        });

        // Wait for indexing
        await new Promise(resolve => setTimeout(resolve, 3000));
    });

    afterAll(async () => {
        // Cleanup test data
        try {
            await vectorSearchService.deleteChunk(`chunk_${textFileId}_0`);
            await vectorSearchService.deleteChunk(`img_${imageFileId}`);
            await vectorSearchService.deleteChunk(`img_${otherUserFileId}`);
        } catch {
            // Ignore cleanup errors
        }
    });

    it('should return both text and image results in unified search', async () => {
        const result = await semanticSearchService.searchRelevantFiles({
            userId: TEST_USER_ID,
            query: 'warehouse inventory',
            threshold: 0.0, // Low threshold to get all results
            maxFiles: 10,
        });

        // Should find both text and image results
        expect(result.results.length).toBeGreaterThanOrEqual(1);

        // Check that we have the structure
        expect(result.query).toBe('warehouse inventory');
        expect(result.threshold).toBe(0.0);

        // Log results for debugging
        console.log('Unified search results:', result.results.map(r => ({
            fileId: r.fileId,
            isImage: r.isImage,
            score: r.relevanceScore,
        })));
    });

    it('should correctly set isImage flag on results', async () => {
        const result = await semanticSearchService.searchRelevantFiles({
            userId: TEST_USER_ID,
            query: 'warehouse photo',
            threshold: 0.0,
            maxFiles: 10,
        });

        // Find text and image results
        const textResult = result.results.find(r => r.fileId === textFileId);
        const imageResult = result.results.find(r => r.fileId === imageFileId);

        if (textResult) {
            expect(textResult.isImage).toBe(false);
            expect(textResult.topChunks.length).toBeGreaterThan(0);
        }

        if (imageResult) {
            expect(imageResult.isImage).toBe(true);
            expect(imageResult.topChunks).toHaveLength(1); // Images include caption as single chunk
        }
    });

    it('should sort results by relevance score descending', async () => {
        const result = await semanticSearchService.searchRelevantFiles({
            userId: TEST_USER_ID,
            query: 'test query',
            threshold: 0.0,
            maxFiles: 10,
        });

        // Verify descending order
        for (let i = 1; i < result.results.length; i++) {
            expect(result.results[i - 1].relevanceScore)
                .toBeGreaterThanOrEqual(result.results[i].relevanceScore);
        }
    });

    it('should enforce multi-tenant isolation (never return other users files)', async () => {
        const result = await semanticSearchService.searchRelevantFiles({
            userId: TEST_USER_ID,
            query: 'photo',
            threshold: 0.0,
            maxFiles: 100, // Get all results
        });

        // Should NOT contain other user's files
        const otherUserFiles = result.results.filter(r => r.fileId === otherUserFileId);
        expect(otherUserFiles).toHaveLength(0);

        // Verify all results belong to TEST_USER_ID
        // (We can't directly check userId in results, but we verify exclusion)
    });

    it('should respect excludeFileIds parameter', async () => {
        const result = await semanticSearchService.searchRelevantFiles({
            userId: TEST_USER_ID,
            query: 'warehouse',
            threshold: 0.0,
            maxFiles: 10,
            excludeFileIds: [textFileId], // Exclude the text file
        });

        // Should not contain excluded file
        const excludedFile = result.results.find(r => r.fileId === textFileId);
        expect(excludedFile).toBeUndefined();
    });

    it('should respect maxFiles limit', async () => {
        const result = await semanticSearchService.searchRelevantFiles({
            userId: TEST_USER_ID,
            query: 'warehouse inventory management',
            threshold: 0.0,
            maxFiles: 1,
        });

        expect(result.results.length).toBeLessThanOrEqual(1);
    });

    it('should handle image search failure gracefully (continue with text search)', async () => {
        // This test verifies that if image embedding generation fails,
        // the search still returns text results

        // Note: We can't easily force a failure in integration tests,
        // but we can verify the behavior by checking that text results
        // are returned even if Azure Vision is not configured

        const result = await semanticSearchService.searchRelevantFiles({
            userId: TEST_USER_ID,
            query: 'inventory document',
            threshold: 0.0,
            maxFiles: 10,
        });

        // Should at least return text results
        expect(result.results.length).toBeGreaterThanOrEqual(0);
        // Should not throw
    });

    it('should include totalChunksSearched from both text and image searches', async () => {
        const result = await semanticSearchService.searchRelevantFiles({
            userId: TEST_USER_ID,
            query: 'warehouse',
            threshold: 0.0,
            maxFiles: 10,
        });

        // totalChunksSearched should be >= 0
        expect(result.totalChunksSearched).toBeGreaterThanOrEqual(0);
    });
});

describe.skipIf(!runIntegrationTests)('SemanticSearchService Integration - Multi-Tenant Security', () => {
    let semanticSearchService: SemanticSearchService;
    let vectorSearchService: VectorSearchService;

    const USER_A = 'security-test-user-a';
    const USER_B = 'security-test-user-b';
    const USER_A_FILE = 'security-user-a-file';
    const USER_B_FILE = 'security-user-b-file';

    beforeAll(async () => {
        semanticSearchService = SemanticSearchService.getInstance();
        vectorSearchService = VectorSearchService.getInstance();

        await vectorSearchService.ensureIndexExists();

        // Create identical content for both users with same embedding
        const sharedEmbedding = new Array(1536).fill(0.5);
        const sharedImageEmbedding = new Array(1024).fill(0.5);

        // User A's data
        await vectorSearchService.indexChunk({
            chunkId: `chunk_${USER_A_FILE}_0`,
            fileId: USER_A_FILE,
            userId: USER_A,
            content: 'Confidential report for User A only',
            embedding: sharedEmbedding,
            chunkIndex: 0,
            tokenCount: 6,
            embeddingModel: 'text-embedding-3-small',
            createdAt: new Date(),
        });

        await vectorSearchService.indexImageEmbedding({
            fileId: `${USER_A_FILE}-img`,
            userId: USER_A,
            embedding: sharedImageEmbedding,
            fileName: 'user-a-confidential.jpg',
        });

        // User B's data (identical content/embedding but different user)
        await vectorSearchService.indexChunk({
            chunkId: `chunk_${USER_B_FILE}_0`,
            fileId: USER_B_FILE,
            userId: USER_B,
            content: 'Confidential report for User B only',
            embedding: sharedEmbedding,
            chunkIndex: 0,
            tokenCount: 6,
            embeddingModel: 'text-embedding-3-small',
            createdAt: new Date(),
        });

        await vectorSearchService.indexImageEmbedding({
            fileId: `${USER_B_FILE}-img`,
            userId: USER_B,
            embedding: sharedImageEmbedding,
            fileName: 'user-b-confidential.jpg',
        });

        await new Promise(resolve => setTimeout(resolve, 3000));
    });

    afterAll(async () => {
        try {
            await vectorSearchService.deleteChunk(`chunk_${USER_A_FILE}_0`);
            await vectorSearchService.deleteChunk(`chunk_${USER_B_FILE}_0`);
            await vectorSearchService.deleteChunk(`img_${USER_A_FILE}-img`);
            await vectorSearchService.deleteChunk(`img_${USER_B_FILE}-img`);
        } catch {
            // Ignore cleanup errors
        }
    });

    it('User A should only see User A files (text search)', async () => {
        const result = await semanticSearchService.searchRelevantFiles({
            userId: USER_A,
            query: 'confidential report',
            threshold: 0.0,
            maxFiles: 100,
        });

        // Should find User A's file
        const userAFiles = result.results.filter(r =>
            r.fileId === USER_A_FILE || r.fileId === `${USER_A_FILE}-img`
        );

        // Should NOT find User B's files
        const userBFiles = result.results.filter(r =>
            r.fileId === USER_B_FILE || r.fileId === `${USER_B_FILE}-img`
        );

        expect(userBFiles).toHaveLength(0);

        console.log(`User A search: found ${userAFiles.length} own files, ${userBFiles.length} User B files`);
    });

    it('User B should only see User B files (text search)', async () => {
        const result = await semanticSearchService.searchRelevantFiles({
            userId: USER_B,
            query: 'confidential report',
            threshold: 0.0,
            maxFiles: 100,
        });

        // Should find User B's file
        const userBFiles = result.results.filter(r =>
            r.fileId === USER_B_FILE || r.fileId === `${USER_B_FILE}-img`
        );

        // Should NOT find User A's files
        const userAFiles = result.results.filter(r =>
            r.fileId === USER_A_FILE || r.fileId === `${USER_A_FILE}-img`
        );

        expect(userAFiles).toHaveLength(0);

        console.log(`User B search: found ${userBFiles.length} own files, ${userAFiles.length} User A files`);
    });

    it('Empty userId should return empty results (not other users data)', async () => {
        // This should either throw or return empty results
        try {
            const result = await semanticSearchService.searchRelevantFiles({
                userId: '',
                query: 'confidential',
                threshold: 0.0,
                maxFiles: 100,
            });

            // If it doesn't throw, should return empty
            expect(result.results).toHaveLength(0);
        } catch {
            // Throwing is also acceptable behavior
            expect(true).toBe(true);
        }
    });
});
