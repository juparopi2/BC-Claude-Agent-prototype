/**
 * ImageCompressor
 *
 * Automatically compresses images that exceed Azure Vision's 20 MB limit.
 * Uses Sharp with quality-preserving settings optimized for AI vision analysis.
 *
 * Strategy:
 * 1. If < 20 MB: return original buffer unchanged
 * 2. If >= 20 MB: compress progressively until under limit
 * 3. Preserve format when possible (JPEG → JPEG, PNG → PNG)
 * 4. Convert problematic formats to JPEG (WebP, large PNGs without alpha)
 *
 * @module services/files/utils/ImageCompressor
 */
import sharp from 'sharp';
import { createChildLogger } from '@/shared/utils/logger';

const logger = createChildLogger({ service: 'ImageCompressor' });

export interface CompressionResult {
  /** Processed buffer (original or compressed) */
  buffer: Buffer;
  /** Whether compression was applied */
  wasCompressed: boolean;
  /** Original buffer size in bytes */
  originalSize: number;
  /** Final buffer size in bytes */
  finalSize: number;
  /** Output format */
  format: 'jpeg' | 'png' | 'webp' | 'gif' | 'unknown';
  /** JPEG quality level used (if applicable) */
  quality?: number;
  /** Final image dimensions */
  dimensions?: { width: number; height: number };
}

/** Azure Vision hard limit (20 MB) */
const AZURE_VISION_MAX_SIZE = 20 * 1024 * 1024;

/** Target size with 1 MB safety buffer */
const TARGET_SIZE = 19 * 1024 * 1024;

/** Quality levels for progressive JPEG compression */
const JPEG_QUALITY_LEVELS = [85, 75, 65, 55, 45];

/** Maximum dimension for very large images */
const MAX_DIMENSION = 4096;

/**
 * Detect image format from buffer magic bytes
 */
function detectFormat(buffer: Buffer): 'jpeg' | 'png' | 'webp' | 'gif' | 'unknown' {
  if (buffer.length < 12) return 'unknown';

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
 * Compress an image if it exceeds Azure Vision's 20 MB limit
 *
 * @param buffer - Original image buffer
 * @param fileName - Filename for logging
 * @returns Compression result with processed buffer
 */
export async function compressImageIfNeeded(
  buffer: Buffer,
  fileName: string
): Promise<CompressionResult> {
  const originalSize = buffer.length;
  const detectedFormat = detectFormat(buffer);

  // If already under limit, return unchanged
  if (originalSize <= AZURE_VISION_MAX_SIZE) {
    logger.debug(
      { fileName, size: originalSize, sizeMB: (originalSize / (1024 * 1024)).toFixed(2) },
      'Image under 20MB, no compression needed'
    );
    return {
      buffer,
      wasCompressed: false,
      originalSize,
      finalSize: originalSize,
      format: detectedFormat,
    };
  }

  logger.info(
    { fileName, originalSize, sizeMB: (originalSize / (1024 * 1024)).toFixed(2) },
    'Image exceeds 20MB, starting compression'
  );

  const image = sharp(buffer);
  const metadata = await image.metadata();

  // Determine output format: JPEG for photos, PNG for graphics with transparency
  const hasAlpha = metadata.hasAlpha === true;
  const outputFormat: 'jpeg' | 'png' = hasAlpha ? 'png' : 'jpeg';

  // Step 1: Resize if dimensions are excessive (> 4096px)
  let pipeline = sharp(buffer);
  let resized = false;

  if (metadata.width && metadata.height) {
    const maxDim = Math.max(metadata.width, metadata.height);
    if (maxDim > MAX_DIMENSION) {
      pipeline = pipeline.resize(MAX_DIMENSION, MAX_DIMENSION, {
        fit: 'inside',
        withoutEnlargement: true,
      });
      resized = true;
      logger.debug(
        { fileName, originalMaxDim: maxDim, newMaxDim: MAX_DIMENSION },
        'Resized oversized image'
      );
    }
  }

  // Step 2: Progressive quality compression
  for (const quality of JPEG_QUALITY_LEVELS) {
    let compressedBuffer: Buffer;

    if (outputFormat === 'jpeg') {
      compressedBuffer = await pipeline
        .jpeg({
          quality,
          mozjpeg: true,
          progressive: true,
        })
        .toBuffer();
    } else {
      // PNG with maximum compression
      compressedBuffer = await pipeline
        .png({
          compressionLevel: 9,
          palette: true,
        })
        .toBuffer();
    }

    const compressedSize = compressedBuffer.length;

    logger.debug(
      {
        fileName,
        quality,
        compressedSize,
        sizeMB: (compressedSize / (1024 * 1024)).toFixed(2),
        format: outputFormat,
      },
      'Compression attempt'
    );

    if (compressedSize <= TARGET_SIZE) {
      const finalMeta = await sharp(compressedBuffer).metadata();
      const reductionPercent = ((1 - compressedSize / originalSize) * 100).toFixed(1);

      logger.info(
        {
          fileName,
          originalSize,
          finalSize: compressedSize,
          reductionPercent,
          quality,
          resized,
          dimensions: { width: finalMeta.width, height: finalMeta.height },
        },
        'Image compressed successfully'
      );

      return {
        buffer: compressedBuffer,
        wasCompressed: true,
        originalSize,
        finalSize: compressedSize,
        format: outputFormat,
        quality,
        dimensions: { width: finalMeta.width!, height: finalMeta.height! },
      };
    }

    // PNG doesn't have quality levels, break after first attempt
    if (outputFormat === 'png') break;
  }

  // Step 3: If still too large, force more aggressive resize
  logger.warn({ fileName }, 'Quality compression insufficient, applying aggressive resize');

  const aggressiveBuffer = await sharp(buffer)
    .resize(2048, 2048, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 60, mozjpeg: true, progressive: true })
    .toBuffer();

  if (aggressiveBuffer.length <= TARGET_SIZE) {
    const finalMeta = await sharp(aggressiveBuffer).metadata();
    const reductionPercent = ((1 - aggressiveBuffer.length / originalSize) * 100).toFixed(1);

    logger.info(
      {
        fileName,
        originalSize,
        finalSize: aggressiveBuffer.length,
        reductionPercent,
        strategy: 'aggressive-resize',
        dimensions: { width: finalMeta.width, height: finalMeta.height },
      },
      'Image compressed with aggressive resize'
    );

    return {
      buffer: aggressiveBuffer,
      wasCompressed: true,
      originalSize,
      finalSize: aggressiveBuffer.length,
      format: 'jpeg',
      quality: 60,
      dimensions: { width: finalMeta.width!, height: finalMeta.height! },
    };
  }

  // Final fallback: even more aggressive compression
  logger.warn({ fileName }, 'Aggressive resize insufficient, applying maximum compression');

  const maxCompressionBuffer = await sharp(buffer)
    .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 40, mozjpeg: true, progressive: true })
    .toBuffer();

  if (maxCompressionBuffer.length <= TARGET_SIZE) {
    const finalMeta = await sharp(maxCompressionBuffer).metadata();
    const reductionPercent = ((1 - maxCompressionBuffer.length / originalSize) * 100).toFixed(1);

    logger.info(
      {
        fileName,
        originalSize,
        finalSize: maxCompressionBuffer.length,
        reductionPercent,
        strategy: 'maximum-compression',
        dimensions: { width: finalMeta.width, height: finalMeta.height },
      },
      'Image compressed with maximum compression'
    );

    return {
      buffer: maxCompressionBuffer,
      wasCompressed: true,
      originalSize,
      finalSize: maxCompressionBuffer.length,
      format: 'jpeg',
      quality: 40,
      dimensions: { width: finalMeta.width!, height: finalMeta.height! },
    };
  }

  // Should not reach here with normal images, but fail gracefully
  throw new Error(
    `Unable to compress image "${fileName}" below 20MB limit. ` +
      `Original size: ${(originalSize / (1024 * 1024)).toFixed(2)}MB. ` +
      `Please use a smaller image.`
  );
}

/**
 * Get compression constants (for testing)
 */
export const COMPRESSION_CONSTANTS = {
  AZURE_VISION_MAX_SIZE,
  TARGET_SIZE,
  MAX_DIMENSION,
  JPEG_QUALITY_LEVELS,
} as const;
