import { env } from '@/config/environment';
import { EmbeddingConfig, TextEmbedding, ImageEmbedding } from './types';
// TODO: Fix import - AzureOpenAI not exported in current @azure/openai version
// import { AzureOpenAI } from '@azure/openai';
import Redis from 'ioredis';
import { createRedisClient } from '@/config/redis';
import crypto from 'crypto';

export class EmbeddingService {
  private static instance?: EmbeddingService;
  private config: EmbeddingConfig;
  // @ts-expect-error - AzureOpenAI type not available in @azure/openai@2.0.0, needs upgrade
  private client?: AzureOpenAI;
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

  // @ts-expect-error - Return type AzureOpenAI not available in @azure/openai@2.0.0
  private getClient(): AzureOpenAI {
    if (!this.client) {
      // @ts-expect-error - AzureOpenAI constructor not available, needs SDK upgrade
      this.client = new AzureOpenAI({
        endpoint: this.config.endpoint,
        apiKey: this.config.apiKey,
        apiVersion: '2024-06-01',
        deployment: this.config.deploymentName,
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
   * @returns The text embedding result
   */
  async generateTextEmbedding(text: string, userId: string): Promise<TextEmbedding> {
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
       console.error('Error writing to cache:', error);
    }

    return finalResult;
  }

  /**
   * Generates a vector embedding for an image.
   * Uses Azure Computer Vision "Vectorize Image" API.
   * @param imageBuffer The image binary data
   * @param userId The ID of the user requesting the embedding
   */
  async generateImageEmbedding(imageBuffer: Buffer, userId: string): Promise<ImageEmbedding> {
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
      
      // Response format: { "vector": [...], "modelVersion": "..." }
      return {
          embedding: data.vector,
          model: data.modelVersion,
          imageSize: imageBuffer.length,
          userId,
          createdAt: new Date()
      };
  }

}
