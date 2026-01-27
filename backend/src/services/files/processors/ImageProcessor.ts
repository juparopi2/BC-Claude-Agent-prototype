/**
 * Image Document Processor
 *
 * Handles image files (JPEG, PNG, GIF, WebP).
 * Unlike text documents, images don't have extractable text.
 * Instead, this processor:
 * 1. Extracts image metadata (dimensions, format)
 * 2. Generates image embeddings via Azure Computer Vision
 * 3. Returns metadata for database storage
 *
 * @module services/files/processors/ImageProcessor
 */

import { createChildLogger } from '@/shared/utils/logger';
import { EmbeddingService } from '@services/embeddings/EmbeddingService';
import { getUsageTrackingService } from '@/domains/billing/tracking/UsageTrackingService';
import type { DocumentProcessor, ExtractionResult, ExtractionMetadata } from './types';
import { env } from '@/infrastructure/config/environment';
import crypto from 'crypto';

const logger = createChildLogger({ service: 'ImageProcessor' });

/**
 * Image format detection from buffer magic bytes
 */
function detectImageFormat(buffer: Buffer): string {
  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'jpeg';
  }
  // PNG: 89 50 4E 47
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return 'png';
  }
  // GIF: 47 49 46
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
    return 'gif';
  }
  // WebP: 52 49 46 46 ... 57 45 42 50
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return 'webp';
  }
  return 'unknown';
}

/**
 * Extended metadata for image files
 */
export interface ImageMetadata extends ExtractionMetadata {
  /** Detected image format (jpeg, png, gif, webp) */
  imageFormat: string;
  /** Whether image embedding was generated */
  embeddingGenerated: boolean;
  /** Embedding dimensions (if generated) */
  embeddingDimensions?: number;
  /** Azure Vision model version used */
  visionModelVersion?: string;
  /** Whether AI caption was generated (D26 feature) */
  captionGenerated?: boolean;
  /** Confidence score of the generated caption */
  captionConfidence?: number;
}

/**
 * Image Document Processor
 *
 * Processes image files by:
 * 1. Detecting format from magic bytes
 * 2. Generating image embedding via Azure Computer Vision API
 * 3. Returning metadata (no text content for images)
 */
export class ImageProcessor implements DocumentProcessor {
  /**
   * Process image file
   *
   * For images, "text extraction" is not applicable.
   * Instead, we generate image embeddings for semantic search.
   *
   * @param buffer - Image content as Buffer
   * @param fileName - Original filename (for logging)
   * @returns Extraction result with empty text and image metadata
   */
  async extractText(buffer: Buffer, fileName: string): Promise<ExtractionResult> {
    // Validate buffer
    if (!buffer || buffer.length === 0) {
      logger.error({ fileName }, 'Buffer is empty or undefined');
      throw new Error(`Failed to process image ${fileName}: Buffer is empty or undefined`);
    }

    logger.info({ fileName, fileSize: buffer.length }, 'Starting image processing');

    try {
      // Step 1: Detect image format from magic bytes
      const imageFormat = detectImageFormat(buffer);
      logger.debug({ fileName, imageFormat }, 'Image format detected');

      // Step 2: Initialize metadata
      const metadata: ImageMetadata = {
        fileSize: buffer.length,
        ocrUsed: false,
        imageFormat,
        embeddingGenerated: false,
      };

      // Step 3: Check if Azure Vision is configured
      const visionConfigured = !!(env.AZURE_VISION_ENDPOINT && env.AZURE_VISION_KEY);

      if (!visionConfigured) {
        logger.warn(
          { fileName },
          'Azure Vision not configured - skipping image embedding and caption generation'
        );

        return {
          // Images have no extractable text - use placeholder
          text: `[Image: ${fileName}]`,
          metadata,
        };
      }

      // Step 4: Generate image embedding AND caption in parallel (D26 feature)
      logger.info({ fileName }, 'Generating image embedding and caption via Azure Computer Vision');

      // Store embedding and caption for return in result
      let generatedEmbedding: number[] | undefined;
      let generatedCaption: string | undefined;
      let captionConfidence: number | undefined;

      const embeddingService = EmbeddingService.getInstance();

      // Generate embedding and caption in parallel for better performance
      // Use skipTracking: true because tracking will be done in FileProcessingService
      // with correct userId and fileId (UUIDs) after persistence
      const placeholderUserId = crypto.randomUUID().toUpperCase();
      const placeholderFileId = crypto.randomUUID().toUpperCase();

      const [embeddingResult, captionResult] = await Promise.allSettled([
        embeddingService.generateImageEmbedding(
          buffer,
          placeholderUserId,
          placeholderFileId,
          { skipTracking: true } // Tracking done in FileProcessingService with real IDs
        ),
        embeddingService.generateImageCaption(
          buffer,
          placeholderUserId,
          placeholderFileId,
          { skipTracking: true } // Tracking done in FileProcessingService with real IDs
        ),
      ]);

      // Process embedding result
      if (embeddingResult.status === 'fulfilled') {
        generatedEmbedding = embeddingResult.value.embedding;
        metadata.embeddingGenerated = true;
        metadata.embeddingDimensions = embeddingResult.value.embedding.length;
        metadata.visionModelVersion = embeddingResult.value.model;

        logger.info(
          {
            fileName,
            embeddingDimensions: embeddingResult.value.embedding.length,
            modelVersion: embeddingResult.value.model,
          },
          'Image embedding generated successfully'
        );
      } else {
        logger.warn(
          {
            fileName,
            error: embeddingResult.reason instanceof Error
              ? embeddingResult.reason.message
              : String(embeddingResult.reason),
          },
          'Failed to generate image embedding - continuing without it'
        );
      }

      // Process caption result (D26 feature)
      if (captionResult.status === 'fulfilled') {
        generatedCaption = captionResult.value.caption;
        captionConfidence = captionResult.value.confidence;
        metadata.captionGenerated = true;
        metadata.captionConfidence = captionConfidence;

        logger.info(
          {
            fileName,
            captionLength: generatedCaption.length,
            confidence: captionConfidence,
          },
          'Image caption generated successfully'
        );
      } else {
        logger.warn(
          {
            fileName,
            error: captionResult.reason instanceof Error
              ? captionResult.reason.message
              : String(captionResult.reason),
          },
          'Failed to generate image caption - continuing without it'
        );
      }

      // Step 5: Return result with embedding and caption
      // D26: Use caption as text content for better semantic search
      const textContent = generatedCaption
        ? `${generatedCaption} [Image: ${fileName}]`
        : `[Image: ${fileName}] Format: ${imageFormat}, Size: ${buffer.length} bytes`;

      const result: ExtractionResult = {
        text: textContent,
        metadata,
        // Include embedding for persistence in FileProcessingService
        imageEmbedding: generatedEmbedding,
        // Include caption for persistence (D26)
        imageCaption: generatedCaption,
        imageCaptionConfidence: captionConfidence,
      };

      logger.info(
        {
          fileName,
          fileSize: buffer.length,
          imageFormat,
          embeddingGenerated: metadata.embeddingGenerated,
          captionGenerated: metadata.captionGenerated,
        },
        'Image processing completed'
      );

      return result;
    } catch (error) {
      logger.error(
        {
          fileName,
          error: error instanceof Error ? error.message : String(error),
        },
        'Image processing failed'
      );

      throw new Error(
        `Failed to process image ${fileName}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}

/**
 * Track image embedding usage for billing
 *
 * Called by FileProcessingService after successful processing.
 * This is a fire-and-forget operation that doesn't block processing.
 *
 * @param userId - User ID for billing
 * @param fileId - File ID for tracking
 * @param metadata - Image metadata with embedding info
 */
export async function trackImageUsage(
  userId: string,
  fileId: string,
  metadata: ImageMetadata
): Promise<void> {
  if (!metadata.embeddingGenerated) {
    logger.debug({ userId, fileId }, 'No embedding generated - skipping usage tracking');
    return;
  }

  try {
    const usageTrackingService = getUsageTrackingService();
    await usageTrackingService.trackEmbedding(
      userId,
      fileId,
      1, // 1 image
      'image',
      {
        model: metadata.visionModelVersion || 'cv-bcagent-dev',
        dimensions: metadata.embeddingDimensions || 1024,
        imageFormat: metadata.imageFormat,
        fileSize: metadata.fileSize,
      }
    );

    logger.debug({ userId, fileId }, 'Image embedding usage tracked');
  } catch (error) {
    // Fire-and-forget - log but don't throw
    logger.warn(
      {
        error: error instanceof Error ? error.message : String(error),
        userId,
        fileId,
      },
      'Failed to track image embedding usage'
    );
  }
}
