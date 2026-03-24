/**
 * diagnose-unified-vector-pipeline.ts
 *
 * End-to-end diagnostic for the unified Cohere Embed v4 vector search pipeline.
 * Validates the full chain: configuration → endpoint connectivity (text + image) →
 * cross-modal vector space consistency (1536d) → V1/V2 index health → per-user
 * content migration completeness.
 *
 * Strategy: Single Cohere Embed v4 model embeds both text and images into a
 * shared 1536d vector space, replacing the legacy dual-model approach
 * (OpenAI text-embedding-3-small + Azure Computer Vision).
 *
 * Usage:
 *   npx tsx scripts/search/diagnose-unified-vector-pipeline.ts                # Full diagnostic
 *   npx tsx scripts/search/diagnose-unified-vector-pipeline.ts --userId <ID>  # User-scoped
 *   npx tsx scripts/search/diagnose-unified-vector-pipeline.ts --quick        # Endpoints only
 */
import 'dotenv/config';
import { SearchClient, SearchIndexClient, AzureKeyCredential } from '@azure/search-documents';
import { getFlag, hasFlag } from '../_shared/args.js';
import { INDEX_NAME, INDEX_NAME_V2, getActiveIndexName } from '../_shared/azure.js';

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

const userId = getFlag('--userId')?.toUpperCase();
const quickMode = hasFlag('--quick');

const searchEndpoint = process.env.AZURE_SEARCH_ENDPOINT;
const searchKey = process.env.AZURE_SEARCH_KEY;
const cohereEndpoint = process.env.COHERE_ENDPOINT?.replace(/\/$/, '');
const cohereKey = process.env.COHERE_API_KEY;
const cohereImageEndpoint = process.env.COHERE_IMAGE_ENDPOINT
  ?? cohereEndpoint?.replace('.cognitiveservices.azure.com', '.services.ai.azure.com');

interface CheckResult {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  detail: string;
}

const results: CheckResult[] = [];

function check(name: string, status: 'pass' | 'warn' | 'fail', detail: string): void {
  results.push({ name, status, detail });
  const icon = status === 'pass' ? `${GREEN}✓${RESET}` : status === 'warn' ? `${YELLOW}⚠${RESET}` : `${RED}✗${RESET}`;
  console.log(`  ${icon} ${name}: ${detail}`);
}

async function verifyConfig(): Promise<void> {
  console.log(`\n${BOLD}━━━ Configuration ━━━${RESET}`);

  check('USE_UNIFIED_INDEX', process.env.USE_UNIFIED_INDEX === 'true' ? 'pass' : 'fail',
    process.env.USE_UNIFIED_INDEX === 'true' ? 'true (V2 pipeline active)' : `${process.env.USE_UNIFIED_INDEX ?? 'not set'} — V2 pipeline NOT active`);

  check('COHERE_ENDPOINT', cohereEndpoint ? 'pass' : 'fail',
    cohereEndpoint ?? 'NOT SET');

  check('COHERE_API_KEY', cohereKey ? 'pass' : 'fail',
    cohereKey ? `set (${cohereKey.length} chars)` : 'NOT SET');

  check('COHERE_IMAGE_ENDPOINT', cohereImageEndpoint ? 'pass' : 'warn',
    process.env.COHERE_IMAGE_ENDPOINT
      ? `explicit: ${process.env.COHERE_IMAGE_ENDPOINT}`
      : `auto-derived: ${cohereImageEndpoint}`);

  check('Active index', getActiveIndexName() === INDEX_NAME_V2 ? 'pass' : 'warn',
    getActiveIndexName());
}

async function verifyEndpoints(): Promise<void> {
  console.log(`\n${BOLD}━━━ Endpoint Connectivity ━━━${RESET}`);

  if (!cohereEndpoint || !cohereKey) {
    check('Text endpoint', 'fail', 'Cohere credentials not configured');
    check('Image endpoint', 'fail', 'Cohere credentials not configured');
    return;
  }

  // Text endpoint
  try {
    const res = await fetch(`${cohereEndpoint}/openai/deployments/embed-v-4-0/embeddings?api-version=2024-06-01`, {
      method: 'POST',
      headers: { 'api-key': cohereKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: ['stabilization test'], model: 'embed-v-4-0' }),
    });
    const data = await res.json() as any;
    const dims = data.data?.[0]?.embedding?.length;
    check('Text endpoint', res.ok && dims === 1536 ? 'pass' : 'fail',
      `${res.status} | model=${data.model} | dims=${dims}`);
  } catch (e: any) {
    check('Text endpoint', 'fail', e.message);
  }

  // Image endpoint
  const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
  try {
    const res = await fetch(`${cohereImageEndpoint}/models/images/embeddings?api-version=2024-05-01-preview`, {
      method: 'POST',
      headers: { 'api-key': cohereKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'embed-v-4-0', input: [{ image: tinyPng }], input_type: 'document' }),
    });
    const data = await res.json() as any;
    const dims = data.data?.[0]?.embedding?.length;
    check('Image endpoint', res.ok && dims === 1536 ? 'pass' : 'fail',
      `${res.status} | model=${data.model} | dims=${dims}`);
  } catch (e: any) {
    check('Image endpoint', 'fail', e.message);
  }

  // Cross-modal vector space
  try {
    const textRes = await fetch(`${cohereEndpoint}/openai/deployments/embed-v-4-0/embeddings?api-version=2024-06-01`, {
      method: 'POST',
      headers: { 'api-key': cohereKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: ['a red sports car driving fast on a highway'], model: 'embed-v-4-0' }),
    });
    const textEmb = ((await textRes.json()) as any).data[0].embedding as number[];

    const imgRes = await fetch(`${cohereImageEndpoint}/models/images/embeddings?api-version=2024-05-01-preview`, {
      method: 'POST',
      headers: { 'api-key': cohereKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'embed-v-4-0', input: [{ image: tinyPng }], input_type: 'query' }),
    });
    const imgEmb = ((await imgRes.json()) as any).data[0].embedding as number[];

    const same = textEmb.length === imgEmb.length;
    let dot = 0, nA = 0, nB = 0;
    for (let i = 0; i < textEmb.length; i++) { dot += textEmb[i] * imgEmb[i]; nA += textEmb[i] ** 2; nB += imgEmb[i] ** 2; }
    const cosine = dot / (Math.sqrt(nA) * Math.sqrt(nB));

    check('Unified vector space', same ? 'pass' : 'fail',
      `text=${textEmb.length}d, image=${imgEmb.length}d, cross-modal cosine=${cosine.toFixed(4)}`);
  } catch (e: any) {
    check('Unified vector space', 'fail', e.message);
  }
}

async function verifyIndexes(): Promise<void> {
  console.log(`\n${BOLD}━━━ Search Indexes ━━━${RESET}`);

  if (!searchEndpoint || !searchKey) {
    check('Search credentials', 'fail', 'AZURE_SEARCH_ENDPOINT/KEY not set');
    return;
  }

  const indexClient = new SearchIndexClient(searchEndpoint, new AzureKeyCredential(searchKey));

  for (const name of [INDEX_NAME, INDEX_NAME_V2]) {
    try {
      const idx = await indexClient.getIndex(name);
      const vectorFields = idx.fields.filter((f: any) => f.type?.includes('Single'));
      const sc = new SearchClient(searchEndpoint, name, new AzureKeyCredential(searchKey));
      const r = await sc.search('*', { top: 0, includeTotalCount: true });
      const isV2 = name === INDEX_NAME_V2;
      const label = isV2 ? 'V2 index' : 'V1 index';

      check(label, 'pass',
        `${name} | ${idx.fields.length} fields | vectors: ${vectorFields.map((f: any) => f.name + '(' + f.vectorSearchDimensions + 'd)').join(', ')} | ${r.count} docs`);
    } catch (e: any) {
      check(name === INDEX_NAME_V2 ? 'V2 index' : 'V1 index', name === INDEX_NAME_V2 ? 'fail' : 'warn',
        `${name}: ${e.message?.slice(0, 80)}`);
    }
  }
}

async function verifyUserContent(): Promise<void> {
  if (!userId) return;
  if (!searchEndpoint || !searchKey) return;

  console.log(`\n${BOLD}━━━ User Content (${userId.slice(0, 8)}...) ━━━${RESET}`);

  const v2 = new SearchClient(searchEndpoint, INDEX_NAME_V2, new AzureKeyCredential(searchKey));

  // Counts
  const textDocs = await v2.search('*', { top: 0, includeTotalCount: true, filter: `userId eq '${userId}' and isImage eq false` });
  const imgDocs = await v2.search('*', { top: 0, includeTotalCount: true, filter: `userId eq '${userId}' and isImage eq true` });
  const total = (textDocs.count || 0) + (imgDocs.count || 0);

  check('User docs in V2', total > 0 ? 'pass' : 'warn',
    `${total} total (${textDocs.count} text chunks, ${imgDocs.count} images)`);

  // Model distribution
  const allDocs = await v2.search('*', { filter: `userId eq '${userId}'`, select: ['embeddingModel', 'isImage'] as any, top: 1000 });
  const models: Record<string, number> = {};
  for await (const r of allDocs.results) {
    const d = r.document as any;
    const key = `${d.embeddingModel || 'unknown'}`;
    models[key] = (models[key] || 0) + 1;
  }

  const allCohere = Object.keys(models).every(m => m.includes('Cohere'));
  check('Embedding model', allCohere ? 'pass' : 'warn',
    Object.entries(models).map(([m, c]) => `${m}: ${c}`).join(', ') || 'no docs');

  // Vector presence check
  const vectorSample = await v2.search('*', {
    filter: `userId eq '${userId}'`,
    select: ['chunkId', 'fileName', 'isImage', 'embeddingVector'] as any,
    top: 50,
  });
  let withVector = 0;
  let withoutVector = 0;
  let sampleCount = 0;
  for await (const r of vectorSample.results) {
    const d = r.document as any;
    if (d.embeddingVector && d.embeddingVector.length > 0) withVector++;
    else withoutVector++;
    sampleCount++;
  }

  check('Vector coverage', withoutVector === 0 ? 'pass' : 'fail',
    `${withVector}/${sampleCount} docs have vectors` + (withoutVector > 0 ? ` (${RED}${withoutVector} MISSING${RESET})` : ''));

  // Image details
  if ((imgDocs.count || 0) > 0) {
    console.log(`\n  ${DIM}Image documents:${RESET}`);
    const imgDetails = await v2.search('*', {
      filter: `userId eq '${userId}' and isImage eq true`,
      select: ['fileName', 'embeddingModel', 'sourceType', 'content', 'embeddingVector'] as any,
      top: 20,
    });
    for await (const r of imgDetails.results) {
      const d = r.document as any;
      const vec = d.embeddingVector;
      const caption = (d.content || '').replace(/\[Image:.*\]/, '').trim().slice(0, 60);
      console.log(`    ${d.sourceType === 'local' ? '📁' : '☁️'}  ${d.fileName} | ${vec ? vec.length + 'd' : 'NO VECTOR'} | ${caption || '(no caption)'}`);
    }
  }
}

async function printSummary(): Promise<void> {
  const passes = results.filter(r => r.status === 'pass').length;
  const warns = results.filter(r => r.status === 'warn').length;
  const fails = results.filter(r => r.status === 'fail').length;

  console.log(`\n${BOLD}━━━ Summary ━━━${RESET}`);
  console.log(`  ${GREEN}✓ ${passes} passed${RESET}  ${warns > 0 ? `${YELLOW}⚠ ${warns} warnings${RESET}  ` : ''}${fails > 0 ? `${RED}✗ ${fails} failed${RESET}` : ''}`);

  if (fails === 0) {
    console.log(`\n  ${GREEN}${BOLD}V2 Stabilization: HEALTHY${RESET}`);
    console.log(`  ${DIM}Unified vector space operational — text and images in same 1536d Cohere Embed v4 space${RESET}`);
  } else {
    console.log(`\n  ${RED}${BOLD}V2 Stabilization: ISSUES DETECTED${RESET}`);
    console.log(`  ${DIM}Review failed checks above${RESET}`);
  }

  process.exit(fails > 0 ? 1 : 0);
}

async function main(): Promise<void> {
  console.log(`${BOLD}${CYAN}RAG Agent Stabilization — V2 Pipeline Diagnostic${RESET}`);
  console.log(`${DIM}Verifying unified Cohere Embed v4 vector space${RESET}`);

  await verifyConfig();
  await verifyEndpoints();

  if (!quickMode) {
    await verifyIndexes();
    await verifyUserContent();
  }

  await printSummary();
}

main().catch(e => {
  console.error(`${RED}Fatal:${RESET}`, e.message);
  process.exit(1);
});
