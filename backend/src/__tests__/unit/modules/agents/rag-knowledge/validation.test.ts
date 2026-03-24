/**
 * PRD-200: Validation Pipeline Tests
 */

import { describe, it, expect } from 'vitest';
import {
  clampParameters,
  applyDefaults,
  applyOverrides,
  validateDates,
  validateSearchInput,
  DEFAULT_THRESHOLD,
  DEFAULT_TOP_IMAGES,
  DEFAULT_TOP_DOCUMENTS,
  DEFAULT_TOP_CROSS_TYPE,
  MAX_TOP,
  MIN_TOP,
} from '@/modules/agents/rag-knowledge/validation';

describe('clampParameters', () => {
  it('clamps top to MIN_TOP when below range', () => {
    const result = clampParameters({ query: 'test', top: 0 });
    expect(result.top).toBe(MIN_TOP);
  });

  it('clamps top to MAX_TOP when above range', () => {
    const result = clampParameters({ query: 'test', top: 100 });
    expect(result.top).toBe(MAX_TOP);
  });

  it('rounds top to nearest integer', () => {
    const result = clampParameters({ query: 'test', top: 7.8 });
    expect(result.top).toBe(8);
  });

  it('preserves top within valid range', () => {
    const result = clampParameters({ query: 'test', top: 25 });
    expect(result.top).toBe(25);
  });

  it('leaves top undefined when not provided', () => {
    const result = clampParameters({ query: 'test' });
    expect(result.top).toBeUndefined();
  });

  it('clamps minRelevanceScore to 0 when negative', () => {
    const result = clampParameters({ query: 'test', minRelevanceScore: -0.5 });
    expect(result.minRelevanceScore).toBe(0);
  });

  it('clamps minRelevanceScore to 1 when above range', () => {
    const result = clampParameters({ query: 'test', minRelevanceScore: 1.5 });
    expect(result.minRelevanceScore).toBe(1);
  });

  it('preserves minRelevanceScore within valid range', () => {
    const result = clampParameters({ query: 'test', minRelevanceScore: 0.5 });
    expect(result.minRelevanceScore).toBe(0.5);
  });

  it('leaves minRelevanceScore undefined when not provided', () => {
    const result = clampParameters({ query: 'test' });
    expect(result.minRelevanceScore).toBeUndefined();
  });
});

describe('applyDefaults', () => {
  it('applies default searchType hybrid', () => {
    const result = applyDefaults({ query: 'test' });
    expect(result.searchType).toBe('hybrid');
  });

  it('applies default sortBy relevance', () => {
    const result = applyDefaults({ query: 'test' });
    expect(result.sortBy).toBe('relevance');
  });

  it('applies default minRelevanceScore threshold', () => {
    const result = applyDefaults({ query: 'test' });
    expect(result.minRelevanceScore).toBeCloseTo(DEFAULT_THRESHOLD, 4);
  });

  it('defaults top to DEFAULT_TOP_IMAGES for images', () => {
    const result = applyDefaults({ query: 'test', fileTypeCategory: 'images' });
    expect(result.top).toBe(DEFAULT_TOP_IMAGES);
  });

  it('defaults top to DEFAULT_TOP_DOCUMENTS for documents', () => {
    const result = applyDefaults({ query: 'test', fileTypeCategory: 'documents' });
    expect(result.top).toBe(DEFAULT_TOP_DOCUMENTS);
  });

  it('defaults top to DEFAULT_TOP_DOCUMENTS for spreadsheets', () => {
    const result = applyDefaults({ query: 'test', fileTypeCategory: 'spreadsheets' });
    expect(result.top).toBe(DEFAULT_TOP_DOCUMENTS);
  });

  it('defaults top to DEFAULT_TOP_CROSS_TYPE when no category', () => {
    const result = applyDefaults({ query: 'test' });
    expect(result.top).toBe(DEFAULT_TOP_CROSS_TYPE);
  });

  it('preserves explicit values over defaults', () => {
    const result = applyDefaults({
      query: 'test',
      searchType: 'keyword',
      top: 20,
      minRelevanceScore: 0.8,
      sortBy: 'newest',
    });
    expect(result.searchType).toBe('keyword');
    expect(result.top).toBe(20);
    expect(result.minRelevanceScore).toBe(0.8);
    expect(result.sortBy).toBe('newest');
  });
});

describe('applyOverrides', () => {
  const base = {
    query: 'normal query',
    searchType: 'hybrid' as const,
    top: 5,
    minRelevanceScore: 0.47,
    sortBy: 'relevance' as const,
  };

  it('forces keyword when query is wildcard "*"', () => {
    const result = applyOverrides({ ...base, query: '*', searchType: 'hybrid' });
    expect(result.searchType).toBe('keyword');
  });

  it('keeps keyword when query is "*" and searchType already keyword', () => {
    const result = applyOverrides({ ...base, query: '*', searchType: 'keyword' });
    expect(result.searchType).toBe('keyword');
  });

  it('forces wildcard + keyword for empty query', () => {
    const result = applyOverrides({ ...base, query: '' });
    expect(result.query).toBe('*');
    expect(result.searchType).toBe('keyword');
  });

  it('forces wildcard + keyword for whitespace-only query', () => {
    const result = applyOverrides({ ...base, query: '   ' });
    expect(result.query).toBe('*');
    expect(result.searchType).toBe('keyword');
  });

  it('downgrades semantic to hybrid when sortBy is not relevance', () => {
    const result = applyOverrides({ ...base, searchType: 'semantic', sortBy: 'newest' });
    expect(result.searchType).toBe('hybrid');
  });

  it('keeps hybrid when sortBy is not relevance', () => {
    const result = applyOverrides({ ...base, searchType: 'hybrid', sortBy: 'newest' });
    expect(result.searchType).toBe('hybrid');
  });

  it('keeps semantic when sortBy is relevance', () => {
    const result = applyOverrides({ ...base, searchType: 'semantic', sortBy: 'relevance' });
    expect(result.searchType).toBe('semantic');
  });

  it('does not modify valid params', () => {
    const result = applyOverrides(base);
    expect(result).toEqual(base);
  });
});

describe('validateDates', () => {
  const base = {
    query: 'test',
    searchType: 'hybrid' as const,
    top: 5,
    minRelevanceScore: 0.47,
    sortBy: 'relevance' as const,
  };

  it('passes valid ISO dates', () => {
    const result = validateDates({ ...base, dateFrom: '2026-01-15', dateTo: '2026-03-31' });
    expect('is_error' in result).toBe(false);
  });

  it('passes when no dates provided', () => {
    const result = validateDates(base);
    expect('is_error' in result).toBe(false);
  });

  it('rejects invalid dateFrom format', () => {
    const result = validateDates({ ...base, dateFrom: '01-15-2026' });
    expect('is_error' in result).toBe(true);
    if ('is_error' in result) {
      expect(result.message).toContain('Invalid dateFrom format');
    }
  });

  it('rejects invalid dateTo format', () => {
    const result = validateDates({ ...base, dateTo: 'not-a-date' });
    expect('is_error' in result).toBe(true);
    if ('is_error' in result) {
      expect(result.message).toContain('Invalid dateTo format');
    }
  });

  it('rejects invalid calendar date', () => {
    const result = validateDates({ ...base, dateFrom: '2026-13-01' });
    expect('is_error' in result).toBe(true);
    if ('is_error' in result) {
      expect(result.message).toContain('not a real calendar date');
    }
  });

  it('swaps dateFrom and dateTo when from > to', () => {
    const result = validateDates({ ...base, dateFrom: '2026-03-31', dateTo: '2026-01-01' });
    expect('is_error' in result).toBe(false);
    if (!('is_error' in result)) {
      expect(result.dateFrom).toBe('2026-01-01');
      expect(result.dateTo).toBe('2026-03-31');
    }
  });
});

describe('validateSearchInput (end-to-end pipeline)', () => {
  it('validates standard hybrid search', () => {
    const result = validateSearchInput({
      query: 'Q3 revenue forecast',
      searchType: 'hybrid',
      fileTypeCategory: 'documents',
      top: 5,
    });
    expect('is_error' in result).toBe(false);
    if (!('is_error' in result)) {
      expect(result.searchType).toBe('hybrid');
      expect(result.top).toBe(5);
      expect(result.fileTypeCategory).toBe('documents');
    }
  });

  it('validates image search (defaults to top 10)', () => {
    const result = validateSearchInput({
      query: 'red truck in parking lot',
      fileTypeCategory: 'images',
    });
    expect('is_error' in result).toBe(false);
    if (!('is_error' in result)) {
      expect(result.top).toBe(10);
      expect(result.searchType).toBe('hybrid');
    }
  });

  it('validates keyword search for exact codes', () => {
    const result = validateSearchInput({
      query: 'INV-2026-0042',
      searchType: 'keyword',
      top: 3,
    });
    expect('is_error' in result).toBe(false);
    if (!('is_error' in result)) {
      expect(result.searchType).toBe('keyword');
      expect(result.top).toBe(3);
    }
  });

  it('validates wildcard date browsing (forces keyword)', () => {
    const result = validateSearchInput({
      query: '*',
      fileTypeCategory: 'spreadsheets',
      dateFrom: '2026-01-01',
      dateTo: '2026-03-31',
      sortBy: 'newest',
    });
    expect('is_error' in result).toBe(false);
    if (!('is_error' in result)) {
      expect(result.searchType).toBe('keyword');
      expect(result.sortBy).toBe('newest');
    }
  });

  it('validates broad exploratory search', () => {
    const result = validateSearchInput({
      query: 'marketing strategy competitive analysis',
      searchType: 'semantic',
      top: 20,
      minRelevanceScore: 0.3,
    });
    expect('is_error' in result).toBe(false);
    if (!('is_error' in result)) {
      expect(result.searchType).toBe('semantic');
      expect(result.top).toBe(20);
      expect(result.minRelevanceScore).toBe(0.3);
    }
  });

  it('clamps out-of-range top before applying defaults', () => {
    const result = validateSearchInput({ query: 'test', top: 200 });
    expect('is_error' in result).toBe(false);
    if (!('is_error' in result)) {
      expect(result.top).toBe(50);
    }
  });

  it('applies all defaults when only query provided', () => {
    const result = validateSearchInput({ query: 'test' });
    expect('is_error' in result).toBe(false);
    if (!('is_error' in result)) {
      expect(result.searchType).toBe('hybrid');
      expect(result.top).toBe(DEFAULT_TOP_CROSS_TYPE);
      expect(result.minRelevanceScore).toBeCloseTo(DEFAULT_THRESHOLD, 4);
      expect(result.sortBy).toBe('relevance');
    }
  });

  it('returns error for invalid date in full pipeline', () => {
    const result = validateSearchInput({ query: 'test', dateFrom: 'bad-date' });
    expect('is_error' in result).toBe(true);
  });
});
