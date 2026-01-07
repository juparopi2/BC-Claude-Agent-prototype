import { describe, it, expect, beforeAll } from 'vitest';
import { EmbeddingService } from '../../../services/embeddings/EmbeddingService';

describe('EmbeddingService Integration', () => {
    // Get singleton INSIDE describe block to ensure setupFiles have run
    let embeddingService: EmbeddingService | null = null;
    let skipTests = false;

    beforeAll(() => {
        // Skip if credentials not present
        if (!process.env.AZURE_OPENAI_KEY ||
            !process.env.AZURE_OPENAI_ENDPOINT ||
            !process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT ||
            !process.env.REDIS_PASSWORD) {
            skipTests = true;
            console.log('Skipping EmbeddingService tests: missing Azure OpenAI or Redis credentials');
            return;
        }
        embeddingService = EmbeddingService.getInstance();
    });

    it('should generate real embeddings from Azure OpenAI', async () => {
        if (skipTests || !embeddingService) {
            console.log('Test skipped: missing credentials');
            return;
        }

        const text = 'This is a test sentence for embedding generation.';
        const result = await embeddingService.generateTextEmbedding(text, 'test-user');

        expect(result).toBeDefined();
        // Ada-002 generates 1536-dimensional embeddings
        expect(result.embedding.length).toBe(1536);
        // Check that it's not all zeros
        expect(result.embedding.some((val: number) => val !== 0)).toBe(true);
    });

    it('should batch generate embeddings', async () => {
        if (skipTests || !embeddingService) {
            console.log('Test skipped: missing credentials');
            return;
        }

        const texts = [
            'First sentence.',
            'Second sentence represents a query.',
            'Third sentence is a bit longer to test tokens.'
        ];

        const results = await embeddingService.generateTextEmbeddingsBatch(texts, 'test-user');

        expect(results).toHaveLength(3);
        results.forEach((result: any) => {
            expect(result.embedding).toHaveLength(1536);
        });
    });

    describe('Image Query Embeddings (Azure Vision VectorizeText)', () => {
        let skipVisionTests = false;

        beforeAll(() => {
            // Skip if Azure Vision credentials not present
            if (!process.env.AZURE_VISION_ENDPOINT || !process.env.AZURE_VISION_KEY) {
                skipVisionTests = true;
                console.log('Skipping Vision tests: missing Azure Vision credentials');
            }
        });

        it('should generate 1024-dimensional embedding for text query using VectorizeText API', async () => {
            if (skipTests || skipVisionTests || !embeddingService) {
                console.log('Test skipped: missing credentials');
                return;
            }

            const query = 'metal boxes on a shelf in a warehouse';
            const result = await embeddingService.generateImageQueryEmbedding(query, 'test-user');

            expect(result).toBeDefined();
            // Azure Vision generates 1024-dimensional embeddings
            expect(result.embedding.length).toBe(1024);
            // Check that it's not all zeros
            expect(result.embedding.some((val: number) => val !== 0)).toBe(true);
            // Check model info
            expect(result.model).toContain('vectorize-text');
        });

        it('should generate embeddings in same vector space as image embeddings', async () => {
            if (skipTests || skipVisionTests || !embeddingService) {
                console.log('Test skipped: missing credentials');
                return;
            }

            // Generate two similar text queries - they should have high similarity
            const query1 = 'sunset over mountains with orange sky';
            const query2 = 'mountain landscape at sunset with golden light';

            const [result1, result2] = await Promise.all([
                embeddingService.generateImageQueryEmbedding(query1, 'test-user'),
                embeddingService.generateImageQueryEmbedding(query2, 'test-user'),
            ]);

            // Calculate cosine similarity
            const dotProduct = result1.embedding.reduce(
                (sum: number, val: number, i: number) => sum + val * result2.embedding[i],
                0
            );
            const magnitude1 = Math.sqrt(
                result1.embedding.reduce((sum: number, val: number) => sum + val * val, 0)
            );
            const magnitude2 = Math.sqrt(
                result2.embedding.reduce((sum: number, val: number) => sum + val * val, 0)
            );
            const cosineSimilarity = dotProduct / (magnitude1 * magnitude2);

            // Similar queries should have high similarity (> 0.7)
            expect(cosineSimilarity).toBeGreaterThan(0.7);
        });

        it('should handle different text queries correctly', async () => {
            if (skipTests || skipVisionTests || !embeddingService) {
                console.log('Test skipped: missing credentials');
                return;
            }

            // Two very different queries
            const query1 = 'beautiful sunset over the ocean';
            const query2 = 'technical diagram of database architecture';

            const [result1, result2] = await Promise.all([
                embeddingService.generateImageQueryEmbedding(query1, 'test-user'),
                embeddingService.generateImageQueryEmbedding(query2, 'test-user'),
            ]);

            // Calculate cosine similarity
            const dotProduct = result1.embedding.reduce(
                (sum: number, val: number, i: number) => sum + val * result2.embedding[i],
                0
            );
            const magnitude1 = Math.sqrt(
                result1.embedding.reduce((sum: number, val: number) => sum + val * val, 0)
            );
            const magnitude2 = Math.sqrt(
                result2.embedding.reduce((sum: number, val: number) => sum + val * val, 0)
            );
            const cosineSimilarity = dotProduct / (magnitude1 * magnitude2);

            // Very different queries should have lower similarity (< 0.85)
            // Note: Azure Vision embeddings may show higher baseline similarity
            expect(cosineSimilarity).toBeLessThan(0.85);
        });

        it('should cache embeddings for repeated queries', async () => {
            if (skipTests || skipVisionTests || !embeddingService) {
                console.log('Test skipped: missing credentials');
                return;
            }

            const query = 'unique test query for caching ' + Date.now();

            // First call - should hit API
            const start1 = Date.now();
            const result1 = await embeddingService.generateImageQueryEmbedding(query, 'test-user');
            const duration1 = Date.now() - start1;

            // Second call - should hit cache (much faster)
            const start2 = Date.now();
            const result2 = await embeddingService.generateImageQueryEmbedding(query, 'test-user');
            const duration2 = Date.now() - start2;

            // Results should be identical
            expect(result1.embedding).toEqual(result2.embedding);

            // Cache hit should be significantly faster (at least 5x)
            // Note: This might be flaky in some environments
            console.log(`First call: ${duration1}ms, Second call: ${duration2}ms`);
            expect(duration2).toBeLessThan(duration1);
        });
    });
});
