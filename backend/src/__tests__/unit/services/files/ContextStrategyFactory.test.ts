/**
 * Context Strategy Factory Tests
 *
 * TDD tests for Phase 5: Chat Integration with Files
 * Testing the file context strategy selection logic.
 *
 * Strategy Rules:
 * - Images → DIRECT_CONTENT (Claude Vision)
 * - Small native files without extracted text → DIRECT_CONTENT
 * - Files with extracted text → EXTRACTED_TEXT
 * - Large files (>30MB) with embeddings → RAG_CHUNKS
 * - Large files without embeddings → EXTRACTED_TEXT (fallback)
 */

import { describe, it, expect } from 'vitest';
import { ContextStrategyFactory } from '@/services/files/context/ContextStrategyFactory';
import type { FileForStrategy } from '@/services/files/context/types';

describe('ContextStrategyFactory', () => {
  const factory = new ContextStrategyFactory();

  describe('selectStrategy', () => {
    describe('Image files (Claude Vision)', () => {
      it('should return DIRECT_CONTENT for PNG images < 30MB', () => {
        const file: FileForStrategy = {
          mimeType: 'image/png',
          sizeBytes: 2_000_000, // 2MB
          hasExtractedText: false,
          embeddingStatus: 'pending',
        };
        const result = factory.selectStrategy(file);
        expect(result.strategy).toBe('DIRECT_CONTENT');
        expect(result.reason).toContain('Image');
      });

      it('should return DIRECT_CONTENT for JPEG images', () => {
        const file: FileForStrategy = {
          mimeType: 'image/jpeg',
          sizeBytes: 5_000_000,
          hasExtractedText: false,
          embeddingStatus: 'pending',
        };
        expect(factory.selectStrategy(file).strategy).toBe('DIRECT_CONTENT');
      });

      it('should return DIRECT_CONTENT for WebP images', () => {
        const file: FileForStrategy = {
          mimeType: 'image/webp',
          sizeBytes: 1_000_000,
          hasExtractedText: false,
          embeddingStatus: 'pending',
        };
        expect(factory.selectStrategy(file).strategy).toBe('DIRECT_CONTENT');
      });

      it('should return DIRECT_CONTENT for GIF images', () => {
        const file: FileForStrategy = {
          mimeType: 'image/gif',
          sizeBytes: 3_000_000,
          hasExtractedText: false,
          embeddingStatus: 'pending',
        };
        expect(factory.selectStrategy(file).strategy).toBe('DIRECT_CONTENT');
      });
    });

    describe('PDF files', () => {
      it('should return EXTRACTED_TEXT for PDF with extracted text', () => {
        const file: FileForStrategy = {
          mimeType: 'application/pdf',
          sizeBytes: 1_000_000, // 1MB
          hasExtractedText: true,
          embeddingStatus: 'completed',
        };
        expect(factory.selectStrategy(file).strategy).toBe('EXTRACTED_TEXT');
      });

      it('should return DIRECT_CONTENT for PDF without extracted text < 30MB', () => {
        const file: FileForStrategy = {
          mimeType: 'application/pdf',
          sizeBytes: 10_000_000, // 10MB
          hasExtractedText: false,
          embeddingStatus: 'pending',
        };
        expect(factory.selectStrategy(file).strategy).toBe('DIRECT_CONTENT');
      });
    });

    describe('Text files', () => {
      it('should return DIRECT_CONTENT for small text files without extracted text', () => {
        const file: FileForStrategy = {
          mimeType: 'text/plain',
          sizeBytes: 50_000, // 50KB
          hasExtractedText: false,
          embeddingStatus: 'pending',
        };
        expect(factory.selectStrategy(file).strategy).toBe('DIRECT_CONTENT');
      });

      it('should return EXTRACTED_TEXT for text files with extracted text', () => {
        const file: FileForStrategy = {
          mimeType: 'text/plain',
          sizeBytes: 100_000,
          hasExtractedText: true,
          embeddingStatus: 'completed',
        };
        expect(factory.selectStrategy(file).strategy).toBe('EXTRACTED_TEXT');
      });

      it('should return DIRECT_CONTENT for markdown files', () => {
        const file: FileForStrategy = {
          mimeType: 'text/markdown',
          sizeBytes: 20_000,
          hasExtractedText: false,
          embeddingStatus: 'pending',
        };
        expect(factory.selectStrategy(file).strategy).toBe('DIRECT_CONTENT');
      });

      it('should return DIRECT_CONTENT for HTML files', () => {
        const file: FileForStrategy = {
          mimeType: 'text/html',
          sizeBytes: 30_000,
          hasExtractedText: false,
          embeddingStatus: 'pending',
        };
        expect(factory.selectStrategy(file).strategy).toBe('DIRECT_CONTENT');
      });
    });

    describe('Large files (>30MB)', () => {
      it('should return RAG_CHUNKS for large files with completed embeddings', () => {
        const file: FileForStrategy = {
          mimeType: 'text/plain',
          sizeBytes: 50_000_000, // 50MB
          hasExtractedText: true,
          embeddingStatus: 'completed',
        };
        expect(factory.selectStrategy(file).strategy).toBe('RAG_CHUNKS');
      });

      it('should return EXTRACTED_TEXT for large files without embeddings but with text', () => {
        const file: FileForStrategy = {
          mimeType: 'application/pdf',
          sizeBytes: 40_000_000, // 40MB
          hasExtractedText: true,
          embeddingStatus: 'pending',
        };
        expect(factory.selectStrategy(file).strategy).toBe('EXTRACTED_TEXT');
      });

      it('should return EXTRACTED_TEXT for large files with failed embeddings', () => {
        const file: FileForStrategy = {
          mimeType: 'text/plain',
          sizeBytes: 35_000_000,
          hasExtractedText: true,
          embeddingStatus: 'failed',
        };
        expect(factory.selectStrategy(file).strategy).toBe('EXTRACTED_TEXT');
      });
    });

    describe('Office documents', () => {
      it('should return EXTRACTED_TEXT for DOCX with extracted text', () => {
        const file: FileForStrategy = {
          mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          sizeBytes: 500_000,
          hasExtractedText: true,
          embeddingStatus: 'completed',
        };
        expect(factory.selectStrategy(file).strategy).toBe('EXTRACTED_TEXT');
      });

      it('should return DIRECT_CONTENT for DOCX without extracted text (fallback)', () => {
        const file: FileForStrategy = {
          mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          sizeBytes: 200_000,
          hasExtractedText: false,
          embeddingStatus: 'pending',
        };
        // DOCX is not natively supported by Claude, so fallback to direct
        expect(factory.selectStrategy(file).strategy).toBe('DIRECT_CONTENT');
      });
    });

    describe('CSV files', () => {
      it('should return EXTRACTED_TEXT for CSV files with extracted text', () => {
        const file: FileForStrategy = {
          mimeType: 'text/csv',
          sizeBytes: 100_000,
          hasExtractedText: true,
          embeddingStatus: 'completed',
        };
        expect(factory.selectStrategy(file).strategy).toBe('EXTRACTED_TEXT');
      });

      it('should return DIRECT_CONTENT for CSV files without extracted text', () => {
        const file: FileForStrategy = {
          mimeType: 'text/csv',
          sizeBytes: 50_000,
          hasExtractedText: false,
          embeddingStatus: 'pending',
        };
        // CSV can be sent directly as text
        expect(factory.selectStrategy(file).strategy).toBe('DIRECT_CONTENT');
      });
    });

    describe('Edge cases', () => {
      it('should handle zero-byte files', () => {
        const file: FileForStrategy = {
          mimeType: 'text/plain',
          sizeBytes: 0,
          hasExtractedText: false,
          embeddingStatus: 'pending',
        };
        expect(factory.selectStrategy(file).strategy).toBe('DIRECT_CONTENT');
      });

      it('should handle files exactly at 30MB boundary', () => {
        const file: FileForStrategy = {
          mimeType: 'application/pdf',
          sizeBytes: 30 * 1024 * 1024, // Exactly 30MB
          hasExtractedText: true,
          embeddingStatus: 'completed',
        };
        // At boundary, with embeddings → RAG
        expect(factory.selectStrategy(file).strategy).toBe('RAG_CHUNKS');
      });

      it('should handle unknown MIME types with extracted text', () => {
        const file: FileForStrategy = {
          mimeType: 'application/x-unknown',
          sizeBytes: 100_000,
          hasExtractedText: true,
          embeddingStatus: 'completed',
        };
        expect(factory.selectStrategy(file).strategy).toBe('EXTRACTED_TEXT');
      });

      it('should handle unknown MIME types without extracted text', () => {
        const file: FileForStrategy = {
          mimeType: 'application/x-unknown',
          sizeBytes: 100_000,
          hasExtractedText: false,
          embeddingStatus: 'pending',
        };
        // Fallback to direct
        expect(factory.selectStrategy(file).strategy).toBe('DIRECT_CONTENT');
      });
    });
  });
});
