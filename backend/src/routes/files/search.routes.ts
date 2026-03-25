/**
 * Image Search Routes
 *
 * Handles semantic image search endpoints.
 *
 * @module routes/files/search.routes
 */

import { Router, Request, Response } from 'express';
import { ZodError } from 'zod';
import { authenticateMicrosoft } from '@/domains/auth/middleware/auth-oauth';
import { sendError } from '@/shared/utils/error-response';
import { ErrorCode } from '@/shared/constants/errors';
import { createChildLogger } from '@/shared/utils/logger';
import { CohereEmbeddingService } from '@/services/search/embeddings/CohereEmbeddingService';
import { VectorSearchService } from '@/services/search/VectorSearchService';
import { getUserId } from './helpers';
import { imageSearchSchema } from './schemas/file.schemas';

const logger = createChildLogger({ service: 'FileSearchRoutes' });
const router = Router();

/**
 * GET /api/files/search/images
 * Search images by semantic text query
 *
 * Uses Cohere Embed v4 to generate a query embedding in the unified 1536d vector space for image similarity search,
 * then searches for semantically similar images in Azure AI Search.
 *
 * Query params:
 * - q: Search query text (required, max 1000 chars)
 * - top: Max results to return (default 10, max 50)
 * - minScore: Minimum similarity score 0-1 (default 0.5)
 */
router.get('/search/images', authenticateMicrosoft, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getUserId(req);

    // Validate query params
    const validation = imageSearchSchema.safeParse(req.query);
    if (!validation.success) {
      sendError(res, ErrorCode.VALIDATION_ERROR, validation.error.errors[0]?.message || 'Invalid query parameters');
      return;
    }

    const { q, top, minScore } = validation.data;

    logger.info({ userId, queryLength: q.length, top, minScore }, 'Searching images');

    // Generate image query embedding (1536d Cohere Embed v4, unified vector space)
    const cohereService = new CohereEmbeddingService();
    const embedding = await cohereService.embedQuery(q);

    // Search for similar images
    const vectorSearchService = VectorSearchService.getInstance();
    const results = await vectorSearchService.searchImages({
      embedding: embedding.embedding,
      userId,
      top,
      minScore,
    });

    logger.info({ userId, query: q, resultCount: results.length }, 'Image search completed');

    res.json({
      results,
      query: q,
      top,
      minScore,
    });
  } catch (error) {
    logger.error({
      error: error instanceof Error ? error.message : String(error),
      userId: req.userId,
    }, 'Image search failed');

    if (error instanceof ZodError) {
      sendError(res, ErrorCode.VALIDATION_ERROR, error.errors[0]?.message || 'Validation failed');
      return;
    }

    if (error instanceof Error && error.message === 'User not authenticated') {
      sendError(res, ErrorCode.UNAUTHORIZED, 'User not authenticated');
      return;
    }

    if (error instanceof Error && error.message.includes('Azure Vision not configured')) {
      sendError(res, ErrorCode.INTERNAL_ERROR, 'Image search not available');
      return;
    }

    sendError(res, ErrorCode.INTERNAL_ERROR, 'Failed to search images');
  }
});

export default router;
