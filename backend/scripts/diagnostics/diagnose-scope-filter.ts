/**
 * diagnose-scope-filter.ts
 *
 * Diagnoses folder/site scope filter issues by verifying:
 *
 * 1. parentFolderId population in AI Search index (null detection)
 * 2. CTE folder expansion from the database (recursive subtree)
 * 3. OData filter construction and test query execution
 * 4. Cross-reference: DB folder tree vs indexed documents
 *
 * Usage:
 *   # Local environment (uses backend/.env)
 *   npx tsx scripts/diagnostics/diagnose-scope-filter.ts --userId <UUID>
 *
 *   # With specific folder
 *   npx tsx scripts/diagnostics/diagnose-scope-filter.ts --userId <UUID> --folderId <UUID>
 *
 *   # Against dev/prod (fetches secrets from Azure Key Vault)
 *   npx tsx scripts/diagnostics/diagnose-scope-filter.ts --userId <UUID> --env dev
 *   npx tsx scripts/diagnostics/diagnose-scope-filter.ts --userId <UUID> --env prod
 *
 *   # Show all indexed parentFolderIds (verbose)
 *   npx tsx scripts/diagnostics/diagnose-scope-filter.ts --userId <UUID> --verbose
 *
 * LOG_SERVICES filter for runtime debugging:
 *   LOG_SERVICES=MentionScopeResolver,FileContextPreparer,SemanticSearchHandler,RagTools,VectorSearchService,SemanticSearchService
 */

import 'dotenv/config';
import { createPrisma } from '../_shared/prisma';
import { createSearchClient, INDEX_NAME } from '../_shared/azure';
import { getFlag, hasFlag } from '../_shared/args';
import { getTargetEnv, resolveEnvironment } from '../_shared/env-resolver';

// ─── ANSI Colors ──────────────────────────────────────────────────────────────
const RED     = '\x1b[31m';
const GREEN   = '\x1b[32m';
const YELLOW  = '\x1b[33m';
const CYAN    = '\x1b[36m';
const MAGENTA = '\x1b[35m';
const BOLD    = '\x1b[1m';
const DIM     = '\x1b[2m';
const RESET   = '\x1b[0m';

function hr(char = '─', len = 80): string { return char.repeat(len); }

function ok(msg: string): void { console.log(`  ${GREEN}✓${RESET} ${msg}`); }
function warn(msg: string): void { console.log(`  ${YELLOW}⚠${RESET} ${msg}`); }
function fail(msg: string): void { console.log(`  ${RED}✗${RESET} ${msg}`); }
function info(msg: string): void { console.log(`  ${CYAN}ℹ${RESET} ${msg}`); }

// ─── Types ────────────────────────────────────────────────────────────────────

interface FolderRow {
  id: string;
  name: string;
  parent_folder_id: string | null;
  is_folder: boolean;
  deletion_status: string | null;
  source_type: string | null;
}

interface SearchDoc {
  chunkId: string;
  fileId: string;
  parentFolderId: string | null;
  siteId: string | null;
  isImage: boolean;
  fileName: string;
}

// ─── Section 1: AI Search Index — parentFolderId Population ───────────────────

async function checkIndexPopulation(
  userId: string,
  verbose: boolean
): Promise<{ total: number; withParent: number; withoutParent: number; parentIds: Set<string> }> {
  console.log(`\n${BOLD}1. AI Search Index — parentFolderId Population${RESET}`);
  console.log(hr());

  const searchClient = createSearchClient<SearchDoc>();
  if (!searchClient) {
    fail('AI Search client not available — check AZURE_SEARCH_ENDPOINT and AZURE_SEARCH_KEY');
    return { total: 0, withParent: 0, withoutParent: 0, parentIds: new Set() };
  }

  const normalizedUserId = userId.toUpperCase();
  const filter = `userId eq '${normalizedUserId}' and (fileStatus ne 'deleting' or fileStatus eq null)`;

  let total = 0;
  let withParent = 0;
  let withoutParent = 0;
  const parentIds = new Set<string>();
  const nullParentFileIds: string[] = [];

  try {
    const results = await searchClient.search('*', {
      filter,
      select: ['chunkId', 'fileId', 'parentFolderId', 'siteId', 'isImage', 'fileName'] as (keyof SearchDoc)[],
      top: 1000,
    });

    for await (const result of results.results) {
      const doc = result.document;
      total++;

      if (doc.parentFolderId) {
        withParent++;
        parentIds.add(doc.parentFolderId);
      } else {
        withoutParent++;
        if (nullParentFileIds.length < 10) {
          nullParentFileIds.push(`${doc.fileId} (${doc.fileName ?? 'unknown'})`);
        }
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    fail(`Search query failed: ${msg}`);
    return { total: 0, withParent: 0, withoutParent: 0, parentIds: new Set() };
  }

  info(`Index: ${CYAN}${INDEX_NAME}${RESET}`);
  info(`Total documents for user: ${BOLD}${total}${RESET}`);
  info(`With parentFolderId:      ${GREEN}${withParent}${RESET}`);
  info(`Without parentFolderId:   ${withoutParent === 0 ? GREEN : RED}${withoutParent}${RESET}`);
  info(`Unique parentFolderIds:   ${BOLD}${parentIds.size}${RESET}`);

  if (withoutParent > 0) {
    fail(`${RED}${withoutParent} documents have NULL parentFolderId — folder scope filter will NOT match these${RESET}`);
    console.log(`\n  Sample null-parent documents:`);
    for (const fid of nullParentFileIds) {
      console.log(`    ${DIM}→ ${fid}${RESET}`);
    }
    if (withoutParent > 10) {
      console.log(`    ${DIM}... and ${withoutParent - 10} more${RESET}`);
    }
  } else if (total > 0) {
    ok('All documents have parentFolderId populated — scope filters should work');
  }

  if (verbose && parentIds.size > 0) {
    console.log(`\n  All indexed parentFolderIds:`);
    for (const pid of [...parentIds].sort()) {
      console.log(`    ${DIM}${pid}${RESET}`);
    }
  }

  return { total, withParent, withoutParent, parentIds };
}

// ─── Section 2: Database — Folder Tree & CTE Expansion ──────────────────────

async function checkFolderExpansion(
  userId: string,
  folderId: string | null,
  verbose: boolean
): Promise<{ rootFolders: FolderRow[]; expandedIds: string[] }> {
  console.log(`\n${BOLD}2. Database — Folder Tree & CTE Expansion${RESET}`);
  console.log(hr());

  const prisma = createPrisma();
  try {
    // Get all root-level folders for the user
    const rootFolders = await prisma.$queryRaw<FolderRow[]>`
      SELECT id, name, parent_folder_id, is_folder, deletion_status, source_type
      FROM files
      WHERE user_id = ${userId.toUpperCase()}
        AND is_folder = 1
        AND parent_folder_id IS NULL
        AND deletion_status IS NULL
      ORDER BY name
    `;

    info(`Root-level folders: ${BOLD}${rootFolders.length}${RESET}`);
    for (const f of rootFolders) {
      console.log(`    ${DIM}${f.id}${RESET} ${f.name} ${DIM}(${f.source_type ?? 'local'})${RESET}`);
    }

    // If folderId given, expand it
    let expandedIds: string[] = [];
    if (folderId) {
      const targetId = folderId.toUpperCase();
      console.log(`\n  ${CYAN}Expanding folder:${RESET} ${targetId}`);

      try {
        const rows = await prisma.$queryRaw<Array<{ id: string; name: string | null; depth: number }>>`
          ;WITH folder_tree AS (
            SELECT id, name, 0 AS depth
            FROM files
            WHERE id = ${targetId}
              AND user_id = ${userId.toUpperCase()}
          UNION ALL
            SELECT f.id, f.name, ft.depth + 1
            FROM files f
            INNER JOIN folder_tree ft ON f.parent_folder_id = ft.id
            WHERE f.user_id = ${userId.toUpperCase()}
              AND f.is_folder = 1
              AND f.deletion_status IS NULL
          )
          SELECT id, name, depth FROM folder_tree
          ORDER BY depth, name
          OPTION (MAXRECURSION 20)
        `;

        expandedIds = rows.map(r => r.id);
        ok(`CTE expanded to ${GREEN}${expandedIds.length}${RESET} folder IDs (including root)`);

        for (const row of rows) {
          const indent = '  '.repeat(row.depth);
          console.log(`    ${indent}${DIM}${row.id}${RESET} ${row.name ?? '(unnamed)'} ${DIM}depth=${row.depth}${RESET}`);
        }

        // Count files within this subtree
        const fileCount = await prisma.$queryRaw<Array<{ cnt: number }>>`
          ;WITH folder_tree AS (
            SELECT id
            FROM files
            WHERE id = ${targetId}
              AND user_id = ${userId.toUpperCase()}
          UNION ALL
            SELECT f.id
            FROM files f
            INNER JOIN folder_tree ft ON f.parent_folder_id = ft.id
            WHERE f.user_id = ${userId.toUpperCase()}
              AND f.is_folder = 1
              AND f.deletion_status IS NULL
          )
          SELECT COUNT(*) AS cnt
          FROM files
          WHERE parent_folder_id IN (SELECT id FROM folder_tree)
            AND is_folder = 0
            AND deletion_status IS NULL
            AND user_id = ${userId.toUpperCase()}
          OPTION (MAXRECURSION 20)
        `;

        const count = Number(fileCount[0]?.cnt ?? 0);
        info(`Total files in subtree: ${BOLD}${count}${RESET}`);
        if (count === 0) {
          warn('No files found in this folder subtree — scope filter will return empty results');
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        fail(`CTE expansion failed: ${RED}${msg}${RESET}`);
        warn('Fallback would use only root folder ID — files in subfolders would NOT match');
      }
    } else {
      info('No --folderId specified. Use --folderId <UUID> to test CTE expansion for a specific folder.');
    }

    return { rootFolders, expandedIds };
  } finally {
    await prisma.$disconnect();
  }
}

// ─── Section 3: Cross-Reference — DB parentFolderIds vs Index ────────────────

async function crossReferenceDbVsIndex(
  userId: string,
  indexedParentIds: Set<string>
): Promise<void> {
  console.log(`\n${BOLD}3. Cross-Reference — DB Folder IDs vs Search Index${RESET}`);
  console.log(hr());

  const prisma = createPrisma();
  try {
    // Get all folder IDs from DB
    const dbFolders = await prisma.$queryRaw<Array<{ id: string; name: string }>>`
      SELECT id, name
      FROM files
      WHERE user_id = ${userId.toUpperCase()}
        AND is_folder = 1
        AND deletion_status IS NULL
      ORDER BY name
    `;

    const dbFolderIds = new Set(dbFolders.map(f => f.id));

    // parentFolderIds in index that don't exist as folders in DB
    const orphanedInIndex: string[] = [];
    for (const pid of indexedParentIds) {
      if (!dbFolderIds.has(pid)) {
        orphanedInIndex.push(pid);
      }
    }

    // DB folders that never appear as parentFolderId in index
    const neverReferenced: string[] = [];
    for (const f of dbFolders) {
      if (!indexedParentIds.has(f.id)) {
        neverReferenced.push(`${f.id} (${f.name})`);
      }
    }

    info(`DB folder count:        ${BOLD}${dbFolderIds.size}${RESET}`);
    info(`Indexed parentFolderIds: ${BOLD}${indexedParentIds.size}${RESET}`);

    if (orphanedInIndex.length > 0) {
      warn(`${orphanedInIndex.length} parentFolderIds in index don't match any DB folder:`);
      for (const pid of orphanedInIndex.slice(0, 5)) {
        console.log(`    ${DIM}→ ${pid}${RESET}`);
      }
    } else if (indexedParentIds.size > 0) {
      ok('All indexed parentFolderIds match existing DB folders');
    }

    if (neverReferenced.length > 0 && neverReferenced.length <= 20) {
      info(`${neverReferenced.length} DB folders have no indexed documents (may be empty):`);
      for (const entry of neverReferenced.slice(0, 10)) {
        console.log(`    ${DIM}→ ${entry}${RESET}`);
      }
    } else if (neverReferenced.length > 20) {
      info(`${neverReferenced.length} DB folders have no indexed documents (many are likely empty parent folders)`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

// ─── Section 4: Test OData Filter Query ──────────────────────────────────────

async function testScopeFilter(
  userId: string,
  expandedIds: string[]
): Promise<void> {
  console.log(`\n${BOLD}4. Test OData Scope Filter Query${RESET}`);
  console.log(hr());

  if (expandedIds.length === 0) {
    info('Skipping — no folder expanded. Use --folderId to test a specific folder.');
    return;
  }

  const searchClient = createSearchClient<SearchDoc>();
  if (!searchClient) {
    fail('AI Search client not available');
    return;
  }

  const normalizedUserId = userId.toUpperCase();
  const folderIdList = expandedIds.map(id => id.toUpperCase()).join(',');
  const scopeFilter = `search.in(parentFolderId, '${folderIdList}', ',')`;
  const fullFilter = `userId eq '${normalizedUserId}' and (fileStatus ne 'deleting' or fileStatus eq null) and ${scopeFilter}`;

  console.log(`  ${CYAN}OData filter:${RESET}`);
  console.log(`    ${DIM}${fullFilter}${RESET}\n`);

  try {
    const results = await searchClient.search('*', {
      filter: fullFilter,
      select: ['chunkId', 'fileId', 'parentFolderId', 'fileName', 'isImage'] as (keyof SearchDoc)[],
      top: 50,
    });

    let count = 0;
    const fileIds = new Set<string>();
    for await (const result of results.results) {
      count++;
      const doc = result.document;
      fileIds.add(doc.fileId);
      if (count <= 10) {
        console.log(`    ${DIM}${doc.chunkId}${RESET} file=${doc.fileId} parent=${doc.parentFolderId} ${doc.isImage ? '🖼' : '📄'} ${doc.fileName ?? ''}`);
      }
    }

    if (count === 0) {
      fail(`${RED}ZERO documents matched the scope filter — this confirms the bug${RESET}`);
      console.log(`\n  ${YELLOW}Possible causes:${RESET}`);
      console.log(`    1. parentFolderId is NULL in the index (check Section 1 above)`);
      console.log(`    2. The folder IDs from CTE don't match what's indexed`);
      console.log(`    3. Case sensitivity mismatch (DB vs index)`);
    } else {
      ok(`${GREEN}${count} documents${RESET} matched across ${GREEN}${fileIds.size} files${RESET}`);
      if (count > 10) {
        console.log(`    ${DIM}... showing first 10 of ${count}${RESET}`);
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    fail(`Filter query failed: ${RED}${msg}${RESET}`);
    console.log(`\n  This usually means the OData filter syntax is invalid.`);
    console.log(`  Check if parentFolderId field exists in the index schema.`);
  }
}

// ─── Section 5: siteId Population Check ──────────────────────────────────────

async function checkSiteIdPopulation(userId: string): Promise<void> {
  console.log(`\n${BOLD}5. AI Search Index — siteId Population (for site scope)${RESET}`);
  console.log(hr());

  const searchClient = createSearchClient<SearchDoc>();
  if (!searchClient) {
    fail('AI Search client not available');
    return;
  }

  const normalizedUserId = userId.toUpperCase();
  const filter = `userId eq '${normalizedUserId}' and (fileStatus ne 'deleting' or fileStatus eq null)`;

  let total = 0;
  let withSiteId = 0;
  const siteIds = new Set<string>();

  try {
    const results = await searchClient.search('*', {
      filter,
      select: ['chunkId', 'siteId'] as (keyof SearchDoc)[],
      top: 1000,
    });

    for await (const result of results.results) {
      total++;
      const doc = result.document;
      if (doc.siteId) {
        withSiteId++;
        siteIds.add(doc.siteId);
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    fail(`siteId check failed: ${msg}`);
    return;
  }

  info(`Documents with siteId: ${BOLD}${withSiteId}${RESET} / ${total}`);
  info(`Unique siteIds: ${BOLD}${siteIds.size}${RESET}`);

  if (siteIds.size > 0) {
    for (const sid of siteIds) {
      console.log(`    ${DIM}${sid}${RESET}`);
    }
  }

  if (withSiteId === 0 && total > 0) {
    warn('No documents have siteId — site scope filter will return empty results');
  } else if (withSiteId > 0 && withSiteId < total) {
    info(`${total - withSiteId} documents without siteId (likely local files — expected)`);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (hasFlag('--help') || hasFlag('-h')) {
    console.log(`
${BOLD}diagnose-scope-filter${RESET} — Verify folder/site scope filtering for RAG search

${CYAN}Usage:${RESET}
  npx tsx scripts/diagnostics/diagnose-scope-filter.ts --userId <UUID> [options]

${CYAN}Options:${RESET}
  --userId <UUID>     User ID to diagnose (required)
  --folderId <UUID>   Specific folder to test CTE expansion and filter query
  --env dev|prod      Run against remote environment (fetches Azure Key Vault secrets)
  --verbose           Show all indexed parentFolderIds
  --help              Show this help message

${CYAN}Sections:${RESET}
  1. AI Search Index — parentFolderId population (null detection)
  2. Database — folder tree CTE expansion
  3. Cross-reference — DB folder IDs vs indexed parentFolderIds
  4. Test OData scope filter query against AI Search
  5. siteId population check (for site scope)

${CYAN}Runtime log debugging:${RESET}
  Set LOG_SERVICES to trace scope filters through the live pipeline:
  ${DIM}LOG_SERVICES=MentionScopeResolver,FileContextPreparer,SemanticSearchHandler,RagTools,VectorSearchService,SemanticSearchService${RESET}
`);
    process.exit(0);
  }

  const targetEnv = getTargetEnv();
  if (targetEnv) await resolveEnvironment(targetEnv);

  const userId = getFlag('--userId') ?? getFlag('--user');
  const folderId = getFlag('--folderId') ?? getFlag('--folder');
  const verbose = hasFlag('--verbose') || hasFlag('-v');

  if (!userId) {
    console.error(`${RED}ERROR: --userId is required${RESET}`);
    process.exit(1);
  }

  console.log(`${BOLD}${MAGENTA}Scope Filter Diagnostic${RESET}`);
  console.log(`${DIM}User: ${userId.toUpperCase()}${RESET}`);
  if (folderId) console.log(`${DIM}Folder: ${folderId.toUpperCase()}${RESET}`);
  if (targetEnv) console.log(`${DIM}Environment: ${targetEnv}${RESET}`);
  console.log(`${DIM}Index: ${INDEX_NAME}${RESET}`);

  // Run all sections
  const indexResult = await checkIndexPopulation(userId, verbose);
  const dbResult = await checkFolderExpansion(userId, folderId, verbose);
  await crossReferenceDbVsIndex(userId, indexResult.parentIds);
  await testScopeFilter(userId, dbResult.expandedIds);
  await checkSiteIdPopulation(userId);

  // Summary
  console.log(`\n${BOLD}Summary${RESET}`);
  console.log(hr('═'));

  const issues: string[] = [];

  if (indexResult.withoutParent > 0) {
    issues.push(`${indexResult.withoutParent} documents have NULL parentFolderId — folder scope is BROKEN for these`);
  }
  if (indexResult.total === 0) {
    issues.push('No documents found in AI Search index for this user');
  }

  if (issues.length === 0) {
    console.log(`  ${GREEN}${BOLD}No critical issues detected.${RESET}`);
    console.log(`  If folder scope still doesn't work, check runtime logs with:`);
    console.log(`  ${DIM}LOG_SERVICES=MentionScopeResolver,FileContextPreparer,SemanticSearchHandler,RagTools,VectorSearchService,SemanticSearchService${RESET}`);
  } else {
    console.log(`  ${RED}${BOLD}${issues.length} issue(s) found:${RESET}`);
    for (const issue of issues) {
      console.log(`  ${RED}✗${RESET} ${issue}`);
    }
    console.log(`\n  ${YELLOW}Recommended fix:${RESET}`);
    console.log(`    If parentFolderId is NULL, re-index affected files:`);
    console.log(`    ${DIM}npx tsx scripts/operations/reprocess-files-for-v2.ts --user-id ${userId} --dry-run${RESET}`);
  }

  console.log();
}

main().catch((err) => {
  console.error(`${RED}Fatal: ${err instanceof Error ? err.message : String(err)}${RESET}`);
  process.exit(1);
});
