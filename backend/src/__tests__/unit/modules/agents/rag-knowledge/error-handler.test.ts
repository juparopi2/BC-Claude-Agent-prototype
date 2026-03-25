/**
 * PRD-200: Error Handler Tests
 */

import { describe, it, expect } from 'vitest';
import {
  classifySearchError,
  formatNoResultsGuidance,
  isAzureSearchError,
  isEmbeddingError,
} from '@/modules/agents/rag-knowledge/error-handler';
import type { ValidatedSearchInput } from '@/modules/agents/rag-knowledge/validation';

const baseParams: ValidatedSearchInput = {
  query: 'test query',
  searchType: 'hybrid',
  top: 5,
  minRelevanceScore: 0.47,
  sortBy: 'relevance',
};

describe('isAzureSearchError', () => {
  it('returns true for Azure Search error shape', () => {
    expect(isAzureSearchError({ statusCode: 400, code: 'InvalidFilter', message: 'bad filter' })).toBe(true);
  });

  it('returns false for regular Error', () => {
    expect(isAzureSearchError(new Error('fail'))).toBe(false);
  });

  it('returns false for null', () => {
    expect(isAzureSearchError(null)).toBe(false);
  });

  it('returns false for string', () => {
    expect(isAzureSearchError('error')).toBe(false);
  });

  it('returns false for object missing code', () => {
    expect(isAzureSearchError({ statusCode: 400, message: 'fail' })).toBe(false);
  });
});

describe('isEmbeddingError', () => {
  it('returns true for embedding-related error', () => {
    expect(isEmbeddingError(new Error('Failed to generate embedding'))).toBe(true);
  });

  it('returns true for OpenAI-related error', () => {
    expect(isEmbeddingError(new Error('OpenAI API rate limit exceeded'))).toBe(true);
  });

  it('returns true for Vision-related error', () => {
    expect(isEmbeddingError(new Error('Azure Vision API unavailable'))).toBe(true);
  });

  it('returns false for generic error', () => {
    expect(isEmbeddingError(new Error('Connection timeout'))).toBe(false);
  });

  it('returns false for non-Error', () => {
    expect(isEmbeddingError('not an error')).toBe(false);
  });
});

describe('classifySearchError', () => {
  it('classifies InvalidFilter error', () => {
    const error = { statusCode: 400, code: 'InvalidFilter', message: 'bad filter expression' };
    const result = JSON.parse(classifySearchError(error, baseParams));
    expect(result.is_error).toBe(true);
    expect(result.message).toContain('filter');
  });

  it('classifies InvalidFilterExpression error', () => {
    const error = { statusCode: 400, code: 'InvalidFilterExpression', message: 'syntax error' };
    const result = JSON.parse(classifySearchError(error, baseParams));
    expect(result.is_error).toBe(true);
    expect(result.message).toContain('filter');
  });

  it('classifies InvalidRequestParameter error', () => {
    const error = { statusCode: 400, code: 'InvalidRequestParameter', message: 'top too large' };
    const result = JSON.parse(classifySearchError(error, baseParams));
    expect(result.is_error).toBe(true);
    expect(result.message).toContain('top');
  });

  it('classifies ServiceUnavailable error', () => {
    const error = { statusCode: 503, code: 'ServiceUnavailable', message: 'service down' };
    const result = JSON.parse(classifySearchError(error, baseParams));
    expect(result.is_error).toBe(true);
    expect(result.message).toContain('temporarily unavailable');
  });

  it('classifies RequestTimeout error', () => {
    const error = { statusCode: 408, code: 'RequestTimeout', message: 'timed out' };
    const result = JSON.parse(classifySearchError(error, baseParams));
    expect(result.is_error).toBe(true);
    expect(result.message).toContain('temporarily unavailable');
  });

  it('classifies unknown Azure Search error', () => {
    const error = { statusCode: 500, code: 'InternalError', message: 'something broke' };
    const result = JSON.parse(classifySearchError(error, baseParams));
    expect(result.is_error).toBe(true);
    expect(result.message).toContain('InternalError');
  });

  it('classifies embedding error', () => {
    const error = new Error('Failed to generate embedding for query');
    const result = JSON.parse(classifySearchError(error, baseParams));
    expect(result.is_error).toBe(true);
    expect(result.message).toContain('keyword');
  });

  it('classifies unknown error', () => {
    const error = new Error('Something unexpected');
    const result = JSON.parse(classifySearchError(error, baseParams));
    expect(result.is_error).toBe(true);
    expect(result.message).toContain('Something unexpected');
  });

  it('handles non-Error objects', () => {
    const result = JSON.parse(classifySearchError('string error', baseParams));
    expect(result.is_error).toBe(true);
    expect(result.message).toContain('string error');
  });
});

describe('formatNoResultsGuidance', () => {
  it('suggests lowering threshold when high', () => {
    const guidance = formatNoResultsGuidance({ ...baseParams, minRelevanceScore: 0.7 });
    expect(guidance).toContain('minRelevanceScore');
    expect(guidance).toContain('0.3');
  });

  it('suggests removing fileTypeCategory filter', () => {
    const guidance = formatNoResultsGuidance({ ...baseParams, fileTypeCategory: 'documents' });
    expect(guidance).toContain('Remove fileTypeCategory');
  });

  it('suggests widening date range', () => {
    const guidance = formatNoResultsGuidance({ ...baseParams, dateFrom: '2026-01-01' });
    expect(guidance).toContain('date range');
  });

  it('suggests hybrid/semantic when keyword mode', () => {
    const guidance = formatNoResultsGuidance({ ...baseParams, searchType: 'keyword' });
    expect(guidance).toContain('hybrid');
  });

  it('suggests increasing top when low', () => {
    const guidance = formatNoResultsGuidance({ ...baseParams, top: 3 });
    expect(guidance).toContain('top');
  });

  it('always includes try different terms suggestion', () => {
    const guidance = formatNoResultsGuidance(baseParams);
    expect(guidance).toContain('different or broader search terms');
  });

  it('always includes ask about uploads suggestion', () => {
    const guidance = formatNoResultsGuidance(baseParams);
    expect(guidance).toContain('uploaded');
  });

  it('includes the query in the message', () => {
    const guidance = formatNoResultsGuidance(baseParams);
    expect(guidance).toContain('test query');
  });
});
