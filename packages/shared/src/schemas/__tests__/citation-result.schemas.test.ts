/**
 * Citation Result Schema Tests (PRD-071)
 */

import { describe, it, expect } from 'vitest';
import {
  CitationPassageSchema,
  CitedDocumentSchema,
  CitationResultSchema,
} from '../citation-result.schemas';

describe('CitationPassageSchema', () => {
  it('validates a valid passage', () => {
    const passage = {
      citationId: 'file1-0',
      excerpt: 'Some relevant text from the document.',
      relevanceScore: 0.85,
    };
    expect(CitationPassageSchema.safeParse(passage).success).toBe(true);
  });

  it('accepts optional fields', () => {
    const passage = {
      citationId: 'file1-0',
      excerpt: 'Text',
      relevanceScore: 0.5,
      pageNumber: 3,
      startOffset: 100,
      endOffset: 200,
    };
    const result = CitationPassageSchema.safeParse(passage);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.pageNumber).toBe(3);
    }
  });

  it('rejects relevanceScore > 1', () => {
    const passage = {
      citationId: 'file1-0',
      excerpt: 'Text',
      relevanceScore: 1.5,
    };
    expect(CitationPassageSchema.safeParse(passage).success).toBe(false);
  });

  it('rejects relevanceScore < 0', () => {
    const passage = {
      citationId: 'file1-0',
      excerpt: 'Text',
      relevanceScore: -0.1,
    };
    expect(CitationPassageSchema.safeParse(passage).success).toBe(false);
  });

  it('rejects excerpt longer than 500 chars', () => {
    const passage = {
      citationId: 'file1-0',
      excerpt: 'a'.repeat(501),
      relevanceScore: 0.5,
    };
    expect(CitationPassageSchema.safeParse(passage).success).toBe(false);
  });
});

describe('CitedDocumentSchema', () => {
  const validDoc = {
    fileId: 'FILE-123',
    fileName: 'report.pdf',
    mimeType: 'application/pdf',
    sourceType: 'blob_storage' as const,
    isImage: false,
    documentRelevance: 0.9,
    passages: [
      { citationId: 'FILE-123-0', excerpt: 'Some text', relevanceScore: 0.85 },
    ],
  };

  it('validates a valid document', () => {
    expect(CitedDocumentSchema.safeParse(validDoc).success).toBe(true);
  });

  it('accepts null fileId', () => {
    const doc = { ...validDoc, fileId: null };
    const result = CitedDocumentSchema.safeParse(doc);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.fileId).toBeNull();
    }
  });

  it('requires at least 1 passage', () => {
    const doc = { ...validDoc, passages: [] };
    expect(CitedDocumentSchema.safeParse(doc).success).toBe(false);
  });

  it('rejects more than 10 passages', () => {
    const doc = {
      ...validDoc,
      passages: Array.from({ length: 11 }, (_, i) => ({
        citationId: `FILE-123-${i}`,
        excerpt: 'Text',
        relevanceScore: 0.5,
      })),
    };
    expect(CitedDocumentSchema.safeParse(doc).success).toBe(false);
  });

  it('validates sourceType against enum', () => {
    const doc = { ...validDoc, sourceType: 'invalid_source' as any };
    expect(CitedDocumentSchema.safeParse(doc).success).toBe(false);
  });

  it('accepts valid sourceType values', () => {
    const validTypes = ['blob_storage', 'chat_attachment', 'sharepoint', 'onedrive', 'email', 'web'] as const;
    for (const sourceType of validTypes) {
      const doc = { ...validDoc, sourceType };
      expect(CitedDocumentSchema.safeParse(doc).success).toBe(true);
    }
  });
});

describe('CitationResultSchema', () => {
  const validResult = {
    _type: 'citation_result' as const,
    documents: [
      {
        fileId: 'FILE-123',
        fileName: 'report.pdf',
        mimeType: 'application/pdf',
        sourceType: 'blob_storage' as const,
        isImage: false,
        documentRelevance: 0.9,
        passages: [
          { citationId: 'FILE-123-0', excerpt: 'Some text', relevanceScore: 0.85 },
        ],
      },
    ],
    summary: 'Found 1 relevant document for "test query"',
    totalResults: 1,
    query: 'test query',
  };

  it('validates a valid citation result', () => {
    expect(CitationResultSchema.safeParse(validResult).success).toBe(true);
  });

  it('requires _type to be "citation_result"', () => {
    const wrong = { ...validResult, _type: 'wrong_type' as any };
    expect(CitationResultSchema.safeParse(wrong).success).toBe(false);
  });

  it('requires at least 1 document', () => {
    const empty = { ...validResult, documents: [] };
    expect(CitationResultSchema.safeParse(empty).success).toBe(false);
  });

  it('rejects more than 20 documents', () => {
    const tooMany = {
      ...validResult,
      documents: Array.from({ length: 21 }, (_, i) => ({
        fileId: `FILE-${i}`,
        fileName: `doc${i}.pdf`,
        mimeType: 'application/pdf',
        sourceType: 'blob_storage' as const,
        isImage: false,
        documentRelevance: 0.5,
        passages: [
          { citationId: `FILE-${i}-0`, excerpt: 'Text', relevanceScore: 0.5 },
        ],
      })),
    };
    expect(CitationResultSchema.safeParse(tooMany).success).toBe(false);
  });

  it('requires query field', () => {
    const { query: _, ...noQuery } = validResult;
    expect(CitationResultSchema.safeParse(noQuery).success).toBe(false);
  });

  it('requires summary field', () => {
    const { summary: _, ...noSummary } = validResult;
    expect(CitationResultSchema.safeParse(noSummary).success).toBe(false);
  });
});
