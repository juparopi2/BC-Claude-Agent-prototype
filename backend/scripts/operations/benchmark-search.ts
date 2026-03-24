/**
 * PRD-203: Search Benchmark Script
 *
 * Compares search latency and result quality between:
 *   - Application-side vectorization (current: Cohere API → vector → Azure AI Search)
 *   - Query-time vectorization (PRD-203: Azure AI Search native vectorizer)
 *
 * Usage:
 *   npx tsx scripts/operations/benchmark-search.ts [--user-id <UUID>] [--threshold <ms>]
 *
 * Requires:
 *   - USE_UNIFIED_INDEX=true
 *   - COHERE_ENDPOINT and COHERE_API_KEY configured
 *   - file-chunks-index-v2 with vectorizer configured (for query-time path)
 *
 * Exit codes:
 *   0 — Query-time vectorization overhead < threshold (default: 100ms)
 *   1 — Overhead exceeds threshold or errors occurred
 */

import { env } from '../../src/infrastructure/config/environment';
import { VectorSearchService } from '../../src/services/search/VectorSearchService';
import { getUnifiedEmbeddingService } from '../../src/services/search/embeddings/EmbeddingServiceFactory';
import { createChildLogger } from '../../src/shared/utils/logger';

const logger = createChildLogger({ service: 'BenchmarkSearch' });

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

interface BenchmarkResult {
  query: string;
  appSideLatencyMs: number;
  queryTimeLatencyMs: number;
  overheadMs: number;
  appSideResultCount: number;
  queryTimeResultCount: number;
  resultOverlap: number;
}

async function benchmarkQuery(
  query: string,
  userId: string,
  vectorSearchService: VectorSearchService,
): Promise<BenchmarkResult> {
  const embeddingService = getUnifiedEmbeddingService();
  if (!embeddingService) {
    throw new Error('Cohere embedding service not available');
  }

  // Path 1: Application-side vectorization
  const appStart = performance.now();
  const embedding = await embeddingService.embedQuery(query);
  const appResult = await vectorSearchService.semanticSearch({
    text: query,
    textEmbedding: embedding.embedding,
    userId,
    fetchTopK: 30,
    finalTopK: 10,
    minScore: 0,
    useVectorSearch: true,
    useSemanticRanker: true,
  });
  const appLatency = performance.now() - appStart;

  // Path 2: Query-time vectorization (kind: 'text')
  const qtStart = performance.now();
  const qtResult = await vectorSearchService.semanticSearch({
    text: query,
    // No textEmbedding — Azure generates it
    userId,
    fetchTopK: 30,
    finalTopK: 10,
    minScore: 0,
    useVectorSearch: true,
    useSemanticRanker: true,
  });
  const qtLatency = performance.now() - qtStart;

  // Calculate result overlap
  const appFileIds = new Set(appResult.results.map(r => r.fileId));
  const qtFileIds = new Set(qtResult.results.map(r => r.fileId));
  const overlap = [...appFileIds].filter(id => qtFileIds.has(id)).length;
  const maxPossible = Math.max(appFileIds.size, qtFileIds.size) || 1;

  return {
    query,
    appSideLatencyMs: Math.round(appLatency),
    queryTimeLatencyMs: Math.round(qtLatency),
    overheadMs: Math.round(qtLatency - appLatency),
    appSideResultCount: appResult.results.length,
    queryTimeResultCount: qtResult.results.length,
    resultOverlap: overlap / maxPossible,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const userIdIdx = args.indexOf('--user-id');
  const thresholdIdx = args.indexOf('--threshold');
  const userId = userIdIdx >= 0 ? args[userIdIdx + 1] : 'BENCHMARK-USER';
  const threshold = thresholdIdx >= 0 ? parseInt(args[thresholdIdx + 1], 10) : 100;

  if (!env.USE_UNIFIED_INDEX) {
    console.error('ERROR: USE_UNIFIED_INDEX must be true to run this benchmark');
    process.exit(1);
  }

  console.log('=== PRD-203: Search Benchmark ===');
  console.log(`User ID: ${userId}`);
  console.log(`Overhead threshold: ${threshold}ms`);
  console.log(`Queries: ${TEST_QUERIES.length}`);
  console.log('');

  const vectorSearchService = VectorSearchService.getInstance();
  const results: BenchmarkResult[] = [];

  for (const query of TEST_QUERIES) {
    try {
      const result = await benchmarkQuery(query, userId, vectorSearchService);
      results.push(result);
      console.log(`  "${query.slice(0, 40)}..." → app=${result.appSideLatencyMs}ms, qt=${result.queryTimeLatencyMs}ms, overhead=${result.overheadMs}ms, overlap=${(result.resultOverlap * 100).toFixed(0)}%`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error({ query, error: msg }, 'Benchmark query failed');
      console.error(`  "${query.slice(0, 40)}..." → ERROR: ${msg}`);
    }
  }

  if (results.length === 0) {
    console.error('\nNo successful benchmarks. Check configuration.');
    process.exit(1);
  }

  // Summary
  const avgOverhead = results.reduce((sum, r) => sum + r.overheadMs, 0) / results.length;
  const maxOverhead = Math.max(...results.map(r => r.overheadMs));
  const avgOverlap = results.reduce((sum, r) => sum + r.resultOverlap, 0) / results.length;

  console.log('\n=== Summary ===');
  console.log(`Avg overhead: ${Math.round(avgOverhead)}ms`);
  console.log(`Max overhead: ${maxOverhead}ms`);
  console.log(`Avg result overlap: ${(avgOverlap * 100).toFixed(1)}%`);
  console.log(`Threshold: ${threshold}ms`);
  console.log(`Verdict: ${avgOverhead <= threshold ? 'PASS ✓' : 'FAIL ✗'}`);

  process.exit(avgOverhead <= threshold ? 0 : 1);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
