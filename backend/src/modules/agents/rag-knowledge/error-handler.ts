/**
 * PRD-200: Error Classification & Guided Passthrough
 *
 * Classifies Azure AI Search and embedding errors, returning actionable guidance
 * to the RAG agent so it can adjust parameters and retry.
 */

import type { ValidatedSearchInput } from './validation';

/**
 * Type guard for Azure AI Search errors (have statusCode and code properties).
 */
export function isAzureSearchError(error: unknown): error is { statusCode: number; code: string; message: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'statusCode' in error &&
    'code' in error &&
    'message' in error &&
    typeof (error as Record<string, unknown>).code === 'string' &&
    typeof (error as Record<string, unknown>).message === 'string'
  );
}

/**
 * Heuristic check for embedding generation errors.
 */
export function isEmbeddingError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  return msg.includes('embedding') || msg.includes('openai') || msg.includes('vision') || msg.includes('vectorize');
}

/**
 * Classify a search error and return a JSON string with is_error: true and actionable guidance.
 * The returned string is meant to be returned directly as the tool result.
 */
export function classifySearchError(error: unknown, _params: ValidatedSearchInput): string {
  let guidance: { is_error: true; message: string };

  if (isAzureSearchError(error)) {
    const code = error.code;

    if (code === 'InvalidFilter' || code === 'InvalidFilterExpression') {
      guidance = {
        is_error: true,
        message: `Azure AI Search filter error: ${error.message}. ` +
          `This usually means the filter syntax is invalid. ` +
          `Try removing or simplifying the filter parameters (remove fileTypeCategory or date range).`,
      };
    } else if (code === 'InvalidRequestParameter') {
      guidance = {
        is_error: true,
        message: `Invalid search parameter: ${error.message}. ` +
          `Try simplifying your query or reducing the 'top' value to 5.`,
      };
    } else if (code === 'ServiceUnavailable' || code === 'RequestTimeout') {
      guidance = {
        is_error: true,
        message: `Azure AI Search is temporarily unavailable. ` +
          `Try again with a simpler query or reduce 'top' to 5.`,
      };
    } else {
      guidance = {
        is_error: true,
        message: `Azure AI Search error (${code}): ${error.message}. ` +
          `Try a different query or searchType.`,
      };
    }
  } else if (isEmbeddingError(error)) {
    guidance = {
      is_error: true,
      message: `Failed to generate search embeddings for the query. ` +
        `Try using searchType "keyword" which does not require embeddings, ` +
        `or simplify your query text.`,
    };
  } else {
    const errorMessage = error instanceof Error ? error.message : String(error);
    guidance = {
      is_error: true,
      message: `Search failed: ${errorMessage}. ` +
        `Try a different query or searchType.`,
    };
  }

  return JSON.stringify(guidance);
}

/**
 * Generate actionable suggestions when search returns zero results.
 * Returns a guidance string to include in the empty result response.
 */
export function formatNoResultsGuidance(params: ValidatedSearchInput): string {
  const suggestions: string[] = [];

  if (params.minRelevanceScore > 0.5) {
    suggestions.push('Lower minRelevanceScore to 0.3 for broader recall');
  }
  if (params.fileTypeCategory) {
    suggestions.push('Remove fileTypeCategory filter to search across all file types');
  }
  if (params.dateFrom || params.dateTo) {
    suggestions.push('Remove or widen the date range');
  }
  if (params.searchType === 'keyword') {
    suggestions.push('Try searchType "hybrid" or "semantic" for conceptual matching');
  }
  if (params.top < 10) {
    suggestions.push('Increase "top" to 10-20 for more candidates');
  }

  suggestions.push('Try different or broader search terms');
  suggestions.push('Ask the user if they have uploaded the relevant documents');

  return `No results found for query "${params.query}". Suggestions:\n` +
    suggestions.map(s => `- ${s}`).join('\n');
}
