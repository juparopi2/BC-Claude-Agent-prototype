/**
 * RAG Knowledge Tools Tests (PRD-071)
 *
 * Tests that knowledgeSearchTool returns CitationResult format
 * for successful searches and StructuredSearchResult for errors/empty.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the semantic search service before importing the tool
const mockSearchRelevantFiles = vi.fn();
vi.mock('@/services/search/semantic', () => ({
  getSemanticSearchService: () => ({
    searchRelevantFiles: mockSearchRelevantFiles,
  }),
  SEMANTIC_THRESHOLD: 0.7,
}));

import { knowledgeSearchTool } from '@/modules/agents/rag-knowledge/tools';

describe('knowledgeSearchTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns CitationResult with _type for successful results', async () => {
    mockSearchRelevantFiles.mockResolvedValue({
      results: [
        {
          fileId: 'FILE-1',
          fileName: 'report.pdf',
          mimeType: 'application/pdf',
          relevanceScore: 0.9,
          isImage: false,
          topChunks: [
            { content: 'Relevant excerpt', score: 0.88, chunkIndex: 0 },
          ],
        },
      ],
      totalChunksSearched: 100,
      threshold: 0.6,
    });

    const result = await knowledgeSearchTool.invoke(
      { query: 'test query' },
      { configurable: { userId: 'USER-1' } }
    );

    const parsed = JSON.parse(result);
    expect(parsed._type).toBe('citation_result');
    expect(parsed.documents).toHaveLength(1);
    expect(parsed.documents[0].fileId).toBe('FILE-1');
    expect(parsed.documents[0].fileName).toBe('report.pdf');
    expect(parsed.documents[0].documentRelevance).toBe(0.9);
    expect(parsed.totalResults).toBe(1);
    expect(parsed.query).toBe('test query');
  });

  it('includes passages with excerpts and relevance scores', async () => {
    mockSearchRelevantFiles.mockResolvedValue({
      results: [
        {
          fileId: 'FILE-1',
          fileName: 'doc.txt',
          mimeType: 'text/plain',
          relevanceScore: 0.85,
          isImage: false,
          topChunks: [
            { content: 'First chunk', score: 0.9, chunkIndex: 0 },
            { content: 'Second chunk', score: 0.8, chunkIndex: 1 },
          ],
        },
      ],
      totalChunksSearched: 50,
      threshold: 0.6,
    });

    const result = await knowledgeSearchTool.invoke(
      { query: 'search' },
      { configurable: { userId: 'USER-1' } }
    );

    const parsed = JSON.parse(result);
    expect(parsed.documents[0].passages).toHaveLength(2);
    expect(parsed.documents[0].passages[0].excerpt).toBe('First chunk');
    expect(parsed.documents[0].passages[0].relevanceScore).toBe(0.9);
    expect(parsed.documents[0].passages[0].citationId).toBe('FILE-1-0');
    expect(parsed.documents[0].passages[1].citationId).toBe('FILE-1-1');
  });

  it('includes summary text in result', async () => {
    mockSearchRelevantFiles.mockResolvedValue({
      results: [
        {
          fileId: 'FILE-1',
          fileName: 'doc.txt',
          mimeType: 'text/plain',
          relevanceScore: 0.8,
          isImage: false,
          topChunks: [{ content: 'text', score: 0.8, chunkIndex: 0 }],
        },
        {
          fileId: 'FILE-2',
          fileName: 'doc2.txt',
          mimeType: 'text/plain',
          relevanceScore: 0.7,
          isImage: false,
          topChunks: [{ content: 'text2', score: 0.7, chunkIndex: 0 }],
        },
      ],
      totalChunksSearched: 50,
      threshold: 0.6,
    });

    const result = await knowledgeSearchTool.invoke(
      { query: 'my query' },
      { configurable: { userId: 'USER-1' } }
    );

    const parsed = JSON.parse(result);
    expect(parsed.summary).toContain('2 relevant documents');
    expect(parsed.summary).toContain('my query');
  });

  it('returns StructuredSearchResult for empty results (no _type)', async () => {
    mockSearchRelevantFiles.mockResolvedValue({
      results: [],
      totalChunksSearched: 50,
      threshold: 0.6,
    });

    const result = await knowledgeSearchTool.invoke(
      { query: 'empty query' },
      { configurable: { userId: 'USER-1' } }
    );

    const parsed = JSON.parse(result);
    expect(parsed._type).toBeUndefined();
    expect(parsed.sources).toEqual([]);
    expect(parsed.searchMetadata.query).toBe('empty query');
  });

  it('returns StructuredSearchResult with error for failures (no _type)', async () => {
    mockSearchRelevantFiles.mockRejectedValue(new Error('Service unavailable'));

    const result = await knowledgeSearchTool.invoke(
      { query: 'fail query' },
      { configurable: { userId: 'USER-1' } }
    );

    const parsed = JSON.parse(result);
    expect(parsed._type).toBeUndefined();
    expect(parsed.error).toBe('Service unavailable');
  });

  it('returns error when no userId in config', async () => {
    const result = await knowledgeSearchTool.invoke(
      { query: 'no user' },
      { configurable: {} }
    );

    const parsed = JSON.parse(result);
    expect(parsed.error).toContain('No user context');
  });
});
