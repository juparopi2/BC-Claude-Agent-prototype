/**
 * debug-rag-search-flow.ts — Trace the EXACT RAG agent search flow
 *
 * Simulates what happens when the RAG agent calls search_knowledge with
 * fileTypeCategory="images" — traces through VectorSearchService.semanticSearch()
 * to identify where results are lost.
 */
import 'dotenv/config';
import { SearchClient, AzureKeyCredential } from '@azure/search-documents';

const BOLD = '\x1b[1m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

interface SearchDoc {
  chunkId: string;
  fileId: string;
  userId: string;
  content: string;
  isImage: boolean;
  fileStatus: string;
  imageCaption: string | null;
  chunkIndex: number;
}

async function main() {
  const userId = '2DD10FBD-F1C1-4578-8B57-CB1B2421BE40';
  const query = 'red light strip';

  const client = new SearchClient(
    process.env.AZURE_SEARCH_ENDPOINT!,
    'file-chunks-index-v2',
    new AzureKeyCredential(process.env.AZURE_SEARCH_KEY!),
    { serviceVersion: '2025-08-01-preview' },
  );

  console.log(`\n${BOLD}${CYAN}=== RAG Search Flow Trace ===${RESET}`);
  console.log(`Query: "${query}"`);
  console.log(`Mode: images (useSemanticRanker=false)\n`);

  // ── Step 1: Verify images exist in index ──
  console.log(`${BOLD}── Step 1: Images in index ──${RESET}`);
  const countResult = await client.search('*', {
    filter: `userId eq '${userId}' and isImage eq true and (fileStatus ne 'deleting' or fileStatus eq null)`,
    top: 0,
    includeTotalCount: true,
  });
  console.log(`  Total image docs: ${GREEN}${countResult.count}${RESET}`);

  // ── Step 2: Verify embeddings exist (sample) ──
  console.log(`\n${BOLD}── Step 2: Check embeddingVector presence ──${RESET}`);
  const sampleDocs = await client.search('*', {
    filter: `userId eq '${userId}' and isImage eq true`,
    top: 3,
    select: ['chunkId', 'imageCaption'] as (keyof SearchDoc)[],
  });
  let sampleCount = 0;
  for await (const r of sampleDocs.results) {
    sampleCount++;
    const doc = r.document as Record<string, unknown>;
    console.log(`  ${sampleCount}. ${DIM}${String(doc.chunkId).substring(0,20)}${RESET} caption="${String(doc.imageCaption ?? 'NULL').substring(0, 50)}" score=${r.score}`);
  }
  console.log(`  Sampled: ${sampleCount} docs OK`);

  // ── Step 3: Run EXACT same query as VectorSearchService.semanticSearch() ──
  console.log(`\n${BOLD}── Step 3: Exact VectorSearchService query (no threshold) ──${RESET}`);
  const searchFilter = `userId eq '${userId}' and (fileStatus ne 'deleting' or fileStatus eq null) and isImage eq true`;
  const fetchTopK = 150; // Same as RAG: maxFiles(10) * maxChunks(5) * multiplier(3)

  const rawResults = await client.search(query, {
    filter: searchFilter,
    top: fetchTopK,
    select: ['chunkId', 'fileId', 'content', 'chunkIndex', 'isImage', 'imageCaption'] as (keyof SearchDoc)[],
    vectorSearchOptions: {
      queries: [{
        kind: 'text' as const,
        text: query,
        fields: ['embeddingVector'],
        kNearestNeighborsCount: fetchTopK,
        weight: 1.0,
      }],
    },
  });

  let totalCandidates = 0;
  let aboveThreshold = 0;
  const THRESHOLD = 0.55;
  const allScores: Array<{ score: number; caption: string }> = [];

  for await (const r of rawResults.results) {
    totalCandidates++;
    const doc = r.document as Record<string, unknown>;
    const score = r.score ?? 0;
    allScores.push({ score, caption: String(doc.imageCaption ?? doc.content ?? '').substring(0, 60) });
    if (score >= THRESHOLD) aboveThreshold++;
  }

  // Sort by score desc
  allScores.sort((a, b) => b.score - a.score);

  console.log(`  ${BOLD}Total candidates returned: ${totalCandidates}${RESET}`);
  console.log(`  Above threshold (${THRESHOLD}): ${aboveThreshold > 0 ? GREEN : RED}${aboveThreshold}${RESET}`);

  if (totalCandidates > 0) {
    console.log(`\n  ${BOLD}Top 10 results by score:${RESET}`);
    for (const item of allScores.slice(0, 10)) {
      const passThreshold = item.score >= THRESHOLD;
      const color = passThreshold ? GREEN : RED;
      const label = passThreshold ? 'PASS' : 'FILTERED OUT';
      console.log(`    score=${color}${item.score.toFixed(6)}${RESET} ${DIM}[${label}]${RESET} "${item.caption}"`);
    }

    console.log(`\n  ${BOLD}Score statistics:${RESET}`);
    console.log(`    Max:  ${allScores[0].score.toFixed(6)}`);
    console.log(`    Min:  ${allScores[allScores.length - 1].score.toFixed(6)}`);
    console.log(`    Avg:  ${(allScores.reduce((s, r) => s + r.score, 0) / allScores.length).toFixed(6)}`);
  }

  // ── Step 4: Diagnosis ──
  console.log(`\n${BOLD}── Step 4: Diagnosis ──${RESET}`);
  if (totalCandidates > 0 && aboveThreshold === 0) {
    console.log(`  ${RED}${BOLD}CONFIRMED: Vector search returns ${totalCandidates} results but ALL are below threshold ${THRESHOLD}${RESET}`);
    console.log(`  ${YELLOW}Root cause: SEMANTIC_THRESHOLD (${THRESHOLD}) was calibrated for Semantic Ranker scores (0-1 normalized)`);
    console.log(`  but image mode uses useSemanticRanker=false → scores are raw RRF (0.01-0.03 range)${RESET}`);
    console.log(`  ${GREEN}Fix: Skip minScore filtering when useSemanticRanker is OFF${RESET}`);
  } else if (totalCandidates === 0) {
    console.log(`  ${RED}No candidates at all — vectorizer may be failing silently${RESET}`);
  } else {
    console.log(`  ${GREEN}Search working — ${aboveThreshold} results pass threshold${RESET}`);
  }

  // ── Step 5: Also test text search (non-image mode) for comparison ──
  console.log(`\n${BOLD}── Step 5: Comparison — text search with Semantic Ranker ──${RESET}`);
  try {
    const textResults = await client.search('invoice', {
      filter: `userId eq '${userId}' and (fileStatus ne 'deleting' or fileStatus eq null)`,
      top: 5,
      select: ['chunkId', 'fileId', 'content', 'isImage'] as (keyof SearchDoc)[],
      queryType: 'semantic',
      semanticSearchOptions: { configurationName: 'semantic-config' },
      vectorSearchOptions: {
        queries: [{
          kind: 'text' as const,
          text: 'invoice',
          fields: ['embeddingVector'],
          kNearestNeighborsCount: 30,
          weight: 1.0,
        }],
      },
    });
    let textCount = 0;
    for await (const r of textResults.results) {
      textCount++;
      const doc = r.document as Record<string, unknown>;
      const rerankerScore = (r as unknown as { rerankerScore?: number }).rerankerScore;
      console.log(`  ${textCount}. score=${r.score?.toFixed(4)} reranker=${rerankerScore?.toFixed(4) ?? 'N/A'} "${String(doc.content ?? '').substring(0, 50)}"`);
    }
    console.log(`  Text results: ${textCount}`);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(`  ${RED}Text search error: ${msg.substring(0, 200)}${RESET}`);
  }
}

main().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
