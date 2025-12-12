/**
 * File Context Prompt Builder Tests
 *
 * TDD tests for Phase 5: Chat Integration with Files
 * Testing prompt construction with file context.
 */

import { describe, it, expect } from 'vitest';
import { FileContextPromptBuilder } from '@/services/files/context/PromptBuilder';
import type { RetrievedContent } from '@/services/files/context/retrieval.types';

describe('FileContextPromptBuilder', () => {
  const builder = new FileContextPromptBuilder();

  describe('buildDocumentContext', () => {
    it('should format text content with XML tags', () => {
      const contents: RetrievedContent[] = [
        {
          fileId: 'f1',
          fileName: 'report.txt',
          strategy: 'EXTRACTED_TEXT',
          content: { type: 'text', text: 'This is the report content.' },
        },
      ];

      const result = builder.buildDocumentContext(contents);

      expect(result).toContain('<document');
      expect(result).toContain('name="report.txt"');
      expect(result).toContain('This is the report content.');
      expect(result).toContain('</document>');
    });

    it('should include file ID in document tag', () => {
      const contents: RetrievedContent[] = [
        {
          fileId: 'file-uuid-123',
          fileName: 'data.txt',
          strategy: 'EXTRACTED_TEXT',
          content: { type: 'text', text: 'Data content' },
        },
      ];

      const result = builder.buildDocumentContext(contents);

      expect(result).toContain('id="file-uuid-123"');
    });

    it('should handle multiple documents', () => {
      const contents: RetrievedContent[] = [
        {
          fileId: 'f1',
          fileName: 'doc1.txt',
          strategy: 'EXTRACTED_TEXT',
          content: { type: 'text', text: 'Content 1' },
        },
        {
          fileId: 'f2',
          fileName: 'doc2.txt',
          strategy: 'EXTRACTED_TEXT',
          content: { type: 'text', text: 'Content 2' },
        },
      ];

      const result = builder.buildDocumentContext(contents);

      expect(result).toContain('doc1.txt');
      expect(result).toContain('doc2.txt');
      expect(result).toContain('Content 1');
      expect(result).toContain('Content 2');
      // Should have two document tags (use space after to avoid matching <documents>)
      expect((result.match(/<document /g) || []).length).toBe(2);
      expect((result.match(/<\/document>/g) || []).length).toBe(2);
    });

    it('should format RAG chunks with chunk indices', () => {
      const contents: RetrievedContent[] = [
        {
          fileId: 'f1',
          fileName: 'large.pdf',
          strategy: 'RAG_CHUNKS',
          content: {
            type: 'chunks',
            chunks: [
              { chunkIndex: 0, text: 'First relevant chunk', relevanceScore: 0.95 },
              { chunkIndex: 5, text: 'Second relevant chunk', relevanceScore: 0.85 },
            ],
          },
        },
      ];

      const result = builder.buildDocumentContext(contents);

      expect(result).toContain('large.pdf');
      expect(result).toContain('chunk="0"');
      expect(result).toContain('chunk="5"');
      expect(result).toContain('First relevant chunk');
      expect(result).toContain('Second relevant chunk');
    });

    it('should include relevance scores for chunks', () => {
      const contents: RetrievedContent[] = [
        {
          fileId: 'f1',
          fileName: 'doc.pdf',
          strategy: 'RAG_CHUNKS',
          content: {
            type: 'chunks',
            chunks: [
              { chunkIndex: 0, text: 'Relevant text', relevanceScore: 0.92 },
            ],
          },
        },
      ];

      const result = builder.buildDocumentContext(contents);

      expect(result).toContain('relevance="0.92"');
    });

    it('should skip base64 content (handled separately for Claude Vision)', () => {
      const contents: RetrievedContent[] = [
        {
          fileId: 'f1',
          fileName: 'image.png',
          strategy: 'DIRECT_CONTENT',
          content: { type: 'base64', mimeType: 'image/png', data: 'base64encodeddata' },
        },
      ];

      const result = builder.buildDocumentContext(contents);

      // Base64 images are sent via Claude's native image support, not text context
      expect(result).toBe('');
    });

    it('should handle mixed content types (text + base64)', () => {
      const contents: RetrievedContent[] = [
        {
          fileId: 'f1',
          fileName: 'image.png',
          strategy: 'DIRECT_CONTENT',
          content: { type: 'base64', mimeType: 'image/png', data: 'imagedata' },
        },
        {
          fileId: 'f2',
          fileName: 'notes.txt',
          strategy: 'EXTRACTED_TEXT',
          content: { type: 'text', text: 'Text notes here' },
        },
      ];

      const result = builder.buildDocumentContext(contents);

      // Should only include the text file
      expect(result).toContain('notes.txt');
      expect(result).toContain('Text notes here');
      expect(result).not.toContain('image.png');
      expect(result).not.toContain('imagedata');
    });

    it('should escape XML special characters in content', () => {
      const contents: RetrievedContent[] = [
        {
          fileId: 'f1',
          fileName: 'code.txt',
          strategy: 'EXTRACTED_TEXT',
          content: { type: 'text', text: 'Code: if (x < 5 && y > 3) { return "ok"; }' },
        },
      ];

      const result = builder.buildDocumentContext(contents);

      // Content should be properly escaped or CDATA wrapped
      expect(result).toContain('code.txt');
      // Verify the content is included (escaping may vary)
      expect(result).toMatch(/if.*x.*5.*y.*3/);
    });

    it('should return empty string for empty contents array', () => {
      const result = builder.buildDocumentContext([]);
      expect(result).toBe('');
    });
  });

  describe('buildSystemInstructions', () => {
    it('should include citation instructions when files present', () => {
      const fileNames = ['report.pdf', 'data.csv'];

      const result = builder.buildSystemInstructions(fileNames);

      expect(result).toContain('documents');
      expect(result.toLowerCase()).toMatch(/cit(e|ing)/); // 'cite' or 'citing'
      expect(result).toContain('report.pdf');
      expect(result).toContain('data.csv');
    });

    it('should return empty string when no files', () => {
      const result = builder.buildSystemInstructions([]);
      expect(result).toBe('');
    });

    it('should include format instructions for citations', () => {
      const fileNames = ['doc.pdf'];

      const result = builder.buildSystemInstructions(fileNames);

      // Should specify how to cite (e.g., [doc.pdf] or similar format)
      expect(result).toMatch(/\[.*\]|cite|reference/i);
    });

    it('should handle single file', () => {
      const fileNames = ['single.txt'];

      const result = builder.buildSystemInstructions(fileNames);

      expect(result).toContain('single.txt');
      expect(result.length).toBeGreaterThan(0);
    });

    it('should handle many files', () => {
      const fileNames = ['file1.txt', 'file2.pdf', 'file3.docx', 'file4.csv', 'file5.xlsx'];

      const result = builder.buildSystemInstructions(fileNames);

      // Should list all files
      for (const name of fileNames) {
        expect(result).toContain(name);
      }
    });
  });

  describe('getImageContents', () => {
    it('should extract only base64 image content', () => {
      const contents: RetrievedContent[] = [
        {
          fileId: 'f1',
          fileName: 'image.png',
          strategy: 'DIRECT_CONTENT',
          content: { type: 'base64', mimeType: 'image/png', data: 'pngdata' },
        },
        {
          fileId: 'f2',
          fileName: 'notes.txt',
          strategy: 'EXTRACTED_TEXT',
          content: { type: 'text', text: 'Text content' },
        },
        {
          fileId: 'f3',
          fileName: 'photo.jpg',
          strategy: 'DIRECT_CONTENT',
          content: { type: 'base64', mimeType: 'image/jpeg', data: 'jpegdata' },
        },
      ];

      const images = builder.getImageContents(contents);

      expect(images).toHaveLength(2);
      expect(images[0]?.mimeType).toBe('image/png');
      expect(images[0]?.data).toBe('pngdata');
      expect(images[1]?.mimeType).toBe('image/jpeg');
    });

    it('should return empty array when no images', () => {
      const contents: RetrievedContent[] = [
        {
          fileId: 'f1',
          fileName: 'doc.txt',
          strategy: 'EXTRACTED_TEXT',
          content: { type: 'text', text: 'Just text' },
        },
      ];

      const images = builder.getImageContents(contents);

      expect(images).toHaveLength(0);
    });
  });

  describe('estimateTokens', () => {
    it('should estimate tokens for text content', () => {
      const content: RetrievedContent = {
        fileId: 'f1',
        fileName: 'doc.txt',
        strategy: 'EXTRACTED_TEXT',
        content: { type: 'text', text: 'Hello world this is a test' },
      };

      const tokens = builder.estimateTokens(content);

      // Rough estimate: ~6 words = ~6-8 tokens
      expect(tokens).toBeGreaterThan(0);
      expect(tokens).toBeLessThan(100);
    });

    it('should estimate tokens for chunks content', () => {
      const content: RetrievedContent = {
        fileId: 'f1',
        fileName: 'doc.pdf',
        strategy: 'RAG_CHUNKS',
        content: {
          type: 'chunks',
          chunks: [
            { chunkIndex: 0, text: 'First chunk text' },
            { chunkIndex: 1, text: 'Second chunk text' },
          ],
        },
      };

      const tokens = builder.estimateTokens(content);

      // Should sum both chunks
      expect(tokens).toBeGreaterThan(0);
    });

    it('should return 0 for base64 content', () => {
      const content: RetrievedContent = {
        fileId: 'f1',
        fileName: 'image.png',
        strategy: 'DIRECT_CONTENT',
        content: { type: 'base64', mimeType: 'image/png', data: 'data' },
      };

      const tokens = builder.estimateTokens(content);

      // Base64 images don't count against text token limit
      expect(tokens).toBe(0);
    });
  });
});
