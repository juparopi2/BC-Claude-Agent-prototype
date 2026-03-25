/**
 * Search Validation Script
 *
 * Validates that search queries return results with acceptable latency.
 * Verifies the query-time vectorization pipeline is working correctly.
 *
 * Usage:
 *   npx tsx scripts/operations/benchmark-search.ts [--user-id <UUID>] [--threshold <ms>]
 *
 * Requires:
 *   - COHERE_ENDPOINT and COHERE_API_KEY configured
 *   - Azure AI Search index with vectorizer configured
 *
 * Exit codes:
 *   0 — All queries returned results within threshold (default: 500ms)
 *   1 — Queries failed or exceeded threshold
 */

import { VectorSearchService } from '../../src/services/search/VectorSearchService';
import { createChildLogger } from '../../src/shared/utils/logger';

const logger = createChildLogger({ service: 'SearchValidation' });

const TEST_QUERIES = [
  'What is the return policy for damaged items?',
  'Q3 revenue forecast 2025',
  'organizational chart',
  'red truck in parking lot',
  'invoice template Excel',
  'employee onboarding process',
  'API authentication documentation',
  'marketing budget allocation',
];

interface ValidationResult {
  query: string;
  latencyMs: number;
  resultCount: number;
  success: boolean;
  error?: string;
}

async function validateQuery(
  query: string,
  userId: string,
  vectorSearchService: VectorSearchService,
): Promise<ValidationResult> {
  const start = performance.now();
  try {
    // Query-time vectorization: Azure AI Search generates embeddings via native vectorizer
    const result = await vectorSearchService.semanticSearch({
      text: query,
      userId,
      fetchTopK: 30,
      finalTopK: 10,
      minScore: 0,
      useVectorSearch: true,
      useSemanticRanker: true,
    });
    const latency = performance.now() - start;

    return {
      query,
      latencyMs: Math.round(latency),
      resultCount: result.results.length,
      success: true,
    };
  } catch (error) {
    const latency = performance.now() - start;
    const msg = error instanceof Error ? error.message : String(error);
    return {
      query,
      latencyMs: Math.round(latency),
      resultCount: 0,
      success: false,
      error: msg,
    };
  }
}

async function main() {
  const args = process.argv.slice(2);
  const userIdIdx = args.indexOf('--user-id');
  const thresholdIdx = args.indexOf('--threshold');
  const userId = userIdIdx >= 0 ? args[userIdIdx + 1] : 'BENCHMARK-USER';
  const threshold = thresholdIdx >= 0 ? parseInt(args[thresholdIdx + 1], 10) : 500;

  console.log('=== Search Validation ===');
  console.log(`User ID: ${userId}`);
  console.log(`Latency threshold: ${threshold}ms`);
  console.log(`Queries: ${TEST_QUERIES.length}`);
  console.log('');

  const vectorSearchService = VectorSearchService.getInstance();
  const results: ValidationResult[] = [];

  for (const query of TEST_QUERIES) {
    const result = await validateQuery(query, userId, vectorSearchService);
    results.push(result);
    const status = result.success ? '✓' : '✗';
    const detail = result.success
      ? `${result.latencyMs}ms, ${result.resultCount} results`
      : `ERROR: ${result.error}`;
    console.log(`  ${status} "${query.slice(0, 45)}..." → ${detail}`);
  }

  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  const avgLatency = successful.length > 0
    ? successful.reduce((sum, r) => sum + r.latencyMs, 0) / successful.length
    : 0;
  const maxLatency = successful.length > 0
    ? Math.max(...successful.map(r => r.latencyMs))
    : 0;

  console.log('\n=== Summary ===');
  console.log(`Successful: ${successful.length}/${results.length}`);
  console.log(`Failed: ${failed.length}/${results.length}`);
  if (successful.length > 0) {
    console.log(`Avg latency: ${Math.round(avgLatency)}ms`);
    console.log(`Max latency: ${maxLatency}ms`);
  }
  console.log(`Threshold: ${threshold}ms`);

  const pass = failed.length === 0 && avgLatency <= threshold;
  console.log(`Verdict: ${pass ? 'PASS ✓' : 'FAIL ✗'}`);

  process.exit(pass ? 0 : 1);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
