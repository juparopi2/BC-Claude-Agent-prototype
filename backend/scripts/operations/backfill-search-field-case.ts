/**
 * backfill-search-field-case.ts
 *
 * Fixes case inconsistency in AI Search index by uppercasing `parentFolderId`
 * and `siteId` fields using mergeDocuments (no embedding reprocessing).
 *
 * Root cause: The indexing pipeline stored these fields in original DB case
 * (lowercase) while OData filters use UPPERCASE. Azure AI Search search.in()
 * is case-sensitive, so folder/site scope filters returned zero results.
 *
 * This script:
 *   1. Scans all documents in the index (or for a specific user)
 *   2. Identifies documents where parentFolderId or siteId are not UPPERCASE
 *   3. Updates them in batches via mergeDocuments (only touches those 2 fields)
 *
 * Usage:
 *   # Dry run (local dev)
 *   npx tsx scripts/operations/backfill-search-field-case.ts --dry-run
 *
 *   # Dry run for specific user
 *   npx tsx scripts/operations/backfill-search-field-case.ts --userId <UUID> --dry-run
 *
 *   # Execute against local dev
 *   npx tsx scripts/operations/backfill-search-field-case.ts --userId <UUID> --confirm
 *
 *   # Dry run against dev/prod environment
 *   npx tsx scripts/operations/backfill-search-field-case.ts --env dev --dry-run
 *   npx tsx scripts/operations/backfill-search-field-case.ts --env prod --dry-run
 *
 *   # Execute against dev/prod (after verifying dry-run)
 *   npx tsx scripts/operations/backfill-search-field-case.ts --env dev --userId <UUID> --confirm
 *   npx tsx scripts/operations/backfill-search-field-case.ts --env prod --confirm
 */

import 'dotenv/config';
import { createSearchClient, INDEX_NAME } from '../_shared/azure';
import { getFlag, hasFlag } from '../_shared/args';
import { getTargetEnv, resolveEnvironment } from '../_shared/env-resolver';

// ─── ANSI Colors ──────────────────────────────────────────────────────────────
const RED     = '\x1b[31m';
const GREEN   = '\x1b[32m';
const YELLOW  = '\x1b[33m';
const CYAN    = '\x1b[36m';
const BOLD    = '\x1b[1m';
const DIM     = '\x1b[2m';
const RESET   = '\x1b[0m';

function hr(char = '─', len = 80): string { return char.repeat(len); }

// ─── Types ────────────────────────────────────────────────────────────────────

interface IndexDoc {
  chunkId: string;
  fileId: string;
  userId: string;
  parentFolderId: string | null;
  siteId: string | null;
}

interface MergeDoc {
  chunkId: string;
  parentFolderId?: string;
  siteId?: string;
}

function needsUppercase(value: string | null): boolean {
  if (!value) return false;
  return value !== value.toUpperCase();
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (hasFlag('--help') || hasFlag('-h')) {
    console.log(`
${BOLD}backfill-search-field-case${RESET} — Uppercase parentFolderId & siteId in AI Search index

${CYAN}Usage:${RESET}
  npx tsx scripts/operations/backfill-search-field-case.ts [options]

${CYAN}Options:${RESET}
  --dry-run             Preview changes without writing (REQUIRED for first run)
  --confirm             Execute the updates (mutually exclusive with --dry-run)
  --userId <UUID>       Only process documents for this user
  --env dev|prod        Run against remote environment
  --batch-size <N>      Documents per merge batch (default: 1000, Azure max)
  --help                Show this help

${CYAN}Workflow:${RESET}
  1. npx tsx scripts/operations/backfill-search-field-case.ts --dry-run
  2. npx tsx scripts/operations/backfill-search-field-case.ts --userId <UUID> --confirm
  3. Verify with: npx tsx scripts/diagnostics/diagnose-scope-filter.ts --userId <UUID> --folderId <ID>
  4. npx tsx scripts/operations/backfill-search-field-case.ts --env prod --dry-run
  5. npx tsx scripts/operations/backfill-search-field-case.ts --env prod --confirm
`);
    process.exit(0);
  }

  // Parse flags
  const targetEnv = getTargetEnv();
  if (targetEnv) await resolveEnvironment(targetEnv);

  const dryRun = hasFlag('--dry-run');
  const confirm = hasFlag('--confirm');
  const userId = getFlag('--userId') ?? getFlag('--user');
  const batchSize = parseInt(getFlag('--batch-size') ?? '1000', 10);

  if (!dryRun && !confirm) {
    console.error(`${RED}ERROR: Must specify either --dry-run or --confirm${RESET}`);
    process.exit(1);
  }
  if (dryRun && confirm) {
    console.error(`${RED}ERROR: --dry-run and --confirm are mutually exclusive${RESET}`);
    process.exit(1);
  }

  const searchClient = createSearchClient<IndexDoc>();
  if (!searchClient) {
    console.error(`${RED}ERROR: AI Search credentials not available${RESET}`);
    process.exit(1);
  }

  // Header
  console.log(`${BOLD}Backfill: UPPERCASE parentFolderId & siteId${RESET}`);
  console.log(`${DIM}Index: ${INDEX_NAME}${RESET}`);
  console.log(`${DIM}Mode: ${dryRun ? 'DRY RUN (no changes)' : `${RED}LIVE — will update documents${RESET}`}${RESET}`);
  if (targetEnv) console.log(`${DIM}Environment: ${targetEnv}${RESET}`);
  if (userId) console.log(`${DIM}User filter: ${userId.toUpperCase()}${RESET}`);
  console.log(`${DIM}Batch size: ${batchSize}${RESET}`);
  console.log(hr());

  // Build base filter
  let filter = '(fileStatus ne \'deleting\' or fileStatus eq null)';
  if (userId) {
    filter = `userId eq '${userId.toUpperCase()}' and ${filter}`;
  }

  // Scan all documents
  console.log(`\n${CYAN}Scanning index...${RESET}`);

  let totalScanned = 0;
  let needsFixParent = 0;
  let needsFixSite = 0;
  let alreadyCorrect = 0;
  const mergeBatches: MergeDoc[][] = [];
  let currentBatch: MergeDoc[] = [];

  // Paginate using skip/top — chunkId is not sortable so we can't use cursor pagination.
  // Azure AI Search supports skip up to 100,000. For larger indices, filter by userId.
  const PAGE_SIZE = 1000;
  let skip = 0;
  let hasMore = true;

  while (hasMore) {
    const searchOptions: Record<string, unknown> = {
      filter,
      select: ['chunkId', 'fileId', 'userId', 'parentFolderId', 'siteId'],
      top: PAGE_SIZE,
      skip,
    };

    const results = await searchClient.search('*', searchOptions);
    let pageCount = 0;

    for await (const result of results.results) {
      const doc = result.document;
      totalScanned++;
      pageCount++;

      const fixParent = needsUppercase(doc.parentFolderId);
      const fixSite = needsUppercase(doc.siteId);

      if (!fixParent && !fixSite) {
        alreadyCorrect++;
        continue;
      }

      if (fixParent) needsFixParent++;
      if (fixSite) needsFixSite++;

      const mergeDoc: MergeDoc = { chunkId: doc.chunkId };
      if (fixParent && doc.parentFolderId) {
        mergeDoc.parentFolderId = doc.parentFolderId.toUpperCase();
      }
      if (fixSite && doc.siteId) {
        mergeDoc.siteId = doc.siteId.toUpperCase();
      }

      currentBatch.push(mergeDoc);

      if (currentBatch.length >= batchSize) {
        mergeBatches.push(currentBatch);
        currentBatch = [];
      }
    }

    if (pageCount < PAGE_SIZE) {
      hasMore = false;
    } else {
      skip += pageCount;
      // Azure AI Search skip limit is 100,000
      if (skip >= 100_000) {
        console.warn(`\n  ${YELLOW}Warning: Reached skip limit (100k). Use --userId to process per-user.${RESET}`);
        hasMore = false;
      }
    }

    process.stdout.write(`\r  Scanned: ${totalScanned} docs...`);
  }

  // Flush remaining batch
  if (currentBatch.length > 0) {
    mergeBatches.push(currentBatch);
  }

  const totalToFix = mergeBatches.reduce((sum, b) => sum + b.length, 0);

  // Report
  console.log(`\n\n${BOLD}Scan Results${RESET}`);
  console.log(hr());
  console.log(`  Total scanned:           ${BOLD}${totalScanned}${RESET}`);
  console.log(`  Already UPPERCASE:       ${GREEN}${alreadyCorrect}${RESET}`);
  console.log(`  Need parentFolderId fix: ${needsFixParent > 0 ? YELLOW : GREEN}${needsFixParent}${RESET}`);
  console.log(`  Need siteId fix:         ${needsFixSite > 0 ? YELLOW : GREEN}${needsFixSite}${RESET}`);
  console.log(`  Total documents to fix:  ${totalToFix > 0 ? `${YELLOW}${BOLD}${totalToFix}${RESET}` : `${GREEN}0${RESET}`}`);
  console.log(`  Merge batches:           ${mergeBatches.length}`);

  if (totalToFix === 0) {
    console.log(`\n${GREEN}${BOLD}All documents already have UPPERCASE fields. Nothing to do.${RESET}`);
    return;
  }

  // Show sample of what would change
  console.log(`\n${BOLD}Sample changes (first 5):${RESET}`);
  const allDocs = mergeBatches.flat();
  for (const doc of allDocs.slice(0, 5)) {
    const changes: string[] = [];
    if (doc.parentFolderId) changes.push(`parentFolderId→${doc.parentFolderId.slice(0, 20)}...`);
    if (doc.siteId) changes.push(`siteId→${doc.siteId.slice(0, 30)}...`);
    console.log(`  ${DIM}${doc.chunkId}${RESET} ${changes.join(', ')}`);
  }
  if (allDocs.length > 5) {
    console.log(`  ${DIM}... and ${allDocs.length - 5} more${RESET}`);
  }

  // Dry run stops here
  if (dryRun) {
    console.log(`\n${YELLOW}${BOLD}DRY RUN — no changes made.${RESET}`);
    console.log(`  To apply, run with ${CYAN}--confirm${RESET} instead of ${CYAN}--dry-run${RESET}`);
    return;
  }

  // Execute merge
  console.log(`\n${BOLD}Executing merge updates...${RESET}`);

  let totalUpdated = 0;
  let totalFailed = 0;

  for (let i = 0; i < mergeBatches.length; i++) {
    const batch = mergeBatches[i]!;

    try {
      const result = await searchClient.mergeDocuments(batch as unknown as IndexDoc[]);
      const succeeded = result.results.filter(r => r.succeeded).length;
      const failed = result.results.filter(r => !r.succeeded).length;
      totalUpdated += succeeded;
      totalFailed += failed;

      if (failed > 0) {
        const failedResults = result.results.filter(r => !r.succeeded);
        for (const f of failedResults.slice(0, 3)) {
          console.error(`  ${RED}Failed: ${f.key} — ${f.errorMessage}${RESET}`);
        }
      }

      process.stdout.write(`\r  Batch ${i + 1}/${mergeBatches.length}: ${succeeded} updated, ${failed} failed`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`\n  ${RED}Batch ${i + 1} failed: ${msg}${RESET}`);
      totalFailed += batch.length;
    }
  }

  // Final report
  console.log(`\n\n${BOLD}Results${RESET}`);
  console.log(hr('═'));
  console.log(`  Updated:  ${GREEN}${BOLD}${totalUpdated}${RESET}`);
  console.log(`  Failed:   ${totalFailed > 0 ? `${RED}${totalFailed}${RESET}` : `${GREEN}0${RESET}`}`);

  if (totalFailed === 0) {
    console.log(`\n${GREEN}${BOLD}Backfill completed successfully.${RESET}`);
    console.log(`  Verify with: ${DIM}npx tsx scripts/diagnostics/diagnose-scope-filter.ts --userId <UUID> --folderId <ID>${RESET}`);
  } else {
    console.log(`\n${YELLOW}Backfill completed with ${totalFailed} failures. Re-run to retry failed documents.${RESET}`);
  }
}

main().catch((err) => {
  console.error(`${RED}Fatal: ${err instanceof Error ? err.message : String(err)}${RESET}`);
  process.exit(1);
});
