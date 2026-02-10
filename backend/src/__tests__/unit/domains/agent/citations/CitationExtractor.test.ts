/**
 * CitationExtractor Tests (PRD-071)
 *
 * Tests extraction from both CitationResult format and legacy StructuredSearchResult.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { CitationExtractor, __resetCitationExtractor } from '@/domains/agent/citations/CitationExtractor';

describe('CitationExtractor', () => {
  let extractor: CitationExtractor;

  beforeEach(() => {
    __resetCitationExtractor();
    extractor = new CitationExtractor();
  });

  describe('producesCitations', () => {
    it('returns true for search_knowledge_base', () => {
      expect(extractor.producesCitations('search_knowledge_base')).toBe(true);
    });

    it('returns false for unknown tools', () => {
      expect(extractor.producesCitations('some_other_tool')).toBe(false);
    });
  });

  describe('extract - CitationResult format (new)', () => {
    it('extracts CitedFile[] from CitationResult format', () => {
      const citationResult = {
        _type: 'citation_result',
        documents: [
          {
            fileId: 'FILE-1',
            fileName: 'report.pdf',
            mimeType: 'application/pdf',
            sourceType: 'blob_storage',
            isImage: false,
            documentRelevance: 0.9,
            passages: [
              { citationId: 'FILE-1-0', excerpt: 'Some text', relevanceScore: 0.88 },
            ],
          },
        ],
        summary: 'Found 1 document',
        totalResults: 1,
        query: 'test',
      };

      const citations = extractor.extract('search_knowledge_base', JSON.stringify(citationResult));

      expect(citations).toHaveLength(1);
      expect(citations[0].fileName).toBe('report.pdf');
      expect(citations[0].fileId).toBe('FILE-1');
      expect(citations[0].sourceType).toBe('blob_storage');
      expect(citations[0].mimeType).toBe('application/pdf');
      expect(citations[0].isImage).toBe(false);
      expect(citations[0].fetchStrategy).toBe('internal_api');
    });

    it('maps documentRelevance to relevanceScore', () => {
      const citationResult = {
        _type: 'citation_result',
        documents: [
          {
            fileId: 'FILE-1',
            fileName: 'doc.txt',
            mimeType: 'text/plain',
            sourceType: 'blob_storage',
            isImage: false,
            documentRelevance: 0.75,
            passages: [
              { citationId: 'FILE-1-0', excerpt: 'text', relevanceScore: 0.7 },
            ],
          },
        ],
        summary: 'Found 1 document',
        totalResults: 1,
        query: 'test',
      };

      const citations = extractor.extract('search_knowledge_base', JSON.stringify(citationResult));

      expect(citations[0].relevanceScore).toBe(0.75);
    });

    it('handles multiple documents', () => {
      const citationResult = {
        _type: 'citation_result',
        documents: [
          {
            fileId: 'FILE-1',
            fileName: 'doc1.pdf',
            mimeType: 'application/pdf',
            sourceType: 'blob_storage',
            isImage: false,
            documentRelevance: 0.9,
            passages: [{ citationId: 'FILE-1-0', excerpt: 'text', relevanceScore: 0.9 }],
          },
          {
            fileId: 'FILE-2',
            fileName: 'doc2.xlsx',
            mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            sourceType: 'blob_storage',
            isImage: false,
            documentRelevance: 0.7,
            passages: [{ citationId: 'FILE-2-0', excerpt: 'data', relevanceScore: 0.7 }],
          },
        ],
        summary: 'Found 2 documents',
        totalResults: 2,
        query: 'test',
      };

      const citations = extractor.extract('search_knowledge_base', JSON.stringify(citationResult));

      expect(citations).toHaveLength(2);
      expect(citations[0].fileName).toBe('doc1.pdf');
      expect(citations[1].fileName).toBe('doc2.xlsx');
    });
  });

  describe('extract - StructuredSearchResult format (legacy)', () => {
    it('extracts CitedFile[] from legacy format', () => {
      const legacyResult = {
        sources: [
          {
            fileId: 'FILE-1',
            fileName: 'report.pdf',
            sourceType: 'blob_storage',
            mimeType: 'application/pdf',
            relevanceScore: 0.9,
            isImage: false,
            excerpts: [{ content: 'text', score: 0.88, chunkIndex: 0 }],
          },
        ],
        searchMetadata: {
          query: 'test',
          totalChunksSearched: 50,
          threshold: 0.7,
        },
      };

      const citations = extractor.extract('search_knowledge_base', JSON.stringify(legacyResult));

      expect(citations).toHaveLength(1);
      expect(citations[0].fileName).toBe('report.pdf');
      expect(citations[0].relevanceScore).toBe(0.9);
      expect(citations[0].fetchStrategy).toBe('internal_api');
    });
  });

  describe('extract - edge cases', () => {
    it('returns empty array for non-citation tools', () => {
      const citations = extractor.extract('some_other_tool', '{}');
      expect(citations).toEqual([]);
    });

    it('returns empty array for malformed JSON', () => {
      const citations = extractor.extract('search_knowledge_base', 'not json');
      expect(citations).toEqual([]);
    });

    it('returns empty array for empty string', () => {
      const citations = extractor.extract('search_knowledge_base', '');
      expect(citations).toEqual([]);
    });

    it('returns empty array for empty documents in CitationResult', () => {
      const result = {
        _type: 'citation_result',
        documents: [],
        summary: '',
        totalResults: 0,
        query: 'test',
      };
      const citations = extractor.extract('search_knowledge_base', JSON.stringify(result));
      expect(citations).toEqual([]);
    });
  });
});
