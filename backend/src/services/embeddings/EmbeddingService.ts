import { env } from '@/config/environment';
import { EmbeddingConfig, TextEmbedding, ImageEmbedding } from './types';
import { OpenAI } from 'openai';
import Redis from 'ioredis';
import { createRedisClient } from '@/config/redis';
import crypto from 'crypto';
import { getUsageTrackingService } from '@services/tracking/UsageTrackingService';
import { createChildLogger } from '@/utils/logger';

const logger = createChildLogger({ service: 'EmbeddingService' });

export class EmbeddingService {
  private static instance?: EmbeddingService;
  private config: EmbeddingConfig;
  private client?: OpenAI;
  private cache?: Redis;

  private constructor() {
    // Validate configuration
    if (!env.AZURE_OPENAI_ENDPOINT) {
      throw new Error('AZURE_OPENAI_ENDPOINT not configured');
    }
    if (!env.AZURE_OPENAI_KEY) {
      throw new Error('AZURE_OPENAI_KEY not configured');
    }

    this.config = {
      endpoint: env.AZURE_OPENAI_ENDPOINT,
      apiKey: env.AZURE_OPENAI_KEY,
      deploymentName: env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT || 'text-embedding-3-small',
      visionEndpoint: env.AZURE_VISION_ENDPOINT,
      visionKey: env.AZURE_VISION_KEY
    };
  }

  public static getInstance(): EmbeddingService {
    if (!EmbeddingService.instance) {
      EmbeddingService.instance = new EmbeddingService();
    }
    return EmbeddingService.instance;
  }

  private getClient(): OpenAI {
    if (!this.client) {
      this.client = new OpenAI({
        apiKey: this.config.apiKey,
        baseURL: `${this.config.endpoint}/openai/deployments/${this.config.deploymentName}`,
        defaultQuery: { 'api-version': '2024-06-01' },
        defaultHeaders: { 'api-key': this.config.apiKey },
        maxRetries: 3
      });
    }
    return this.client;
  }

  private getCache(): Redis {
    if (!this.cache) {
      // Use PRODUCTION profile for reliability, or env based if needed. 
      // Using default profile which auto-detects Test/E2E/Prod
      this.cache = createRedisClient();
    }
    return this.cache;
  }

  private getCacheKey(text: string): string {
    const hash = crypto.createHash('sha256').update(text).digest('hex');
    return `embedding:${hash}`;
  }

  /**
   * Generates a vector embedding for a single text string.
   * @param text The text to embed
   * @param userId The ID of the user requesting the embedding
   * @param fileId Optional file ID for tracking (defaults to 'direct')
   * @returns The text embedding result
   */
  async generateTextEmbedding(text: string, userId: string, fileId = 'direct'): Promise<TextEmbedding> {
    if (!text || text.trim().length === 0) {
      throw new Error('Text cannot be empty');
    }

    const cacheKey = this.getCacheKey(text);
    const cache = this.getCache();

    // Try cache first
    try {
      const cached = await cache.get(cacheKey);
      if (cached) {
        const result = JSON.parse(cached) as TextEmbedding;
        // Restore Date object from JSON string
        result.createdAt = new Date(result.createdAt);
        return result;
      }
    } catch (error) {
      // Log error but continue to generate embedding
      console.error('Error reading from cache:', error);
    }

    const client = this.getClient();
    const result = await client.embeddings.create({
      input: [text],
      model: this.config.deploymentName
    });
    
    // Validate we got at least one embedding
    if (!result.data || result.data.length === 0) {
      throw new Error('No embedding returned from service');
    }

    const embeddingData = result.data[0];
    if (!embeddingData) {
      throw new Error('No embedding data in response');
    }

    const finalResult: TextEmbedding = {
      embedding: embeddingData.embedding,
      model: this.config.deploymentName, 
      tokenCount: result.usage.total_tokens,
      userId,
      createdAt: new Date(),
      raw: result
    };

    // Store in cache (TBL 7 days = 604800 seconds)
    try {
      await cache.set(cacheKey, JSON.stringify(finalResult), 'EX', 604800);
    } catch (error) {
       logger.error({ err: error }, 'Error writing to cache');
    }

    // Track usage for billing (fire-and-forget)
    this.trackTextEmbeddingUsage(userId, fileId, finalResult.tokenCount).catch((err) => {
      logger.warn({ err, userId, fileId, tokenCount: finalResult.tokenCount }, 'Failed to track text embedding usage');
    });

    return finalResult;
  }

  /**
   * Generates a vector embedding for an image.
   * Uses Azure Computer Vision "Vectorize Image" API.
   * @param imageBuffer The image binary data
   * @param userId The ID of the user requesting the embedding
   * @param fileId Optional file ID for tracking (defaults to 'direct')
   */
  async generateImageEmbedding(imageBuffer: Buffer, userId: string, fileId = 'direct'): Promise<ImageEmbedding> {
      if (!this.config.visionEndpoint || !this.config.visionKey) {
          throw new Error('Azure Vision not configured');
      }

      // API Endpoint Construction
      // https://<endpoint>/computervision/retrieval:vectorizeImage?api-version=2024-02-01&model-version=2023-04-15
      const url = `${this.config.visionEndpoint}/computervision/retrieval:vectorizeImage?api-version=2024-02-01&model-version=2023-04-15`;

      const response = await fetch(url, {
          method: 'POST',
          headers: {
              'Content-Type': 'application/octet-stream',
              'Ocp-Apim-Subscription-Key': this.config.visionKey
          },
          body: imageBuffer
      });

      if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Vision API Error: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const data = await response.json() as { vector: number[]; modelVersion: string };

      // Track usage for billing (fire-and-forget)
      // For images, we track count=1 as the "tokens" parameter
      this.trackImageEmbeddingUsage(userId, fileId, imageBuffer.length).catch((err) => {
        logger.warn({ err, userId, fileId }, 'Failed to track image embedding usage');
      });

      // Response format: { "vector": [...], "modelVersion": "..." }
      return {
          embedding: data.vector,
          model: data.modelVersion,
          imageSize: imageBuffer.length,
          userId,
          createdAt: new Date()
      };
  }

  /**
   * Generates vector embeddings for a batch of texts.
   * optimized with Redis caching - only generates embeddings for non-cached texts.
   * @param texts Array of texts to embed
   * @param userId User ID for tracking
   * @param fileId Optional file ID for tracking (defaults to 'direct')
   * @returns Array of TextEmbedding objects in the same order as input
   */
  async generateTextEmbeddingsBatch(texts: string[], userId: string, fileId = 'direct'): Promise<TextEmbedding[]> {
    if (!texts || texts.length === 0) {
      return [];
    }

    const cache = this.getCache();
    const results: (TextEmbedding | null)[] = new Array(texts.length).fill(null);
    
    // 1. Check cache for all texts
    const cacheKeys = texts.map(text => this.getCacheKey(text));
    
    try {
      // Use mget to fetch all keys at once
      const cachedValues = await cache.mget(...cacheKeys);
      
      cachedValues.forEach((value, index) => {
        if (value) {
          const embedding = JSON.parse(value) as TextEmbedding;
          embedding.createdAt = new Date(embedding.createdAt);
          results[index] = embedding;
        }
      });
    } catch (error) {
      console.error('Error reading from cache (batch):', error);
      // Continue without cache on error
    }

    // 2. Identify missing indices
    const missingIndices = results
      .map((val, index) => val === null ? index : -1)
      .filter(index => index !== -1);

    if (missingIndices.length === 0) {
      return results as TextEmbedding[];
    }

    // 3. Generate embeddings for missing texts
    const client = this.getClient();
    const textsToEmbed = missingIndices.map(index => texts[index]);

    // OpenAI Limits: 2048 dimensions max, but we use strict chunks.
    // Batch size limit is typically large enough, but we should be safe.
    // If array is huge, we might need to chunk the API calls, but for "chunks" of a file,
    // usually we process 10-100 at a time.
    
    try {
      const apiResult = await client.embeddings.create({
        input: textsToEmbed as string[],
        model: this.config.deploymentName
      });

      // 4. Merge results and update cache
      if (!apiResult.data) {
        throw new Error('No data returned from batch embedding generation');
      }

      const pipeline = cache.pipeline();

      apiResult.data.forEach((item, i) => {
        const originalIndex = missingIndices[i];
        if (originalIndex === undefined) return;
        
        const embeddingResult: TextEmbedding = {
          embedding: item.embedding,
          model: this.config.deploymentName,
          tokenCount: 0, // In batch, sometimes total_tokens is aggregated. We can estimate or use total / count
          userId,
          createdAt: new Date(),
          raw: apiResult // Store full response ref if needed, but might be heavy
        };

        // Distribute token usage approximation if provided globally
        if (apiResult.usage && apiResult.usage.total_tokens) {
           // This is rough approximation for individual tracking, 
           // but accurate enough for aggregate costs if we track the batch call.
           // Ideally we'd tokenize locally to be precise, but for now:
           embeddingResult.tokenCount = Math.ceil(apiResult.usage.total_tokens / apiResult.data.length);
        }

        results[originalIndex] = embeddingResult;

        const key = cacheKeys[originalIndex];
        if (!key) return;

        // Cache the new result
        pipeline.set(key, JSON.stringify(embeddingResult), 'EX', 604800);
      });

      await pipeline.exec();

      // Track usage for billing (fire-and-forget)
      // Only track tokens for newly generated embeddings (not cached)
      if (apiResult.usage?.total_tokens) {
        this.trackTextEmbeddingUsage(userId, fileId, apiResult.usage.total_tokens, {
          batch_size: missingIndices.length,
          cached_count: texts.length - missingIndices.length,
        }).catch((err) => {
          logger.warn({ err, userId, fileId, tokenCount: apiResult.usage?.total_tokens }, 'Failed to track batch embedding usage');
        });
      }

    } catch (error) {
       logger.error({ err: error }, 'Error in batch embedding generation');
       throw error;
    }

    return results as TextEmbedding[];
  }

  /**
   * Track text embedding usage for billing (helper method)
   *
   * @param userId User ID for usage attribution
   * @param fileId File ID for tracking
   * @param tokenCount Number of tokens used
   * @param metadata Optional metadata
   */
  private async trackTextEmbeddingUsage(
    userId: string,
    fileId: string,
    tokenCount: number,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    const usageTrackingService = getUsageTrackingService();
    await usageTrackingService.trackEmbedding(userId, fileId, tokenCount, 'text', {
      model: this.config.deploymentName,
      ...metadata,
    });

    logger.debug(
      { userId, fileId, tokenCount, model: this.config.deploymentName },
      'Text embedding usage tracked'
    );
  }

  /**
   * Track image embedding usage for billing (helper method)
   *
   * @param userId User ID for usage attribution
   * @param fileId File ID for tracking
   * @param imageSize Size of the image in bytes
   */
  private async trackImageEmbeddingUsage(
    userId: string,
    fileId: string,
    imageSize: number
  ): Promise<void> {
    const usageTrackingService = getUsageTrackingService();
    // For images, tokens parameter is the count (1 per image)
    await usageTrackingService.trackEmbedding(userId, fileId, 1, 'image', {
      image_size: imageSize,
    });

    logger.debug(
      { userId, fileId, imageSize },
      'Image embedding usage tracked'
    );
  }
}
