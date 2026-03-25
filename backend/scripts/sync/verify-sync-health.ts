#!/usr/bin/env npx tsx
/**
 * verify-sync-health.ts — File Sync Health Report
 *
 * Runs diagnostics across the full sync pipeline and outputs a report:
 *   - Scope status distribution
 *   - Stuck scopes (syncing > 10 minutes)
 *   - Error scopes with last error message
 *   - File pipeline status distribution
 *   - Failed files with error details
 *   - Per-user search index comparison (DB ready count vs AI Search indexed count)
 *   - Subscription health (expired or missing subscriptions)
 *
 * Usage (run from backend/ directory):
 *   npx tsx scripts/sync/verify-sync-health.ts
 *   npx tsx scripts/sync/verify-sync-health.ts --json
 *   npx tsx scripts/sync/verify-sync-health.ts --fix
 *   npx tsx scripts/sync/verify-sync-health.ts --strict
 *   npx tsx scripts/sync/verify-sync-health.ts --fix --strict
 */

import 'dotenv/config';
import { createPrisma } from '../_shared/prisma';
import { createSearchClient } from '../_shared/azure';
import { hasFlag } from '../_shared/args';

// ============================================================================
// ANSI color helpers
// ============================================================================

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';

// ============================================================================
// Types
// ============================================================================

interface ScopeStatusRow {
  sync_status: string;
  count: number;
}

interface StuckScope {
  id: string;
  scope_display_name: string | null;
  updated_at: Date | null;
  minutesStuck: number;
}

interface ErrorScope {
  id: string;
  scope_display_name: string | null;
  last_sync_error: string | null;
  updated_at: Date | null;
}

interface FilePipelineRow {
  pipeline_status: string;
  count: number;
}

interface FailedFile {
  id: string;
  name: string;
  scopeName: string | null;
  last_processing_error: string | null;
}

interface UserSearchComparison {
  userId: string;
  dbReadyCount: number;
  searchIndexedCount: number | null;
  missing: number | null;
  searchUnavailable: boolean;
}

interface SubscriptionIssue {
  scopeId: string;
  scopeName: string | null;
  issue: string;
}

interface HealthReport {
  generatedAt: string;
  scopeStatusDistribution: Record<string, number>;
  stuckScopes: StuckScope[];
  errorScopes: ErrorScope[];
  filePipelineDistribution: Record<string, number>;
  failedFiles: FailedFile[];
  searchComparisons: UserSearchComparison[];
  searchServiceAvailable: boolean;
  subscriptionIssues: SubscriptionIssue[];
  totalIssues: number;
  status: 'OK' | 'DEGRADED' | 'CRITICAL';
  fixActions: string[];
}

// ============================================================================
// Scope Status Distribution
// ============================================================================

async function getScopeStatusDistribution(
  prisma: ReturnType<typeof createPrisma>,
): Promise<Record<string, number>> {
  // Query all scopes grouped by sync_status via raw SQL for efficiency
  const rows = await prisma.$queryRaw<ScopeStatusRow[]>`
    SELECT sync_status, COUNT(*) AS count
    FROM connection_scopes
    GROUP BY sync_status
  `;

  const distribution: Record<string, number> = {};
  for (const row of rows) {
    // COUNT(*) comes back as BigInt from mssql driver — coerce to number
    distribution[row.sync_status] = Number(row.count);
  }
  return distribution;
}

// ============================================================================
// Stuck Scopes
// ============================================================================

const STUCK_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

async function getStuckScopes(
  prisma: ReturnType<typeof createPrisma>,
): Promise<StuckScope[]> {
  const cutoff = new Date(Date.now() - STUCK_THRESHOLD_MS);

  const rows = await prisma.connection_scopes.findMany({
    where: {
      sync_status: 'syncing',
      updated_at: { lt: cutoff },
    },
    select: {
      id: true,
      scope_display_name: true,
      updated_at: true,
    },
  });

  return rows.map((row) => {
    const elapsed = row.updated_at
      ? Date.now() - new Date(row.updated_at).getTime()
      : STUCK_THRESHOLD_MS + 1;
    return {
      id: row.id,
      scope_display_name: row.scope_display_name,
      updated_at: row.updated_at,
      minutesStuck: Math.round(elapsed / 60_000),
    };
  });
}

// ============================================================================
// Error Scopes
// ============================================================================

async function getErrorScopes(
  prisma: ReturnType<typeof createPrisma>,
): Promise<ErrorScope[]> {
  const rows = await prisma.connection_scopes.findMany({
    where: { sync_status: 'error' },
    select: {
      id: true,
      scope_display_name: true,
      last_sync_error: true,
      updated_at: true,
    },
    orderBy: { updated_at: 'desc' },
  });

  return rows.map((row) => ({
    id: row.id,
    scope_display_name: row.scope_display_name,
    last_sync_error: row.last_sync_error,
    updated_at: row.updated_at,
  }));
}

// ============================================================================
// File Pipeline Distribution
// ============================================================================

async function getFilePipelineDistribution(
  prisma: ReturnType<typeof createPrisma>,
): Promise<Record<string, number>> {
  const rows = await prisma.$queryRaw<FilePipelineRow[]>`
    SELECT pipeline_status, COUNT(*) AS count
    FROM files
    WHERE deletion_status IS NULL
    GROUP BY pipeline_status
  `;

  const distribution: Record<string, number> = {};
  for (const row of rows) {
    distribution[row.pipeline_status] = Number(row.count);
  }
  return distribution;
}

// ============================================================================
// Failed Files Detail
// ============================================================================

async function getFailedFiles(
  prisma: ReturnType<typeof createPrisma>,
): Promise<FailedFile[]> {
  const rows = await prisma.files.findMany({
    where: {
      pipeline_status: 'failed',
      deletion_status: null,
    },
    select: {
      id: true,
      name: true,
      last_processing_error: true,
      connection_scope_id: true,
    },
    orderBy: { updated_at: 'desc' },
    take: 50, // cap at 50 to avoid overflowing output
  });

  // Batch-fetch scope display names
  const scopeIds = [...new Set(rows.map((r) => r.connection_scope_id).filter((id): id is string => id !== null))];
  const scopeMap: Record<string, string | null> = {};

  if (scopeIds.length > 0) {
    const scopes = await prisma.connection_scopes.findMany({
      where: { id: { in: scopeIds } },
      select: { id: true, scope_display_name: true },
    });
    for (const scope of scopes) {
      scopeMap[scope.id] = scope.scope_display_name;
    }
  }

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    scopeName: row.connection_scope_id ? (scopeMap[row.connection_scope_id] ?? row.connection_scope_id) : null,
    last_processing_error: row.last_processing_error,
  }));
}

// ============================================================================
// Per-User Search Index Comparison
// ============================================================================

async function getSearchComparisons(
  prisma: ReturnType<typeof createPrisma>,
): Promise<{ comparisons: UserSearchComparison[]; searchServiceAvailable: boolean }> {
  // Find all users who have at least one 'ready' file (excluding deleted)
  const readyCounts = await prisma.$queryRaw<Array<{ user_id: string; count: number }>>`
    SELECT user_id, COUNT(*) AS count
    FROM files
    WHERE pipeline_status = 'ready'
      AND deletion_status IS NULL
      AND is_folder = 0
    GROUP BY user_id
  `;

  if (readyCounts.length === 0) {
    return { comparisons: [], searchServiceAvailable: true };
  }

  // Attempt to connect to AI Search
  const searchClient = createSearchClient<{ fileId?: string }>();

  if (!searchClient) {
    // Search not configured — report all users without index counts
    return {
      comparisons: readyCounts.map((row) => ({
        userId: row.user_id.toUpperCase(),
        dbReadyCount: Number(row.count),
        searchIndexedCount: null,
        missing: null,
        searchUnavailable: true,
      })),
      searchServiceAvailable: false,
    };
  }

  const comparisons: UserSearchComparison[] = [];

  for (const row of readyCounts) {
    const userId = row.user_id.toUpperCase();
    const dbReadyCount = Number(row.count);

    try {
      // Count unique fileIds in AI Search for this user.
      // We iterate through all results (paged) collecting unique fileIds.
      const searchFilter = `userId eq '${userId}'`;
      const fileIds = new Set<string>();

      // Azure Search returns up to 1000 results per request — paginate if needed
      let skip = 0;
      const pageSize = 1000;
      let hasMore = true;

      while (hasMore) {
        const results = await searchClient.search('*', {
          filter: searchFilter,
          select: ['fileId'] as string[],
          top: pageSize,
          skip,
        } as Record<string, unknown>);

        let pageCount = 0;
        for await (const result of results.results) {
          const doc = result.document as { fileId?: string };
          if (doc.fileId) {
            fileIds.add(doc.fileId);
          }
          pageCount++;
        }

        // If we got a full page, there may be more
        hasMore = pageCount === pageSize;
        skip += pageCount;

        // Safety cap: stop after 100k docs per user to avoid runaway loops
        if (skip >= 100_000) {
          hasMore = false;
        }
      }

      const searchIndexedCount = fileIds.size;
      const missing = Math.max(0, dbReadyCount - searchIndexedCount);

      comparisons.push({
        userId,
        dbReadyCount,
        searchIndexedCount,
        missing,
        searchUnavailable: false,
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      // If search fails for this specific user, record it but continue
      comparisons.push({
        userId,
        dbReadyCount,
        searchIndexedCount: null,
        missing: null,
        searchUnavailable: true,
      });
      console.error(`  ${YELLOW}Warning: Could not query AI Search for user ${userId}: ${errMsg}${RESET}`);
    }
  }

  return { comparisons, searchServiceAvailable: true };
}

// ============================================================================
// Subscription Health
// ============================================================================

async function getSubscriptionIssues(
  prisma: ReturnType<typeof createPrisma>,
): Promise<SubscriptionIssue[]> {
  const issues: SubscriptionIssue[] = [];
  const now = new Date();

  // Find synced scopes that have a subscription but it has expired
  const expiredSubs = await prisma.connection_scopes.findMany({
    where: {
      sync_status: { in: ['synced', 'idle', 'syncing', 'sync_queued'] },
      subscription_id: { not: null },
      subscription_expires_at: { lt: now },
    },
    select: {
      id: true,
      scope_display_name: true,
      subscription_expires_at: true,
    },
  });

  for (const scope of expiredSubs) {
    const expiredAgo = scope.subscription_expires_at
      ? Math.round((now.getTime() - new Date(scope.subscription_expires_at).getTime()) / 60_000)
      : 0;
    issues.push({
      scopeId: scope.id,
      scopeName: scope.scope_display_name,
      issue: `Subscription expired ${expiredAgo} minute(s) ago (${scope.subscription_expires_at?.toISOString() ?? 'unknown'})`,
    });
  }

  // Find synced scopes that have NO subscription (may miss real-time change notifications)
  const noSubScopes = await prisma.connection_scopes.findMany({
    where: {
      sync_status: 'synced',
      subscription_id: null,
    },
    select: {
      id: true,
      scope_display_name: true,
    },
  });

  for (const scope of noSubScopes) {
    issues.push({
      scopeId: scope.id,
      scopeName: scope.scope_display_name,
      issue: 'Synced scope has no subscription — real-time change notifications disabled',
    });
  }

  return issues;
}

// ============================================================================
// Fix Mode: Reset stuck syncing scopes to idle
// ============================================================================

async function fixStuckScopes(
  prisma: ReturnType<typeof createPrisma>,
  stuckScopes: StuckScope[],
): Promise<string[]> {
  const actions: string[] = [];

  if (stuckScopes.length === 0) {
    return actions;
  }

  for (const scope of stuckScopes) {
    const name = scope.scope_display_name ?? scope.id;
    try {
      await prisma.connection_scopes.update({
        where: { id: scope.id },
        data: {
          sync_status: 'idle',
          last_sync_error: 'Auto-reset by health check: stuck in syncing state',
          updated_at: new Date(),
        },
      });
      const action = `Reset scope "${name}" (${scope.id}) from syncing → idle (was stuck ${scope.minutesStuck} min)`;
      actions.push(action);
      console.log(`  ${GREEN}✓${RESET} ${action}`);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const action = `FAILED to reset scope "${name}" (${scope.id}): ${errMsg}`;
      actions.push(action);
      console.log(`  ${RED}✗${RESET} ${action}`);
    }
  }

  return actions;
}

// ============================================================================
// Human-readable output
// ============================================================================

function printReport(report: HealthReport): void {
  const sep = (title: string): void => {
    console.log(`\n${BOLD}--- ${title} ---${RESET}`);
  };

  const pad = (label: string, n: number): string =>
    `  ${label.padEnd(14)} ${String(n).padStart(5)}`;

  console.log(`\n${BOLD}${CYAN}=== File Sync Health Report ===${RESET}`);
  console.log(`Generated: ${report.generatedAt}`);

  // ── Scope Status Distribution ──────────────────────────────────────────────
  sep('Scope Status Distribution');
  const scopeStatuses = ['synced', 'idle', 'sync_queued', 'syncing', 'error'];
  const allScopeStatuses = [
    ...scopeStatuses,
    ...Object.keys(report.scopeStatusDistribution).filter((s) => !scopeStatuses.includes(s)),
  ];
  for (const status of allScopeStatuses) {
    const count = report.scopeStatusDistribution[status] ?? 0;
    const color =
      status === 'synced' ? GREEN :
      status === 'error' ? RED :
      (status === 'syncing' || status === 'sync_queued') ? YELLOW : DIM;
    console.log(`${color}${pad(status + ':', count)}${RESET}`);
  }

  // ── Issues Found ──────────────────────────────────────────────────────────
  sep('Issues Found');

  const stuckColor = report.stuckScopes.length > 0 ? YELLOW : GREEN;
  const stuckIcon = report.stuckScopes.length > 0 ? '⚠' : '✓';
  console.log(`${stuckColor}${stuckIcon} STUCK SCOPES (syncing > 10 min): ${report.stuckScopes.length}${RESET}`);
  for (const scope of report.stuckScopes) {
    const name = scope.scope_display_name ?? scope.id;
    const lastUpdate = scope.updated_at ? new Date(scope.updated_at).toISOString() : 'unknown';
    console.log(`  ${YELLOW}  - Scope ${scope.id} (${name}): stuck ${scope.minutesStuck} min (last update: ${lastUpdate})${RESET}`);
  }

  const errorColor = report.errorScopes.length > 0 ? RED : GREEN;
  const errorIcon = report.errorScopes.length > 0 ? '✗' : '✓';
  console.log(`${errorColor}${errorIcon} ERROR SCOPES: ${report.errorScopes.length}${RESET}`);
  for (const scope of report.errorScopes) {
    const name = scope.scope_display_name ?? scope.id;
    const lastAttempt = scope.updated_at ? new Date(scope.updated_at).toISOString() : 'unknown';
    const errMsg = scope.last_sync_error ? `"${scope.last_sync_error}"` : '(no error message)';
    console.log(`  ${RED}  - Scope ${scope.id} (${name}): ${errMsg} (last attempt: ${lastAttempt})${RESET}`);
  }

  // ── File Pipeline Status ───────────────────────────────────────────────────
  sep('File Pipeline Status');
  const pipelineStatuses = ['ready', 'embedding', 'chunked', 'chunking', 'extracted', 'extracting', 'queued', 'failed'];
  const allPipelineStatuses = [
    ...pipelineStatuses,
    ...Object.keys(report.filePipelineDistribution).filter((s) => !pipelineStatuses.includes(s)),
  ];
  for (const status of allPipelineStatuses) {
    const count = report.filePipelineDistribution[status] ?? 0;
    if (count === 0) continue;
    const color =
      status === 'ready' ? GREEN :
      status === 'failed' ? RED :
      YELLOW;
    console.log(`${color}${pad(status + ':', count)}${RESET}`);
  }

  // ── Failed Files ───────────────────────────────────────────────────────────
  sep('Failed Files');
  if (report.failedFiles.length === 0) {
    console.log(`  ${GREEN}✓ No failed files${RESET}`);
  } else {
    for (const file of report.failedFiles) {
      const scopePart = file.scopeName ? ` (scope: ${file.scopeName})` : '';
      const errPart = file.last_processing_error ? `"${file.last_processing_error}"` : '(no error message)';
      console.log(`  ${RED}  - ${file.name}${scopePart}: ${errPart}${RESET}`);
    }
    if (report.filePipelineDistribution['failed'] > report.failedFiles.length) {
      console.log(`  ${DIM}  ... (showing first ${report.failedFiles.length} of ${report.filePipelineDistribution['failed']} failed files)${RESET}`);
    }
  }

  // ── Search Index Comparison ────────────────────────────────────────────────
  sep('Search Index Comparison');
  if (!report.searchServiceAvailable) {
    console.log(`  ${YELLOW}⚠ AI Search not configured (AZURE_SEARCH_ENDPOINT / AZURE_SEARCH_KEY) — skipping${RESET}`);
  } else if (report.searchComparisons.length === 0) {
    console.log(`  ${DIM}  No users with ready files${RESET}`);
  } else {
    for (const comp of report.searchComparisons) {
      if (comp.searchUnavailable) {
        console.log(`  ${YELLOW}⚠ User ${comp.userId}: DB=${comp.dbReadyCount} ready, Search=unavailable${RESET}`);
      } else if (comp.missing !== null && comp.missing > 0) {
        console.log(`  ${RED}✗ User ${comp.userId}: DB=${comp.dbReadyCount} ready, Search=${comp.searchIndexedCount} indexed (${comp.missing} MISSING)${RESET}`);
      } else {
        console.log(`  ${GREEN}✓ User ${comp.userId}: DB=${comp.dbReadyCount} ready, Search=${comp.searchIndexedCount} indexed (OK)${RESET}`);
      }
    }
  }

  // ── Subscription Health ────────────────────────────────────────────────────
  sep('Subscription Health');
  if (report.subscriptionIssues.length === 0) {
    console.log(`  ${GREEN}✓ All subscriptions healthy${RESET}`);
  } else {
    for (const issue of report.subscriptionIssues) {
      const name = issue.scopeName ?? issue.scopeId;
      console.log(`  ${YELLOW}⚠ Scope "${name}" (${issue.scopeId}): ${issue.issue}${RESET}`);
    }
  }

  // ── Fix Actions ────────────────────────────────────────────────────────────
  if (report.fixActions.length > 0) {
    sep('Fix Actions Applied');
    for (const action of report.fixActions) {
      console.log(`  ${CYAN}  → ${action}${RESET}`);
    }
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  sep('Summary');
  console.log(`Total issues: ${report.totalIssues}`);
  const statusColor =
    report.status === 'OK' ? GREEN :
    report.status === 'DEGRADED' ? YELLOW :
    RED;
  console.log(`Status: ${statusColor}${BOLD}${report.status}${RESET}`);
  console.log('');
}

// ============================================================================
// Build report
// ============================================================================

async function buildReport(prisma: ReturnType<typeof createPrisma>, fix: boolean): Promise<HealthReport> {
  // Run all diagnostic queries in parallel where possible
  const [
    scopeStatusDistribution,
    stuckScopes,
    errorScopes,
    filePipelineDistribution,
    failedFiles,
    subscriptionIssues,
  ] = await Promise.all([
    getScopeStatusDistribution(prisma),
    getStuckScopes(prisma),
    getErrorScopes(prisma),
    getFilePipelineDistribution(prisma),
    getFailedFiles(prisma),
    getSubscriptionIssues(prisma),
  ]);

  // Search comparison (not parallelized with DB queries — involves external service)
  const { comparisons: searchComparisons, searchServiceAvailable } =
    await getSearchComparisons(prisma);

  // Fix mode: reset stuck scopes
  let fixActions: string[] = [];
  if (fix && stuckScopes.length > 0) {
    fixActions = await fixStuckScopes(prisma, stuckScopes);
  }

  // Count issues
  const missingInSearch = searchComparisons.filter((c) => c.missing !== null && c.missing > 0).length;

  const totalIssues =
    stuckScopes.length +
    errorScopes.length +
    (filePipelineDistribution['failed'] ?? 0) +
    missingInSearch +
    subscriptionIssues.length;

  const status: HealthReport['status'] =
    totalIssues === 0 ? 'OK' :
    errorScopes.length > 0 || (filePipelineDistribution['failed'] ?? 0) > 0 ? 'CRITICAL' :
    'DEGRADED';

  return {
    generatedAt: new Date().toISOString(),
    scopeStatusDistribution,
    stuckScopes,
    errorScopes,
    filePipelineDistribution,
    failedFiles,
    searchComparisons,
    searchServiceAvailable,
    subscriptionIssues,
    totalIssues,
    status,
    fixActions,
  };
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const jsonOutput = hasFlag('--json');
  const fix = hasFlag('--fix');
  const strict = hasFlag('--strict');

  if (!jsonOutput) {
    if (fix) {
      console.log(`${YELLOW}Fix mode enabled — stuck syncing scopes will be reset to idle.${RESET}`);
    }
  }

  const prisma = createPrisma();

  try {
    const report = await buildReport(prisma, fix);

    if (jsonOutput) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      printReport(report);
    }

    if (strict && report.totalIssues > 0) {
      process.exit(1);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  const errMsg = err instanceof Error ? err.message : String(err);
  console.error(`${RED}Fatal error: ${errMsg}${RESET}`);
  if (err instanceof Error && err.stack) {
    console.error(err.stack);
  }
  process.exit(1);
});
