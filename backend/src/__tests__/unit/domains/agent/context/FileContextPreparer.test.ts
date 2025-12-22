/**
 * @module FileContextPreparer.test
 * Unit tests for FileContextPreparer.
 * Tests the file context preparation functionality.
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import {
  FileContextPreparer,
  createFileContextPreparer,
} from '@/domains/agent/context/FileContextPreparer';
import type { ParsedFile } from '@/types/file.types';
import type { SearchResult } from '@/domains/agent/context/types';
import type { MultiRetrievalResult, RetrievedContent } from '@/services/files/context/retrieval.types';

// Mock logger
vi.mock('@/shared/utils/logger', () => ({
  createChildLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  }),
}));

// Helper to create a mock ParsedFile
function createMockParsedFile(overrides: Partial<ParsedFile> = {}): ParsedFile {
  return {
    id: 'file-1',
    userId: 'user-1',
    name: 'test-file.txt',
    mimeType: 'text/plain',
    sizeBytes: 1024,
    blobPath: 'path/to/blob',
    hasExtractedText: true,
    embeddingStatus: 'completed',
    createdAt: new Date(),
    updatedAt: new Date(),
    isFavorite: false,
    isFolder: false,
    ...overrides,
  };
}

// Helper to create a mock RetrievedContent
function createMockRetrievedContent(fileId: string, fileName: string, text: string): RetrievedContent {
  return {
    fileId,
    fileName,
    strategy: 'EXTRACTED_TEXT',
    content: {
      type: 'text',
      text,
    },
  };
}

describe('FileContextPreparer', () => {
  let mockFileService: {
    getFile: Mock;
  };

  let mockContextRetrieval: {
    retrieveMultiple: Mock;
  };

  let mockPromptBuilder: {
    buildDocumentContext: Mock;
  };

  let mockSearchHandler: {
    search: Mock;
  };

  beforeEach(() => {
    mockFileService = {
      getFile: vi.fn(),
    };

    mockContextRetrieval = {
      retrieveMultiple: vi.fn(),
    };

    mockPromptBuilder = {
      buildDocumentContext: vi.fn(),
    };

    mockSearchHandler = {
      search: vi.fn(),
    };
  });

  // ===================================
  // 1. Factory Function Tests
  // ===================================

  describe('Factory Function Tests', () => {
    it('createFileContextPreparer() creates new instance', () => {
      const preparer = createFileContextPreparer(
        mockFileService as any,
        mockContextRetrieval as any,
        mockPromptBuilder as any,
        mockSearchHandler as any
      );

      expect(preparer).toBeInstanceOf(FileContextPreparer);
    });

    it('creates independent instances', () => {
      const preparer1 = createFileContextPreparer(
        mockFileService as any,
        mockContextRetrieval as any,
        mockPromptBuilder as any,
        mockSearchHandler as any
      );
      const preparer2 = createFileContextPreparer(
        mockFileService as any,
        mockContextRetrieval as any,
        mockPromptBuilder as any,
        mockSearchHandler as any
      );

      expect(preparer1).not.toBe(preparer2);
      expect(preparer1).toBeInstanceOf(FileContextPreparer);
      expect(preparer2).toBeInstanceOf(FileContextPreparer);
    });
  });

  // ===================================
  // 2. Attachment Validation Tests
  // ===================================

  describe('Attachment Validation Tests', () => {
    it('validates existing attachments successfully', async () => {
      const mockFile = createMockParsedFile({ id: 'file-1', name: 'document.pdf' });
      mockFileService.getFile.mockResolvedValue(mockFile);

      const mockRetrievalResult: MultiRetrievalResult = {
        contents: [createMockRetrievedContent('file-1', 'document.pdf', 'PDF content')],
        failures: [],
        totalTokens: 100,
        truncated: false,
      };
      mockContextRetrieval.retrieveMultiple.mockResolvedValue(mockRetrievalResult);
      mockPromptBuilder.buildDocumentContext.mockReturnValue('<documents>...</documents>');

      const preparer = createFileContextPreparer(
        mockFileService as any,
        mockContextRetrieval as any,
        mockPromptBuilder as any,
        mockSearchHandler as any
      );

      const result = await preparer.prepare('user-1', 'test query', {
        attachments: ['file-1'],
      });

      expect(mockFileService.getFile).toHaveBeenCalledWith('user-1', 'file-1');
      expect(result.filesIncluded).toHaveLength(1);
      expect(result.filesIncluded[0]?.source).toBe('attachment');
    });

    it('throws when attachment file not found', async () => {
      mockFileService.getFile.mockResolvedValue(null);

      const preparer = createFileContextPreparer(
        mockFileService as any,
        mockContextRetrieval as any,
        mockPromptBuilder as any,
        mockSearchHandler as any
      );

      await expect(
        preparer.prepare('user-1', 'test query', {
          attachments: ['nonexistent-file'],
        })
      ).rejects.toThrow('File not found or access denied: nonexistent-file');
    });

    it('throws when access denied (null from FileService)', async () => {
      // FileService returns null for unauthorized access
      mockFileService.getFile.mockResolvedValue(null);

      const preparer = createFileContextPreparer(
        mockFileService as any,
        mockContextRetrieval as any,
        mockPromptBuilder as any,
        mockSearchHandler as any
      );

      await expect(
        preparer.prepare('user-1', 'test query', {
          attachments: ['unauthorized-file'],
        })
      ).rejects.toThrow('File not found or access denied: unauthorized-file');
    });

    it('returns empty context when no attachments provided', async () => {
      mockSearchHandler.search.mockResolvedValue([]);

      const preparer = createFileContextPreparer(
        mockFileService as any,
        mockContextRetrieval as any,
        mockPromptBuilder as any,
        mockSearchHandler as any
      );

      const result = await preparer.prepare('user-1', 'test query', {});

      expect(result.contextText).toBe('');
      expect(result.filesIncluded).toEqual([]);
      expect(result.totalFilesProcessed).toBe(0);
    });
  });

  // ===================================
  // 3. Semantic Search Tests
  // ===================================

  describe('Semantic Search Tests', () => {
    it('executes search when enableAutoSemanticSearch=true', async () => {
      const searchResults: SearchResult[] = [
        { fileId: 'file-1', fileName: 'relevant.txt', content: 'Relevant content', score: 0.9 },
      ];
      mockSearchHandler.search.mockResolvedValue(searchResults);

      const mockRetrievalResult: MultiRetrievalResult = {
        contents: [createMockRetrievedContent('file-1', 'relevant.txt', 'Relevant content')],
        failures: [],
        totalTokens: 50,
        truncated: false,
      };
      mockContextRetrieval.retrieveMultiple.mockResolvedValue(mockRetrievalResult);
      mockPromptBuilder.buildDocumentContext.mockReturnValue('<documents>...</documents>');

      const preparer = createFileContextPreparer(
        mockFileService as any,
        mockContextRetrieval as any,
        mockPromptBuilder as any,
        mockSearchHandler as any
      );

      const result = await preparer.prepare('user-1', 'test query', {
        enableAutoSemanticSearch: true,
      });

      expect(mockSearchHandler.search).toHaveBeenCalledWith('user-1', 'test query', {
        threshold: undefined,
        maxFiles: undefined,
        excludeFileIds: [],
      });
      expect(result.semanticSearchUsed).toBe(true);
    });

    it('does not execute search when enableAutoSemanticSearch=false (default)', async () => {
      const preparer = createFileContextPreparer(
        mockFileService as any,
        mockContextRetrieval as any,
        mockPromptBuilder as any,
        mockSearchHandler as any
      );

      const result = await preparer.prepare('user-1', 'test query', {});

      expect(mockSearchHandler.search).not.toHaveBeenCalled();
      expect(result.semanticSearchUsed).toBe(false);
    });

    it('respects custom threshold and maxFiles', async () => {
      mockSearchHandler.search.mockResolvedValue([]);

      const preparer = createFileContextPreparer(
        mockFileService as any,
        mockContextRetrieval as any,
        mockPromptBuilder as any,
        mockSearchHandler as any
      );

      await preparer.prepare('user-1', 'test query', {
        enableAutoSemanticSearch: true,
        semanticThreshold: 0.85,
        maxSemanticFiles: 3,
      });

      expect(mockSearchHandler.search).toHaveBeenCalledWith('user-1', 'test query', {
        threshold: 0.85,
        maxFiles: 3,
        excludeFileIds: [],
      });
    });

    it('excludes attachment fileIds from semantic search', async () => {
      const mockFile = createMockParsedFile({ id: 'attachment-1', name: 'attached.pdf' });
      mockFileService.getFile.mockResolvedValue(mockFile);
      mockSearchHandler.search.mockResolvedValue([]);

      const mockRetrievalResult: MultiRetrievalResult = {
        contents: [createMockRetrievedContent('attachment-1', 'attached.pdf', 'Content')],
        failures: [],
        totalTokens: 50,
        truncated: false,
      };
      mockContextRetrieval.retrieveMultiple.mockResolvedValue(mockRetrievalResult);
      mockPromptBuilder.buildDocumentContext.mockReturnValue('<documents>...</documents>');

      const preparer = createFileContextPreparer(
        mockFileService as any,
        mockContextRetrieval as any,
        mockPromptBuilder as any,
        mockSearchHandler as any
      );

      await preparer.prepare('user-1', 'test query', {
        attachments: ['attachment-1'],
        enableAutoSemanticSearch: true,
      });

      expect(mockSearchHandler.search).toHaveBeenCalledWith('user-1', 'test query', {
        threshold: undefined,
        maxFiles: undefined,
        excludeFileIds: ['attachment-1'],
      });
    });
  });

  // ===================================
  // 4. File Combination Tests
  // ===================================

  describe('File Combination Tests', () => {
    it('combines attachments and semantic results', async () => {
      const mockFile = createMockParsedFile({ id: 'file-1', name: 'attached.txt' });
      mockFileService.getFile.mockResolvedValue(mockFile);

      const searchResults: SearchResult[] = [
        { fileId: 'file-2', fileName: 'found.txt', content: 'Search content', score: 0.88 },
      ];
      mockSearchHandler.search.mockResolvedValue(searchResults);

      const mockRetrievalResult: MultiRetrievalResult = {
        contents: [
          createMockRetrievedContent('file-1', 'attached.txt', 'Attached content'),
          createMockRetrievedContent('file-2', 'found.txt', 'Search content'),
        ],
        failures: [],
        totalTokens: 100,
        truncated: false,
      };
      mockContextRetrieval.retrieveMultiple.mockResolvedValue(mockRetrievalResult);
      mockPromptBuilder.buildDocumentContext.mockReturnValue('<documents>...</documents>');

      const preparer = createFileContextPreparer(
        mockFileService as any,
        mockContextRetrieval as any,
        mockPromptBuilder as any,
        mockSearchHandler as any
      );

      const result = await preparer.prepare('user-1', 'test query', {
        attachments: ['file-1'],
        enableAutoSemanticSearch: true,
      });

      expect(result.filesIncluded).toHaveLength(2);
      expect(result.totalFilesProcessed).toBe(2);
    });

    it('deduplicates files with same fileId (attachment takes priority)', async () => {
      const mockFile = createMockParsedFile({ id: 'file-1', name: 'duplicate.txt' });
      mockFileService.getFile.mockResolvedValue(mockFile);

      // Semantic search returns the same file
      const searchResults: SearchResult[] = [
        { fileId: 'file-1', fileName: 'duplicate.txt', content: 'Content', score: 0.95 },
      ];
      mockSearchHandler.search.mockResolvedValue(searchResults);

      const mockRetrievalResult: MultiRetrievalResult = {
        contents: [createMockRetrievedContent('file-1', 'duplicate.txt', 'Content')],
        failures: [],
        totalTokens: 50,
        truncated: false,
      };
      mockContextRetrieval.retrieveMultiple.mockResolvedValue(mockRetrievalResult);
      mockPromptBuilder.buildDocumentContext.mockReturnValue('<documents>...</documents>');

      const preparer = createFileContextPreparer(
        mockFileService as any,
        mockContextRetrieval as any,
        mockPromptBuilder as any,
        mockSearchHandler as any
      );

      const result = await preparer.prepare('user-1', 'test query', {
        attachments: ['file-1'],
        enableAutoSemanticSearch: true,
      });

      // Should only have 1 file (deduplicated)
      expect(result.totalFilesProcessed).toBe(1);
      expect(result.filesIncluded).toHaveLength(1);
      expect(result.filesIncluded[0]?.source).toBe('attachment');
    });

    it('assigns correct source for each file', async () => {
      const mockFile = createMockParsedFile({ id: 'attached-1', name: 'attached.pdf' });
      mockFileService.getFile.mockResolvedValue(mockFile);

      const searchResults: SearchResult[] = [
        { fileId: 'search-1', fileName: 'found.pdf', content: 'Found', score: 0.9 },
      ];
      mockSearchHandler.search.mockResolvedValue(searchResults);

      const mockRetrievalResult: MultiRetrievalResult = {
        contents: [
          createMockRetrievedContent('attached-1', 'attached.pdf', 'Attached'),
          createMockRetrievedContent('search-1', 'found.pdf', 'Found'),
        ],
        failures: [],
        totalTokens: 100,
        truncated: false,
      };
      mockContextRetrieval.retrieveMultiple.mockResolvedValue(mockRetrievalResult);
      mockPromptBuilder.buildDocumentContext.mockReturnValue('<documents>...</documents>');

      const preparer = createFileContextPreparer(
        mockFileService as any,
        mockContextRetrieval as any,
        mockPromptBuilder as any,
        mockSearchHandler as any
      );

      const result = await preparer.prepare('user-1', 'test query', {
        attachments: ['attached-1'],
        enableAutoSemanticSearch: true,
      });

      const attachedFile = result.filesIncluded.find((f) => f.id === 'attached-1');
      const searchFile = result.filesIncluded.find((f) => f.id === 'search-1');

      expect(attachedFile?.source).toBe('attachment');
      expect(searchFile?.source).toBe('semantic_search');
      expect(searchFile?.score).toBe(0.9);
    });
  });

  // ===================================
  // 5. Context Formatting Tests
  // ===================================

  describe('Context Formatting Tests', () => {
    it('generates XML via PromptBuilder', async () => {
      const mockFile = createMockParsedFile({ id: 'file-1', name: 'doc.txt' });
      mockFileService.getFile.mockResolvedValue(mockFile);

      const mockRetrievalResult: MultiRetrievalResult = {
        contents: [createMockRetrievedContent('file-1', 'doc.txt', 'Document content')],
        failures: [],
        totalTokens: 50,
        truncated: false,
      };
      mockContextRetrieval.retrieveMultiple.mockResolvedValue(mockRetrievalResult);
      mockPromptBuilder.buildDocumentContext.mockReturnValue(
        '<documents><document id="file-1">Document content</document></documents>'
      );

      const preparer = createFileContextPreparer(
        mockFileService as any,
        mockContextRetrieval as any,
        mockPromptBuilder as any,
        mockSearchHandler as any
      );

      const result = await preparer.prepare('user-1', 'test query', {
        attachments: ['file-1'],
      });

      expect(mockPromptBuilder.buildDocumentContext).toHaveBeenCalledWith(
        mockRetrievalResult.contents
      );
      expect(result.contextText).toContain('<documents>');
    });

    it('returns empty string when no files', async () => {
      const preparer = createFileContextPreparer(
        mockFileService as any,
        mockContextRetrieval as any,
        mockPromptBuilder as any,
        mockSearchHandler as any
      );

      const result = await preparer.prepare('user-1', 'test query', {});

      expect(result.contextText).toBe('');
    });

    it('includes all required fields in result', async () => {
      const mockFile = createMockParsedFile({ id: 'file-1', name: 'test.txt' });
      mockFileService.getFile.mockResolvedValue(mockFile);

      const mockRetrievalResult: MultiRetrievalResult = {
        contents: [createMockRetrievedContent('file-1', 'test.txt', 'Content')],
        failures: [],
        totalTokens: 25,
        truncated: false,
      };
      mockContextRetrieval.retrieveMultiple.mockResolvedValue(mockRetrievalResult);
      mockPromptBuilder.buildDocumentContext.mockReturnValue('<documents>...</documents>');

      const preparer = createFileContextPreparer(
        mockFileService as any,
        mockContextRetrieval as any,
        mockPromptBuilder as any,
        mockSearchHandler as any
      );

      const result = await preparer.prepare('user-1', 'test query', {
        attachments: ['file-1'],
        enableAutoSemanticSearch: true,
      });

      expect(result).toHaveProperty('contextText');
      expect(result).toHaveProperty('filesIncluded');
      expect(result).toHaveProperty('semanticSearchUsed');
      expect(result).toHaveProperty('totalFilesProcessed');

      expect(result.filesIncluded[0]).toHaveProperty('id');
      expect(result.filesIncluded[0]).toHaveProperty('name');
      expect(result.filesIncluded[0]).toHaveProperty('content');
      expect(result.filesIncluded[0]).toHaveProperty('source');
    });
  });

  // ===================================
  // 6. Error Handling Tests
  // ===================================

  describe('Error Handling Tests', () => {
    it('graceful degradation when semantic search fails', async () => {
      mockSearchHandler.search.mockRejectedValue(new Error('Search service unavailable'));

      const preparer = createFileContextPreparer(
        mockFileService as any,
        mockContextRetrieval as any,
        mockPromptBuilder as any,
        mockSearchHandler as any
      );

      // Should not throw, just return empty results
      const result = await preparer.prepare('user-1', 'test query', {
        enableAutoSemanticSearch: true,
      });

      expect(result.contextText).toBe('');
      expect(result.filesIncluded).toEqual([]);
      expect(result.semanticSearchUsed).toBe(true);
    });

    it('propagates errors from attachment validation', async () => {
      mockFileService.getFile.mockRejectedValue(new Error('Database connection failed'));

      const preparer = createFileContextPreparer(
        mockFileService as any,
        mockContextRetrieval as any,
        mockPromptBuilder as any,
        mockSearchHandler as any
      );

      await expect(
        preparer.prepare('user-1', 'test query', {
          attachments: ['file-1'],
        })
      ).rejects.toThrow('Database connection failed');
    });

    it('propagates errors from ContextRetrievalService', async () => {
      const mockFile = createMockParsedFile({ id: 'file-1', name: 'test.txt' });
      mockFileService.getFile.mockResolvedValue(mockFile);
      mockContextRetrieval.retrieveMultiple.mockRejectedValue(new Error('Blob storage unavailable'));

      const preparer = createFileContextPreparer(
        mockFileService as any,
        mockContextRetrieval as any,
        mockPromptBuilder as any,
        mockSearchHandler as any
      );

      await expect(
        preparer.prepare('user-1', 'test query', {
          attachments: ['file-1'],
        })
      ).rejects.toThrow('Blob storage unavailable');
    });

    it('handles multiple attachment validation correctly', async () => {
      // First file succeeds, second fails
      mockFileService.getFile
        .mockResolvedValueOnce(createMockParsedFile({ id: 'file-1' }))
        .mockResolvedValueOnce(null);

      const preparer = createFileContextPreparer(
        mockFileService as any,
        mockContextRetrieval as any,
        mockPromptBuilder as any,
        mockSearchHandler as any
      );

      await expect(
        preparer.prepare('user-1', 'test query', {
          attachments: ['file-1', 'file-2'],
        })
      ).rejects.toThrow('File not found or access denied: file-2');
    });
  });

  // ===================================
  // 7. Realistic Scenario Tests
  // ===================================

  describe('Realistic Scenario Tests', () => {
    it('complete flow with attachments and semantic search', async () => {
      // Setup: 2 attachments + 2 semantic results (1 duplicate)
      mockFileService.getFile
        .mockResolvedValueOnce(createMockParsedFile({ id: 'attach-1', name: 'manual.pdf' }))
        .mockResolvedValueOnce(createMockParsedFile({ id: 'attach-2', name: 'specs.docx' }));

      const searchResults: SearchResult[] = [
        { fileId: 'attach-1', fileName: 'manual.pdf', content: 'Manual content', score: 0.95 }, // Duplicate
        { fileId: 'search-1', fileName: 'related.txt', content: 'Related content', score: 0.85 },
      ];
      mockSearchHandler.search.mockResolvedValue(searchResults);

      const mockRetrievalResult: MultiRetrievalResult = {
        contents: [
          createMockRetrievedContent('attach-1', 'manual.pdf', 'Manual content'),
          createMockRetrievedContent('attach-2', 'specs.docx', 'Specs content'),
          createMockRetrievedContent('search-1', 'related.txt', 'Related content'),
        ],
        failures: [],
        totalTokens: 500,
        truncated: false,
      };
      mockContextRetrieval.retrieveMultiple.mockResolvedValue(mockRetrievalResult);
      mockPromptBuilder.buildDocumentContext.mockReturnValue(
        '<documents><document>...</document></documents>'
      );

      const preparer = createFileContextPreparer(
        mockFileService as any,
        mockContextRetrieval as any,
        mockPromptBuilder as any,
        mockSearchHandler as any
      );

      const result = await preparer.prepare('user-1', 'How to configure the product?', {
        attachments: ['attach-1', 'attach-2'],
        enableAutoSemanticSearch: true,
        semanticThreshold: 0.8,
        maxSemanticFiles: 5,
      });

      // 3 unique files (attach-1, attach-2, search-1)
      expect(result.totalFilesProcessed).toBe(3);
      expect(result.filesIncluded).toHaveLength(3);
      expect(result.semanticSearchUsed).toBe(true);
      expect(result.contextText).toContain('<documents>');

      // Verify sources
      const attach1 = result.filesIncluded.find((f) => f.id === 'attach-1');
      const search1 = result.filesIncluded.find((f) => f.id === 'search-1');
      expect(attach1?.source).toBe('attachment');
      expect(search1?.source).toBe('semantic_search');
      expect(search1?.score).toBe(0.85);
    });

    it('only attachments without semantic search', async () => {
      mockFileService.getFile.mockResolvedValue(
        createMockParsedFile({ id: 'file-1', name: 'report.pdf' })
      );

      const mockRetrievalResult: MultiRetrievalResult = {
        contents: [createMockRetrievedContent('file-1', 'report.pdf', 'Report content')],
        failures: [],
        totalTokens: 200,
        truncated: false,
      };
      mockContextRetrieval.retrieveMultiple.mockResolvedValue(mockRetrievalResult);
      mockPromptBuilder.buildDocumentContext.mockReturnValue('<documents>...</documents>');

      const preparer = createFileContextPreparer(
        mockFileService as any,
        mockContextRetrieval as any,
        mockPromptBuilder as any,
        mockSearchHandler as any
      );

      const result = await preparer.prepare('user-1', 'Summarize this report', {
        attachments: ['file-1'],
        enableAutoSemanticSearch: false,
      });

      expect(mockSearchHandler.search).not.toHaveBeenCalled();
      expect(result.semanticSearchUsed).toBe(false);
      expect(result.filesIncluded).toHaveLength(1);
    });

    it('only semantic search without attachments', async () => {
      const searchResults: SearchResult[] = [
        { fileId: 'file-1', fileName: 'doc1.txt', content: 'Content 1', score: 0.92 },
        { fileId: 'file-2', fileName: 'doc2.txt', content: 'Content 2', score: 0.88 },
      ];
      mockSearchHandler.search.mockResolvedValue(searchResults);

      const mockRetrievalResult: MultiRetrievalResult = {
        contents: [
          createMockRetrievedContent('file-1', 'doc1.txt', 'Content 1'),
          createMockRetrievedContent('file-2', 'doc2.txt', 'Content 2'),
        ],
        failures: [],
        totalTokens: 150,
        truncated: false,
      };
      mockContextRetrieval.retrieveMultiple.mockResolvedValue(mockRetrievalResult);
      mockPromptBuilder.buildDocumentContext.mockReturnValue('<documents>...</documents>');

      const preparer = createFileContextPreparer(
        mockFileService as any,
        mockContextRetrieval as any,
        mockPromptBuilder as any,
        mockSearchHandler as any
      );

      const result = await preparer.prepare('user-1', 'Find information about X', {
        enableAutoSemanticSearch: true,
      });

      expect(mockFileService.getFile).not.toHaveBeenCalled();
      expect(result.semanticSearchUsed).toBe(true);
      expect(result.filesIncluded).toHaveLength(2);
      expect(result.filesIncluded.every((f) => f.source === 'semantic_search')).toBe(true);
    });
  });
});
