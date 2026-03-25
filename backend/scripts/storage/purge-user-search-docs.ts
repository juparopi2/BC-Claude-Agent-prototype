/**
 * purge-user-search-docs.ts
 *
 * Delete all AI Search documents belonging to a specific user.
 * Uses paginated search with explicit skip/top to avoid async iterator hangs.
 *
 * Usage:
 *   npx tsx scripts/storage/purge-user-search-docs.ts <userId>
 *   npx tsx scripts/storage/purge-user-search-docs.ts <userId> --confirm
 */

import 'dotenv/config';
import { SearchClient, AzureKeyCredential } from '@azure/search-documents';
import { hasFlag, getPositionalArg } from '../_shared/args.js';
import { INDEX_NAME } from '../_shared/azure.js';

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

if (hasFlag('--help') || hasFlag('-h')) {
  console.log(`
${BOLD}purge-user-search-docs.ts${RESET} — Delete orphan AI Search documents for a user

${BOLD}Usage:${RESET}
  npx tsx scripts/storage/purge-user-search-docs.ts <userId>            ${DIM}(dry-run)${RESET}
  npx tsx scripts/storage/purge-user-search-docs.ts <userId> --confirm  ${DIM}(execute)${RESET}

${BOLD}Index:${RESET}
  Uses the active search index (INDEX_NAME from _shared/azure)
`);
  process.exit(0);
}

const userId = getPositionalArg()?.toUpperCase();
if (!userId) {
  console.error(`${RED}✗${RESET} Usage: npx tsx scripts/storage/purge-user-search-docs.ts <userId> [--confirm]`);
  process.exit(1);
}

const confirm = hasFlag('--confirm');

const indexNames: string[] = [INDEX_NAME];

const endpoint = process.env.AZURE_SEARCH_ENDPOINT;
const key = process.env.AZURE_SEARCH_KEY;

if (!endpoint || !key) {
  console.error(`${RED}✗${RESET} AZURE_SEARCH_ENDPOINT and AZURE_SEARCH_KEY must be set`);
  process.exit(1);
}

interface SearchDoc {
  chunkId: string;
  fileId?: string;
}

async function collectDocumentIds(client: SearchClient<SearchDoc>, indexName: string): Promise<string[]> {
  const allIds: string[] = [];
  const pageSize = 500;
  let skip = 0;

  console.log(`${CYAN}ℹ${RESET} Scanning index "${indexName}" for userId = ${userId}`);

  while (true) {
    const result = await client.search('*', {
      filter: `userId eq '${userId}'`,
      select: ['chunkId'] as any,
      top: pageSize,
      skip,
      includeTotalCount: skip === 0,
    });

    if (skip === 0 && result.count !== undefined) {
      console.log(`${CYAN}ℹ${RESET} Total documents reported by index: ${result.count}`);
    }

    const batch: string[] = [];
    for await (const r of result.results) {
      batch.push((r.document as any).chunkId);
    }

    allIds.push(...batch);
    console.log(`  Page ${Math.floor(skip / pageSize) + 1}: fetched ${batch.length} (total so far: ${allIds.length})`);

    if (batch.length < pageSize) break;
    skip += pageSize;
  }

  return allIds;
}

async function deleteDocuments(client: SearchClient<SearchDoc>, ids: string[]): Promise<{ succeeded: number; failed: number }> {
  const batchSize = 1000;
  let succeeded = 0;
  let failed = 0;

  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize);
    const actions = batch.map(chunkId => ({
      chunkId,
    }));

    const result = await client.deleteDocuments(actions);
    const batchSucceeded = result.results.filter(r => r.succeeded).length;
    const batchFailed = result.results.filter(r => !r.succeeded).length;
    succeeded += batchSucceeded;
    failed += batchFailed;

    console.log(`  Batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(ids.length / batchSize)}: ${GREEN}${batchSucceeded} deleted${RESET}${batchFailed > 0 ? `, ${RED}${batchFailed} failed${RESET}` : ''}`);
  }

  return { succeeded, failed };
}

async function main() {
  let globalSucceeded = 0;
  let globalFailed = 0;
  let totalFound = 0;

  for (const indexName of indexNames) {
    const client = new SearchClient<SearchDoc>(endpoint!, indexName, new AzureKeyCredential(key!));

    if (indexNames.length > 1) {
      console.log(`\n${BOLD}Index: ${indexName}${RESET}`);
    }

    const ids = await collectDocumentIds(client, indexName);
    totalFound += ids.length;

    if (ids.length === 0) {
      console.log(`${GREEN}✓${RESET} No documents found in "${indexName}" for this user.`);
      continue;
    }

    console.log(`\n${BOLD}Found ${ids.length} document(s) in "${indexName}"${RESET}`);

    if (!confirm) {
      console.log(`${YELLOW}⚠${RESET} DRY RUN — no changes made. Add ${BOLD}--confirm${RESET} to execute.`);
      continue;
    }

    console.log(`\nDeleting ${ids.length} documents from "${indexName}"...`);
    const { succeeded, failed } = await deleteDocuments(client, ids);
    globalSucceeded += succeeded;
    globalFailed += failed;

    console.log(`${BOLD}Result:${RESET} ${GREEN}${succeeded} deleted${RESET}, ${failed > 0 ? RED : DIM}${failed} failed${RESET}`);
  }

  if (totalFound === 0) {
    console.log(`\n${GREEN}✓${RESET} No documents found for this user. Already clean.`);
    process.exit(0);
  }

  if (!confirm) {
    console.log(`\n${YELLOW}⚠${RESET} DRY RUN — no changes made. Add ${BOLD}--confirm${RESET} to execute.`);
    process.exit(0);
  }

  if (indexNames.length > 1) {
    console.log(`\n${BOLD}Total:${RESET} ${GREEN}${globalSucceeded} deleted${RESET}, ${globalFailed > 0 ? RED : DIM}${globalFailed} failed${RESET}`);
  }

  if (globalFailed > 0) {
    process.exit(1);
  }
}

main().catch(e => {
  console.error(`${RED}✗${RESET} Fatal:`, e.message);
  process.exit(1);
});
