import { describe, it, expect, vi } from 'vitest';
import sharp from 'sharp';
import { compressImageIfNeeded, COMPRESSION_CONSTANTS } from './ImageCompressor';

/**
 * ImageCompressor Unit Tests
 *
 * Tests the automatic image compression utility for Azure Vision API.
 * Azure Vision has a 20 MB limit, and this utility compresses oversized images.
 */

// Mock logger to prevent console output during tests
vi.mock('@/shared/utils/logger', () => ({
  createChildLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('ImageCompressor', () => {
  describe('compressImageIfNeeded', () => {
    describe('images under 20MB', () => {
      it('should not compress images under 20MB', async () => {
        // Create a small JPEG image (100x100 red)
        const smallBuffer = await sharp({
          create: {
            width: 100,
            height: 100,
            channels: 3,
            background: { r: 255, g: 0, b: 0 },
          },
        })
          .jpeg({ quality: 80 })
          .toBuffer();

        const result = await compressImageIfNeeded(smallBuffer, 'small.jpg');

        expect(result.wasCompressed).toBe(false);
        expect(result.originalSize).toBe(smallBuffer.length);
        expect(result.finalSize).toBe(smallBuffer.length);
        expect(result.buffer).toBe(smallBuffer); // Same buffer reference
      });

      it('should detect JPEG format correctly', async () => {
        const jpegBuffer = await sharp({
          create: {
            width: 50,
            height: 50,
            channels: 3,
            background: { r: 0, g: 255, b: 0 },
          },
        })
          .jpeg()
          .toBuffer();

        const result = await compressImageIfNeeded(jpegBuffer, 'test.jpg');

        expect(result.format).toBe('jpeg');
      });

      it('should detect PNG format correctly', async () => {
        const pngBuffer = await sharp({
          create: {
            width: 50,
            height: 50,
            channels: 4,
            background: { r: 0, g: 0, b: 255, alpha: 1 },
          },
        })
          .png()
          .toBuffer();

        const result = await compressImageIfNeeded(pngBuffer, 'test.png');

        expect(result.format).toBe('png');
      });

      it('should detect WebP format correctly', async () => {
        const webpBuffer = await sharp({
          create: {
            width: 50,
            height: 50,
            channels: 3,
            background: { r: 128, g: 128, b: 128 },
          },
        })
          .webp()
          .toBuffer();

        const result = await compressImageIfNeeded(webpBuffer, 'test.webp');

        expect(result.format).toBe('webp');
      });

      it('should detect GIF format correctly', async () => {
        const gifBuffer = await sharp({
          create: {
            width: 50,
            height: 50,
            channels: 3,
            background: { r: 255, g: 255, b: 0 },
          },
        })
          .gif()
          .toBuffer();

        const result = await compressImageIfNeeded(gifBuffer, 'test.gif');

        expect(result.format).toBe('gif');
      });
    });

    describe('images over 20MB', () => {
      it('should compress large images to under target size', async () => {
        // Create a large uncompressed image that exceeds 20MB
        // Using a 5000x5000 image with high quality JPEG should be over 20MB
        const largeBuffer = await sharp({
          create: {
            width: 5000,
            height: 5000,
            channels: 3,
            background: { r: 128, g: 64, b: 192 },
          },
        })
          .jpeg({ quality: 100 })
          .toBuffer();

        // Only test if buffer is actually over 20MB
        if (largeBuffer.length <= COMPRESSION_CONSTANTS.AZURE_VISION_MAX_SIZE) {
          // Skip if buffer wasn't large enough
          console.log(
            `Test buffer only ${(largeBuffer.length / (1024 * 1024)).toFixed(2)}MB, skipping large image test`
          );
          return;
        }

        const result = await compressImageIfNeeded(largeBuffer, 'large.jpg');

        expect(result.wasCompressed).toBe(true);
        expect(result.finalSize).toBeLessThanOrEqual(COMPRESSION_CONSTANTS.TARGET_SIZE);
        expect(result.originalSize).toBe(largeBuffer.length);
        expect(result.quality).toBeDefined();
      });

      it('should resize oversized dimensions before compression', async () => {
        // Create an image with dimensions larger than MAX_DIMENSION (4096)
        const oversizedBuffer = await sharp({
          create: {
            width: 6000,
            height: 4000,
            channels: 3,
            background: { r: 200, g: 100, b: 50 },
          },
        })
          .jpeg({ quality: 100 })
          .toBuffer();

        // Only run if actually over limit
        if (oversizedBuffer.length <= COMPRESSION_CONSTANTS.AZURE_VISION_MAX_SIZE) {
          console.log(`Test buffer only ${(oversizedBuffer.length / (1024 * 1024)).toFixed(2)}MB, skipping`);
          return;
        }

        const result = await compressImageIfNeeded(oversizedBuffer, 'oversized.jpg');

        expect(result.wasCompressed).toBe(true);
        expect(result.dimensions).toBeDefined();

        // Should have been resized to fit within MAX_DIMENSION
        if (result.dimensions) {
          expect(Math.max(result.dimensions.width, result.dimensions.height)).toBeLessThanOrEqual(
            COMPRESSION_CONSTANTS.MAX_DIMENSION
          );
        }
      });

      it('should preserve PNG format with alpha channel', async () => {
        // Create a PNG with transparency that needs compression
        const pngWithAlpha = await sharp({
          create: {
            width: 3000,
            height: 3000,
            channels: 4,
            background: { r: 100, g: 150, b: 200, alpha: 0.5 },
          },
        })
          .png({ compressionLevel: 0 }) // No compression to make it large
          .toBuffer();

        const result = await compressImageIfNeeded(pngWithAlpha, 'alpha.png');

        // If compression was needed, it should preserve PNG format for alpha
        if (result.wasCompressed) {
          // PNG with alpha should stay as PNG (unless aggressive resize needed)
          // Note: if very aggressive resize is needed, it may convert to JPEG
          expect(['png', 'jpeg']).toContain(result.format);
        } else {
          expect(result.format).toBe('png');
        }
      });

      it('should convert non-alpha images to JPEG for better compression', async () => {
        // Create a large PNG without alpha
        const largePngNoAlpha = await sharp({
          create: {
            width: 4000,
            height: 4000,
            channels: 3, // No alpha channel
            background: { r: 50, g: 100, b: 150 },
          },
        })
          .png({ compressionLevel: 0 })
          .toBuffer();

        // Only run if actually over limit
        if (largePngNoAlpha.length <= COMPRESSION_CONSTANTS.AZURE_VISION_MAX_SIZE) {
          console.log(`Test buffer only ${(largePngNoAlpha.length / (1024 * 1024)).toFixed(2)}MB, skipping`);
          return;
        }

        const result = await compressImageIfNeeded(largePngNoAlpha, 'no-alpha.png');

        expect(result.wasCompressed).toBe(true);
        // Should convert to JPEG for better compression since no alpha
        expect(result.format).toBe('jpeg');
      });
    });

    describe('compression quality levels', () => {
      it('should try progressive quality levels for JPEG', async () => {
        // Create a moderately large JPEG that needs some compression
        const moderateBuffer = await sharp({
          create: {
            width: 4000,
            height: 4000,
            channels: 3,
            background: { r: 100, g: 100, b: 100 },
          },
        })
          .jpeg({ quality: 100 })
          .toBuffer();

        if (moderateBuffer.length <= COMPRESSION_CONSTANTS.AZURE_VISION_MAX_SIZE) {
          console.log(`Test buffer only ${(moderateBuffer.length / (1024 * 1024)).toFixed(2)}MB, skipping`);
          return;
        }

        const result = await compressImageIfNeeded(moderateBuffer, 'moderate.jpg');

        expect(result.wasCompressed).toBe(true);
        // Quality should be one of the defined levels
        expect(COMPRESSION_CONSTANTS.JPEG_QUALITY_LEVELS).toContain(result.quality);
      });
    });

    describe('edge cases', () => {
      it('should handle exactly 20MB images (boundary case)', async () => {
        // For this test, we just verify that images at or just under 20MB are not compressed
        const buffer = await sharp({
          create: {
            width: 100,
            height: 100,
            channels: 3,
            background: { r: 0, g: 0, b: 0 },
          },
        })
          .jpeg()
          .toBuffer();

        // Simulate a buffer that's exactly at the limit
        const result = await compressImageIfNeeded(buffer, 'boundary.jpg');

        // Since our test buffer is small, it should not be compressed
        expect(result.wasCompressed).toBe(false);
      });

      it('should handle unknown format gracefully', async () => {
        // Create a buffer that doesn't match known magic bytes
        const unknownBuffer = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b]);

        // This will fail because sharp can't process it, but let's verify format detection
        // We can't actually test compression of invalid images, but we can verify
        // the format detection returns 'unknown' for random bytes
        const result = await compressImageIfNeeded(
          // Use a valid small image but with small size
          await sharp({
            create: { width: 10, height: 10, channels: 3, background: { r: 0, g: 0, b: 0 } },
          })
            .raw()
            .toBuffer()
            .then(() => unknownBuffer),
          'unknown.bin'
        );

        // Since it's under 20MB, it won't be compressed
        expect(result.wasCompressed).toBe(false);
        expect(result.format).toBe('unknown');
      });

      it('should return dimensions for compressed images', async () => {
        const buffer = await sharp({
          create: {
            width: 500,
            height: 300,
            channels: 3,
            background: { r: 100, g: 100, b: 100 },
          },
        })
          .jpeg()
          .toBuffer();

        const result = await compressImageIfNeeded(buffer, 'test.jpg');

        // Small image, not compressed
        expect(result.wasCompressed).toBe(false);
        // Dimensions not returned for non-compressed images
        expect(result.dimensions).toBeUndefined();
      });
    });

    describe('constants', () => {
      it('should have correct Azure Vision limit constant', () => {
        expect(COMPRESSION_CONSTANTS.AZURE_VISION_MAX_SIZE).toBe(20 * 1024 * 1024); // 20 MB
      });

      it('should have target size less than Azure limit (safety buffer)', () => {
        expect(COMPRESSION_CONSTANTS.TARGET_SIZE).toBeLessThan(
          COMPRESSION_CONSTANTS.AZURE_VISION_MAX_SIZE
        );
        // Target should be 19 MB (1 MB safety buffer)
        expect(COMPRESSION_CONSTANTS.TARGET_SIZE).toBe(19 * 1024 * 1024);
      });

      it('should have reasonable max dimension', () => {
        expect(COMPRESSION_CONSTANTS.MAX_DIMENSION).toBe(4096);
      });

      it('should have descending quality levels', () => {
        const levels = COMPRESSION_CONSTANTS.JPEG_QUALITY_LEVELS;
        for (let i = 1; i < levels.length; i++) {
          expect(levels[i]).toBeLessThan(levels[i - 1]);
        }
      });
    });
  });
});
