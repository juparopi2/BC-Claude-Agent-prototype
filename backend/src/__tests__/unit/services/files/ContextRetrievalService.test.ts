/**
 * Context Retrieval Service Tests
 *
 * TDD tests for Phase 5: Chat Integration with Files
 * Testing content retrieval based on context strategy.
 *
 * Strategy Rules:
 * - DIRECT_CONTENT (images) → base64 encoded
 * - DIRECT_CONTENT (text) → plain text from blob
 * - EXTRACTED_TEXT → extracted_text from database
 * - RAG_CHUNKS → relevant chunks from vector search
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ContextRetrievalService } from '@/services/files/context/ContextRetrievalService';
import type { ParsedFile } from '@/types/file.types';
import type { SearchResult } from '@/services/search/types';

describe('ContextRetrievalService', () => {
  let service: ContextRetrievalService;
  let mockFileService: {
    getFile: ReturnType<typeof vi.fn>;
    getFileWithExtractedText: ReturnType<typeof vi.fn>;
  };
  let mockFileUploadService: {
    downloadFromBlob: ReturnType<typeof vi.fn>;
  };
  let mockVectorSearchService: {
    search: ReturnType<typeof vi.fn>;
  };
  let mockEmbeddingService: {
    embedText: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockFileService = {
      getFile: vi.fn(),
      getFileWithExtractedText: vi.fn(),
    };
    mockFileUploadService = {
      downloadFromBlob: vi.fn(),
    };
    mockVectorSearchService = {
      search: vi.fn(),
    };
    mockEmbeddingService = {
      embedText: vi.fn(),
    };

    service = new ContextRetrievalService(
      mockFileService as unknown as Parameters<typeof ContextRetrievalService.prototype.constructor>[0],
      mockFileUploadService as unknown as Parameters<typeof ContextRetrievalService.prototype.constructor>[1],
      mockVectorSearchService as unknown as Parameters<typeof ContextRetrievalService.prototype.constructor>[2],
      mockEmbeddingService as unknown as Parameters<typeof ContextRetrievalService.prototype.constructor>[3]
    );
  });

  describe('retrieveContent', () => {
    describe('DIRECT_CONTENT strategy - Images', () => {
      it('should download and return base64 for PNG images', async () => {
        const file: ParsedFile = {
          id: 'file-1',
          userId: 'user-1',
          name: 'image.png',
          mimeType: 'image/png',
          sizeBytes: 1000,
          blobPath: 'users/user-1/files/image.png',
          isFolder: false,
          isFavorite: false,
          parentFolderId: null,
          processingStatus: 'completed',
          embeddingStatus: 'pending',
          hasExtractedText: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        const imageBuffer = Buffer.from('fake-image-data');
        mockFileUploadService.downloadFromBlob.mockResolvedValue(imageBuffer);

        const result = await service.retrieveContent('user-1', file);

        expect(result.strategy).toBe('DIRECT_CONTENT');
        expect(result.content.type).toBe('base64');
        if (result.content.type === 'base64') {
          expect(result.content.mimeType).toBe('image/png');
          expect(result.content.data).toBe(imageBuffer.toString('base64'));
        }
        expect(mockFileUploadService.downloadFromBlob).toHaveBeenCalledWith(file.blobPath);
      });

      it('should download and return base64 for JPEG images', async () => {
        const file: ParsedFile = {
          id: 'file-2',
          userId: 'user-1',
          name: 'photo.jpg',
          mimeType: 'image/jpeg',
          sizeBytes: 5000,
          blobPath: 'users/user-1/files/photo.jpg',
          isFolder: false,
          isFavorite: false,
          parentFolderId: null,
          processingStatus: 'completed',
          embeddingStatus: 'pending',
          hasExtractedText: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        const imageBuffer = Buffer.from('jpeg-data');
        mockFileUploadService.downloadFromBlob.mockResolvedValue(imageBuffer);

        const result = await service.retrieveContent('user-1', file);

        expect(result.strategy).toBe('DIRECT_CONTENT');
        expect(result.content.type).toBe('base64');
        if (result.content.type === 'base64') {
          expect(result.content.mimeType).toBe('image/jpeg');
        }
      });
    });

    describe('DIRECT_CONTENT strategy - Text files', () => {
      it('should download and return text for small text files', async () => {
        const file: ParsedFile = {
          id: 'file-3',
          userId: 'user-1',
          name: 'notes.txt',
          mimeType: 'text/plain',
          sizeBytes: 500,
          blobPath: 'users/user-1/files/notes.txt',
          isFolder: false,
          isFavorite: false,
          parentFolderId: null,
          processingStatus: 'pending',
          embeddingStatus: 'pending',
          hasExtractedText: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        const textContent = 'Hello World - This is my notes file.';
        mockFileUploadService.downloadFromBlob.mockResolvedValue(Buffer.from(textContent));

        const result = await service.retrieveContent('user-1', file);

        expect(result.strategy).toBe('DIRECT_CONTENT');
        expect(result.content.type).toBe('text');
        if (result.content.type === 'text') {
          expect(result.content.text).toBe(textContent);
        }
      });

      it('should return text for markdown files', async () => {
        const file: ParsedFile = {
          id: 'file-4',
          userId: 'user-1',
          name: 'README.md',
          mimeType: 'text/markdown',
          sizeBytes: 1000,
          blobPath: 'users/user-1/files/README.md',
          isFolder: false,
          isFavorite: false,
          parentFolderId: null,
          processingStatus: 'pending',
          embeddingStatus: 'pending',
          hasExtractedText: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        const markdown = '# Title\n\nSome content here.';
        mockFileUploadService.downloadFromBlob.mockResolvedValue(Buffer.from(markdown));

        const result = await service.retrieveContent('user-1', file);

        expect(result.strategy).toBe('DIRECT_CONTENT');
        expect(result.content.type).toBe('text');
      });
    });

    describe('EXTRACTED_TEXT strategy', () => {
      it('should return extracted text from database for PDFs with extraction', async () => {
        const file: ParsedFile = {
          id: 'file-5',
          userId: 'user-1',
          name: 'document.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 5_000_000,
          blobPath: 'users/user-1/files/document.pdf',
          isFolder: false,
          isFavorite: false,
          parentFolderId: null,
          processingStatus: 'completed',
          embeddingStatus: 'completed',
          hasExtractedText: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        const extractedText = 'This is the extracted content from the PDF document.';
        mockFileService.getFileWithExtractedText.mockResolvedValue({
          ...file,
          extractedText,
        });

        const result = await service.retrieveContent('user-1', file);

        expect(result.strategy).toBe('EXTRACTED_TEXT');
        expect(result.content.type).toBe('text');
        if (result.content.type === 'text') {
          expect(result.content.text).toBe(extractedText);
        }
        expect(mockFileService.getFileWithExtractedText).toHaveBeenCalledWith('user-1', 'file-5');
      });

      it('should return extracted text for DOCX files', async () => {
        const file: ParsedFile = {
          id: 'file-6',
          userId: 'user-1',
          name: 'report.docx',
          mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          sizeBytes: 200_000,
          blobPath: 'users/user-1/files/report.docx',
          isFolder: false,
          isFavorite: false,
          parentFolderId: null,
          processingStatus: 'completed',
          embeddingStatus: 'completed',
          hasExtractedText: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        mockFileService.getFileWithExtractedText.mockResolvedValue({
          ...file,
          extractedText: 'DOCX extracted content',
        });

        const result = await service.retrieveContent('user-1', file);

        expect(result.strategy).toBe('EXTRACTED_TEXT');
        expect(result.content.type).toBe('text');
      });
    });

    describe('RAG_CHUNKS strategy', () => {
      it('should search and return relevant chunks for large files', async () => {
        const file: ParsedFile = {
          id: 'file-7',
          userId: 'user-1',
          name: 'large-document.txt',
          mimeType: 'text/plain',
          sizeBytes: 50_000_000, // 50MB - over 30MB threshold
          blobPath: 'users/user-1/files/large-document.txt',
          isFolder: false,
          isFavorite: false,
          parentFolderId: null,
          processingStatus: 'completed',
          embeddingStatus: 'completed',
          hasExtractedText: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        const queryEmbedding = new Array(1536).fill(0.1);
        mockEmbeddingService.embedText.mockResolvedValue(queryEmbedding);

        const searchResults: SearchResult[] = [
          { chunkId: 'chunk-1', fileId: 'file-7', content: 'First relevant chunk', score: 0.95, chunkIndex: 0 },
          { chunkId: 'chunk-2', fileId: 'file-7', content: 'Second relevant chunk', score: 0.85, chunkIndex: 5 },
        ];
        mockVectorSearchService.search.mockResolvedValue(searchResults);

        const result = await service.retrieveContent('user-1', file, {
          userQuery: 'What is the main topic?',
          maxChunks: 5,
        });

        expect(result.strategy).toBe('RAG_CHUNKS');
        expect(result.content.type).toBe('chunks');
        if (result.content.type === 'chunks') {
          expect(result.content.chunks).toHaveLength(2);
          expect(result.content.chunks[0]?.text).toBe('First relevant chunk');
          expect(result.content.chunks[0]?.relevanceScore).toBe(0.95);
          expect(result.content.chunks[1]?.chunkIndex).toBe(5);
        }

        expect(mockEmbeddingService.embedText).toHaveBeenCalledWith('What is the main topic?');
        expect(mockVectorSearchService.search).toHaveBeenCalledWith(
          expect.objectContaining({
            embedding: queryEmbedding,
            userId: 'user-1',
            top: 5,
          })
        );
      });

      it('should fallback to EXTRACTED_TEXT if no query provided for RAG', async () => {
        const file: ParsedFile = {
          id: 'file-8',
          userId: 'user-1',
          name: 'large-doc.txt',
          mimeType: 'text/plain',
          sizeBytes: 50_000_000,
          blobPath: 'users/user-1/files/large-doc.txt',
          isFolder: false,
          isFavorite: false,
          parentFolderId: null,
          processingStatus: 'completed',
          embeddingStatus: 'completed',
          hasExtractedText: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        mockFileService.getFileWithExtractedText.mockResolvedValue({
          ...file,
          extractedText: 'Full extracted text (truncated)',
        });

        // No userQuery provided - should fallback to extracted text
        const result = await service.retrieveContent('user-1', file);

        expect(result.strategy).toBe('EXTRACTED_TEXT');
        expect(result.content.type).toBe('text');
      });
    });

    describe('Error handling', () => {
      it('should throw if blob download fails', async () => {
        const file: ParsedFile = {
          id: 'file-err-1',
          userId: 'user-1',
          name: 'broken.txt',
          mimeType: 'text/plain',
          sizeBytes: 100,
          blobPath: 'users/user-1/files/broken.txt',
          isFolder: false,
          isFavorite: false,
          parentFolderId: null,
          processingStatus: 'pending',
          embeddingStatus: 'pending',
          hasExtractedText: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        mockFileUploadService.downloadFromBlob.mockRejectedValue(new Error('Blob not found'));

        await expect(service.retrieveContent('user-1', file)).rejects.toThrow('Blob not found');
      });

      it('should throw if extracted text not found', async () => {
        const file: ParsedFile = {
          id: 'file-err-2',
          userId: 'user-1',
          name: 'missing.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 5000,
          blobPath: 'users/user-1/files/missing.pdf',
          isFolder: false,
          isFavorite: false,
          parentFolderId: null,
          processingStatus: 'completed',
          embeddingStatus: 'completed',
          hasExtractedText: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        mockFileService.getFileWithExtractedText.mockResolvedValue({
          ...file,
          extractedText: null, // No text despite hasExtractedText
        });

        await expect(service.retrieveContent('user-1', file)).rejects.toThrow(
          /extracted text not found/i
        );
      });
    });
  });

  describe('retrieveMultiple', () => {
    it('should retrieve content for multiple files', async () => {
      const files: ParsedFile[] = [
        {
          id: 'f1',
          userId: 'user-1',
          name: 'doc.txt',
          mimeType: 'text/plain',
          sizeBytes: 100,
          blobPath: 'users/user-1/files/doc.txt',
          isFolder: false,
          isFavorite: false,
          parentFolderId: null,
          processingStatus: 'pending',
          embeddingStatus: 'pending',
          hasExtractedText: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: 'f2',
          userId: 'user-1',
          name: 'image.png',
          mimeType: 'image/png',
          sizeBytes: 1000,
          blobPath: 'users/user-1/files/image.png',
          isFolder: false,
          isFavorite: false,
          parentFolderId: null,
          processingStatus: 'pending',
          embeddingStatus: 'pending',
          hasExtractedText: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];

      mockFileUploadService.downloadFromBlob
        .mockResolvedValueOnce(Buffer.from('text content'))
        .mockResolvedValueOnce(Buffer.from('image-bytes'));

      const result = await service.retrieveMultiple('user-1', files);

      expect(result.contents).toHaveLength(2);
      expect(result.failures).toHaveLength(0);
    });

    it('should include failures for files that error', async () => {
      const files: ParsedFile[] = [
        {
          id: 'f-ok',
          userId: 'user-1',
          name: 'good.txt',
          mimeType: 'text/plain',
          sizeBytes: 100,
          blobPath: 'users/user-1/files/good.txt',
          isFolder: false,
          isFavorite: false,
          parentFolderId: null,
          processingStatus: 'pending',
          embeddingStatus: 'pending',
          hasExtractedText: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: 'f-bad',
          userId: 'user-1',
          name: 'broken.txt',
          mimeType: 'text/plain',
          sizeBytes: 100,
          blobPath: 'users/user-1/files/broken.txt',
          isFolder: false,
          isFavorite: false,
          parentFolderId: null,
          processingStatus: 'pending',
          embeddingStatus: 'pending',
          hasExtractedText: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];

      mockFileUploadService.downloadFromBlob
        .mockResolvedValueOnce(Buffer.from('content'))
        .mockRejectedValueOnce(new Error('Network error'));

      const result = await service.retrieveMultiple('user-1', files);

      expect(result.contents).toHaveLength(1);
      expect(result.failures).toHaveLength(1);
      expect(result.failures[0]?.fileId).toBe('f-bad');
      expect(result.failures[0]?.reason).toContain('Network error');
    });

    it('should respect maxTotalTokens limit', async () => {
      const files: ParsedFile[] = [
        {
          id: 'f1',
          userId: 'user-1',
          name: 'file1.txt',
          mimeType: 'text/plain',
          sizeBytes: 100,
          blobPath: 'users/user-1/files/file1.txt',
          isFolder: false,
          isFavorite: false,
          parentFolderId: null,
          processingStatus: 'pending',
          embeddingStatus: 'pending',
          hasExtractedText: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: 'f2',
          userId: 'user-1',
          name: 'file2.txt',
          mimeType: 'text/plain',
          sizeBytes: 100,
          blobPath: 'users/user-1/files/file2.txt',
          isFolder: false,
          isFavorite: false,
          parentFolderId: null,
          processingStatus: 'pending',
          embeddingStatus: 'pending',
          hasExtractedText: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];

      // Create large content that exceeds token limit
      // Token estimate is ~4 chars per token, so 200000 chars = ~50000 tokens
      const largeContent = 'a '.repeat(250000); // ~500000 chars = ~125000 tokens
      mockFileUploadService.downloadFromBlob
        .mockResolvedValueOnce(Buffer.from(largeContent))
        .mockResolvedValueOnce(Buffer.from('small content'));

      const result = await service.retrieveMultiple('user-1', files, {
        maxTotalTokens: 50000, // Lower than first file's tokens
      });

      // Should truncate and mark as truncated (first file added but exceeds limit)
      expect(result.truncated).toBe(true);
      expect(result.contents.length).toBe(1); // Only first file added
    });
  });
});
