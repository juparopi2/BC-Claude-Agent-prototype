/**
 * convertToLangChainFormat Unit Tests
 *
 * Tests for the utility that converts Anthropic native content blocks
 * to LangChain-compatible format.
 */

import { describe, it, expect } from 'vitest';
import type {
  AnthropicAttachmentContentBlock,
  LangChainContentBlock,
} from '@bc-agent/shared';
import { convertToLangChainFormat } from '@shared/providers/utils/content-format';

describe('convertToLangChainFormat', () => {
  // --------------------------------------------------------
  // 1. Base64 image → image_url with data URI
  // --------------------------------------------------------
  describe('base64 image blocks', () => {
    it('should convert a base64 image to image_url with a data URI', () => {
      const blocks: AnthropicAttachmentContentBlock[] = [
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: 'image/png',
            data: 'abc123==',
          },
        },
      ];

      const result = convertToLangChainFormat(blocks);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        type: 'image_url',
        image_url: { url: 'data:image/png;base64,abc123==' },
      });
    });

    it('should build the data URI from media_type and data fields', () => {
      const blocks: AnthropicAttachmentContentBlock[] = [
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: 'image/jpeg',
            data: '/9j/4AAQSkZJRg==',
          },
        },
      ];

      const result = convertToLangChainFormat(blocks);

      expect(result[0]).toMatchObject({
        type: 'image_url',
        image_url: { url: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==' },
      });
    });
  });

  // --------------------------------------------------------
  // 2. Base64 document → document pass-through
  // --------------------------------------------------------
  describe('base64 document blocks', () => {
    it('should pass through a base64 document block unchanged', () => {
      const blocks: AnthropicAttachmentContentBlock[] = [
        {
          type: 'document',
          source: {
            type: 'base64',
            media_type: 'application/pdf',
            data: 'JVBERi0xLjQ=',
          },
        },
      ];

      const result = convertToLangChainFormat(blocks);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        type: 'document',
        source: {
          type: 'base64',
          media_type: 'application/pdf',
          data: 'JVBERi0xLjQ=',
        },
      });
    });

    it('should preserve the full source object for a base64 text document', () => {
      const source = { type: 'base64' as const, media_type: 'text/plain', data: 'SGVsbG8=' };
      const blocks: AnthropicAttachmentContentBlock[] = [
        { type: 'document', source },
      ];

      const result = convertToLangChainFormat(blocks);

      expect((result[0] as { source: unknown }).source).toEqual(source);
    });
  });

  // --------------------------------------------------------
  // 3. Files API image → pass-through (type preserved)
  // --------------------------------------------------------
  describe('Files API image blocks', () => {
    it('should pass through a Files API image block as-is', () => {
      const blocks: AnthropicAttachmentContentBlock[] = [
        {
          type: 'image',
          source: {
            type: 'file',
            file_id: 'file_abc123',
          },
        },
      ];

      const result = convertToLangChainFormat(blocks);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        type: 'image',
        source: {
          type: 'file',
          file_id: 'file_abc123',
        },
      });
    });
  });

  // --------------------------------------------------------
  // 4. Files API document → pass-through (type preserved)
  // --------------------------------------------------------
  describe('Files API document blocks', () => {
    it('should pass through a Files API document block as-is', () => {
      const blocks: AnthropicAttachmentContentBlock[] = [
        {
          type: 'document',
          source: {
            type: 'file',
            file_id: 'file_xyz789',
          },
        },
      ];

      const result = convertToLangChainFormat(blocks);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        type: 'document',
        source: {
          type: 'file',
          file_id: 'file_xyz789',
        },
      });
    });
  });

  // --------------------------------------------------------
  // 5. URL image → image_url with HTTPS URL (new)
  // --------------------------------------------------------
  describe('URL image blocks', () => {
    it('should convert a URL image block to image_url with the HTTPS URL', () => {
      const sasUrl = 'https://mystorage.blob.core.windows.net/container/image.png?sv=2021-08-06&sig=abc';
      const blocks: AnthropicAttachmentContentBlock[] = [
        {
          type: 'image',
          source: {
            type: 'url',
            url: sasUrl,
          },
        },
      ];

      const result = convertToLangChainFormat(blocks);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        type: 'image_url',
        image_url: { url: sasUrl },
      });
    });

    it('should use the URL as-is (no data URI wrapping) for URL images', () => {
      const url = 'https://example.com/photo.webp';
      const blocks: AnthropicAttachmentContentBlock[] = [
        {
          type: 'image',
          source: { type: 'url', url },
        },
      ];

      const result = convertToLangChainFormat(blocks);

      const imageBlock = result[0] as { type: string; image_url: { url: string } };
      expect(imageBlock.type).toBe('image_url');
      expect(imageBlock.image_url.url).toBe(url);
      expect(imageBlock.image_url.url).not.toContain('base64');
    });
  });

  // --------------------------------------------------------
  // 6. URL document → document pass-through with url source (new)
  // --------------------------------------------------------
  describe('URL document blocks', () => {
    it('should pass through a URL document block with the url source intact', () => {
      const sasUrl = 'https://mystorage.blob.core.windows.net/container/doc.pdf?sv=2021-08-06&sig=xyz';
      const blocks: AnthropicAttachmentContentBlock[] = [
        {
          type: 'document',
          source: {
            type: 'url',
            url: sasUrl,
          },
        },
      ];

      const result = convertToLangChainFormat(blocks);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        type: 'document',
        source: {
          type: 'url',
          url: sasUrl,
        },
      });
    });

    it('should produce a document (not image_url) for URL document blocks', () => {
      const blocks: AnthropicAttachmentContentBlock[] = [
        {
          type: 'document',
          source: { type: 'url', url: 'https://example.com/report.pdf' },
        },
      ];

      const result = convertToLangChainFormat(blocks);

      expect(result[0].type).toBe('document');
    });
  });

  // --------------------------------------------------------
  // 7. Empty array → empty array
  // --------------------------------------------------------
  describe('empty input', () => {
    it('should return an empty array when given an empty array', () => {
      const result = convertToLangChainFormat([]);

      expect(result).toEqual([]);
      expect(result).toHaveLength(0);
    });
  });

  // --------------------------------------------------------
  // 8. Mixed blocks (base64 image + URL document + file image)
  // --------------------------------------------------------
  describe('mixed blocks', () => {
    it('should correctly convert each block type independently in a mixed array', () => {
      const sasUrl = 'https://storage.example.com/doc.pdf?sig=test';
      const blocks: AnthropicAttachmentContentBlock[] = [
        // base64 image
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: 'image/gif',
            data: 'R0lGODlhAQ==',
          },
        },
        // URL document
        {
          type: 'document',
          source: {
            type: 'url',
            url: sasUrl,
          },
        },
        // Files API image
        {
          type: 'image',
          source: {
            type: 'file',
            file_id: 'file_mixed_001',
          },
        },
      ];

      const result: LangChainContentBlock[] = convertToLangChainFormat(blocks);

      expect(result).toHaveLength(3);

      // First block: base64 image → image_url data URI
      expect(result[0]).toEqual({
        type: 'image_url',
        image_url: { url: 'data:image/gif;base64,R0lGODlhAQ==' },
      });

      // Second block: URL document → document pass-through
      expect(result[1]).toEqual({
        type: 'document',
        source: { type: 'url', url: sasUrl },
      });

      // Third block: Files API image → pass-through
      expect(result[2]).toMatchObject({
        type: 'image',
        source: { type: 'file', file_id: 'file_mixed_001' },
      });
    });

    it('should preserve order of output blocks matching input order', () => {
      const blocks: AnthropicAttachmentContentBlock[] = [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'pdf1' } },
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'img1' } },
        { type: 'document', source: { type: 'file', file_id: 'file_001' } },
      ];

      const result = convertToLangChainFormat(blocks);

      expect(result[0].type).toBe('document');
      expect(result[1].type).toBe('image_url');
      expect(result[2].type).toBe('document');
    });
  });
});
