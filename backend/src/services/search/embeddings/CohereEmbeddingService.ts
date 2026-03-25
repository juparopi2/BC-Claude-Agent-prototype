/**
 * Cohere Embed v4 Embedding Service (PRD-201)
 *
 * Implements IEmbeddingService using Cohere Embed v4 for 1536-dimensional vectors
 * in a unified text+image embedding space via Azure AIServices (OpenAI-compatible API).
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
import { COHERE_DEPLOYMENT_NAME, COHERE_MODEL_NAME, COHERE_EMBEDDING_DIMENSIONS } from './models';

const logger = createChildLogger({ service: 'CohereEmbeddingService' });

/** Cohere v2 Embed API batch limit */
const MAX_BATCH_SIZE = 96;

/** Cache TTL in seconds (1 hour) */
const CACHE_TTL_SECONDS = 3600;

// Use COHERE_DEPLOYMENT_NAME from models.ts

/** Azure OpenAI-compatible API version */
const AZURE_API_VERSION = '2024-06-01';

/** Azure AI Foundry Models image embedding API version */
const AZURE_IMAGE_API_VERSION = '2024-05-01-preview';

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

/** Azure OpenAI-compatible embeddings response */
interface AzureEmbedResponse {
  data: Array<{ index: number; embedding: number[] }>;
  model: string;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
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
  readonly dimensions = COHERE_EMBEDDING_DIMENSIONS;
  readonly modelName = COHERE_MODEL_NAME;

  private readonly endpoint: string;
  private readonly apiKey: string;
  private readonly azureImageEndpoint: string;
  private cache?: Redis;

  constructor() {
    if (!env.COHERE_ENDPOINT) {
      throw new Error('COHERE_ENDPOINT not configured');
    }
    if (!env.COHERE_API_KEY) {
      throw new Error('COHERE_API_KEY not configured');
    }
    this.endpoint = env.COHERE_ENDPOINT;
    this.apiKey = env.COHERE_API_KEY;
    this.azureImageEndpoint = env.COHERE_IMAGE_ENDPOINT
      ?? this.endpoint.replace('.cognitiveservices.azure.com', '.services.ai.azure.com');
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
    const response = await this.callCohereApi([text]);
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
    const response = await this.callAzureImageApi([imageWithPrefix], inputType);
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

    const startTime = Date.now();
    // On Azure, the OpenAI-compatible text endpoint does not support image input.
    // Route to the dedicated image endpoint when any image items are present.
    const hasImages = content.some((item) => item.type === 'image_base64');
    let response: CohereEmbedResponse;
    if (hasImages) {
      // Collect all image data URIs from the content for the Azure image endpoint.
      const imageUris = content
        .filter((item): item is { type: 'image_base64'; data: string } => item.type === 'image_base64')
        .map((item) =>
          item.data.startsWith('data:image/') ? item.data : `data:image/jpeg;base64,${item.data}`
        );
      response = await this.callAzureImageApi(imageUris, inputType);
    } else {
      // Text-only interleaved — extract text portions and use the text endpoint
      const textInputs = content
        .map((item) => (item.type === 'text' ? item.text : ''))
        .filter((t) => t.length > 0);
      response = await this.callCohereApi(textInputs);
    }
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

  async embedTextBatch(texts: string[], _inputType: EmbeddingInputType): Promise<EmbeddingResult[]> {
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

      const response = await this.callCohereApi(batchTexts);

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
   * Execute a POST request to the Azure AIServices OpenAI-compatible text embedding endpoint.
   * URL pattern: {endpoint}/openai/deployments/{deploymentName}/embeddings?api-version=2024-06-01
   * Accepts text inputs only — images must go through callAzureImageApi().
   */
  private async callCohereApi(texts: string[]): Promise<CohereEmbedResponse> {
    const startTime = Date.now();

    const baseUrl = this.endpoint.endsWith('/') ? this.endpoint.slice(0, -1) : this.endpoint;
    const url = `${baseUrl}/openai/deployments/${COHERE_DEPLOYMENT_NAME}/embeddings?api-version=${AZURE_API_VERSION}`;
    const headers: Record<string, string> = {
      'api-key': this.apiKey,
      'Content-Type': 'application/json',
    };
    const requestBody = { input: texts, model: COHERE_DEPLOYMENT_NAME };

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
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

    const azureData = (await response.json()) as AzureEmbedResponse;

    // Transform Azure OpenAI-compatible response to internal CohereEmbedResponse format
    const sorted = [...azureData.data].sort((a, b) => a.index - b.index);
    const data: CohereEmbedResponse = {
      id: `azure-${Date.now()}`,
      embeddings: {
        float: sorted.map((d) => d.embedding),
      },
      meta: {
        billed_units: {
          input_tokens: azureData.usage?.prompt_tokens ?? 0,
        },
      },
    };

    logger.debug(
      { durationMs, inputCount: data.embeddings?.float?.length ?? 0 },
      'Cohere API call completed'
    );
    return data;
  }

  /**
   * Execute a POST request to the Azure AI Foundry Models image embedding endpoint.
   * Endpoint: /models/images/embeddings (separate from the OpenAI-compatible text endpoint)
   *
   * Input types are mapped from Cohere conventions to Azure conventions:
   * - search_document → document
   * - search_query    → query
   * - other values    → passed through unchanged
   */
  private async callAzureImageApi(
    images: string[],
    inputType: EmbeddingInputType,
  ): Promise<CohereEmbedResponse> {
    const startTime = Date.now();

    // Map Cohere input_type values to Azure image endpoint conventions
    const inputTypeMap: Record<string, string> = {
      search_document: 'document',
      search_query: 'query',
    };
    const mappedType = inputTypeMap[inputType] ?? inputType;

    const baseUrl = this.azureImageEndpoint.endsWith('/')
      ? this.azureImageEndpoint.slice(0, -1)
      : this.azureImageEndpoint;
    const url = `${baseUrl}/models/images/embeddings?api-version=${AZURE_IMAGE_API_VERSION}`;

    const requestBody = {
      model: COHERE_DEPLOYMENT_NAME,
      input: images.map((img) => ({ image: img })),
      input_type: mappedType,
    };

    const headers: Record<string, string> = {
      'api-key': this.apiKey,
      'Content-Type': 'application/json',
    };

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
      });
    } catch (err: unknown) {
      const errorInfo = err instanceof Error
        ? { message: err.message, name: err.name, stack: err.stack }
        : { value: String(err) };
      logger.error(
        { error: errorInfo, endpoint: this.azureImageEndpoint },
        'Azure image embedding API network error — fetch failed'
      );
      throw new Error(
        `Azure image embedding API network error (endpoint: ${this.azureImageEndpoint}): ${err instanceof Error ? err.message : String(err)}`
      );
    }

    const durationMs = Date.now() - startTime;

    if (!response.ok) {
      const errorText = await response.text().catch(() => '(could not read response body)');
      const isRateLimit = response.status === 429;
      const message = isRateLimit
        ? `Azure image embedding rate limit exceeded. Retry after cooling period. Status: ${response.status}`
        : `Azure image embedding API error: ${response.status} ${response.statusText} - ${errorText}`;

      logger.error(
        { status: response.status, durationMs, endpoint: this.azureImageEndpoint },
        message
      );
      throw new Error(message);
    }

    const azureData = (await response.json()) as AzureEmbedResponse;

    // Transform Azure OpenAI-compatible response to internal CohereEmbedResponse format
    const sorted = [...azureData.data].sort((a, b) => a.index - b.index);
    const data: CohereEmbedResponse = {
      id: `azure-${Date.now()}`,
      embeddings: {
        float: sorted.map((d) => d.embedding),
      },
      meta: {
        billed_units: {
          input_tokens: azureData.usage?.prompt_tokens ?? 0,
        },
      },
    };

    logger.debug(
      { durationMs, inputCount: data.embeddings?.float?.length ?? 0, inputType },
      'Azure image embedding API call completed'
    );

    return data;
  }
}

// Singleton accessor — replaces getUnifiedEmbeddingService() from deleted EmbeddingServiceFactory
let cohereInstance: CohereEmbeddingService | undefined;

export function getCohereEmbeddingService(): CohereEmbeddingService {
  if (!cohereInstance) {
    cohereInstance = new CohereEmbeddingService();
  }
  return cohereInstance;
}

/** Reset singleton for testing */
export function _resetCohereServiceForTesting(): void {
  cohereInstance = undefined;
}
