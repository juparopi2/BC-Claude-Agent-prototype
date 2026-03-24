/**
 * Cohere Embed 4 Embedding Service (PRD-201)
 *
 * Implements IEmbeddingService using the Cohere Embed v4 REST API via
 * Azure AI Foundry serverless endpoint. Produces 1536-dimensional vectors
 * in a unified text+image embedding space, replacing the two-model setup
 * (OpenAI text-embedding-3-small + Azure Computer Vision) when
 * USE_UNIFIED_INDEX=true.
 *
 * Key capabilities:
 * - Text embedding (search_document / search_query input types)
 * - Image embedding (base64 data URI — JPEG/PNG/WebP)
 * - Interleaved text+image content (PRD-203 future)
 * - Batch text embedding with Redis caching and mget for cache reads
 *
 * Cache strategy:
 * - Key pattern: `cohere:{text|image}:{sha256(input)}`
 * - TTL: 3600s (1 hour), raw API response excluded to save memory
 * - Cache misses are non-fatal — logs a warning, falls through to API
 *
 * @module services/search/embeddings/CohereEmbeddingService
 */

import crypto from 'crypto';
import Redis from 'ioredis';
import { env } from '@/infrastructure/config/environment';
import { createChildLogger } from '@/shared/utils/logger';
import { createRedisClient } from '@/infrastructure/redis/redis';
import { getUsageTrackingService } from '@/domains/billing/tracking/UsageTrackingService';
import type { IEmbeddingService, EmbeddingInputType, EmbeddingResult } from './types';

const logger = createChildLogger({ service: 'CohereEmbeddingService' });

/** Cohere v2 Embed API batch limit */
const MAX_BATCH_SIZE = 96;

/** Cache TTL in seconds (1 hour) */
const CACHE_TTL_SECONDS = 3600;

// ---------------------------------------------------------------------------
// Internal API response types
// ---------------------------------------------------------------------------

interface CohereEmbedResponse {
  id: string;
  embeddings: {
    float: number[][];
  };
  texts?: string[];
  meta?: {
    api_version?: { version: string };
    billed_units?: { input_tokens?: number };
  };
}

// ---------------------------------------------------------------------------
// Cacheable shape (raw response excluded to save memory)
// ---------------------------------------------------------------------------

interface CachedEmbeddingResult {
  embedding: number[];
  model: string;
  inputTokens: number;
}

// ---------------------------------------------------------------------------
// Service implementation
// ---------------------------------------------------------------------------

export class CohereEmbeddingService implements IEmbeddingService {
  readonly dimensions = 1536;
  readonly modelName = 'Cohere-embed-v4';

  private readonly endpoint: string;
  private readonly apiKey: string;
  private cache?: Redis;

  constructor() {
    if (!env.COHERE_ENDPOINT) {
      throw new Error('COHERE_ENDPOINT not configured — required when USE_UNIFIED_INDEX=true');
    }
    if (!env.COHERE_API_KEY) {
      throw new Error('COHERE_API_KEY not configured — required when USE_UNIFIED_INDEX=true');
    }
    this.endpoint = env.COHERE_ENDPOINT;
    this.apiKey = env.COHERE_API_KEY;
  }

  // -------------------------------------------------------------------------
  // IEmbeddingService: embedText
  // -------------------------------------------------------------------------

  async embedText(text: string, inputType: EmbeddingInputType): Promise<EmbeddingResult> {
    if (!text || text.trim().length === 0) {
      throw new Error('Text cannot be empty');
    }

    const cacheKey = this.getCacheKey('text', text);
    const cached = await this.tryReadCache(cacheKey);
    if (cached) {
      return cached;
    }

    const startTime = Date.now();
    const response = await this.callCohereApi({
      texts: [text],
      input_type: inputType,
      embedding_types: ['float'],
      truncate: 'END',
    });
    const durationMs = Date.now() - startTime;

    const embedding = response.embeddings.float[0];
    if (!embedding) {
      throw new Error('Cohere API returned no embedding for text input');
    }

    const inputTokens = response.meta?.billed_units?.input_tokens ?? 0;
    const result: EmbeddingResult = { embedding, model: this.modelName, inputTokens };

    await this.tryWriteCache(cacheKey, result);

    logger.debug({ durationMs, inputType, textLength: text.length }, 'embedText completed');

    getUsageTrackingService()
      .trackEmbedding('system', 'direct', inputTokens, 'text', { model: this.modelName })
      .catch((err: unknown) => {
        logger.warn(
          { error: err instanceof Error ? { message: err.message, name: err.name } : { value: String(err) } },
          'Failed to track text embedding usage'
        );
      });

    return result;
  }

  // -------------------------------------------------------------------------
  // IEmbeddingService: embedImage
  // -------------------------------------------------------------------------

  async embedImage(imageBase64: string, inputType: EmbeddingInputType): Promise<EmbeddingResult> {
    if (!imageBase64 || imageBase64.trim().length === 0) {
      throw new Error('Image data cannot be empty');
    }

    // Ensure data URI prefix — Cohere requires it
    const imageWithPrefix = imageBase64.startsWith('data:image/')
      ? imageBase64
      : `data:image/jpeg;base64,${imageBase64}`;

    const cacheKey = this.getCacheKey('image', imageBase64);
    const cached = await this.tryReadCache(cacheKey);
    if (cached) {
      return cached;
    }

    const startTime = Date.now();
    const response = await this.callCohereApi({
      images: [imageWithPrefix],
      input_type: inputType,
      embedding_types: ['float'],
      truncate: 'END',
    });
    const durationMs = Date.now() - startTime;

    const embedding = response.embeddings.float[0];
    if (!embedding) {
      throw new Error('Cohere API returned no embedding for image input');
    }

    const inputTokens = response.meta?.billed_units?.input_tokens ?? 0;
    const result: EmbeddingResult = { embedding, model: this.modelName, inputTokens };

    await this.tryWriteCache(cacheKey, result);

    logger.debug({ durationMs, inputType }, 'embedImage completed');

    getUsageTrackingService()
      .trackEmbedding('system', 'direct', inputTokens, 'image', { model: this.modelName })
      .catch((err: unknown) => {
        logger.warn(
          { error: err instanceof Error ? { message: err.message, name: err.name } : { value: String(err) } },
          'Failed to track image embedding usage'
        );
      });

    return result;
  }

  // -------------------------------------------------------------------------
  // IEmbeddingService: embedInterleaved
  // -------------------------------------------------------------------------

  async embedInterleaved(
    content: Array<{ type: 'text'; text: string } | { type: 'image_base64'; data: string }>,
    inputType: EmbeddingInputType,
  ): Promise<EmbeddingResult> {
    if (!content || content.length === 0) {
      throw new Error('Interleaved content cannot be empty');
    }

    // Build Cohere v2 interleaved inputs array
    const inputs = content.map((item) => {
      if (item.type === 'text') {
        return { text: item.text };
      }
      // Ensure data URI prefix for image items
      const imageData = item.data.startsWith('data:image/')
        ? item.data
        : `data:image/jpeg;base64,${item.data}`;
      return { image: imageData };
    });

    const startTime = Date.now();
    const response = await this.callCohereApi({
      inputs,
      input_type: inputType,
      embedding_types: ['float'],
    });
    const durationMs = Date.now() - startTime;

    const embedding = response.embeddings.float[0];
    if (!embedding) {
      throw new Error('Cohere API returned no embedding for interleaved input');
    }

    const inputTokens = response.meta?.billed_units?.input_tokens ?? 0;
    const result: EmbeddingResult = { embedding, model: this.modelName, inputTokens };

    logger.debug({ durationMs, inputType, itemCount: content.length }, 'embedInterleaved completed');

    getUsageTrackingService()
      .trackEmbedding('system', 'direct', inputTokens, 'text', { model: this.modelName, interleaved: true })
      .catch((err: unknown) => {
        logger.warn(
          { error: err instanceof Error ? { message: err.message, name: err.name } : { value: String(err) } },
          'Failed to track interleaved embedding usage'
        );
      });

    return result;
  }

  // -------------------------------------------------------------------------
  // IEmbeddingService: embedTextBatch
  // -------------------------------------------------------------------------

  async embedTextBatch(texts: string[], inputType: EmbeddingInputType): Promise<EmbeddingResult[]> {
    if (!texts || texts.length === 0) {
      return [];
    }

    const results: (EmbeddingResult | null)[] = new Array(texts.length).fill(null);
    const cacheKeys = texts.map((t) => this.getCacheKey('text', t));

    // Batch cache read via mget
    try {
      const cache = this.getCache();
      const cachedValues = await cache.mget(...cacheKeys);
      cachedValues.forEach((value, index) => {
        if (value) {
          try {
            const parsed = JSON.parse(value) as CachedEmbeddingResult;
            results[index] = parsed;
          } catch {
            // Corrupted cache entry — skip, will re-embed
          }
        }
      });
    } catch (err: unknown) {
      logger.warn(
        { error: err instanceof Error ? { message: err.message, name: err.name } : { value: String(err) } },
        'Batch cache read failed — continuing without cache'
      );
    }

    // Identify which texts still need embedding
    const missingIndices = results
      .map((val, i) => (val === null ? i : -1))
      .filter((i) => i !== -1);

    if (missingIndices.length === 0) {
      return results as EmbeddingResult[];
    }

    // Chunk missing texts into batches of MAX_BATCH_SIZE
    const textsToEmbed = missingIndices.map((i) => texts[i] as string);
    let totalInputTokens = 0;

    for (let offset = 0; offset < textsToEmbed.length; offset += MAX_BATCH_SIZE) {
      const batchTexts = textsToEmbed.slice(offset, offset + MAX_BATCH_SIZE);
      const batchIndices = missingIndices.slice(offset, offset + MAX_BATCH_SIZE);

      const response = await this.callCohereApi({
        texts: batchTexts,
        input_type: inputType,
        embedding_types: ['float'],
        truncate: 'END',
      });

      const batchTokens = response.meta?.billed_units?.input_tokens ?? 0;
      totalInputTokens += batchTokens;

      // Distribute token cost evenly across the batch for per-item tracking
      const tokensPerItem = batchTexts.length > 0 ? Math.ceil(batchTokens / batchTexts.length) : 0;

      // Write results and update cache via pipeline
      try {
        const cache = this.getCache();
        const pipeline = cache.pipeline();

        response.embeddings.float.forEach((embedding, i) => {
          const originalIndex = batchIndices[i];
          if (originalIndex === undefined) return;

          const result: EmbeddingResult = {
            embedding,
            model: this.modelName,
            inputTokens: tokensPerItem,
          };
          results[originalIndex] = result;

          const key = cacheKeys[originalIndex];
          if (!key) return;

          const cacheable: CachedEmbeddingResult = {
            embedding,
            model: this.modelName,
            inputTokens: tokensPerItem,
          };
          pipeline.set(key, JSON.stringify(cacheable), 'EX', CACHE_TTL_SECONDS);
        });

        await pipeline.exec();
      } catch (err: unknown) {
        logger.warn(
          { error: err instanceof Error ? { message: err.message, name: err.name } : { value: String(err) } },
          'Batch cache write failed — results are still returned'
        );
        // Results already populated above — cache failure is non-fatal
      }
    }

    // Fire-and-forget usage tracking for the full batch
    getUsageTrackingService()
      .trackEmbedding('system', 'direct', totalInputTokens, 'text', {
        model: this.modelName,
        batch_size: missingIndices.length,
        cached_count: texts.length - missingIndices.length,
      })
      .catch((err: unknown) => {
        logger.warn(
          { error: err instanceof Error ? { message: err.message, name: err.name } : { value: String(err) } },
          'Failed to track batch embedding usage'
        );
      });

    return results as EmbeddingResult[];
  }

  // -------------------------------------------------------------------------
  // IEmbeddingService: embedQuery
  // -------------------------------------------------------------------------

  async embedQuery(text: string): Promise<EmbeddingResult> {
    return this.embedText(text, 'search_query');
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private getCache(): Redis {
    if (!this.cache) {
      // PRODUCTION profile enables offline queue for transient connection handling
      this.cache = createRedisClient('PRODUCTION');
    }
    return this.cache;
  }

  private getCacheKey(type: 'text' | 'image', input: string): string {
    const hash = crypto.createHash('sha256').update(input).digest('hex');
    return `cohere:${type}:${hash}`;
  }

  private async tryReadCache(key: string): Promise<EmbeddingResult | null> {
    try {
      const cache = this.getCache();
      const value = await cache.get(key);
      if (!value) return null;
      return JSON.parse(value) as CachedEmbeddingResult;
    } catch (err: unknown) {
      logger.warn(
        { error: err instanceof Error ? { message: err.message, name: err.name } : { value: String(err) }, key },
        'Cache read failed — continuing to API'
      );
      return null;
    }
  }

  private async tryWriteCache(key: string, result: EmbeddingResult): Promise<void> {
    try {
      const cache = this.getCache();
      const cacheable: CachedEmbeddingResult = {
        embedding: result.embedding,
        model: result.model,
        inputTokens: result.inputTokens,
      };
      await cache.set(key, JSON.stringify(cacheable), 'EX', CACHE_TTL_SECONDS);
    } catch (err: unknown) {
      logger.warn(
        { error: err instanceof Error ? { message: err.message, name: err.name } : { value: String(err) }, key },
        'Cache write failed — result returned without caching'
      );
    }
  }

  /**
   * Execute a POST request to the Cohere v2 Embed endpoint.
   * Handles HTTP error mapping (rate limits get a descriptive message)
   * and logs duration for benchmarking.
   */
  private async callCohereApi(body: Record<string, unknown>): Promise<CohereEmbedResponse> {
    const startTime = Date.now();

    let response: Response;
    try {
      response = await fetch(`${this.endpoint}/v2/embed`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
    } catch (err: unknown) {
      const errorInfo = err instanceof Error
        ? { message: err.message, name: err.name, stack: err.stack }
        : { value: String(err) };
      logger.error(
        { error: errorInfo, endpoint: this.endpoint },
        'Cohere API network error — fetch failed'
      );
      throw new Error(
        `Cohere API network error (endpoint: ${this.endpoint}): ${err instanceof Error ? err.message : String(err)}`
      );
    }

    const durationMs = Date.now() - startTime;

    if (!response.ok) {
      const errorText = await response.text().catch(() => '(could not read response body)');
      const isRateLimit = response.status === 429;
      const message = isRateLimit
        ? `Cohere rate limit exceeded. Retry after cooling period. Status: ${response.status}`
        : `Cohere API error: ${response.status} ${response.statusText} - ${errorText}`;

      logger.error(
        { status: response.status, durationMs, endpoint: this.endpoint },
        message
      );
      throw new Error(message);
    }

    const data = (await response.json()) as CohereEmbedResponse;
    logger.debug(
      { durationMs, inputCount: data.embeddings?.float?.length ?? 0 },
      'Cohere API call completed'
    );
    return data;
  }
}
