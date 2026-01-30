import { env } from '@/infrastructure/config/environment';
import { EmbeddingConfig, TextEmbedding, ImageEmbedding } from './types';
import { OpenAI } from 'openai';
import Redis from 'ioredis';
import { createRedisClient } from '@/infrastructure/redis/redis';
import crypto from 'crypto';
import { getUsageTrackingService } from '@/domains/billing/tracking/UsageTrackingService';
import { createChildLogger } from '@/shared/utils/logger';

const logger = createChildLogger({ service: 'EmbeddingService' });

/**
 * Options for embedding generation methods
 */
export interface EmbeddingOptions {
  /**
   * Skip usage tracking for this operation.
   * Use when tracking will be done elsewhere with correct IDs
   * (e.g., in FileProcessingService after persistence).
   */
  skipTracking?: boolean;
}

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
      // Use PRODUCTION profile for reliability - enables offline queue
      // to handle transient connection issues gracefully
      this.cache = createRedisClient('PRODUCTION');
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
      logger.warn({ error: error instanceof Error ? error.message : String(error) }, 'Error reading from embedding cache');
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

    // Store in cache (TTL 1 hour = 3600 seconds)
    // We exclude 'raw' from cache to save memory (~95% reduction per entry)
    // Embeddings are deterministic so they can be regenerated if needed
    try {
      const cacheableResult = {
        embedding: finalResult.embedding,
        model: finalResult.model,
        tokenCount: finalResult.tokenCount,
        userId: finalResult.userId,
        createdAt: finalResult.createdAt,
      };
      await cache.set(cacheKey, JSON.stringify(cacheableResult), 'EX', 3600);
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
   * @param options Optional settings (e.g., skipTracking)
   */
  async generateImageEmbedding(
    imageBuffer: Buffer,
    userId: string,
    fileId = 'direct',
    options?: EmbeddingOptions
  ): Promise<ImageEmbedding> {
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

      // Track usage for billing (fire-and-forget) - skip if requested
      // Tracking may be done elsewhere with correct IDs (e.g., FileProcessingService)
      if (!options?.skipTracking) {
        this.trackImageEmbeddingUsage(userId, fileId, imageBuffer.length).catch((err) => {
          logger.warn({ err, userId, fileId }, 'Failed to track image embedding usage');
        });
      }

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
   * Generates a 1024d embedding for a text query using Azure Vision VectorizeText API.
   *
   * This embedding is in the SAME vector space as image embeddings (VectorizeImage),
   * enabling text-to-image semantic search. For example, searching "sunset over mountains"
   * will find images semantically related to sunsets and mountains.
   *
   * @param text The text query to embed (max ~77 tokens per Azure Vision docs)
   * @param userId The ID of the user requesting the embedding
   * @param fileId Optional file ID for tracking (defaults to 'direct')
   * @returns ImageEmbedding with 1024 dimensions
   */
  async generateImageQueryEmbedding(text: string, userId: string, fileId = 'direct'): Promise<ImageEmbedding> {
    if (!this.config.visionEndpoint || !this.config.visionKey) {
      throw new Error('Azure Vision not configured');
    }

    if (!text || text.trim().length === 0) {
      throw new Error('Text query cannot be empty');
    }

    // Check cache first (different prefix for image query embeddings)
    const cacheKey = `img-query:${this.getCacheKey(text)}`;
    const cache = this.getCache();

    try {
      const cached = await cache.get(cacheKey);
      if (cached) {
        const result = JSON.parse(cached) as ImageEmbedding;
        result.createdAt = new Date(result.createdAt);
        logger.debug({ userId, textLength: text.length }, 'Image query embedding cache hit');
        return result;
      }
    } catch (error) {
      logger.warn({ error }, 'Error reading image query embedding from cache');
    }

    // API Endpoint: VectorizeText (same embedding space as VectorizeImage)
    // https://<endpoint>/computervision/retrieval:vectorizeText?api-version=2024-02-01&model-version=2023-04-15
    const url = `${this.config.visionEndpoint}/computervision/retrieval:vectorizeText?api-version=2024-02-01&model-version=2023-04-15`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Ocp-Apim-Subscription-Key': this.config.visionKey
      },
      body: JSON.stringify({ text })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Vision VectorizeText API Error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const data = await response.json() as { vector: number[]; modelVersion: string };

    const result: ImageEmbedding = {
      embedding: data.vector,
      model: `vectorize-text-${data.modelVersion}`,
      imageSize: 0, // Not applicable for text queries
      userId,
      createdAt: new Date()
    };

    // Cache the result (TTL 1 hour to limit memory usage)
    try {
      await cache.set(cacheKey, JSON.stringify(result), 'EX', 3600);
    } catch (error) {
      logger.warn({ error }, 'Error caching image query embedding');
    }

    // Track usage for billing (fire-and-forget)
    // For text queries to image space, we track as image type with text length
    this.trackImageQueryEmbeddingUsage(userId, fileId, text.length).catch((err) => {
      logger.warn({ err, userId, fileId }, 'Failed to track image query embedding usage');
    });

    logger.debug(
      { userId, textLength: text.length, dimensions: result.embedding.length },
      'Generated image query embedding'
    );

    return result;
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
      logger.warn({ error: error instanceof Error ? error.message : String(error) }, 'Error reading from embedding cache (batch)');
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

        // Cache the new result (exclude 'raw' to save memory, TTL 1 hour)
        const cacheableResult = {
          embedding: embeddingResult.embedding,
          model: embeddingResult.model,
          tokenCount: embeddingResult.tokenCount,
          userId: embeddingResult.userId,
          createdAt: embeddingResult.createdAt,
        };
        pipeline.set(key, JSON.stringify(cacheableResult), 'EX', 3600);
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

  /**
   * Track image query embedding usage for billing (helper method)
   *
   * For text-to-image search queries using VectorizeText API.
   *
   * @param userId User ID for usage attribution
   * @param fileId File ID for tracking
   * @param textLength Length of the text query
   */
  private async trackImageQueryEmbeddingUsage(
    userId: string,
    fileId: string,
    textLength: number
  ): Promise<void> {
    const usageTrackingService = getUsageTrackingService();
    // Track as 'image_query' type, count=1 per query
    await usageTrackingService.trackEmbedding(userId, fileId, 1, 'image', {
      query_type: 'image_query',
      text_length: textLength,
    });

    logger.debug(
      { userId, fileId, textLength },
      'Image query embedding usage tracked'
    );
  }

  /**
   * Generates a textual caption/description for an image using Azure Vision Image Analysis API.
   *
   * This is used for D26 (Multimodal RAG with Reranker) to improve search relevance
   * by storing semantic descriptions of images alongside their vector embeddings.
   *
   * @param imageBuffer The image binary data (JPEG, PNG, GIF, or WebP)
   * @param userId The ID of the user (for tracking)
   * @param fileId Optional file ID for tracking (defaults to 'direct')
   * @param options Optional settings (e.g., skipTracking)
   * @returns The generated caption text, or null if captioning fails gracefully
   */
  async generateImageCaption(
    imageBuffer: Buffer,
    userId: string,
    fileId = 'direct',
    options?: EmbeddingOptions
  ): Promise<ImageCaptionResult> {
    if (!this.config.visionEndpoint || !this.config.visionKey) {
      throw new Error('Azure Vision not configured');
    }

    if (!imageBuffer || imageBuffer.length === 0) {
      throw new Error('Image buffer cannot be empty');
    }

    // Azure Vision Image Analysis API
    // https://<endpoint>/computervision/imageanalysis:analyze?api-version=2024-02-01&features=caption
    const url = `${this.config.visionEndpoint}/computervision/imageanalysis:analyze?api-version=2024-02-01&features=caption`;

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
      logger.error(
        { status: response.status, statusText: response.statusText, error: errorText, userId, fileId },
        'Azure Vision Image Analysis API error'
      );
      throw new Error(`Vision Image Analysis API Error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const data = await response.json() as ImageAnalysisResponse;

    // Extract caption from response
    const caption = data.captionResult?.text || '';
    const confidence = data.captionResult?.confidence || 0;

    // Track usage for billing (fire-and-forget) - skip if requested
    // Tracking may be done elsewhere with correct IDs (e.g., FileProcessingService)
    if (!options?.skipTracking) {
      this.trackImageCaptionUsage(userId, fileId, imageBuffer.length).catch((err) => {
        logger.warn({ err, userId, fileId }, 'Failed to track image caption usage');
      });
    }

    logger.debug(
      { userId, fileId, captionLength: caption.length, confidence },
      'Generated image caption'
    );

    return {
      caption,
      confidence,
      modelVersion: data.modelVersion || 'unknown'
    };
  }

  /**
   * Track image caption usage for billing (helper method)
   *
   * @param userId User ID for usage attribution
   * @param fileId File ID for tracking
   * @param imageSize Size of the image in bytes
   */
  private async trackImageCaptionUsage(
    userId: string,
    fileId: string,
    imageSize: number
  ): Promise<void> {
    const usageTrackingService = getUsageTrackingService();
    // Track as 'image_caption' type, count=1 per image
    await usageTrackingService.trackEmbedding(userId, fileId, 1, 'image', {
      operation: 'caption',
      image_size: imageSize,
    });

    logger.debug(
      { userId, fileId, imageSize },
      'Image caption usage tracked'
    );
  }
}

/**
 * Response type from Azure Vision Image Analysis API
 */
interface ImageAnalysisResponse {
  captionResult?: {
    text: string;
    confidence: number;
  };
  modelVersion?: string;
  metadata?: {
    width: number;
    height: number;
  };
}

/**
 * Result from image caption generation
 */
export interface ImageCaptionResult {
  caption: string;
  confidence: number;
  modelVersion: string;
}
