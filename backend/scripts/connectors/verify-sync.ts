#!/usr/bin/env npx tsx
/**
 * verify-sync.ts - Cross-System Sync Verification (PRD-116)
 *
 * Verifies that SharePoint/OneDrive files are correctly synced through
 * the full pipeline: DB → Blob → AI Search.
 *
 * Sections:
 * - sql:      Connection overview, scope summary, file pipeline status
 * - blob:     Blob existence check for synced files
 * - search:   AI Search document count verification
 * - pipeline: Visual pipeline funnel, stuck file detection
 *
 * Usage:
 *   npx tsx scripts/connectors/verify-sync.ts --userId <ID>
 *   npx tsx scripts/connectors/verify-sync.ts --userId <ID> --health
 *   npx tsx scripts/connectors/verify-sync.ts --userId <ID> --scope <ID>
 *   npx tsx scripts/connectors/verify-sync.ts --userId <ID> --section sql
 *   npx tsx scripts/connectors/verify-sync.ts --userId <ID> --section blob
 *   npx tsx scripts/connectors/verify-sync.ts --userId <ID> --section search
 *   npx tsx scripts/connectors/verify-sync.ts --userId <ID> --section pipeline
 *   npx tsx scripts/connectors/verify-sync.ts --help
 */

import 'dotenv/config';
import { createPrisma } from '../_shared/prisma';
import { createSearchClient } from '../_shared/azure';
import { getFlag, hasFlag } from '../_shared/args';

// ============================================================================
// Help
// ============================================================================

function printHelp(): void {
  console.log(`
${BOLD}verify-sync.ts${RESET} — Cross-system sync verification (DB → Blob → AI Search)

${BOLD}Usage:${RESET}
  npx tsx scripts/connectors/verify-sync.ts --userId <ID>
  npx tsx scripts/connectors/verify-sync.ts --userId <ID> --health
  npx tsx scripts/connectors/verify-sync.ts --userId <ID> --scope <ID>
  npx tsx scripts/connectors/verify-sync.ts --userId <ID> --section <name>

${BOLD}Flags:${RESET}
  --userId <ID>             Required. User to inspect.
  --scope <ID>              Limit to a single connection scope.
  --section sql|blob|search|pipeline
                            Run only one section (default: all).
  --health                  Compact summary (~20 lines). Overrides --section.
  --deep                    Enhanced cross-system checks (integrity, vectors, error patterns).
  --errors                  Focus output on problems — skip healthy items.
  --help, -h                Show this help message.

${BOLD}Sections:${RESET}
  sql       Connection overview, scope status, file counts, orphan detection.
            With --deep: token health, scope coverage gaps, deletion consistency.
  blob      Blob path presence check for synced files (lightweight mode).
  search    AI Search chunk count per ready file in DB.
            With --deep: false positive detection, stale search data, vector sampling.
  pipeline  Visual funnel, stuck file detection, failure details.
            With --deep: error pattern analysis, retry count analysis.

${BOLD}Recommended workflow:${RESET}
  1. Quick:  npx tsx scripts/connectors/verify-sync.ts --userId <ID> --health
  2. Full:   npx tsx scripts/connectors/verify-sync.ts --userId <ID>
  3. Deep:   npx tsx scripts/connectors/verify-sync.ts --userId <ID> --deep
  4. Errors: npx tsx scripts/connectors/verify-sync.ts --userId <ID> --deep --errors
`);
}

// ============================================================================
// ANSI color helpers
// ============================================================================

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const CYAN = '\x1b[36m';

function header(title: string): void {
  console.log(`\n${BOLD}${CYAN}${'═'.repeat(60)}${RESET}`);
  console.log(`${BOLD}${CYAN}  ${title}${RESET}`);
  console.log(`${BOLD}${CYAN}${'═'.repeat(60)}${RESET}\n`);
}

function subheader(title: string): void {
  console.log(`\n${BOLD}  ${title}${RESET}`);
  console.log(`  ${DIM}${'─'.repeat(50)}${RESET}`);
}

function ok(msg: string): void { if (!errorsOnly) console.log(`  ${GREEN}✓${RESET} ${msg}`); }
function warn(msg: string): void { console.log(`  ${YELLOW}⚠${RESET} ${msg}`); }
function fail(msg: string): void { console.log(`  ${RED}✗${RESET} ${msg}`); }
function info(msg: string): void { console.log(`  ${BLUE}ℹ${RESET} ${msg}`); }

// ============================================================================
// Deep mode & error focus flags (module-level for all section functions)
// ============================================================================

const deepMode = hasFlag('--deep');
const errorsOnly = hasFlag('--errors');

// ============================================================================
// Relative time helper
// ============================================================================

function relativeTime(date: Date | null): string {
  if (!date) return 'never';
  const elapsed = Date.now() - new Date(date).getTime();
  if (elapsed < 60_000) return `${Math.round(elapsed / 1000)}s ago`;
  if (elapsed < 3_600_000) return `${Math.round(elapsed / 60_000)}m ago`;
  if (elapsed < 86_400_000) return `${Math.round(elapsed / 3_600_000)}h ago`;
  return `${Math.round(elapsed / 86_400_000)}d ago`;
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  if (hasFlag('--help') || hasFlag('-h')) {
    printHelp();
    process.exit(0);
  }

  const userId = getFlag('--userId')?.toUpperCase() ?? null;
  const scopeFilter = getFlag('--scope')?.toUpperCase() ?? null;
  const sectionFilter = getFlag('--section') ?? null;
  const healthMode = hasFlag('--health');

  if (!userId) {
    console.error(
      `${RED}ERROR: --userId is required.${RESET}\n` +
      `Run with --help for usage.`
    );
    process.exit(1);
  }

  if (sectionFilter && !['sql', 'blob', 'search', 'pipeline'].includes(sectionFilter)) {
    console.error(`${RED}ERROR: --section must be one of: sql, blob, search, pipeline${RESET}`);
    process.exit(1);
  }

  const prisma = createPrisma();

  try {
    if (healthMode) {
      await runHealthCheck(prisma, userId);
      return;
    }

    const runSection = (name: string): boolean => !sectionFilter || sectionFilter === name;

    if (runSection('sql')) await verifySQLSection(prisma, userId, scopeFilter);
    if (runSection('blob')) await verifyBlobSection(prisma, userId, scopeFilter);
    if (runSection('search')) await verifySearchSection(prisma, userId, scopeFilter);
    if (runSection('pipeline')) await verifyPipelineSection(prisma, userId, scopeFilter);
  } finally {
    await prisma.$disconnect();
  }
}

// ============================================================================
// Health Check (compact summary)
// ============================================================================

async function runHealthCheck(prisma: ReturnType<typeof createPrisma>, userId: string): Promise<void> {
  header('Sync Health Check');

  // Connections
  const connections = await prisma.connections.findMany({
    where: { user_id: userId },
    select: { id: true, provider: true, status: true },
  });

  info(`Connections: ${connections.length}`);
  for (const conn of connections) {
    const statusColor = conn.status === 'connected' ? GREEN : conn.status === 'expired' ? YELLOW : RED;
    console.log(`    ${conn.provider.padEnd(12)} ${statusColor}${conn.status}${RESET}  ${conn.id}`);
  }

  if (connections.length === 0) {
    warn('No connections found for this user');
    return;
  }

  // Scopes (via connection IDs)
  const connectionIds = connections.map((c) => c.id);
  const scopes = await prisma.connection_scopes.findMany({
    where: { connection_id: { in: connectionIds } },
    select: { id: true, sync_status: true, scope_display_name: true, item_count: true },
  });

  subheader(`Scopes: ${scopes.length}`);
  const statusCounts: Record<string, number> = {};
  for (const scope of scopes) {
    statusCounts[scope.sync_status] = (statusCounts[scope.sync_status] || 0) + 1;
  }
  for (const [status, count] of Object.entries(statusCounts)) {
    const statusColor =
      status === 'synced' ? GREEN :
      status === 'syncing' || status === 'sync_queued' ? YELLOW :
      status === 'error' ? RED : DIM;
    console.log(`    ${statusColor}${status.padEnd(14)}${RESET} ${count}`);
  }

  // Files pipeline
  const files = await prisma.files.findMany({
    where: {
      user_id: userId,
      source_type: { in: ['onedrive', 'sharepoint'] },
      deletion_status: null,
      is_folder: false,
    },
    select: { pipeline_status: true },
  });

  subheader(`Files: ${files.length}`);
  const pipelineCounts: Record<string, number> = {};
  for (const file of files) {
    const status = file.pipeline_status ?? 'unknown';
    pipelineCounts[status] = (pipelineCounts[status] || 0) + 1;
  }
  const total = files.length || 1;
  for (const [status, count] of Object.entries(pipelineCounts).sort()) {
    const pctStr = ((count / total) * 100).toFixed(0);
    const color = status === 'ready' ? GREEN : status === 'failed' ? RED : YELLOW;
    console.log(`    ${color}${status.padEnd(16)}${RESET} ${String(count).padStart(5)}  (${pctStr}%)`);
  }

  // Quick health assessment
  subheader('Assessment');
  const stuckScopes = scopes.filter((s) => s.sync_status === 'syncing');
  const errorScopes = scopes.filter((s) => s.sync_status === 'error');
  const failedFiles = files.filter((f) => f.pipeline_status === 'failed');

  if (stuckScopes.length === 0 && errorScopes.length === 0 && failedFiles.length === 0) {
    ok('All systems healthy');
  } else {
    if (stuckScopes.length > 0) warn(`${stuckScopes.length} scope(s) stuck in syncing state`);
    if (errorScopes.length > 0) fail(`${errorScopes.length} scope(s) in error state`);
    if (failedFiles.length > 0) fail(`${failedFiles.length} file(s) in failed pipeline status`);
  }
}

// ============================================================================
// SQL Section
// ============================================================================

async function verifySQLSection(
  prisma: ReturnType<typeof createPrisma>,
  userId: string,
  scopeFilter: string | null,
): Promise<void> {
  header('SQL Verification');

  // Connection overview
  const connections = await prisma.connections.findMany({
    where: { user_id: userId },
    select: {
      id: true,
      provider: true,
      status: true,
      display_name: true,
      token_expires_at: true,
      created_at: true,
      updated_at: true,
    },
  });

  subheader('Connections');
  if (connections.length === 0) {
    warn('No connections found for this user');
    return;
  }

  for (const conn of connections) {
    const statusColor = conn.status === 'connected' ? GREEN : conn.status === 'expired' ? YELLOW : RED;
    const tokenExpiry = conn.token_expires_at
      ? `expires ${relativeTime(conn.token_expires_at)} (${new Date(conn.token_expires_at).toISOString()})`
      : 'no token';
    console.log(`  ${BOLD}${conn.display_name ?? conn.provider}${RESET}`);
    console.log(`    ID:       ${conn.id}`);
    console.log(`    Provider: ${conn.provider}`);
    console.log(`    Status:   ${statusColor}${conn.status}${RESET}`);
    console.log(`    Token:    ${tokenExpiry}`);
    console.log();
  }

  // Connection token health (deep mode)
  if (deepMode) {
    subheader('Connection Token Health');
    for (const conn of connections) {
      if (conn.token_expires_at) {
        const ttl = new Date(conn.token_expires_at).getTime() - Date.now();
        if (ttl < 0) {
          fail(`${conn.display_name ?? conn.provider}: Token EXPIRED (${relativeTime(conn.token_expires_at)})`);
        } else if (ttl < 24 * 60 * 60 * 1000) {
          warn(`${conn.display_name ?? conn.provider}: Token expires soon (${relativeTime(conn.token_expires_at)})`);
        } else {
          ok(`${conn.display_name ?? conn.provider}: Token valid (expires ${relativeTime(conn.token_expires_at)})`);
        }
      } else {
        warn(`${conn.display_name ?? conn.provider}: No token expiry recorded`);
      }
    }
  }

  // Scope summary
  const connectionIds = connections.map((c) => c.id);
  const scopeWhere: Record<string, unknown> = scopeFilter
    ? { id: scopeFilter, connection_id: { in: connectionIds } }
    : { connection_id: { in: connectionIds } };

  const scopes = await prisma.connection_scopes.findMany({
    where: scopeWhere,
    select: {
      id: true,
      connection_id: true,
      scope_type: true,
      scope_display_name: true,
      sync_status: true,
      item_count: true,
      last_sync_at: true,
      last_sync_error: true,
      scope_mode: true,
      updated_at: true,
    },
    orderBy: { created_at: 'asc' },
  });

  subheader(`Scopes (${scopes.length})`);
  for (const scope of scopes) {
    const statusColor =
      scope.sync_status === 'synced' ? GREEN :
      scope.sync_status === 'syncing' || scope.sync_status === 'sync_queued' ? YELLOW :
      scope.sync_status === 'error' ? RED : DIM;

    console.log(`  ${BOLD}${scope.scope_display_name ?? scope.scope_type}${RESET} (${scope.scope_mode ?? 'include'})`);
    console.log(`    ID:       ${scope.id}`);
    console.log(`    Status:   ${statusColor}${scope.sync_status}${RESET}`);
    console.log(`    Items:    ${scope.item_count}`);
    if (scope.last_sync_at) {
      console.log(`    Last sync: ${relativeTime(scope.last_sync_at)} (${new Date(scope.last_sync_at).toISOString()})`);
    }
    if (scope.last_sync_error) {
      fail(`    Error: ${scope.last_sync_error}`);
    }

    // Stuck detection: syncing for > 10 minutes
    if (scope.sync_status === 'syncing' && scope.updated_at) {
      const elapsed = Date.now() - new Date(scope.updated_at).getTime();
      if (elapsed > 10 * 60 * 1000) {
        warn(`    Scope stuck in syncing for ${Math.round(elapsed / 60000)} minutes`);
      }
    }

    // File counts per scope
    const fileCount = await prisma.files.count({
      where: { connection_scope_id: scope.id, deletion_status: null },
    });
    const mismatch = fileCount !== scope.item_count && scope.item_count > 0;
    console.log(
      `    Files (DB): ${fileCount}` +
      (mismatch ? ` ${YELLOW}(mismatch with item_count=${scope.item_count})${RESET}` : '')
    );

    // Pipeline status distribution
    const files = await prisma.files.findMany({
      where: { connection_scope_id: scope.id, deletion_status: null, is_folder: false },
      select: { pipeline_status: true },
    });
    if (files.length > 0) {
      const distribution: Record<string, number> = {};
      for (const f of files) {
        const ps = f.pipeline_status ?? 'unknown';
        distribution[ps] = (distribution[ps] || 0) + 1;
      }
      console.log(`    Pipeline:  ${Object.entries(distribution).map(([s, n]) => `${s}=${n}`).join(', ')}`);
    }

    // Scope coverage analysis (deep mode) — detect false negatives
    if (deepMode && scope.item_count > 0 && fileCount < scope.item_count) {
      const missing = scope.item_count - fileCount;
      warn(`    Coverage gap: ${missing} item(s) declared in scope but absent from DB (potential false negatives)`);
    }
    console.log();
  }

  // Orphan detection — external files missing a scope assignment
  subheader('Orphan Detection');
  const orphanFiles = await prisma.files.count({
    where: {
      user_id: userId,
      source_type: { in: ['onedrive', 'sharepoint'] },
      connection_scope_id: null,
      deletion_status: null,
    },
  });
  if (orphanFiles > 0) {
    warn(`${orphanFiles} external file(s) without a scope assignment (connection_scope_id IS NULL)`);
  } else {
    ok('No orphan files detected');
  }

  // Deletion state consistency check (deep mode)
  if (deepMode) {
    subheader('Deletion Consistency');
    const inconsistentDeletions = await prisma.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(*) as count FROM files
      WHERE user_id = ${userId}
        AND ((deleted_at IS NOT NULL AND deletion_status IS NULL)
          OR (deleted_at IS NULL AND deletion_status IS NOT NULL))
    `;
    const inconsistentCount = Number(inconsistentDeletions[0]?.count ?? 0);
    if (inconsistentCount > 0) {
      fail(`${inconsistentCount} file(s) with inconsistent deletion state (deleted_at vs deletion_status mismatch)`);
    } else {
      ok('All files have consistent deletion state');
    }
  }
}

// ============================================================================
// Blob Section
// ============================================================================

async function verifyBlobSection(
  prisma: ReturnType<typeof createPrisma>,
  userId: string,
  scopeFilter: string | null,
): Promise<void> {
  header('Blob Verification');

  const files = await prisma.files.findMany({
    where: {
      user_id: userId,
      source_type: { in: ['onedrive', 'sharepoint'] },
      deletion_status: null,
      is_folder: false,
      ...(scopeFilter ? { connection_scope_id: scopeFilter } : {}),
    },
    select: {
      id: true,
      name: true,
      blob_path: true,
      pipeline_status: true,
    },
  });

  info(`Checking ${files.length} external file(s)`);

  // Stages where blob_path should already exist
  const pastRegistered = ['extracting', 'extracted', 'chunking', 'chunked', 'embedding', 'ready', 'failed'];

  let nullBlobPath = 0;
  for (const file of files) {
    if (!file.blob_path && pastRegistered.includes(file.pipeline_status ?? '')) {
      nullBlobPath++;
      if (nullBlobPath <= 5) {
        warn(`No blob_path for file "${file.name}" (${file.id}) with status=${file.pipeline_status}`);
      }
    }
  }

  if (nullBlobPath > 5) {
    warn(`... and ${nullBlobPath - 5} more file(s) with missing blob_path`);
  }

  // Summarize blob_path presence
  const withBlobPath = files.filter((f) => Boolean(f.blob_path)).length;
  const withoutBlobPath = files.length - withBlobPath;

  subheader('Summary');
  info(`Files with blob_path:    ${withBlobPath}`);
  info(`Files without blob_path: ${withoutBlobPath}`);

  if (nullBlobPath === 0) {
    ok('All files that should have blob paths do have them');
  } else {
    fail(`${nullBlobPath} file(s) missing blob_path despite being past the registration stage`);
  }

  info('Note: Actual blob existence check requires Azure Storage SDK (not included in lightweight mode)');
  info('      Use scripts/storage/verify-storage.ts --section blob for full blob verification');
}

// ============================================================================
// Search Section
// ============================================================================

async function verifySearchSection(
  prisma: ReturnType<typeof createPrisma>,
  userId: string,
  scopeFilter: string | null,
): Promise<void> {
  header('AI Search Verification');

  const readyFiles = await prisma.files.findMany({
    where: {
      user_id: userId,
      source_type: { in: ['onedrive', 'sharepoint'] },
      deletion_status: null,
      is_folder: false,
      pipeline_status: 'ready',
      ...(scopeFilter ? { connection_scope_id: scopeFilter } : {}),
    },
    select: {
      id: true,
      name: true,
      connection_scope_id: true,
    },
  });

  info(`${readyFiles.length} file(s) with pipeline_status='ready'`);

  if (readyFiles.length === 0) {
    warn('No ready files to check');
    return;
  }

  // Check chunk counts in DB
  let totalChunks = 0;
  let filesWithoutChunks = 0;

  for (const file of readyFiles) {
    const chunkCount = await prisma.file_chunks.count({
      where: { file_id: file.id },
    });
    totalChunks += chunkCount;
    if (chunkCount === 0) {
      filesWithoutChunks++;
      if (filesWithoutChunks <= 3) {
        warn(`File "${file.name}" (${file.id}) is 'ready' but has 0 chunks in DB`);
      }
    }
  }

  if (filesWithoutChunks > 3) {
    warn(`... and ${filesWithoutChunks - 3} more file(s) without chunks`);
  }

  subheader('Summary');
  info(`Total ready files:  ${readyFiles.length}`);
  info(`Total DB chunks:    ${totalChunks}`);
  info(`Avg chunks/file:    ${readyFiles.length > 0 ? (totalChunks / readyFiles.length).toFixed(1) : 'n/a'}`);

  if (filesWithoutChunks > 0) {
    fail(`${filesWithoutChunks} file(s) marked ready with 0 chunks in DB`);
  } else {
    ok('All ready files have chunks in DB');
  }

  // Per-scope coverage (only when not filtered to a single scope)
  if (!scopeFilter) {
    const scopeIds = [...new Set(readyFiles.map((f) => f.connection_scope_id).filter((id): id is string => Boolean(id)))];
    if (scopeIds.length > 1) {
      subheader('Per-Scope Coverage');
      for (const sid of scopeIds) {
        const scopeReadyCount = readyFiles.filter((f) => f.connection_scope_id === sid).length;
        const totalInScope = await prisma.files.count({
          where: { connection_scope_id: sid, deletion_status: null, is_folder: false },
        });
        const pct = totalInScope > 0 ? Math.round((scopeReadyCount / totalInScope) * 100) : 0;
        const color = pct === 100 ? GREEN : pct >= 80 ? YELLOW : RED;
        console.log(`    ${DIM}${sid}${RESET}  ${color}${pct}%${RESET} (${scopeReadyCount}/${totalInScope} ready)`);
      }
    }
  }

  // AI Search metadata field sampling
  const searchClient = createSearchClient<{
    chunkId: string;
    fileId: string;
    siteId?: string;
    sourceType?: string;
    parentFolderId?: string;
  }>();

  if (searchClient) {
    subheader('AI Search Metadata Fields');

    try {
      const searchResults = await searchClient.search('*', {
        filter: `userId eq '${userId}'`,
        select: ['chunkId', 'fileId', 'siteId', 'sourceType', 'parentFolderId'] as string[],
        top: 5,
      } as Record<string, unknown>);

      const sampleDocs: Array<{
        chunkId: string;
        fileId: string;
        siteId?: string;
        sourceType?: string;
        parentFolderId?: string;
      }> = [];
      for await (const result of searchResults.results) {
        if (result.document) sampleDocs.push(result.document);
      }

      if (sampleDocs.length === 0) {
        warn('No documents found in AI Search for this user');
      } else {
        const withSiteId = sampleDocs.filter((d) => d.siteId !== undefined && d.siteId !== null).length;
        const withSourceType = sampleDocs.filter((d) => d.sourceType !== undefined && d.sourceType !== null).length;
        const withParentFolderId = sampleDocs.filter((d) => d.parentFolderId !== undefined && d.parentFolderId !== null).length;

        const total = sampleDocs.length;
        const fieldStatus = (populated: number, label: string): void => {
          const color = populated === total ? GREEN : populated === 0 ? RED : YELLOW;
          const icon = populated === total ? '✓' : populated === 0 ? '✗' : '⚠';
          console.log(`  ${color}${icon}${RESET} ${label}: ${populated}/${total} sampled docs`);
        };

        fieldStatus(withSiteId, 'siteId');
        fieldStatus(withSourceType, 'sourceType');
        fieldStatus(withParentFolderId, 'parentFolderId');

        // Show first 3 docs for visual confirmation
        const preview = sampleDocs.slice(0, 3);
        console.log(`\n  ${DIM}Sample documents:${RESET}`);
        for (const doc of preview) {
          console.log(`    ${DIM}chunk:${RESET} ${doc.chunkId.substring(0, 30)}...`);
          console.log(`      siteId:         ${doc.siteId ?? '(null)'}`);
          console.log(`      sourceType:     ${doc.sourceType ?? '(null)'}`);
          console.log(`      parentFolderId: ${doc.parentFolderId ?? '(null)'}`);
        }
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      fail(`Failed to query AI Search: ${errorMsg}`);
    }

    // ── Deep mode: Cross-system integrity checks ──────────────────────
    if (deepMode) {
      // 1. False positive detection: ready files with 0 search documents
      subheader('False Positive Detection');
      info('Cross-checking ready files against AI Search documents...');

      try {
        // Fetch all unique fileIds from search index for this user (paginated)
        const searchFileIds = new Set<string>();
        const PAGE_SIZE = 500;
        let skip = 0;

        while (true) {
          const pageResults = await searchClient.search('*', {
            filter: `userId eq '${userId}'`,
            select: ['fileId'] as string[],
            top: PAGE_SIZE,
            skip,
          } as Record<string, unknown>);

          let batchCount = 0;
          for await (const result of pageResults.results) {
            if (result.document) {
              searchFileIds.add((result.document as Record<string, string>).fileId?.toUpperCase());
              batchCount++;
            }
          }
          if (batchCount < PAGE_SIZE) break;
          skip += PAGE_SIZE;
        }

        info(`Found ${searchFileIds.size} unique file(s) in AI Search index`);

        // False positives: ready in DB but no docs in Search
        const falsePositives = readyFiles.filter(
          (f) => !searchFileIds.has(f.id.toUpperCase())
        );

        if (falsePositives.length > 0) {
          fail(`${falsePositives.length} file(s) marked 'ready' but have 0 documents in AI Search ${BOLD}(FALSE POSITIVES)${RESET}`);
          for (const fp of falsePositives.slice(0, 10)) {
            console.log(`    ${RED}✗${RESET} "${fp.name}" — ${DIM}${fp.id}${RESET}`);
          }
          if (falsePositives.length > 10) {
            console.log(`    ${DIM}... and ${falsePositives.length - 10} more${RESET}`);
          }
          info('These files need re-processing. Reset their pipeline_status to "queued".');
        } else {
          ok(`All ${readyFiles.length} ready files have corresponding documents in AI Search`);
        }

        // 2. Stale search data: non-ready files that still have search docs
        const allNonReadyFiles = await prisma.files.findMany({
          where: {
            user_id: userId,
            source_type: { in: ['onedrive', 'sharepoint'] },
            deletion_status: null,
            is_folder: false,
            pipeline_status: { not: 'ready' },
            ...(scopeFilter ? { connection_scope_id: scopeFilter } : {}),
          },
          select: { id: true, name: true, pipeline_status: true },
        });

        const staleSearchFiles = allNonReadyFiles.filter(
          (f) => searchFileIds.has(f.id.toUpperCase())
        );

        if (staleSearchFiles.length > 0) {
          warn(`${staleSearchFiles.length} file(s) NOT ready but still have documents in AI Search ${BOLD}(STALE DATA)${RESET}`);
          for (const sf of staleSearchFiles.slice(0, 5)) {
            console.log(`    ${YELLOW}⚠${RESET} "${sf.name}" [${sf.pipeline_status}] — ${DIM}${sf.id}${RESET}`);
          }
          if (staleSearchFiles.length > 5) {
            console.log(`    ${DIM}... and ${staleSearchFiles.length - 5} more${RESET}`);
          }
        } else {
          ok('No stale search documents detected');
        }

        // 3. Vector presence sampling
        subheader('Vector Presence Sampling');
        const sampleSize = Math.min(readyFiles.length, 20);
        if (sampleSize === 0) {
          warn('No ready files to sample for vector presence');
        } else {
          info(`Sampling ${sampleSize} file(s) for vector completeness...`);
          let withVector = 0;
          let withoutVector = 0;
          const missingVectorFiles: string[] = [];

          for (const file of readyFiles.slice(0, sampleSize)) {
            const chunk = await prisma.file_chunks.findFirst({
              where: { file_id: file.id },
              select: { search_document_id: true },
            });

            if (!chunk?.search_document_id) continue;

            try {
              const fullDoc = await searchClient.getDocument(chunk.search_document_id) as Record<string, unknown>;
              const hasVector = Boolean(
                (Array.isArray(fullDoc.contentVector) && fullDoc.contentVector.length > 0) ||
                (Array.isArray(fullDoc.embeddingVector) && fullDoc.embeddingVector.length > 0)
              );
              if (hasVector) withVector++;
              else {
                withoutVector++;
                if (missingVectorFiles.length < 5) missingVectorFiles.push(file.name);
              }
            } catch {
              withoutVector++;
              if (missingVectorFiles.length < 5) missingVectorFiles.push(file.name);
            }
          }

          const total = withVector + withoutVector;
          if (total === 0) {
            warn('No documents could be sampled (no chunks with search_document_id)');
          } else if (withoutVector > 0) {
            fail(`${withoutVector}/${total} sampled documents MISSING vectors`);
            for (const name of missingVectorFiles) {
              console.log(`    ${RED}✗${RESET} ${name}`);
            }
          } else {
            ok(`All ${total} sampled documents have vectors`);
          }
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        warn(`Deep integrity checks failed: ${errorMsg}`);
      }
    }
  } else {
    info('AI Search not configured — skipping metadata field check');
  }
}

// ============================================================================
// Pipeline Section
// ============================================================================

async function verifyPipelineSection(
  prisma: ReturnType<typeof createPrisma>,
  userId: string,
  scopeFilter: string | null,
): Promise<void> {
  header('Pipeline Verification');

  const files = await prisma.files.findMany({
    where: {
      user_id: userId,
      source_type: { in: ['onedrive', 'sharepoint'] },
      deletion_status: null,
      is_folder: false,
      ...(scopeFilter ? { connection_scope_id: scopeFilter } : {}),
    },
    select: {
      id: true,
      name: true,
      pipeline_status: true,
      updated_at: true,
      last_processing_error: true,
    },
  });

  if (files.length === 0) {
    warn('No external files found');
    return;
  }

  // Pipeline funnel
  const stages = ['queued', 'extracting', 'extracted', 'chunking', 'chunked', 'embedding', 'ready', 'failed'];
  const counts: Record<string, number> = {};
  for (const f of files) {
    const s = f.pipeline_status ?? 'unknown';
    counts[s] = (counts[s] || 0) + 1;
  }

  subheader('Pipeline Funnel');
  const maxCount = Math.max(...Object.values(counts), 1);
  const barWidth = 30;

  for (const stage of stages) {
    const count = counts[stage] || 0;
    if (count === 0 && stage !== 'ready' && stage !== 'failed') continue;
    const bar = '█'.repeat(Math.max(1, Math.round((count / maxCount) * barWidth)));
    const pct = ((count / files.length) * 100).toFixed(0);
    const color = stage === 'ready' ? GREEN : stage === 'failed' ? RED : YELLOW;
    console.log(`  ${stage.padEnd(12)} ${color}${bar.padEnd(barWidth)}${RESET}  ${String(count).padStart(5)} (${pct.padStart(3)}%)`);
  }

  // Other/unknown statuses not in the standard stages list
  for (const [status, count] of Object.entries(counts)) {
    if (!stages.includes(status)) {
      const pct = ((count / files.length) * 100).toFixed(0);
      console.log(`  ${status.padEnd(12)} ${DIM}${'░'.repeat(barWidth)}${RESET}  ${String(count).padStart(5)} (${pct.padStart(3)}%)`);
    }
  }

  // Stuck file detection (non-terminal status > 30 min without update)
  const stuckThreshold = 30 * 60 * 1000;
  const nonTerminal = ['queued', 'extracting', 'extracted', 'chunking', 'chunked', 'embedding'];
  const stuckFiles = files.filter((f) =>
    nonTerminal.includes(f.pipeline_status ?? '') &&
    f.updated_at &&
    Date.now() - new Date(f.updated_at).getTime() > stuckThreshold
  );

  if (stuckFiles.length > 0) {
    subheader(`Stuck Files (${stuckFiles.length})`);
    for (const f of stuckFiles.slice(0, 10)) {
      const elapsed = Math.round((Date.now() - new Date(f.updated_at!).getTime()) / 60000);
      warn(`"${f.name}" — stuck in ${f.pipeline_status} for ${elapsed}min`);
      console.log(`    ${DIM}${f.id}${RESET}`);
    }
    if (stuckFiles.length > 10) {
      warn(`... and ${stuckFiles.length - 10} more stuck file(s)`);
    }
  }

  // Failed files detail
  const failedFiles = files.filter((f) => f.pipeline_status === 'failed');
  if (failedFiles.length > 0) {
    subheader(`Failed Files (${failedFiles.length})`);
    for (const f of failedFiles.slice(0, 10)) {
      fail(`"${f.name}" — ${f.last_processing_error ?? 'no error message'}`);
      console.log(`    ${DIM}${f.id}${RESET}`);
    }
    if (failedFiles.length > 10) {
      fail(`... and ${failedFiles.length - 10} more failed file(s)`);
    }
  }

  // Recommendations
  subheader('Recommendations');
  if (stuckFiles.length > 0) {
    info(`Run: npx tsx scripts/connectors/fix-stuck-scopes.ts --userId ${userId} --dry-run`);
  }
  if (failedFiles.length > 0) {
    info('Review failed files and consider re-triggering sync for affected scopes');
  }
  if (stuckFiles.length === 0 && failedFiles.length === 0) {
    ok('Pipeline is healthy — no stuck or failed files');
  }

  // ── Deep mode: Error pattern analysis + retry analysis ──────────
  if (deepMode) {
    // Error pattern analysis
    if (failedFiles.length > 0) {
      subheader('Error Pattern Analysis');
      const errorPatterns: Record<string, number> = {};
      for (const f of failedFiles) {
        const errorMsg = f.last_processing_error ?? '(no error message)';
        // Normalize: strip UUIDs and URLs for grouping
        const normalized = errorMsg
          .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<UUID>')
          .replace(/https?:\/\/\S+/g, '<URL>')
          .substring(0, 120);
        errorPatterns[normalized] = (errorPatterns[normalized] || 0) + 1;
      }

      const sorted = Object.entries(errorPatterns).sort(([, a], [, b]) => b - a);
      for (const [pattern, count] of sorted.slice(0, 5)) {
        console.log(`    ${RED}${String(count).padStart(4)}×${RESET} ${pattern}`);
      }
      if (sorted.length > 5) {
        info(`... and ${sorted.length - 5} more distinct error patterns`);
      }

      // Files without any error message
      const noErrorMsg = failedFiles.filter((f) => !f.last_processing_error);
      if (noErrorMsg.length > 0) {
        warn(`${noErrorMsg.length} failed file(s) have NO error message recorded — check processing logs`);
      }
    }

    // Retry count analysis
    const filesWithRetries = await prisma.files.findMany({
      where: {
        user_id: userId,
        source_type: { in: ['onedrive', 'sharepoint'] },
        deletion_status: null,
        is_folder: false,
        pipeline_retry_count: { gt: 0 },
        ...(scopeFilter ? { connection_scope_id: scopeFilter } : {}),
      },
      select: {
        id: true,
        name: true,
        pipeline_status: true,
        pipeline_retry_count: true,
      },
      orderBy: { pipeline_retry_count: 'desc' },
      take: 10,
    });

    if (filesWithRetries.length > 0) {
      subheader(`Retry Analysis (top ${filesWithRetries.length})`);
      for (const f of filesWithRetries) {
        const statusColor = f.pipeline_status === 'failed' ? RED : f.pipeline_status === 'ready' ? GREEN : YELLOW;
        console.log(`    ${String(f.pipeline_retry_count).padStart(2)} retries — ${statusColor}[${f.pipeline_status}]${RESET} "${f.name}"`);
      }

      const highRetry = filesWithRetries.filter((f) => f.pipeline_retry_count >= 3);
      if (highRetry.length > 0) {
        warn(`${highRetry.length} file(s) with 3+ retries — investigate root cause`);
      }
    }

    // Cross-script recommendations
    subheader('Further Investigation');
    info(`Storage details: npx tsx scripts/storage/verify-storage.ts --userId ${userId} --check-embeddings`);
    info(`Vector pipeline: npx tsx scripts/search/diagnose-unified-vector-pipeline.ts --userId ${userId}`);
    info(`Queue health:    npx tsx scripts/redis/queue-status.ts --verbose`);
    if (failedFiles.length > 0 || stuckFiles.length > 0) {
      info(`Fix stuck:       npx tsx scripts/connectors/fix-stuck-scopes.ts --userId ${userId} --dry-run`);
    }
  }
}

// ============================================================================
// Run
// ============================================================================

main().catch((error) => {
  console.error(`${RED}Fatal error:${RESET}`, error);
  process.exit(1);
});
