/**
 * CitationParser Unit Tests
 *
 * Phase 5: Chat Integration with Files - Ciclo 4
 * Tests for parsing file citations from Claude's response text.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { CitationParser } from '@/services/files/citations/CitationParser';

describe('CitationParser', () => {
  let parser: CitationParser;

  beforeEach(() => {
    parser = new CitationParser();
  });

  describe('parseCitations', () => {
    it('should parse single citation [filename.ext]', () => {
      const text = 'Según [report.pdf], el valor es 100.';
      const fileMap = new Map([['report.pdf', 'file-uuid-1']]);

      const result = parser.parseCitations(text, fileMap);

      expect(result.citations).toHaveLength(1);
      expect(result.citations[0]?.fileName).toBe('report.pdf');
      expect(result.citations[0]?.fileId).toBe('file-uuid-1');
      expect(result.citations[0]?.rawText).toBe('[report.pdf]');
      expect(result.citations[0]?.startIndex).toBe(6);
      expect(result.citations[0]?.endIndex).toBe(18);
      expect(result.matchedFileIds).toContain('file-uuid-1');
    });

    it('should parse multiple different citations', () => {
      const text = 'Según [doc1.pdf] y [data.csv], los datos son correctos.';
      const fileMap = new Map([
        ['doc1.pdf', 'file-1'],
        ['data.csv', 'file-2'],
      ]);

      const result = parser.parseCitations(text, fileMap);

      expect(result.citations).toHaveLength(2);
      expect(result.citations[0]?.fileName).toBe('doc1.pdf');
      expect(result.citations[0]?.fileId).toBe('file-1');
      expect(result.citations[1]?.fileName).toBe('data.csv');
      expect(result.citations[1]?.fileId).toBe('file-2');
      expect(result.matchedFileIds).toEqual(['file-1', 'file-2']);
    });

    it('should handle citations not in context (unmatched)', () => {
      const text = 'Según [unknown.pdf], algo pasó.';
      const fileMap = new Map([['other.pdf', 'file-1']]);

      const result = parser.parseCitations(text, fileMap);

      expect(result.citations).toHaveLength(1);
      expect(result.citations[0]?.fileName).toBe('unknown.pdf');
      expect(result.citations[0]?.fileId).toBeNull();
      expect(result.matchedFileIds).toHaveLength(0);
    });

    it('should not match numeric references like [1] or [42]', () => {
      const text = 'This is a reference [1] and another [42].';
      const fileMap = new Map<string, string>();

      const result = parser.parseCitations(text, fileMap);

      // Numeric references should NOT be matched (no dot in them)
      expect(result.citations).toHaveLength(0);
    });

    it('should not match text without extension like [example]', () => {
      const text = 'This is [example text] and [another reference].';
      const fileMap = new Map<string, string>();

      const result = parser.parseCitations(text, fileMap);

      // Text without dots should NOT be matched
      expect(result.citations).toHaveLength(0);
    });

    it('should handle duplicate citations with same file', () => {
      const text = 'En [report.pdf] dice X. También en [report.pdf] dice Y.';
      const fileMap = new Map([['report.pdf', 'file-1']]);

      const result = parser.parseCitations(text, fileMap);

      expect(result.citations).toHaveLength(2);
      expect(result.citations[0]?.fileId).toBe('file-1');
      expect(result.citations[1]?.fileId).toBe('file-1');
      // matchedFileIds should be unique (deduplicated)
      expect(result.matchedFileIds).toEqual(['file-1']);
    });

    it('should handle empty text', () => {
      const result = parser.parseCitations('', new Map());

      expect(result.originalText).toBe('');
      expect(result.citations).toHaveLength(0);
      expect(result.matchedFileIds).toHaveLength(0);
    });

    it('should handle text with no citations', () => {
      const text = 'This is just regular text without any citations.';
      const fileMap = new Map([['report.pdf', 'file-1']]);

      const result = parser.parseCitations(text, fileMap);

      expect(result.originalText).toBe(text);
      expect(result.citations).toHaveLength(0);
      expect(result.matchedFileIds).toHaveLength(0);
    });

    it('should preserve original text in result', () => {
      const text = 'Original [file.txt] text here.';
      const fileMap = new Map([['file.txt', 'file-id']]);

      const result = parser.parseCitations(text, fileMap);

      expect(result.originalText).toBe(text);
      expect(result.processedText).toBe(text);
    });

    it('should handle various file extensions', () => {
      const text = 'See [report.pdf], [data.xlsx], [image.png], and [doc.docx].';
      const fileMap = new Map([
        ['report.pdf', 'f1'],
        ['data.xlsx', 'f2'],
        ['image.png', 'f3'],
        ['doc.docx', 'f4'],
      ]);

      const result = parser.parseCitations(text, fileMap);

      expect(result.citations).toHaveLength(4);
      expect(result.matchedFileIds).toEqual(['f1', 'f2', 'f3', 'f4']);
    });

    it('should handle filenames with multiple dots', () => {
      const text = 'Check [my.file.name.pdf] for details.';
      const fileMap = new Map([['my.file.name.pdf', 'file-multi-dot']]);

      const result = parser.parseCitations(text, fileMap);

      expect(result.citations).toHaveLength(1);
      expect(result.citations[0]?.fileName).toBe('my.file.name.pdf');
      expect(result.citations[0]?.fileId).toBe('file-multi-dot');
    });

    it('should handle filenames with spaces', () => {
      const text = 'Refer to [my document.pdf] for info.';
      const fileMap = new Map([['my document.pdf', 'file-with-space']]);

      const result = parser.parseCitations(text, fileMap);

      expect(result.citations).toHaveLength(1);
      expect(result.citations[0]?.fileName).toBe('my document.pdf');
      expect(result.citations[0]?.fileId).toBe('file-with-space');
    });

    it('should handle mixed matched and unmatched citations', () => {
      const text = 'See [known.pdf] and [unknown.docx] for details.';
      const fileMap = new Map([['known.pdf', 'file-known']]);

      const result = parser.parseCitations(text, fileMap);

      expect(result.citations).toHaveLength(2);
      expect(result.citations[0]?.fileId).toBe('file-known');
      expect(result.citations[1]?.fileId).toBeNull();
      expect(result.matchedFileIds).toEqual(['file-known']);
    });

    it('should handle citation at start of text', () => {
      const text = '[report.pdf] contains the data.';
      const fileMap = new Map([['report.pdf', 'f1']]);

      const result = parser.parseCitations(text, fileMap);

      expect(result.citations).toHaveLength(1);
      expect(result.citations[0]?.startIndex).toBe(0);
    });

    it('should handle citation at end of text', () => {
      const text = 'See the data in [report.pdf]';
      const fileMap = new Map([['report.pdf', 'f1']]);

      const result = parser.parseCitations(text, fileMap);

      expect(result.citations).toHaveLength(1);
      expect(result.citations[0]?.endIndex).toBe(text.length);
    });
  });
});
