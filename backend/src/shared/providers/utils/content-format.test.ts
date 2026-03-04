import { describe, it, expect } from 'vitest';
import { convertToLangChainFormat } from './content-format';
import type {
  AnthropicAttachmentContentBlock,
  AnthropicImageBlock,
  AnthropicDocumentBlock,
  AnthropicFileImageBlock,
  AnthropicFileDocumentBlock,
  AnthropicUrlImageBlock,
  AnthropicUrlDocumentBlock,
  AnthropicContainerUploadBlock,
} from '@bc-agent/shared';

describe('convertToLangChainFormat', () => {
  it('should convert a base64 image block to image_url with data URI', () => {
    const block: AnthropicImageBlock = {
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/png',
        data: 'abc123==',
      },
    };

    const result = convertToLangChainFormat([block]);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      type: 'image_url',
      image_url: { url: 'data:image/png;base64,abc123==' },
    });
  });

  it('should pass through a base64 document block unchanged', () => {
    const block: AnthropicDocumentBlock = {
      type: 'document',
      source: {
        type: 'base64',
        media_type: 'application/pdf',
        data: 'pdfdata==',
      },
    };

    const result = convertToLangChainFormat([block]);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      type: 'document',
      source: {
        type: 'base64',
        media_type: 'application/pdf',
        data: 'pdfdata==',
      },
    });
  });

  it('should pass through a Files API image reference with source type file', () => {
    const block: AnthropicFileImageBlock = {
      type: 'image',
      source: {
        type: 'file',
        file_id: 'file-abc123',
      },
    };

    const result = convertToLangChainFormat([block]);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      type: 'image',
      source: { type: 'file', file_id: 'file-abc123' },
    });
  });

  it('should pass through a Files API document reference with source type file', () => {
    const block: AnthropicFileDocumentBlock = {
      type: 'document',
      source: {
        type: 'file',
        file_id: 'file-def456',
      },
    };

    const result = convertToLangChainFormat([block]);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      type: 'document',
      source: { type: 'file', file_id: 'file-def456' },
    });
  });

  it('should convert a URL image block to image_url with the HTTPS URL', () => {
    const block: AnthropicUrlImageBlock = {
      type: 'image',
      source: {
        type: 'url',
        url: 'https://example.blob.core.windows.net/container/image.png?sas=token',
      },
    };

    const result = convertToLangChainFormat([block]);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      type: 'image_url',
      image_url: {
        url: 'https://example.blob.core.windows.net/container/image.png?sas=token',
      },
    });
  });

  it('should pass through a URL document block with the source object intact', () => {
    const block: AnthropicUrlDocumentBlock = {
      type: 'document',
      source: {
        type: 'url',
        url: 'https://example.blob.core.windows.net/container/document.pdf?sas=token',
      },
    };

    const result = convertToLangChainFormat([block]);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      type: 'document',
      source: {
        type: 'url',
        url: 'https://example.blob.core.windows.net/container/document.pdf?sas=token',
      },
    });
  });

  it('should pass through a container_upload block unchanged', () => {
    const block: AnthropicContainerUploadBlock = {
      type: 'container_upload',
      file_id: 'file-sandbox-xyz',
    };

    const result = convertToLangChainFormat([block]);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      type: 'container_upload',
      file_id: 'file-sandbox-xyz',
    });
  });

  it('should correctly convert a mixed array of image, document, and container_upload blocks', () => {
    const blocks: AnthropicAttachmentContentBlock[] = [
      {
        type: 'image',
        source: { type: 'base64', media_type: 'image/jpeg', data: 'imgdata==' },
      } as AnthropicImageBlock,
      {
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: 'docdata==' },
      } as AnthropicDocumentBlock,
      {
        type: 'container_upload',
        file_id: 'file-mixed-001',
      } as AnthropicContainerUploadBlock,
    ];

    const result = convertToLangChainFormat(blocks);

    expect(result).toHaveLength(3);

    expect(result[0]).toEqual({
      type: 'image_url',
      image_url: { url: 'data:image/jpeg;base64,imgdata==' },
    });

    expect(result[1]).toEqual({
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: 'docdata==' },
    });

    expect(result[2]).toEqual({
      type: 'container_upload',
      file_id: 'file-mixed-001',
    });
  });

  it('should return an empty array when given an empty array', () => {
    const result = convertToLangChainFormat([]);
    expect(result).toEqual([]);
  });
});
