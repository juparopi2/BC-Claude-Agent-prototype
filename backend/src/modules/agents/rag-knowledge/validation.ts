import { SEMANTIC_THRESHOLD } from '@/services/search/semantic/types';

// ===== Constants =====

/** RAG tool threshold multiplier for broader recall. Applied to SEMANTIC_THRESHOLD (0.55) to get ~0.47. */
export const RAG_THRESHOLD_MULTIPLIER = 0.85;

/** Default relevance threshold: SEMANTIC_THRESHOLD * RAG_THRESHOLD_MULTIPLIER ≈ 0.4675 */
export const DEFAULT_THRESHOLD = SEMANTIC_THRESHOLD * RAG_THRESHOLD_MULTIPLIER;

export const DEFAULT_TOP_IMAGES = 10;
export const DEFAULT_TOP_DOCUMENTS = 5;
export const DEFAULT_TOP_CROSS_TYPE = 10;
export const MAX_TOP = 50;
export const MIN_TOP = 1;

// ===== Types =====

/** Raw input from LLM tool call (after Zod structural validation) */
export interface RawSearchInput {
  query: string;
  searchType?: 'hybrid' | 'semantic' | 'keyword';
  fileTypeCategory?: 'images' | 'documents' | 'spreadsheets' | 'code' | 'presentations';
  top?: number;
  minRelevanceScore?: number;
  dateFrom?: string;
  dateTo?: string;
  sortBy?: 'relevance' | 'newest' | 'oldest';
  /** PRD-203: Controls response verbosity */
  responseDetail?: 'concise' | 'detailed';
}

/** After clamping + defaults + overrides + date validation — all required fields resolved */
export interface ValidatedSearchInput {
  query: string;
  searchType: 'hybrid' | 'semantic' | 'keyword';
  fileTypeCategory?: 'images' | 'documents' | 'spreadsheets' | 'code' | 'presentations';
  top: number;
  minRelevanceScore: number;
  dateFrom?: string;
  dateTo?: string;
  sortBy: 'relevance' | 'newest' | 'oldest';
  /** PRD-203: Controls response verbosity (default: 'detailed') */
  responseDetail: 'concise' | 'detailed';
}

/** Validation error returned to agent with is_error: true */
export interface ValidationError {
  is_error: true;
  message: string;
}

// ===== Pipeline Functions =====

/**
 * Step 1: Clamp out-of-range numeric parameters to valid bounds.
 * Pure function, no side effects.
 */
export function clampParameters(params: RawSearchInput): RawSearchInput {
  return {
    ...params,
    top: params.top !== undefined
      ? Math.max(MIN_TOP, Math.min(MAX_TOP, Math.round(params.top)))
      : undefined,
    minRelevanceScore: params.minRelevanceScore !== undefined
      ? Math.max(0, Math.min(1, params.minRelevanceScore))
      : undefined,
  };
}

/**
 * Step 2: Apply context-aware defaults for unset optional parameters.
 */
export function applyDefaults(params: RawSearchInput): ValidatedSearchInput {
  const isImageSearch = params.fileTypeCategory === 'images';
  const hasFileTypeCategory = params.fileTypeCategory !== undefined;

  return {
    query: params.query,
    searchType: params.searchType ?? 'hybrid',
    fileTypeCategory: params.fileTypeCategory,
    top: params.top ?? (isImageSearch ? DEFAULT_TOP_IMAGES : hasFileTypeCategory ? DEFAULT_TOP_DOCUMENTS : DEFAULT_TOP_CROSS_TYPE),
    minRelevanceScore: params.minRelevanceScore ?? DEFAULT_THRESHOLD,
    dateFrom: params.dateFrom,
    dateTo: params.dateTo,
    sortBy: params.sortBy ?? 'relevance',
    responseDetail: params.responseDetail ?? 'detailed',
  };
}

/**
 * Step 3: Override parameters to prevent known bad states.
 */
export function applyOverrides(params: ValidatedSearchInput): ValidatedSearchInput {
  const overrides: Partial<ValidatedSearchInput> = {};

  // Query "*" + semantic/hybrid → force keyword (semantic ranker fails on wildcard)
  if (params.query === '*' && params.searchType !== 'keyword') {
    overrides.searchType = 'keyword';
  }

  // Empty/whitespace query → treat as wildcard browse
  if (!params.query?.trim()) {
    overrides.query = '*';
    overrides.searchType = 'keyword';
  }

  // sortBy !== 'relevance' + semantic → downgrade to hybrid
  // (pure semantic ordering is meaningless when sorted by date; hybrid allows orderby to work alongside relevance)
  if (params.sortBy !== 'relevance' && params.searchType === 'semantic') {
    overrides.searchType = 'hybrid';
  }

  return { ...params, ...overrides };
}

/**
 * Step 4: Validate date parameters — reject with guidance if invalid, swap if from > to.
 */
export function validateDates(params: ValidatedSearchInput): ValidatedSearchInput | ValidationError {
  const isoDateRegex = /^\d{4}-\d{2}-\d{2}$/;

  for (const field of ['dateFrom', 'dateTo'] as const) {
    const value = params[field];
    if (value && !isoDateRegex.test(value)) {
      return {
        is_error: true,
        message: `Invalid ${field} format: "${value}". Expected ISO date format YYYY-MM-DD (e.g., "2026-01-15"). ` +
          `Please retry with a valid date.`,
      };
    }
    if (value && isNaN(Date.parse(value))) {
      return {
        is_error: true,
        message: `Invalid date value for ${field}: "${value}". The date is not a real calendar date. ` +
          `Please retry with a valid date like "2026-03-24".`,
      };
    }
  }

  // dateFrom > dateTo → swap silently (common LLM mistake)
  if (params.dateFrom && params.dateTo && params.dateFrom > params.dateTo) {
    return {
      ...params,
      dateFrom: params.dateTo,
      dateTo: params.dateFrom,
    };
  }

  return params;
}

/**
 * Main validation pipeline — composes all steps in sequence.
 * Returns validated input or a ValidationError with is_error: true.
 */
export function validateSearchInput(raw: RawSearchInput): ValidatedSearchInput | ValidationError {
  // Step 1: Clamp out-of-range values
  const clamped = clampParameters(raw);

  // Step 2: Apply context-aware defaults
  const withDefaults = applyDefaults(clamped);

  // Step 3: Apply overrides to prevent bad states
  const overridden = applyOverrides(withDefaults);

  // Step 4: Validate dates
  return validateDates(overridden);
}
