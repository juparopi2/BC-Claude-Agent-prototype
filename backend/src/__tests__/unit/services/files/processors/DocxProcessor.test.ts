/**
 * DocxProcessor Unit Tests
 *
 * Comprehensive tests for DocxProcessor which handles Microsoft Word .docx files.
 * Uses mocked mammoth library to avoid complex fixture creation.
 *
 * Pattern: vi.hoisted() + manual re-setup in beforeEach
 * Based on: FileService.test.ts (passing pattern)
 *
 * Coverage Target: >90% (DocxProcessor.ts is ~113 lines)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DocxProcessor } from '@/services/files/processors/DocxProcessor';
import type { Result as MammothResult } from 'mammoth';

// ===== MOCK MAMMOTH LIBRARY (vi.hoisted pattern) =====
const mockExtractRawText = vi.hoisted(() => vi.fn());

vi.mock('mammoth', () => ({
  default: {
    extractRawText: mockExtractRawText,
  },
}));

// ===== MOCK LOGGER (vi.hoisted pattern) =====
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

describe('DocxProcessor', () => {
  let processor: DocxProcessor;

  const testFileName = 'test-document.docx';
  const testBuffer = Buffer.from('fake-docx-content');

  beforeEach(() => {
    vi.clearAllMocks();

    // Re-setup mock implementations after clearAllMocks
    mockExtractRawText.mockResolvedValue({
      value: '',
      messages: [],
    } as MammothResult<string>);

    processor = new DocxProcessor();
  });

  // ========== SUITE 1: SUCCESSFUL EXTRACTION (3 TESTS) ==========
  describe('extractText() - Success Cases', () => {
    it('should extract text from valid DOCX buffer', async () => {
      const extractedText = 'This is a sample Word document with some content.';
      mockExtractRawText.mockResolvedValueOnce({
        value: extractedText,
        messages: [],
      } as MammothResult<string>);

      const result = await processor.extractText(testBuffer, testFileName);

      // Verify mammoth was called with correct buffer
      expect(mockExtractRawText).toHaveBeenCalledWith({ buffer: testBuffer });

      // Verify extraction result
      expect(result.text).toBe(extractedText);
      expect(result.metadata.fileSize).toBe(testBuffer.length);
      expect(result.metadata.ocrUsed).toBe(false);

      // Verify logging
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          fileName: testFileName,
          fileSize: testBuffer.length,
        }),
        'Starting DOCX extraction'
      );

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          fileName: testFileName,
          textLength: extractedText.length,
          fileSize: testBuffer.length,
          messageCount: 0,
        }),
        'DOCX extraction completed successfully'
      );
    });

    it('should trim whitespace from extracted text', async () => {
      const textWithWhitespace = '   \n\n  Document content with leading/trailing whitespace  \n\n  ';
      const expectedTrimmed = 'Document content with leading/trailing whitespace';

      mockExtractRawText.mockResolvedValueOnce({
        value: textWithWhitespace,
        messages: [],
      } as MammothResult<string>);

      const result = await processor.extractText(testBuffer, testFileName);

      expect(result.text).toBe(expectedTrimmed);
      expect(result.text).not.toBe(textWithWhitespace);
    });

    it('should return correct metadata structure', async () => {
      const extractedText = 'Sample text';
      mockExtractRawText.mockResolvedValueOnce({
        value: extractedText,
        messages: [],
      } as MammothResult<string>);

      const result = await processor.extractText(testBuffer, testFileName);

      // Verify metadata structure
      expect(result.metadata).toEqual({
        fileSize: testBuffer.length,
        ocrUsed: false, // mammoth does not use OCR
      });

      // Verify ocrUsed is always false (mammoth doesn't use OCR)
      expect(result.metadata.ocrUsed).toBe(false);
    });
  });

  // ========== SUITE 2: EMPTY CONTENT HANDLING (2 TESTS) ==========
  describe('extractText() - Empty Content', () => {
    it('should log warning when extracted text is empty after trimming', async () => {
      const emptyWhitespace = '   \n\n   \t\t   ';
      mockExtractRawText.mockResolvedValueOnce({
        value: emptyWhitespace,
        messages: [],
      } as MammothResult<string>);

      const result = await processor.extractText(testBuffer, testFileName);

      // Verify empty text is returned
      expect(result.text).toBe('');

      // Verify warning was logged
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ fileName: testFileName }),
        'Extracted text is empty after trimming'
      );

      // Verify successful completion was still logged
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          fileName: testFileName,
          textLength: 0,
        }),
        'DOCX extraction completed successfully'
      );
    });

    it('should handle document with no text content', async () => {
      mockExtractRawText.mockResolvedValueOnce({
        value: '',
        messages: [],
      } as MammothResult<string>);

      const result = await processor.extractText(testBuffer, testFileName);

      expect(result.text).toBe('');
      expect(result.metadata.fileSize).toBe(testBuffer.length);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ fileName: testFileName }),
        'Extracted text is empty after trimming'
      );
    });
  });

  // ========== SUITE 3: MAMMOTH WARNINGS HANDLING (2 TESTS) ==========
  describe('extractText() - Mammoth Warnings', () => {
    it('should log warnings but not fail extraction', async () => {
      const extractedText = 'Document with warnings';
      const warnings = [
        { type: 'warning', message: 'Unrecognized style: CustomStyle1' },
        { type: 'warning', message: 'Image not found: image1.png' },
      ];

      mockExtractRawText.mockResolvedValueOnce({
        value: extractedText,
        messages: warnings,
      } as MammothResult<string>);

      const result = await processor.extractText(testBuffer, testFileName);

      // Verify extraction succeeded despite warnings
      expect(result.text).toBe(extractedText);

      // Verify warnings were logged
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          fileName: testFileName,
          warningCount: 2,
          warnings: ['Unrecognized style: CustomStyle1', 'Image not found: image1.png'],
        }),
        'Mammoth reported warnings during extraction'
      );

      // Verify successful completion was logged
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          fileName: testFileName,
          messageCount: 2,
        }),
        'DOCX extraction completed successfully'
      );
    });

    it('should filter and log only warning-type messages', async () => {
      const extractedText = 'Document with mixed messages';
      const mixedMessages = [
        { type: 'warning', message: 'Warning 1' },
        { type: 'info', message: 'Info message' },
        { type: 'warning', message: 'Warning 2' },
      ];

      mockExtractRawText.mockResolvedValueOnce({
        value: extractedText,
        messages: mixedMessages,
      } as MammothResult<string>);

      const result = await processor.extractText(testBuffer, testFileName);

      expect(result.text).toBe(extractedText);

      // Verify only warnings were logged (info messages excluded)
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          warningCount: 2,
          warnings: ['Warning 1', 'Warning 2'],
        }),
        'Mammoth reported warnings during extraction'
      );
    });
  });

  // ========== SUITE 4: MAMMOTH ERRORS HANDLING (2 TESTS) ==========
  describe('extractText() - Mammoth Errors', () => {
    it('should log errors reported by mammoth but still return text', async () => {
      const extractedText = 'Partial document content';
      const errors = [
        { type: 'error', message: 'Failed to parse table structure' },
        { type: 'error', message: 'Corrupt paragraph element' },
      ];

      mockExtractRawText.mockResolvedValueOnce({
        value: extractedText,
        messages: errors,
      } as MammothResult<string>);

      const result = await processor.extractText(testBuffer, testFileName);

      // Verify extraction succeeded despite errors
      expect(result.text).toBe(extractedText);

      // Verify errors were logged
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          fileName: testFileName,
          errorCount: 2,
          errors: ['Failed to parse table structure', 'Corrupt paragraph element'],
        }),
        'Mammoth reported errors during extraction'
      );

      // Verify successful completion was logged
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          fileName: testFileName,
          messageCount: 2,
        }),
        'DOCX extraction completed successfully'
      );
    });

    it('should handle mixed warnings and errors', async () => {
      const extractedText = 'Document with mixed issues';
      const mixedMessages = [
        { type: 'warning', message: 'Style warning' },
        { type: 'error', message: 'Parse error' },
        { type: 'warning', message: 'Another warning' },
      ];

      mockExtractRawText.mockResolvedValueOnce({
        value: extractedText,
        messages: mixedMessages,
      } as MammothResult<string>);

      const result = await processor.extractText(testBuffer, testFileName);

      expect(result.text).toBe(extractedText);

      // Verify both warnings and errors were logged separately
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          warningCount: 2,
          warnings: ['Style warning', 'Another warning'],
        }),
        'Mammoth reported warnings during extraction'
      );

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          errorCount: 1,
          errors: ['Parse error'],
        }),
        'Mammoth reported errors during extraction'
      );
    });
  });

  // ========== SUITE 5: BUFFER VALIDATION (3 TESTS) ==========
  describe('extractText() - Buffer Validation', () => {
    it('should throw error when buffer is empty', async () => {
      const emptyBuffer = Buffer.from([]);

      await expect(processor.extractText(emptyBuffer, testFileName)).rejects.toThrow(
        'Buffer is empty or undefined'
      );

      // Verify mammoth was not called
      expect(mockExtractRawText).not.toHaveBeenCalled();

      // Verify error was logged
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          fileName: testFileName,
          error: 'Buffer is empty or undefined',
        }),
        'DOCX extraction failed'
      );
    });

    it('should throw error with descriptive message for empty buffer', async () => {
      const emptyBuffer = Buffer.from([]);

      await expect(processor.extractText(emptyBuffer, testFileName)).rejects.toThrow(
        `Failed to extract text from ${testFileName}: Buffer is empty or undefined`
      );
    });

    it('should handle buffer with zero length', async () => {
      const zeroBuffer = Buffer.alloc(0);

      await expect(processor.extractText(zeroBuffer, testFileName)).rejects.toThrow(
        'Buffer is empty or undefined'
      );

      expect(mockExtractRawText).not.toHaveBeenCalled();
    });
  });

  // ========== SUITE 6: MAMMOTH LIBRARY FAILURES (3 TESTS) ==========
  describe('extractText() - Mammoth Failures', () => {
    it('should throw error when mammoth extraction fails', async () => {
      const mammothError = new Error('Invalid DOCX structure');
      mockExtractRawText.mockRejectedValueOnce(mammothError);

      await expect(processor.extractText(testBuffer, testFileName)).rejects.toThrow(
        `Failed to extract text from ${testFileName}: Invalid DOCX structure`
      );

      // Verify error was logged
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          fileName: testFileName,
          error: 'Invalid DOCX structure',
        }),
        'DOCX extraction failed'
      );
    });

    it('should handle corrupted DOCX buffer', async () => {
      const corruptError = new Error('Corrupted ZIP structure');
      mockExtractRawText.mockRejectedValueOnce(corruptError);

      await expect(processor.extractText(testBuffer, testFileName)).rejects.toThrow(
        `Failed to extract text from ${testFileName}: Corrupted ZIP structure`
      );
    });

    it('should handle non-Error exceptions from mammoth', async () => {
      const stringError = 'Unexpected mammoth failure';
      mockExtractRawText.mockRejectedValueOnce(stringError);

      await expect(processor.extractText(testBuffer, testFileName)).rejects.toThrow(
        `Failed to extract text from ${testFileName}: Unexpected mammoth failure`
      );

      // Verify string error was converted to string in log
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          fileName: testFileName,
          error: 'Unexpected mammoth failure',
        }),
        'DOCX extraction failed'
      );
    });
  });

  // ========== SUITE 7: LARGE DOCUMENT HANDLING (2 TESTS) ==========
  describe('extractText() - Large Documents', () => {
    it('should handle large documents with many pages', async () => {
      const largeText = 'A'.repeat(100000); // 100KB of text
      mockExtractRawText.mockResolvedValueOnce({
        value: largeText,
        messages: [],
      } as MammothResult<string>);

      const largeBuffer = Buffer.alloc(500000); // 500KB buffer
      const result = await processor.extractText(largeBuffer, 'large-document.docx');

      expect(result.text).toBe(largeText);
      expect(result.text.length).toBe(100000);
      expect(result.metadata.fileSize).toBe(500000);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          fileName: 'large-document.docx',
          textLength: 100000,
          fileSize: 500000,
        }),
        'DOCX extraction completed successfully'
      );
    });

    it('should handle documents with complex formatting', async () => {
      const complexText =
        'Document with\n\nmultiple\nparagraphs\n\nand various\n\nformatting elements.';
      const warnings = [
        { type: 'warning', message: 'Complex table ignored' },
        { type: 'warning', message: 'Text box not supported' },
        { type: 'warning', message: 'Custom numbering scheme simplified' },
      ];

      mockExtractRawText.mockResolvedValueOnce({
        value: complexText,
        messages: warnings,
      } as MammothResult<string>);

      const result = await processor.extractText(testBuffer, 'complex-document.docx');

      expect(result.text).toBe(complexText);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          warningCount: 3,
        }),
        'Mammoth reported warnings during extraction'
      );
    });
  });

  // ========== SUITE 8: EDGE CASES (3 TESTS) ==========
  describe('extractText() - Edge Cases', () => {
    it('should handle document with only whitespace', async () => {
      const whitespaceOnly = '\n\n\t\t   \n\n   \t';
      mockExtractRawText.mockResolvedValueOnce({
        value: whitespaceOnly,
        messages: [],
      } as MammothResult<string>);

      const result = await processor.extractText(testBuffer, testFileName);

      expect(result.text).toBe(''); // Trimmed to empty
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ fileName: testFileName }),
        'Extracted text is empty after trimming'
      );
    });

    it('should handle document with special characters', async () => {
      const specialChars = 'Document with © trademark™ and émojis 🎉 and symbols €£¥';
      mockExtractRawText.mockResolvedValueOnce({
        value: specialChars,
        messages: [],
      } as MammothResult<string>);

      const result = await processor.extractText(testBuffer, 'special-chars.docx');

      expect(result.text).toBe(specialChars);
      expect(result.text).toContain('©');
      expect(result.text).toContain('™');
      expect(result.text).toContain('🎉');
      expect(result.text).toContain('€£¥');
    });

    it('should handle filename with special characters in logging', async () => {
      const specialFileName = 'document (1) [draft].docx';
      const extractedText = 'Content';

      mockExtractRawText.mockResolvedValueOnce({
        value: extractedText,
        messages: [],
      } as MammothResult<string>);

      await processor.extractText(testBuffer, specialFileName);

      // Verify filename is correctly logged
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ fileName: specialFileName }),
        'Starting DOCX extraction'
      );

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ fileName: specialFileName }),
        'DOCX extraction completed successfully'
      );
    });
  });

  // ========== SUITE 9: MESSAGE TYPES HANDLING (1 TEST) ==========
  describe('extractText() - Message Type Filtering', () => {
    it('should correctly separate warnings from errors', async () => {
      const extractedText = 'Text content';
      const messages = [
        { type: 'warning', message: 'W1' },
        { type: 'error', message: 'E1' },
        { type: 'info', message: 'I1' }, // Should be ignored
        { type: 'warning', message: 'W2' },
        { type: 'error', message: 'E2' },
        { type: 'debug', message: 'D1' }, // Should be ignored
      ];

      mockExtractRawText.mockResolvedValueOnce({
        value: extractedText,
        messages,
      } as MammothResult<string>);

      const result = await processor.extractText(testBuffer, testFileName);

      expect(result.text).toBe(extractedText);

      // Verify warnings logged (only type: 'warning')
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          warningCount: 2,
          warnings: ['W1', 'W2'],
        }),
        'Mammoth reported warnings during extraction'
      );

      // Verify errors logged (only type: 'error')
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          errorCount: 2,
          errors: ['E1', 'E2'],
        }),
        'Mammoth reported errors during extraction'
      );

      // Verify total message count includes all messages
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          messageCount: 6, // All messages counted
        }),
        'DOCX extraction completed successfully'
      );
    });
  });
});
