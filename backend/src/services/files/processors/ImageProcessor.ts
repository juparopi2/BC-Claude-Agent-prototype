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

import { createChildLogger } from '@/utils/logger';
import { EmbeddingService } from '@services/embeddings/EmbeddingService';
import { getUsageTrackingService } from '@services/tracking/UsageTrackingService';
import type { DocumentProcessor, ExtractionResult, ExtractionMetadata } from './types';
import { env } from '@/config/environment';

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
          'Azure Vision not configured - skipping image embedding generation'
        );

        return {
          // Images have no extractable text - use placeholder
          text: `[Image: ${fileName}]`,
          metadata,
        };
      }

      // Step 4: Generate image embedding
      logger.info({ fileName }, 'Generating image embedding via Azure Computer Vision');

      try {
        const embeddingService = EmbeddingService.getInstance();

        // Note: EmbeddingService.generateImageEmbedding expects (userId, fileId, buffer)
        // but we only have fileName here. We'll pass 'image-processor' as placeholder userId/fileId
        // The actual tracking happens in FileProcessingService with real userId/fileId
        const embedding = await embeddingService.generateImageEmbedding(
          buffer,
          'image-processor', // placeholder userId
          fileName // use fileName as placeholder fileId
        );

        metadata.embeddingGenerated = true;
        metadata.embeddingDimensions = embedding.embedding.length;
        metadata.visionModelVersion = embedding.model;

        logger.info(
          {
            fileName,
            embeddingDimensions: embedding.embedding.length,
            modelVersion: embedding.model,
          },
          'Image embedding generated successfully'
        );
      } catch (embeddingError) {
        // Log warning but don't fail processing
        // The image can still be stored, just without semantic search capability
        logger.warn(
          {
            fileName,
            error: embeddingError instanceof Error ? embeddingError.message : String(embeddingError),
          },
          'Failed to generate image embedding - continuing without it'
        );
      }

      // Step 5: Return result
      const result: ExtractionResult = {
        // Images have no extractable text - use descriptive placeholder
        // This helps with basic text search ("find images in folder X")
        text: `[Image: ${fileName}] Format: ${imageFormat}, Size: ${buffer.length} bytes`,
        metadata,
      };

      logger.info(
        {
          fileName,
          fileSize: buffer.length,
          imageFormat,
          embeddingGenerated: metadata.embeddingGenerated,
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
