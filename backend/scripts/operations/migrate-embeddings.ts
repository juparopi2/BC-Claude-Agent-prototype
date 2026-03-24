/**
 * PRD-202: One-time embedding migration script.
 *
 * Migrates all chunks from the v1 index (file-chunks-index) to the v2 index
 * (file-chunks-index-v2) by re-embedding content with Cohere Embed 4.
 *
 * The v2 index uses a single unified 1536d vector field `embeddingVector`
 * for both text and image content, replacing the separate `contentVector`
 * (1536d OpenAI) and `imageVector` (1024d Azure CV) fields in v1.
 *
 * Usage:
 *   npx tsx scripts/operations/migrate-embeddings.ts --dry-run
 *   npx tsx scripts/operations/migrate-embeddings.ts --validate
 *   npx tsx scripts/operations/migrate-embeddings.ts --user-id <UUID>
 *   npx tsx scripts/operations/migrate-embeddings.ts
 *   npx tsx scripts/operations/migrate-embeddings.ts --batch-size 50 --concurrency 3
 */

import 'dotenv/config';
import { SearchClient, AzureKeyCredential } from '@azure/search-documents';
import { createSearchClient, createBlobContainerClient } from '../_shared/azure';
import { createPrisma } from '../_shared/prisma';
import { hasFlag, getFlag, getNumericFlag } from '../_shared/args';
import { createCohereClient, CohereClient } from '../_shared/cohere';
import type { ContainerClient } from '@azure/storage-blob';

// ============================================================================
// ANSI colors
// ============================================================================

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

// ============================================================================
// Index names
// ============================================================================

const INDEX_NAME_V1 = process.env.AZURE_SEARCH_INDEX_NAME || 'file-chunks-index';
const INDEX_NAME_V2 = 'file-chunks-index-v2';

// ============================================================================
// CLI flags
// ============================================================================

const dryRun = hasFlag('--dry-run');
const validateOnly = hasFlag('--validate');
const userId = getFlag('--user-id')?.toUpperCase() ?? null;
const batchSize = getNumericFlag('--batch-size', 100);
const concurrency = getNumericFlag('--concurrency', 5);

if (hasFlag('--help')) {
  console.log(`
Usage: npx tsx scripts/operations/migrate-embeddings.ts [flags]

Flags:
  --dry-run           Scan v1 index, report counts, don't write
  --validate          Run quality comparison between v1 and v2
  --user-id <ID>      Migrate only a specific user's content
  --batch-size <N>    Override batch size (default: 100)
  --concurrency <N>   Parallel image downloads (default: 5)
  --help              Show this help
  `);
  process.exit(0);
}

// ============================================================================
// Types
// ============================================================================

interface ChunkRef {
  chunkId: string;
  fileId: string;
  userId: string;
  content: string;
  isImage: boolean;
  mimeType: string | null;
  sourceType: string | null;
  fileName: string | null;
  fileModifiedAt: string | null;
  chunkIndex: number | null;
  tokenCount: number | null;
  embeddingModel: string | null;
  fileStatus: string | null;
  sizeBytes: number | null;
  siteId: string | null;
  parentFolderId: string | null;
}

interface MigrationFailure {
  chunkId: string;
  error: string;
}

interface SearchHit {
  fileId: string;
  score: number;
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const startTime = Date.now();
  console.log(`${BOLD}PRD-202: Embedding Migration${RESET}`);
  console.log(`${DIM}Migrating from ${INDEX_NAME_V1} → ${INDEX_NAME_V2}${RESET}\n`);

  // Initialize clients
  const searchClientV1 = createSearchClient<Record<string, unknown>>();
  if (!searchClientV1) {
    console.error(`${RED}✗ AI Search credentials not configured${RESET}`);
    process.exit(1);
  }

  // Create v2 client explicitly (different index name from v1)
  const endpoint = process.env.AZURE_SEARCH_ENDPOINT;
  const key = process.env.AZURE_SEARCH_KEY;
  if (!endpoint || !key) {
    console.error(`${RED}✗ AZURE_SEARCH_ENDPOINT or AZURE_SEARCH_KEY not set${RESET}`);
    process.exit(1);
  }
  const searchClientV2 = new SearchClient<Record<string, unknown>>(
    endpoint,
    INDEX_NAME_V2,
    new AzureKeyCredential(key),
  );

  const cohere = createCohereClient();
  if (!cohere) {
    console.error(`${RED}✗ Cohere credentials not configured${RESET}`);
    process.exit(1);
  }

  if (validateOnly) {
    await runValidation(searchClientV1, searchClientV2, cohere);
    return;
  }

  // PHASE 1: SCAN
  console.log(`${CYAN}Phase 1: Scanning v1 index...${RESET}`);
  const chunks = await scanV1Index(searchClientV1);

  const textChunks = chunks.filter(c => !c.isImage);
  const imageChunks = chunks.filter(c => c.isImage);

  console.log(`  Total: ${BOLD}${chunks.length}${RESET} chunks`);
  console.log(`  Text:  ${textChunks.length}`);
  console.log(`  Image: ${imageChunks.length}\n`);

  if (dryRun) {
    console.log(`${YELLOW}[DRY RUN] Would migrate ${chunks.length} chunks. Exiting.${RESET}`);
    process.exit(0);
  }

  const failures: MigrationFailure[] = [];

  // PHASE 2: MIGRATE TEXT CHUNKS
  console.log(`${CYAN}Phase 2: Migrating text chunks...${RESET}`);
  await migrateTextChunks(textChunks, searchClientV2, cohere, failures);

  // PHASE 3: MIGRATE IMAGE CHUNKS
  console.log(`\n${CYAN}Phase 3: Migrating image chunks...${RESET}`);
  await migrateImageChunks(imageChunks, searchClientV2, cohere, failures);

  // PHASE 4: VERIFY
  console.log(`\n${CYAN}Phase 4: Verifying...${RESET}`);
  await verifyMigration(searchClientV1, searchClientV2);

  // PHASE 5: REPORT
  const durationSec = Math.round((Date.now() - startTime) / 1000);
  console.log(`\n${BOLD}Migration Summary${RESET}`);
  console.log(`  Duration:  ${durationSec}s`);
  console.log(`  Migrated:  ${chunks.length - failures.length}/${chunks.length}`);
  console.log(`  Failures:  ${failures.length > 0 ? RED : GREEN}${failures.length}${RESET}`);

  if (failures.length > 0) {
    console.log(`\n${YELLOW}Failed chunks:${RESET}`);
    for (const f of failures.slice(0, 20)) {
      console.log(`  ${f.chunkId}: ${f.error}`);
    }
    if (failures.length > 20) {
      console.log(`  ... and ${failures.length - 20} more`);
    }
    const failRate = failures.length / chunks.length;
    if (failRate > 0.01) {
      console.error(`\n${RED}✗ Failure rate ${(failRate * 100).toFixed(1)}% exceeds 1% threshold${RESET}`);
      process.exit(1);
    }
  }

  console.log(`\n${GREEN}✓ Migration complete${RESET}`);
}

// ============================================================================
// Phase 1: Scan v1 index
// ============================================================================

async function scanV1Index(client: SearchClient<Record<string, unknown>>): Promise<ChunkRef[]> {
  const chunks: ChunkRef[] = [];
  const pageSize = 1000;
  let skip = 0;
  const selectFields = [
    'chunkId', 'fileId', 'userId', 'content', 'isImage',
    'mimeType', 'fileName', 'fileModifiedAt', 'chunkIndex',
    'tokenCount', 'embeddingModel', 'fileStatus', 'sizeBytes',
    'siteId', 'sourceType', 'parentFolderId',
  ];

  // Build filter — exclude chunks actively being deleted
  let filter = "(fileStatus ne 'deleting' or fileStatus eq null)";
  if (userId) {
    filter = `userId eq '${userId}' and ${filter}`;
  }

  while (true) {
    const results = await client.search('*', {
      filter,
      top: pageSize,
      skip,
      select: selectFields as string[],
      orderBy: ['chunkId asc'],
    });

    const batch: ChunkRef[] = [];
    for await (const result of results.results) {
      const doc = result.document as Record<string, unknown>;
      batch.push({
        chunkId: doc['chunkId'] as string,
        fileId: doc['fileId'] as string,
        userId: doc['userId'] as string,
        content: (doc['content'] as string) ?? '',
        isImage: (doc['isImage'] as boolean) ?? false,
        mimeType: (doc['mimeType'] as string) ?? null,
        sourceType: (doc['sourceType'] as string) ?? null,
        fileName: (doc['fileName'] as string) ?? null,
        fileModifiedAt: (doc['fileModifiedAt'] as string) ?? null,
        chunkIndex: (doc['chunkIndex'] as number) ?? null,
        tokenCount: (doc['tokenCount'] as number) ?? null,
        embeddingModel: (doc['embeddingModel'] as string) ?? null,
        fileStatus: (doc['fileStatus'] as string) ?? null,
        sizeBytes: (doc['sizeBytes'] as number) ?? null,
        siteId: (doc['siteId'] as string) ?? null,
        parentFolderId: (doc['parentFolderId'] as string) ?? null,
      });
    }

    chunks.push(...batch);
    console.log(`  Scanned ${chunks.length} chunks...`);

    if (batch.length < pageSize) break;
    skip += pageSize;
  }

  return chunks;
}

// ============================================================================
// Phase 2: Migrate text chunks
// ============================================================================

async function migrateTextChunks(
  chunks: ChunkRef[],
  v2Client: SearchClient<Record<string, unknown>>,
  cohere: CohereClient,
  failures: MigrationFailure[],
): Promise<void> {
  if (chunks.length === 0) {
    console.log('  No text chunks to migrate');
    return;
  }

  const totalBatches = Math.ceil(chunks.length / batchSize);

  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;

    try {
      const texts = batch.map(c => c.content);
      const embedResults = await cohere.embedTextBatch(texts, 'search_document');

      // Build v2 documents
      const documents = batch.map((chunk, idx) => ({
        chunkId: chunk.chunkId,
        fileId: chunk.fileId,
        userId: chunk.userId,
        content: chunk.content,
        embeddingVector: embedResults[idx]!.embedding,
        isImage: false,
        mimeType: chunk.mimeType,
        fileName: chunk.fileName,
        fileModifiedAt: chunk.fileModifiedAt,
        chunkIndex: chunk.chunkIndex,
        tokenCount: chunk.tokenCount,
        embeddingModel: embedResults[idx]!.model,
        fileStatus: chunk.fileStatus ?? 'active',
        sizeBytes: chunk.sizeBytes,
        siteId: chunk.siteId,
        sourceType: chunk.sourceType,
        parentFolderId: chunk.parentFolderId,
        createdAt: new Date().toISOString(),
      }));

      // Use mergeOrUpload for idempotency — safe to re-run
      const uploadResult = await v2Client.mergeOrUploadDocuments(documents);
      const failedDocs = uploadResult.results.filter(r => !r.succeeded);
      for (const f of failedDocs) {
        failures.push({ chunkId: f.key ?? 'unknown', error: f.errorMessage ?? 'Upload failed' });
      }

      console.log(`  Batch ${batchNum}/${totalBatches} — ${Math.min(i + batchSize, chunks.length)}/${chunks.length} text chunks`);
    } catch (error) {
      // Entire batch failed — add all to failures
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error(`  ${RED}Batch ${batchNum} failed: ${errMsg}${RESET}`);
      for (const chunk of batch) {
        failures.push({ chunkId: chunk.chunkId, error: errMsg });
      }
    }
  }
}

// ============================================================================
// Phase 3: Migrate image chunks
// ============================================================================

async function migrateImageChunks(
  chunks: ChunkRef[],
  v2Client: SearchClient<Record<string, unknown>>,
  cohere: CohereClient,
  failures: MigrationFailure[],
): Promise<void> {
  if (chunks.length === 0) {
    console.log('  No image chunks to migrate');
    return;
  }

  const prisma = createPrisma();
  const blobContainer: ContainerClient | null = createBlobContainerClient();

  let processed = 0;
  let skippedExternal = 0;

  // Simple semaphore for concurrency control
  let running = 0;
  const queue: Array<() => Promise<void>> = [];

  function runNext(): void {
    while (running < concurrency && queue.length > 0) {
      const task = queue.shift()!;
      running++;
      void task().finally(() => {
        running--;
        runNext();
      });
    }
  }

  await new Promise<void>((resolve) => {
    for (const chunk of chunks) {
      queue.push(async () => {
        try {
          // Skip external files (OneDrive/SharePoint — need OAuth to download)
          if (chunk.sourceType && chunk.sourceType !== 'local') {
            skippedExternal++;
            processed++;
            return;
          }

          if (!blobContainer) {
            failures.push({ chunkId: chunk.chunkId, error: 'Blob storage not configured' });
            processed++;
            return;
          }

          // Look up blob path from DB
          const file = await prisma.files.findFirst({
            where: { id: chunk.fileId, user_id: chunk.userId },
            select: { blob_path: true, name: true },
          });

          if (!file?.blob_path) {
            failures.push({ chunkId: chunk.chunkId, error: 'No blob path found in DB' });
            processed++;
            return;
          }

          // Download image from blob storage
          const blobClient = blobContainer.getBlobClient(file.blob_path);
          const downloadResponse = await blobClient.download();
          if (!downloadResponse.readableStreamBody) {
            failures.push({ chunkId: chunk.chunkId, error: 'Empty download stream from blob' });
            processed++;
            return;
          }
          const imageBuffer = await streamToBuffer(downloadResponse.readableStreamBody);
          const base64Data = imageBuffer.toString('base64');

          // Embed with Cohere
          const embedResult = await cohere.embedImage(base64Data, 'search_document');

          // Build v2 document
          const document = {
            chunkId: chunk.chunkId,
            fileId: chunk.fileId,
            userId: chunk.userId,
            content: chunk.content,
            embeddingVector: embedResult.embedding,
            isImage: true,
            mimeType: chunk.mimeType,
            fileName: chunk.fileName ?? file.name,
            fileModifiedAt: chunk.fileModifiedAt,
            chunkIndex: chunk.chunkIndex,
            tokenCount: chunk.tokenCount,
            embeddingModel: embedResult.model,
            fileStatus: chunk.fileStatus ?? 'active',
            sizeBytes: chunk.sizeBytes,
            siteId: chunk.siteId,
            sourceType: chunk.sourceType,
            parentFolderId: chunk.parentFolderId,
            createdAt: new Date().toISOString(),
          };

          await v2Client.mergeOrUploadDocuments([document]);

          // Update image_embeddings record in DB to reflect new model/dimensions
          await prisma.$queryRaw`
            UPDATE image_embeddings
            SET embedding = ${JSON.stringify(embedResult.embedding)},
                dimensions = 1536,
                model = 'Cohere-embed-v4',
                model_version = 'v4',
                updated_at = GETUTCDATE()
            WHERE file_id = ${chunk.fileId} AND user_id = ${chunk.userId}
          `;

          processed++;
          if (processed % 10 === 0 || processed === chunks.length) {
            console.log(`  ${processed}/${chunks.length} images (${skippedExternal} external skipped)`);
          }
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error);
          failures.push({ chunkId: chunk.chunkId, error: errMsg });
          processed++;
        }
      });
    }

    // Start initial workers then poll for completion
    runNext();
    const checkComplete = setInterval(() => {
      runNext();
      if (processed >= chunks.length) {
        clearInterval(checkComplete);
        resolve();
      }
    }, 100);
  });

  await prisma.$disconnect();

  if (skippedExternal > 0) {
    console.log(
      `  ${YELLOW}⚠ Skipped ${skippedExternal} external files (OneDrive/SharePoint) — will re-embed on next sync${RESET}`,
    );
  }
}

// ============================================================================
// Phase 4: Verify
// ============================================================================

async function verifyMigration(
  v1Client: SearchClient<Record<string, unknown>>,
  v2Client: SearchClient<Record<string, unknown>>,
): Promise<void> {
  let filter = "(fileStatus ne 'deleting' or fileStatus eq null)";
  if (userId) {
    filter = `userId eq '${userId}' and ${filter}`;
  }

  const v1Count = await countDocuments(v1Client, filter);
  const v2Count = await countDocuments(v2Client, filter);

  console.log(`  V1 index: ${v1Count} documents`);
  console.log(`  V2 index: ${v2Count} documents`);

  if (v2Count >= v1Count) {
    console.log(`  ${GREEN}✓ Counts match or v2 exceeds v1${RESET}`);
  } else {
    const missing = v1Count - v2Count;
    console.log(
      `  ${YELLOW}⚠ V2 is missing ${missing} documents (may include skipped external files)${RESET}`,
    );
  }
}

async function countDocuments(
  client: SearchClient<Record<string, unknown>>,
  filter: string,
): Promise<number> {
  const results = await client.search('*', {
    filter,
    top: 0,
    includeTotalCount: true,
  });
  return results.count ?? 0;
}

// ============================================================================
// Validation mode (--validate)
// ============================================================================

async function runValidation(
  v1Client: SearchClient<Record<string, unknown>>,
  v2Client: SearchClient<Record<string, unknown>>,
  cohere: CohereClient,
): Promise<void> {
  console.log(`${BOLD}Quality Validation${RESET}\n`);

  const testQueries = [
    { query: 'revenue forecast', label: 'Text search' },
    { query: 'organizational chart', label: 'Image search' },
    { query: 'return policy', label: 'Document search' },
    { query: 'budget 2026', label: 'Cross-type' },
  ];

  let allPassed = true;

  for (const tq of testQueries) {
    console.log(`  Query: "${tq.query}" (${tq.label})`);

    // Generate query embedding with Cohere
    const embedResult = await cohere.embedText(tq.query, 'search_query');

    // Search v1 with contentVector field
    const v1Results = await searchWithEmbedding(v1Client, embedResult.embedding, 'contentVector', 5);
    // Search v2 with embeddingVector field
    const v2Results = await searchWithEmbedding(v2Client, embedResult.embedding, 'embeddingVector', 5);

    // Compare top-5 file overlap
    const v1FileIds = new Set(v1Results.map(r => r.fileId));
    const v2FileIds = new Set(v2Results.map(r => r.fileId));
    const overlap = [...v1FileIds].filter(id => v2FileIds.has(id)).length;
    const overlapRatio = v1FileIds.size > 0 ? overlap / v1FileIds.size : 1;

    // Average score comparison
    const v1AvgScore = v1Results.length > 0
      ? v1Results.reduce((s, r) => s + r.score, 0) / v1Results.length
      : 0;
    const v2AvgScore = v2Results.length > 0
      ? v2Results.reduce((s, r) => s + r.score, 0) / v2Results.length
      : 0;
    const scoreDrop = v1AvgScore > 0 ? (v1AvgScore - v2AvgScore) / v1AvgScore : 0;

    const overlapPass = overlapRatio >= 0.6;
    const scorePass = scoreDrop <= 0.15;

    console.log(
      `    Overlap: ${overlap}/${v1FileIds.size} (${(overlapRatio * 100).toFixed(0)}%) ${overlapPass ? GREEN + '✓' : RED + '✗'}${RESET}`,
    );
    console.log(
      `    Score drop: ${(scoreDrop * 100).toFixed(1)}% ${scorePass ? GREEN + '✓' : RED + '✗'}${RESET}`,
    );

    if (!overlapPass || !scorePass) allPassed = false;
  }

  console.log();
  if (allPassed) {
    console.log(`${GREEN}✓ All quality criteria passed${RESET}`);
  } else {
    console.log(`${RED}✗ Some quality criteria failed — review before cutover${RESET}`);
    process.exit(1);
  }
}

async function searchWithEmbedding(
  client: SearchClient<Record<string, unknown>>,
  embedding: number[],
  vectorField: string,
  top: number,
): Promise<SearchHit[]> {
  try {
    const results = await client.search('*', {
      vectorSearchOptions: {
        queries: [
          {
            kind: 'vector' as const,
            vector: embedding,
            fields: [vectorField],
            kNearestNeighborsCount: top,
          },
        ],
      },
      top,
      select: ['fileId'] as string[],
    });

    const hits: SearchHit[] = [];
    for await (const result of results.results) {
      const doc = result.document as Record<string, unknown>;
      hits.push({ fileId: doc['fileId'] as string, score: result.score ?? 0 });
    }
    return hits;
  } catch {
    // Index might be empty or field absent — return empty gracefully
    return [];
  }
}

// ============================================================================
// Helpers
// ============================================================================

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
  }
  return Buffer.concat(chunks);
}

// ============================================================================
// Entry point
// ============================================================================

main().catch((err) => {
  console.error(`${RED}Fatal error:${RESET}`, err);
  process.exit(1);
});
