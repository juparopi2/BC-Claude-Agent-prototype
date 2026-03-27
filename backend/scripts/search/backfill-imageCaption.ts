/**
 * Backfill imageCaption Field in Azure AI Search Index
 *
 * Migration script to separate the AI-generated caption from the `content` field
 * into the new `imageCaption` field for existing image documents.
 *
 * Before running:
 * - Deploy schema changes (add `imageCaption` field) via update-search-schema.ts
 * - Verify the field exists: GET /indexes/file-chunks-index-v2?api-version=2025-08-01-preview
 *
 * What it does:
 * - Queries all documents where isImage eq true
 * - Parses current `content` field: "{caption} [Image: {filename}]"
 * - Sets `imageCaption = caption` (new non-searchable field)
 * - Sets `content = [Image: {filename}]` (stripped of caption)
 * - Uses mergeDocuments (preserves embeddings and all other fields)
 *
 * Usage:
 *   npx tsx scripts/search/backfill-imageCaption.ts --dry-run          # Preview changes
 *   npx tsx scripts/search/backfill-imageCaption.ts                     # Execute migration
 *   npx tsx scripts/search/backfill-imageCaption.ts --userId <UUID>     # Scope to one user
 *
 * @module scripts/search/backfill-imageCaption
 */

import 'dotenv/config';
import { createSearchClient, INDEX_NAME } from '../_shared/azure';
import { hasFlag, getFlag } from '../_shared/args';

const BATCH_SIZE = 1000;
const PAGE_SIZE = 5000;

interface ImageDocument {
  chunkId: string;
  fileId: string;
  userId: string;
  content: string;
  imageCaption?: string;
}

/**
 * Parse the caption from the content field.
 * Content format: "{caption} [Image: {filename}]" or "[Image: {filename}]"
 */
function parseContent(content: string): { caption: string | null; fileName: string; newContent: string } {
  const match = content.match(/^(.+?)\s*\[Image: (.+?)\]$/);
  if (match) {
    const caption = match[1].trim();
    const fileName = match[2];
    // If the "caption" is empty or just whitespace, treat as no caption
    if (!caption) {
      return { caption: null, fileName, newContent: `[Image: ${fileName}]` };
    }
    return { caption, fileName, newContent: `[Image: ${fileName}]` };
  }

  // Content might already be in new format: "[Image: {filename}]"
  const simpleMatch = content.match(/^\[Image: (.+?)\]$/);
  if (simpleMatch) {
    return { caption: null, fileName: simpleMatch[1], newContent: content };
  }

  // Unexpected format — return as-is
  return { caption: null, fileName: 'unknown', newContent: content };
}

async function main(): Promise<void> {
  const dryRun = hasFlag('--dry-run');
  const userIdFilter = getFlag('--userId');

  console.log('=== imageCaption Backfill Migration ===');
  console.log(`Mode: ${dryRun ? 'DRY RUN (no changes)' : 'EXECUTE'}`);
  if (userIdFilter) {
    console.log(`Scoped to userId: ${userIdFilter.toUpperCase()}`);
  }
  console.log();

  const searchClient = createSearchClient<Record<string, unknown>>();
  if (!searchClient) {
    console.error('ERROR: AI Search credentials not configured. Set AZURE_SEARCH_ENDPOINT and AZURE_SEARCH_KEY.');
    process.exit(1);
  }

  // 1. Query all image documents
  console.log('Fetching image documents from search index...');
  const allImages: ImageDocument[] = [];
  let skip = 0;
  let hasMore = true;

  const filter = userIdFilter
    ? `isImage eq true and userId eq '${userIdFilter.toUpperCase()}'`
    : 'isImage eq true';

  while (hasMore) {
    const results = await searchClient.search('*', {
      filter,
      select: ['chunkId', 'fileId', 'userId', 'content', 'imageCaption'] as never,
      top: PAGE_SIZE,
      skip,
      queryType: 'full',
    });

    let count = 0;
    for await (const result of results.results) {
      const doc = result.document as unknown as ImageDocument;
      allImages.push(doc);
      count++;
    }

    console.log(`  Fetched page: skip=${skip}, count=${count}, total=${allImages.length}`);

    if (count < PAGE_SIZE) {
      hasMore = false;
    } else {
      skip += PAGE_SIZE;
    }
  }

  console.log(`Total image documents found: ${allImages.length}`);
  console.log();

  // 2. Analyze and prepare updates
  const updates: Array<Record<string, unknown>> = [];
  let alreadyMigrated = 0;
  let noCaption = 0;
  let willMigrate = 0;

  for (const doc of allImages) {
    // Skip if already migrated (imageCaption is set AND content has no caption)
    if (doc.imageCaption && doc.content.match(/^\[Image: .+?\]$/)) {
      alreadyMigrated++;
      continue;
    }

    const parsed = parseContent(doc.content);

    if (!parsed.caption) {
      // No caption to extract — content is already clean or never had a caption
      noCaption++;
      continue;
    }

    updates.push({
      chunkId: doc.chunkId,
      content: parsed.newContent,
      imageCaption: parsed.caption,
      '@search.action': 'merge',
    });
    willMigrate++;
  }

  console.log('Analysis:');
  console.log(`  Already migrated: ${alreadyMigrated}`);
  console.log(`  No caption to extract: ${noCaption}`);
  console.log(`  Will migrate: ${willMigrate}`);
  console.log();

  if (updates.length === 0) {
    console.log('No documents need migration. Done.');
    return;
  }

  // Show sample updates
  console.log('Sample updates (first 3):');
  for (const update of updates.slice(0, 3)) {
    console.log(`  chunkId: ${update.chunkId}`);
    console.log(`    content: "${update.content}"`);
    console.log(`    imageCaption: "${String(update.imageCaption).slice(0, 80)}..."`);
    console.log();
  }

  if (dryRun) {
    console.log('DRY RUN — no changes applied. Run without --dry-run to execute.');
    return;
  }

  // 3. Execute updates in batches
  console.log(`Executing migration in batches of ${BATCH_SIZE}...`);
  let uploaded = 0;
  let failed = 0;

  for (let i = 0; i < updates.length; i += BATCH_SIZE) {
    const batch = updates.slice(i, i + BATCH_SIZE);

    try {
      const result = await searchClient.mergeOrUploadDocuments(batch);
      const succeeded = result.results.filter(r => r.succeeded).length;
      const batchFailed = result.results.filter(r => !r.succeeded).length;
      uploaded += succeeded;
      failed += batchFailed;

      console.log(
        `  Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${succeeded} succeeded, ${batchFailed} failed (total: ${uploaded}/${updates.length})`
      );

      if (batchFailed > 0) {
        const failures = result.results.filter(r => !r.succeeded);
        console.warn(`    Failed keys: ${failures.map(f => f.key).slice(0, 5).join(', ')}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  Batch ${Math.floor(i / BATCH_SIZE) + 1} FAILED: ${message}`);
    }
  }

  console.log();
  console.log('=== Migration Complete ===');
  console.log(`  Updated: ${uploaded}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Skipped (already migrated): ${alreadyMigrated}`);
  console.log(`  Skipped (no caption): ${noCaption}`);
}

main().catch((error) => {
  console.error('Migration failed:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
