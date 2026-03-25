/**
 * Image Caption Service
 *
 * Generates textual captions/descriptions for images using the Azure Vision
 * Image Analysis API. Extracted from the legacy EmbeddingService so that image
 * captioning can be used independently of the legacy text/image embedding stack.
 *
 * Used by ImageProcessor for D26 (Multimodal RAG with Reranker) to store
 * semantic descriptions of images alongside their vector embeddings, improving
 * BM25/keyword search relevance.
 *
 * @module services/files/processors/ImageCaptionService
 */

import { env } from '@/infrastructure/config/environment';
import { getUsageTrackingService } from '@/domains/billing/tracking/UsageTrackingService';
import { createChildLogger } from '@/shared/utils/logger';

const logger = createChildLogger({ service: 'ImageCaptionService' });

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

/**
 * Options for caption generation
 */
export interface ImageCaptionOptions {
  /**
   * Skip usage tracking for this operation.
   * Use when tracking will be done elsewhere with correct IDs
   * (e.g., in FileProcessingService after persistence).
   */
  skipTracking?: boolean;
}

export class ImageCaptionService {
  private static instance?: ImageCaptionService;

  private readonly visionEndpoint: string | undefined;
  private readonly visionKey: string | undefined;

  private constructor() {
    this.visionEndpoint = env.AZURE_VISION_ENDPOINT;
    this.visionKey = env.AZURE_VISION_KEY;
  }

  public static getInstance(): ImageCaptionService {
    if (!ImageCaptionService.instance) {
      ImageCaptionService.instance = new ImageCaptionService();
    }
    return ImageCaptionService.instance;
  }

  /**
   * Generates a textual caption/description for an image using the Azure Vision
   * Image Analysis API.
   *
   * This is used for D26 (Multimodal RAG with Reranker) to improve search
   * relevance by storing semantic descriptions of images alongside their vector
   * embeddings.
   *
   * @param imageBuffer The image binary data (JPEG, PNG, GIF, or WebP)
   * @param userId The ID of the user (for usage tracking)
   * @param fileId Optional file ID for tracking (defaults to 'direct')
   * @param options Optional settings (e.g., skipTracking)
   * @returns The generated caption, confidence score, and model version
   */
  async generateCaption(
    imageBuffer: Buffer,
    userId: string,
    fileId = 'direct',
    options?: ImageCaptionOptions
  ): Promise<ImageCaptionResult> {
    if (!this.visionEndpoint || !this.visionKey) {
      throw new Error('Azure Vision not configured');
    }

    if (!imageBuffer || imageBuffer.length === 0) {
      throw new Error('Image buffer cannot be empty');
    }

    // Azure Vision Image Analysis API
    // https://<endpoint>/computervision/imageanalysis:analyze?api-version=2024-02-01&features=caption
    const url = `${this.visionEndpoint}/computervision/imageanalysis:analyze?api-version=2024-02-01&features=caption`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Ocp-Apim-Subscription-Key': this.visionKey,
      },
      body: imageBuffer,
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(
        {
          status: response.status,
          statusText: response.statusText,
          error: errorText,
          userId,
          fileId,
        },
        'Azure Vision Image Analysis API error'
      );
      throw new Error(
        `Vision Image Analysis API Error: ${response.status} ${response.statusText} - ${errorText}`
      );
    }

    const data = (await response.json()) as ImageAnalysisResponse;

    const caption = data.captionResult?.text ?? '';
    const confidence = data.captionResult?.confidence ?? 0;

    // Track usage for billing (fire-and-forget) — skip if requested.
    // Tracking may be done elsewhere with correct IDs (e.g., FileProcessingService).
    if (!options?.skipTracking) {
      this.trackImageCaptionUsage(userId, fileId, imageBuffer.length).catch((err: unknown) => {
        const errorInfo =
          err instanceof Error
            ? { message: err.message, stack: err.stack, name: err.name }
            : { value: String(err) };
        logger.warn({ error: errorInfo, userId, fileId }, 'Failed to track image caption usage');
      });
    }

    logger.debug(
      { userId, fileId, captionLength: caption.length, confidence },
      'Generated image caption'
    );

    return {
      caption,
      confidence,
      modelVersion: data.modelVersion ?? 'unknown',
    };
  }

  /**
   * Track image caption usage for billing.
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
    // Track as 'image' type with operation='caption', count=1 per image
    await usageTrackingService.trackEmbedding(userId, fileId, 1, 'image', {
      operation: 'caption',
      image_size: imageSize,
    });

    logger.debug({ userId, fileId, imageSize }, 'Image caption usage tracked');
  }
}
