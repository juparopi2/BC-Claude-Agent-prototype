import { describe, it, expect, beforeAll } from 'vitest';
import { EmbeddingService } from '../../../services/embeddings/EmbeddingService';
import 'dotenv/config';

// Only run if Azure OpenAI credentials are present
const runIntegrationTests = 
    process.env.AZURE_OPENAI_KEY && 
    process.env.AZURE_OPENAI_ENDPOINT && 
    process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT;

describe.skipIf(!runIntegrationTests)('EmbeddingService Integration', () => {
    const embeddingService = EmbeddingService.getInstance();

    it('should generate real embeddings from Azure OpenAI', async () => {
        const text = 'This is a test sentence for embedding generation.';
        const result = await embeddingService.generateTextEmbedding(text, 'test-user');

        expect(result).toBeDefined();
        // Ada-002 generates 1536-dimensional embeddings
        expect(result.embedding.length).toBe(1536);
        // Check that it's not all zeros
        expect(result.embedding.some((val: number) => val !== 0)).toBe(true);
    });

    it('should batch generate embeddings', async () => {
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
});
