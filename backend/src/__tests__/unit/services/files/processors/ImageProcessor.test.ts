import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ===== HOISTED MOCKS =====
const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('@/shared/utils/logger', () => ({
  logger: mockLogger,
  createChildLogger: vi.fn(() => mockLogger),
}));

// Mock environment (default: Azure Vision NOT configured)
const mockEnv = vi.hoisted(() => ({
  AZURE_VISION_ENDPOINT: '',
  AZURE_VISION_KEY: '',
}));

vi.mock('@/infrastructure/config/environment', () => ({
  env: mockEnv,
}));

// Mock ImageCompressor (pass buffer through unchanged)
vi.mock('@/services/files/utils/ImageCompressor', () => ({
  compressImageIfNeeded: vi.fn(async (buffer: Buffer) => ({
    buffer,
    wasCompressed: false,
    originalSize: buffer.length,
    finalSize: buffer.length,
    quality: undefined,
  })),
}));

// Mock EmbeddingService
const mockGenerateImageEmbedding = vi.hoisted(() => vi.fn());
const mockGenerateImageCaption = vi.hoisted(() => vi.fn());

vi.mock('@services/embeddings/EmbeddingService', () => ({
  EmbeddingService: {
    getInstance: vi.fn(() => ({
      generateImageEmbedding: mockGenerateImageEmbedding,
      generateImageCaption: mockGenerateImageCaption,
    })),
  },
}));

// Mock UsageTrackingService
const mockTrackEmbedding = vi.hoisted(() => vi.fn());

vi.mock('@/domains/billing/tracking/UsageTrackingService', () => ({
  getUsageTrackingService: vi.fn(() => ({
    trackEmbedding: mockTrackEmbedding,
  })),
}));

import { ImageProcessor, trackImageUsage } from '@services/files/processors/ImageProcessor';
import type { ImageMetadata } from '@services/files/processors/ImageProcessor';

// =============================================================================
// Test Suite
// =============================================================================

describe('ImageProcessor', () => {
  let processor: ImageProcessor;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset environment to defaults (Vision NOT configured)
    mockEnv.AZURE_VISION_ENDPOINT = '';
    mockEnv.AZURE_VISION_KEY = '';
    processor = new ImageProcessor();
  });

  // ===========================================================================
  // Suite 1: Image format detection via metadata (Azure Vision NOT configured)
  // ===========================================================================

  describe('Image format detection (via metadata.imageFormat)', () => {
    it('should detect JPEG format', async () => {
      const buffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
      const result = await processor.extractText(buffer, 'photo.jpg');
      expect((result.metadata as ImageMetadata).imageFormat).toBe('jpeg');
    });

    it('should detect PNG format', async () => {
      const buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      const result = await processor.extractText(buffer, 'image.png');
      expect((result.metadata as ImageMetadata).imageFormat).toBe('png');
    });

    it('should detect GIF format', async () => {
      const buffer = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
      const result = await processor.extractText(buffer, 'animation.gif');
      expect((result.metadata as ImageMetadata).imageFormat).toBe('gif');
    });

    it('should detect WebP format', async () => {
      // RIFF (52 49 46 46) + 4 size bytes + WEBP (57 45 42 50)
      const buffer = Buffer.from([
        0x52, 0x49, 0x46, 0x46, // RIFF
        0x00, 0x00, 0x00, 0x00, // file size placeholder
        0x57, 0x45, 0x42, 0x50, // WEBP
      ]);
      const result = await processor.extractText(buffer, 'image.webp');
      expect((result.metadata as ImageMetadata).imageFormat).toBe('webp');
    });

    it('should detect BMP format', async () => {
      const buffer = Buffer.from([0x42, 0x4d, 0x00, 0x00, 0x00, 0x00]);
      const result = await processor.extractText(buffer, 'bitmap.bmp');
      expect((result.metadata as ImageMetadata).imageFormat).toBe('bmp');
    });

    it('should detect TIFF little-endian format', async () => {
      const buffer = Buffer.from([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00]);
      const result = await processor.extractText(buffer, 'image.tiff');
      expect((result.metadata as ImageMetadata).imageFormat).toBe('tiff');
    });

    it('should detect TIFF big-endian format', async () => {
      const buffer = Buffer.from([0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08]);
      const result = await processor.extractText(buffer, 'image-be.tiff');
      expect((result.metadata as ImageMetadata).imageFormat).toBe('tiff');
    });

    it('should return "unknown" for unrecognized format', async () => {
      // Arbitrary bytes that do not match any known magic number
      const buffer = Buffer.from([0x00, 0x11, 0x22, 0x33, 0x44, 0x55]);
      const result = await processor.extractText(buffer, 'unknown-file.bin');
      expect((result.metadata as ImageMetadata).imageFormat).toBe('unknown');
    });
  });

  // ===========================================================================
  // Suite 2: Basic behaviour (Azure Vision NOT configured)
  // ===========================================================================

  describe('Basic behaviour (Azure Vision not configured)', () => {
    it('should throw when buffer is empty', async () => {
      const emptyBuffer = Buffer.alloc(0);
      await expect(processor.extractText(emptyBuffer, 'empty.jpg')).rejects.toThrow(
        'Buffer is empty or undefined'
      );
    });

    it('should throw when buffer is falsy', async () => {
      // TypeScript guard: cast to satisfy the type signature
      await expect(
        processor.extractText(null as unknown as Buffer, 'null.jpg')
      ).rejects.toThrow('Buffer is empty or undefined');
    });

    it('should return placeholder text [Image: fileName] when Vision not configured', async () => {
      const buffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
      const result = await processor.extractText(buffer, 'photo.jpg');
      expect(result.text).toBe('[Image: photo.jpg]');
    });

    it('should set embeddingGenerated to false when Vision not configured', async () => {
      const buffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
      const result = await processor.extractText(buffer, 'photo.jpg');
      expect((result.metadata as ImageMetadata).embeddingGenerated).toBe(false);
    });

    it('should set ocrUsed to false', async () => {
      const buffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
      const result = await processor.extractText(buffer, 'photo.jpg');
      expect(result.metadata.ocrUsed).toBe(false);
    });

    it('should set fileSize in metadata', async () => {
      const buffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
      const result = await processor.extractText(buffer, 'photo.jpg');
      expect(result.metadata.fileSize).toBe(buffer.length);
    });

    it('should log a warning that Azure Vision is not configured', async () => {
      const buffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
      await processor.extractText(buffer, 'photo.jpg');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ fileName: 'photo.jpg' }),
        'Azure Vision not configured - skipping image embedding and caption generation'
      );
    });

    it('should NOT call EmbeddingService when Vision not configured', async () => {
      const buffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
      await processor.extractText(buffer, 'photo.jpg');
      expect(mockGenerateImageEmbedding).not.toHaveBeenCalled();
      expect(mockGenerateImageCaption).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // Suite 3: Azure Vision configured
  // ===========================================================================

  describe('With Azure Vision configured', () => {
    beforeEach(() => {
      mockEnv.AZURE_VISION_ENDPOINT = 'https://test.cognitiveservices.azure.com';
      mockEnv.AZURE_VISION_KEY = 'test-key';
    });

    afterEach(() => {
      mockEnv.AZURE_VISION_ENDPOINT = '';
      mockEnv.AZURE_VISION_KEY = '';
    });

    it('should call generateImageEmbedding when Vision is configured', async () => {
      mockGenerateImageEmbedding.mockResolvedValue({
        embedding: new Array(1024).fill(0.1),
        model: 'cv-model-2023',
        imageSize: 6,
        userId: 'USER-1',
        createdAt: new Date(),
      });
      mockGenerateImageCaption.mockResolvedValue({
        caption: 'A test image',
        confidence: 0.95,
        modelVersion: 'cv-model-2023',
      });

      const buffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
      await processor.extractText(buffer, 'photo.jpg');

      expect(mockGenerateImageEmbedding).toHaveBeenCalledOnce();
      expect(mockGenerateImageEmbedding).toHaveBeenCalledWith(
        buffer,
        expect.any(String), // placeholderUserId (random UUID)
        expect.any(String), // placeholderFileId (random UUID)
        { skipTracking: true }
      );
    });

    it('should call generateImageCaption when Vision is configured', async () => {
      mockGenerateImageEmbedding.mockResolvedValue({
        embedding: new Array(1024).fill(0.1),
        model: 'cv-model-2023',
        imageSize: 6,
        userId: 'USER-1',
        createdAt: new Date(),
      });
      mockGenerateImageCaption.mockResolvedValue({
        caption: 'A test image',
        confidence: 0.95,
        modelVersion: 'cv-model-2023',
      });

      const buffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
      await processor.extractText(buffer, 'photo.jpg');

      expect(mockGenerateImageCaption).toHaveBeenCalledOnce();
      expect(mockGenerateImageCaption).toHaveBeenCalledWith(
        buffer,
        expect.any(String),
        expect.any(String),
        { skipTracking: true }
      );
    });

    it('should include caption in text when caption is generated', async () => {
      mockGenerateImageEmbedding.mockResolvedValue({
        embedding: new Array(1024).fill(0.1),
        model: 'cv-model-2023',
        imageSize: 6,
        userId: 'USER-1',
        createdAt: new Date(),
      });
      mockGenerateImageCaption.mockResolvedValue({
        caption: 'A beautiful sunset over the ocean',
        confidence: 0.92,
        modelVersion: 'cv-model-2023',
      });

      const buffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
      const result = await processor.extractText(buffer, 'sunset.jpg');

      expect(result.text).toContain('A beautiful sunset over the ocean');
      expect(result.text).toContain('[Image: sunset.jpg]');
    });

    it('should set embeddingGenerated to true when embedding succeeds', async () => {
      mockGenerateImageEmbedding.mockResolvedValue({
        embedding: new Array(1024).fill(0.1),
        model: 'cv-model-2023',
        imageSize: 6,
        userId: 'USER-1',
        createdAt: new Date(),
      });
      mockGenerateImageCaption.mockResolvedValue({
        caption: 'Test caption',
        confidence: 0.9,
        modelVersion: 'cv-model-2023',
      });

      const buffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
      const result = await processor.extractText(buffer, 'photo.jpg');

      expect((result.metadata as ImageMetadata).embeddingGenerated).toBe(true);
    });

    it('should set embeddingDimensions from embedding length', async () => {
      const embedding = new Array(1024).fill(0.1);
      mockGenerateImageEmbedding.mockResolvedValue({
        embedding,
        model: 'cv-model-2023',
        imageSize: 6,
        userId: 'USER-1',
        createdAt: new Date(),
      });
      mockGenerateImageCaption.mockResolvedValue({
        caption: 'Test caption',
        confidence: 0.9,
        modelVersion: 'cv-model-2023',
      });

      const buffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
      const result = await processor.extractText(buffer, 'photo.jpg');

      expect((result.metadata as ImageMetadata).embeddingDimensions).toBe(1024);
    });

    it('should populate imageEmbedding in the result', async () => {
      const embedding = new Array(1024).fill(0.5);
      mockGenerateImageEmbedding.mockResolvedValue({
        embedding,
        model: 'cv-model-2023',
        imageSize: 6,
        userId: 'USER-1',
        createdAt: new Date(),
      });
      mockGenerateImageCaption.mockResolvedValue({
        caption: 'Test caption',
        confidence: 0.9,
        modelVersion: 'cv-model-2023',
      });

      const buffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
      const result = await processor.extractText(buffer, 'photo.jpg');

      expect(result.imageEmbedding).toEqual(embedding);
    });

    it('should populate imageCaption and imageCaptionConfidence in the result', async () => {
      mockGenerateImageEmbedding.mockResolvedValue({
        embedding: new Array(1024).fill(0.1),
        model: 'cv-model-2023',
        imageSize: 6,
        userId: 'USER-1',
        createdAt: new Date(),
      });
      mockGenerateImageCaption.mockResolvedValue({
        caption: 'A cat sitting on a mat',
        confidence: 0.88,
        modelVersion: 'cv-model-2023',
      });

      const buffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
      const result = await processor.extractText(buffer, 'cat.jpg');

      expect(result.imageCaption).toBe('A cat sitting on a mat');
      expect(result.imageCaptionConfidence).toBe(0.88);
    });

    it('should handle embedding failure gracefully (still returns result)', async () => {
      mockGenerateImageEmbedding.mockRejectedValue(new Error('Vision API unavailable'));
      mockGenerateImageCaption.mockResolvedValue({
        caption: 'A test image',
        confidence: 0.9,
        modelVersion: 'cv-model-2023',
      });

      const buffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
      // Should NOT throw — embedding failure is handled with Promise.allSettled
      const result = await processor.extractText(buffer, 'photo.jpg');

      expect((result.metadata as ImageMetadata).embeddingGenerated).toBe(false);
      expect(result.imageEmbedding).toBeUndefined();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          fileName: 'photo.jpg',
          error: 'Vision API unavailable',
        }),
        'Failed to generate image embedding - continuing without it'
      );
    });

    it('should handle caption failure gracefully (still returns result)', async () => {
      mockGenerateImageEmbedding.mockResolvedValue({
        embedding: new Array(1024).fill(0.1),
        model: 'cv-model-2023',
        imageSize: 6,
        userId: 'USER-1',
        createdAt: new Date(),
      });
      mockGenerateImageCaption.mockRejectedValue(new Error('Caption API timeout'));

      const buffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
      // Should NOT throw — caption failure is handled with Promise.allSettled
      const result = await processor.extractText(buffer, 'photo.jpg');

      expect((result.metadata as ImageMetadata).captionGenerated).toBeUndefined();
      expect(result.imageCaption).toBeUndefined();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          fileName: 'photo.jpg',
          error: 'Caption API timeout',
        }),
        'Failed to generate image caption - continuing without it'
      );
    });

    it('should fall back to format/size text when caption is absent', async () => {
      // Both embedding and caption fail
      mockGenerateImageEmbedding.mockRejectedValue(new Error('Embedding failed'));
      mockGenerateImageCaption.mockRejectedValue(new Error('Caption failed'));

      const buffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
      const result = await processor.extractText(buffer, 'photo.jpg');

      // Without caption the text should use the fallback template
      expect(result.text).toContain('[Image: photo.jpg]');
      expect(result.text).toContain('jpeg');
    });
  });

  // ===========================================================================
  // Suite 4: trackImageUsage
  // ===========================================================================

  describe('trackImageUsage()', () => {
    it('should skip tracking when embeddingGenerated is false', async () => {
      const metadata: ImageMetadata = {
        imageFormat: 'jpeg',
        embeddingGenerated: false,
        ocrUsed: false,
        fileSize: 1024,
      };

      await trackImageUsage('USER-123', 'FILE-456', metadata);

      expect(mockTrackEmbedding).not.toHaveBeenCalled();
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'USER-123', fileId: 'FILE-456' }),
        'No embedding generated - skipping usage tracking'
      );
    });

    it('should call usageTrackingService.trackEmbedding when embeddingGenerated is true', async () => {
      mockTrackEmbedding.mockResolvedValue(undefined);

      const metadata: ImageMetadata = {
        imageFormat: 'png',
        embeddingGenerated: true,
        embeddingDimensions: 1024,
        visionModelVersion: 'cv-model-2023',
        ocrUsed: false,
        fileSize: 2048,
      };

      await trackImageUsage('USER-123', 'FILE-456', metadata);

      expect(mockTrackEmbedding).toHaveBeenCalledOnce();
      expect(mockTrackEmbedding).toHaveBeenCalledWith(
        'USER-123',
        'FILE-456',
        1, // 1 image
        'image',
        expect.objectContaining({
          model: 'cv-model-2023',
          dimensions: 1024,
          imageFormat: 'png',
          fileSize: 2048,
        })
      );
    });

    it('should use fallback model name when visionModelVersion is absent', async () => {
      mockTrackEmbedding.mockResolvedValue(undefined);

      const metadata: ImageMetadata = {
        imageFormat: 'jpeg',
        embeddingGenerated: true,
        // visionModelVersion intentionally absent
        ocrUsed: false,
        fileSize: 512,
      };

      await trackImageUsage('USER-AAA', 'FILE-BBB', metadata);

      expect(mockTrackEmbedding).toHaveBeenCalledWith(
        'USER-AAA',
        'FILE-BBB',
        1,
        'image',
        expect.objectContaining({ model: 'cv-bcagent-dev' })
      );
    });

    it('should use fallback dimensions (1024) when embeddingDimensions is absent', async () => {
      mockTrackEmbedding.mockResolvedValue(undefined);

      const metadata: ImageMetadata = {
        imageFormat: 'jpeg',
        embeddingGenerated: true,
        // embeddingDimensions intentionally absent
        ocrUsed: false,
        fileSize: 512,
      };

      await trackImageUsage('USER-AAA', 'FILE-BBB', metadata);

      expect(mockTrackEmbedding).toHaveBeenCalledWith(
        'USER-AAA',
        'FILE-BBB',
        1,
        'image',
        expect.objectContaining({ dimensions: 1024 })
      );
    });

    it('should not throw when tracking fails (fire-and-forget)', async () => {
      mockTrackEmbedding.mockRejectedValue(new Error('Billing service unavailable'));

      const metadata: ImageMetadata = {
        imageFormat: 'jpeg',
        embeddingGenerated: true,
        ocrUsed: false,
        fileSize: 512,
      };

      // Must resolve without throwing
      await expect(trackImageUsage('USER-123', 'FILE-456', metadata)).resolves.toBeUndefined();

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Billing service unavailable',
          userId: 'USER-123',
          fileId: 'FILE-456',
        }),
        'Failed to track image embedding usage'
      );
    });
  });
});
