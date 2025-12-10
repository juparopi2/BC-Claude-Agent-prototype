import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TextProcessor } from '@services/files/processors/TextProcessor';
import type { ExtractionResult } from '@services/files/processors/types';

// Mock logger only
const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('@/utils/logger', () => ({
  logger: mockLogger,
  createChildLogger: vi.fn(() => mockLogger),
}));

describe('TextProcessor', () => {
  let processor: TextProcessor;

  beforeEach(() => {
    vi.clearAllMocks();
    processor = new TextProcessor();
  });

  describe('extractText()', () => {
    describe('Valid UTF-8 text extraction', () => {
      it('should extract plain text from valid UTF-8 buffer', async () => {
        const content = 'Hello, World!';
        const buffer = Buffer.from(content, 'utf-8');
        const fileName = 'test.txt';

        const result = await processor.extractText(buffer, fileName);

        expect(result.text).toBe(content);
        expect(result.metadata.fileSize).toBe(buffer.length);
        expect(result.metadata.ocrUsed).toBe(false);
      });

      it('should trim whitespace from extracted text', async () => {
        const content = '  \n  Hello, World!  \n  ';
        const buffer = Buffer.from(content, 'utf-8');
        const fileName = 'test.txt';

        const result = await processor.extractText(buffer, fileName);

        expect(result.text).toBe('Hello, World!');
        expect(result.metadata.fileSize).toBe(buffer.length);
      });

      it('should handle multi-line text correctly', async () => {
        const content = 'Line 1\nLine 2\nLine 3\n\nLine 5';
        const buffer = Buffer.from(content, 'utf-8');
        const fileName = 'multiline.txt';

        const result = await processor.extractText(buffer, fileName);

        expect(result.text).toBe(content);
        expect(result.text.split('\n')).toHaveLength(5);
        expect(result.metadata.fileSize).toBe(buffer.length);
        expect(result.metadata.ocrUsed).toBe(false);
      });

      it('should handle special characters and UTF-8 encoding', async () => {
        const content = '¡Hola! こんにちは 🎉 Привет €£¥';
        const buffer = Buffer.from(content, 'utf-8');
        const fileName = 'unicode.txt';

        const result = await processor.extractText(buffer, fileName);

        expect(result.text).toBe(content);
        expect(result.text).toContain('¡Hola!');
        expect(result.text).toContain('こんにちは');
        expect(result.text).toContain('🎉');
        expect(result.text).toContain('Привет');
        expect(result.text).toContain('€£¥');
        expect(result.metadata.ocrUsed).toBe(false);
      });

      it('should handle CSV content', async () => {
        const csvContent = 'Name,Age,City\nJohn Doe,30,New York\nJane Smith,25,Los Angeles';
        const buffer = Buffer.from(csvContent, 'utf-8');
        const fileName = 'data.csv';

        const result = await processor.extractText(buffer, fileName);

        expect(result.text).toBe(csvContent);
        expect(result.text).toContain('Name,Age,City');
        expect(result.text).toContain('John Doe,30,New York');
        expect(result.metadata.fileSize).toBe(buffer.length);
        expect(result.metadata.ocrUsed).toBe(false);
      });

      it('should handle JSON content', async () => {
        const jsonContent = JSON.stringify({
          name: 'John Doe',
          age: 30,
          hobbies: ['reading', 'coding'],
          address: {
            city: 'New York',
            zip: '10001',
          },
        }, null, 2);
        const buffer = Buffer.from(jsonContent, 'utf-8');
        const fileName = 'data.json';

        const result = await processor.extractText(buffer, fileName);

        expect(result.text).toBe(jsonContent.trim());
        expect(result.text).toContain('"name": "John Doe"');
        expect(result.text).toContain('"age": 30');
        expect(result.metadata.fileSize).toBe(buffer.length);
        expect(result.metadata.ocrUsed).toBe(false);
      });

      it('should handle markdown content', async () => {
        const markdownContent = `# Heading 1

## Heading 2

This is a paragraph with **bold** and *italic* text.

- List item 1
- List item 2

[Link text](https://example.com)`;
        const buffer = Buffer.from(markdownContent, 'utf-8');
        const fileName = 'document.md';

        const result = await processor.extractText(buffer, fileName);

        expect(result.text).toBe(markdownContent);
        expect(result.text).toContain('# Heading 1');
        expect(result.text).toContain('**bold**');
        expect(result.text).toContain('[Link text](https://example.com)');
        expect(result.metadata.ocrUsed).toBe(false);
      });
    });

    describe('Error handling', () => {
      it('should throw error for empty buffer', async () => {
        const buffer = Buffer.from('', 'utf-8');
        const fileName = 'empty.txt';

        await expect(processor.extractText(buffer, fileName)).rejects.toThrow(
          'Buffer is empty or undefined'
        );
      });

      it('should throw error for null buffer', async () => {
        const buffer = null as unknown as Buffer;
        const fileName = 'null.txt';

        await expect(processor.extractText(buffer, fileName)).rejects.toThrow(
          `Failed to extract text from ${fileName}: Buffer is empty or undefined`
        );
      });

      it('should throw error for undefined buffer', async () => {
        const buffer = undefined as unknown as Buffer;
        const fileName = 'undefined.txt';

        await expect(processor.extractText(buffer, fileName)).rejects.toThrow(
          `Failed to extract text from ${fileName}: Buffer is empty or undefined`
        );
      });

      it('should include filename in error message', async () => {
        const buffer = Buffer.from('', 'utf-8');
        const fileName = 'problematic-file.txt';

        await expect(processor.extractText(buffer, fileName)).rejects.toThrow(
          `Failed to extract text from ${fileName}`
        );
      });

      it('should warn when extracted text is empty after trimming', async () => {
        const content = '   \n\n   \t\t   ';
        const buffer = Buffer.from(content, 'utf-8');
        const fileName = 'whitespace-only.txt';

        const result = await processor.extractText(buffer, fileName);

        expect(result.text).toBe('');
        expect(mockLogger.warn).toHaveBeenCalledWith(
          { fileName },
          'Extracted text is empty after trimming'
        );
      });
    });

    describe('Metadata validation', () => {
      it('should return correct fileSize metadata', async () => {
        const content = 'Test content with some text';
        const buffer = Buffer.from(content, 'utf-8');
        const fileName = 'test.txt';

        const result = await processor.extractText(buffer, fileName);

        expect(result.metadata.fileSize).toBe(buffer.length);
        expect(result.metadata.fileSize).toBeGreaterThan(0);
      });

      it('should always set ocrUsed to false for text files', async () => {
        const content = 'Plain text does not use OCR';
        const buffer = Buffer.from(content, 'utf-8');
        const fileName = 'test.txt';

        const result = await processor.extractText(buffer, fileName);

        expect(result.metadata.ocrUsed).toBe(false);
      });

      it('should return ExtractionResult with correct structure', async () => {
        const content = 'Test content';
        const buffer = Buffer.from(content, 'utf-8');
        const fileName = 'test.txt';

        const result = await processor.extractText(buffer, fileName);

        // Check result has correct shape
        expect(result).toHaveProperty('text');
        expect(result).toHaveProperty('metadata');

        // Check metadata has correct shape
        expect(result.metadata).toHaveProperty('fileSize');
        expect(result.metadata).toHaveProperty('ocrUsed');

        // Validate types
        expect(typeof result.text).toBe('string');
        expect(typeof result.metadata.fileSize).toBe('number');
        expect(typeof result.metadata.ocrUsed).toBe('boolean');
      });
    });

    describe('Logging behavior', () => {
      it('should log info on extraction start', async () => {
        const content = 'Test content';
        const buffer = Buffer.from(content, 'utf-8');
        const fileName = 'test.txt';

        await processor.extractText(buffer, fileName);

        expect(mockLogger.info).toHaveBeenCalledWith(
          { fileName, fileSize: buffer.length },
          'Starting text extraction'
        );
      });

      it('should log info on successful extraction', async () => {
        const content = 'Test content';
        const buffer = Buffer.from(content, 'utf-8');
        const fileName = 'test.txt';

        await processor.extractText(buffer, fileName);

        expect(mockLogger.info).toHaveBeenCalledWith(
          {
            fileName,
            textLength: content.length,
            fileSize: buffer.length,
          },
          'Text extraction completed successfully'
        );
      });

      it('should log error on extraction failure', async () => {
        const buffer = Buffer.from('', 'utf-8');
        const fileName = 'empty.txt';

        await expect(processor.extractText(buffer, fileName)).rejects.toThrow();

        // Buffer validation happens before try block, logs with simpler format
        expect(mockLogger.error).toHaveBeenCalledWith(
          { fileName },
          'Buffer is empty or undefined'
        );
      });
    });

    describe('Edge cases', () => {
      it('should handle very large text content', async () => {
        // Create 1MB of text
        const largeContent = 'A'.repeat(1024 * 1024);
        const buffer = Buffer.from(largeContent, 'utf-8');
        const fileName = 'large.txt';

        const result = await processor.extractText(buffer, fileName);

        expect(result.text.length).toBe(largeContent.length);
        expect(result.metadata.fileSize).toBe(buffer.length);
      });

      it('should handle text with only newlines', async () => {
        const content = '\n\n\n\n\n';
        const buffer = Buffer.from(content, 'utf-8');
        const fileName = 'newlines.txt';

        const result = await processor.extractText(buffer, fileName);

        expect(result.text).toBe('');
        expect(mockLogger.warn).toHaveBeenCalledWith(
          { fileName },
          'Extracted text is empty after trimming'
        );
      });

      it('should handle text with mixed line endings (CRLF and LF)', async () => {
        const content = 'Line 1\r\nLine 2\nLine 3\r\nLine 4';
        const buffer = Buffer.from(content, 'utf-8');
        const fileName = 'mixed-endings.txt';

        const result = await processor.extractText(buffer, fileName);

        expect(result.text).toBe(content);
        expect(result.text).toContain('\r\n');
        expect(result.text).toContain('\n');
      });

      it('should handle text with null bytes', async () => {
        const content = 'Text\x00with\x00null\x00bytes';
        const buffer = Buffer.from(content, 'utf-8');
        const fileName = 'null-bytes.txt';

        const result = await processor.extractText(buffer, fileName);

        expect(result.text).toContain('Text');
        expect(result.text).toContain('null');
        expect(result.text).toContain('bytes');
      });

      it('should handle single character', async () => {
        const content = 'A';
        const buffer = Buffer.from(content, 'utf-8');
        const fileName = 'single.txt';

        const result = await processor.extractText(buffer, fileName);

        expect(result.text).toBe('A');
        expect(result.metadata.fileSize).toBe(1);
      });

      it('should handle text with internal tabs and spaces (leading/trailing trimmed)', async () => {
        // Note: TextProcessor trims leading/trailing whitespace
        const content = 'Indented with tabs\n    Indented with spaces\n\t\tMore tabs here';
        const buffer = Buffer.from(content, 'utf-8');
        const fileName = 'indented.txt';

        const result = await processor.extractText(buffer, fileName);

        expect(result.text).toBe(content);
        expect(result.text).toContain('    '); // internal spaces preserved
        expect(result.text).toContain('\t\t'); // internal tabs preserved
      });
    });

    describe('Different file types (text-based)', () => {
      it('should extract from .txt files', async () => {
        const content = 'Plain text file content';
        const buffer = Buffer.from(content, 'utf-8');
        const fileName = 'document.txt';

        const result = await processor.extractText(buffer, fileName);

        expect(result.text).toBe(content);
      });

      it('should extract from .csv files', async () => {
        const content = 'col1,col2,col3\nval1,val2,val3';
        const buffer = Buffer.from(content, 'utf-8');
        const fileName = 'data.csv';

        const result = await processor.extractText(buffer, fileName);

        expect(result.text).toBe(content);
      });

      it('should extract from .md files', async () => {
        const content = '# Markdown Title\n\nSome **bold** text';
        const buffer = Buffer.from(content, 'utf-8');
        const fileName = 'readme.md';

        const result = await processor.extractText(buffer, fileName);

        expect(result.text).toBe(content);
      });

      it('should extract from .json files', async () => {
        const content = '{"key": "value"}';
        const buffer = Buffer.from(content, 'utf-8');
        const fileName = 'config.json';

        const result = await processor.extractText(buffer, fileName);

        expect(result.text).toBe(content);
      });

      it('should extract from .log files', async () => {
        const content = '[2024-01-01] INFO: Application started\n[2024-01-01] ERROR: Connection failed';
        const buffer = Buffer.from(content, 'utf-8');
        const fileName = 'app.log';

        const result = await processor.extractText(buffer, fileName);

        expect(result.text).toBe(content);
      });
    });
  });
});
