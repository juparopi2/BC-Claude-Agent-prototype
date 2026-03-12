/**
 * Diagnose Sync
 *
 * Diagnostic script for inspecting connection scopes, file hierarchy,
 * stuck syncs, and orphaned files.
 *
 * Usage:
 *   npx tsx scripts/connectors/diagnose-sync.ts --userId <ID>
 *   npx tsx scripts/connectors/diagnose-sync.ts --connectionId <ID>
 *   npx tsx scripts/connectors/diagnose-sync.ts --scopeId <ID> --verbose
 *   npx tsx scripts/connectors/diagnose-sync.ts --userId <ID> --health
 *   npx tsx scripts/connectors/diagnose-sync.ts --userId <ID> --source-type onedrive
 *   npx tsx scripts/connectors/diagnose-sync.ts --help
 */

import 'dotenv/config';
import { createPrisma } from '../_shared/prisma';
import { getFlag, hasFlag } from '../_shared/args';

// ─── ANSI Colors ─────────────────────────────────────────────────
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

// ─── Help ────────────────────────────────────────────────────────
function printHelp(): void {
  console.log(`
${BOLD}diagnose-sync.ts${RESET} — Inspect connection scopes, file hierarchy, and sync issues

${BOLD}Usage:${RESET}
  npx tsx scripts/connectors/diagnose-sync.ts --userId <ID>
  npx tsx scripts/connectors/diagnose-sync.ts --connectionId <ID>
  npx tsx scripts/connectors/diagnose-sync.ts --scopeId <ID> [--verbose]

${BOLD}Flags:${RESET}
  --userId <ID>              Show all connections and scopes for a user
  --connectionId <ID>        Show scopes for a specific connection
  --scopeId <ID>             Show details for a single scope
  --verbose                  Show individual files per scope
  --health                   Compact DB-only summary (~20 lines)
  --source-type onedrive|sharepoint
                             Filter file analysis by source type
  --help, -h                 Show this help message
`);
}

if (hasFlag('--help') || hasFlag('-h')) {
  printHelp();
  process.exit(0);
}

// ─── Relative time helper ─────────────────────────────────────────
function relativeTime(date: Date | null): string {
  if (!date) return 'never';
  const elapsed = Date.now() - new Date(date).getTime();
  if (elapsed < 60_000) return `${Math.round(elapsed / 1000)} seconds ago`;
  if (elapsed < 3_600_000) return `${Math.round(elapsed / 60_000)} minutes ago`;
  if (elapsed < 86_400_000) return `${Math.round(elapsed / 3_600_000)} hours ago`;
  return `${Math.round(elapsed / 86_400_000)} days ago`;
}

// ─── Types ───────────────────────────────────────────────────────
interface ScopeRow {
  id: string;
  connection_id: string;
  scope_type: string;
  scope_display_name: string | null;
  scope_path: string | null;
  sync_status: string;
  last_sync_at: Date | null;
  last_sync_error: string | null;
  item_count: number;
  created_at: Date;
}

interface ConnectionRow {
  id: string;
  provider: string;
  status: string;
  display_name: string | null;
}

// ─── Main ────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const userId = getFlag('--userId')?.toUpperCase() ?? null;
  const connectionId = getFlag('--connectionId')?.toUpperCase() ?? null;
  const scopeId = getFlag('--scopeId')?.toUpperCase() ?? null;
  const verbose = hasFlag('--verbose');
  const healthMode = hasFlag('--health');
  const sourceTypeRaw = getFlag('--source-type');
  const sourceType = sourceTypeRaw === 'onedrive' || sourceTypeRaw === 'sharepoint' ? sourceTypeRaw : null;

  if (sourceTypeRaw && !sourceType) {
    console.error(`${RED}ERROR: --source-type must be 'onedrive' or 'sharepoint'${RESET}`);
    process.exit(1);
  }

  if (!userId && !connectionId && !scopeId) {
    console.error(`${RED}ERROR: Provide at least one of --userId, --connectionId, or --scopeId${RESET}`);
    printHelp();
    process.exit(1);
  }

  const prisma = createPrisma();

  try {
    // ─── Health mode ──────────────────────────────────────────
    if (healthMode) {
      await runHealthCheck(prisma, userId, connectionId, sourceType);
      return;
    }

    // Build scope query based on input
    let scopes: ScopeRow[];
    let connections: ConnectionRow[] = [];

    if (scopeId) {
      scopes = await prisma.connection_scopes.findMany({
        where: { id: scopeId },
      }) as unknown as ScopeRow[];
    } else if (connectionId) {
      scopes = await prisma.connection_scopes.findMany({
        where: { connection_id: connectionId },
        orderBy: { created_at: 'asc' },
      }) as unknown as ScopeRow[];

      connections = await prisma.connections.findMany({
        where: { id: connectionId },
        select: { id: true, provider: true, status: true, display_name: true },
      }) as unknown as ConnectionRow[];
    } else {
      // userId
      connections = await prisma.connections.findMany({
        where: { user_id: userId! },
        select: { id: true, provider: true, status: true, display_name: true },
      }) as unknown as ConnectionRow[];

      const connectionIds = connections.map((c) => c.id);
      if (connectionIds.length === 0) {
        console.log(`${YELLOW}No connections found for user ${userId}${RESET}`);
        return;
      }

      scopes = await prisma.connection_scopes.findMany({
        where: { connection_id: { in: connectionIds } },
        orderBy: { created_at: 'asc' },
      }) as unknown as ScopeRow[];
    }

    // ─── Connections Summary ──────────────────────────────────
    if (connections.length > 0) {
      console.log(`\n${BOLD}=== Connections ===${RESET}`);
      for (const conn of connections) {
        const statusColor = conn.status === 'connected' ? GREEN : conn.status === 'error' ? RED : YELLOW;
        console.log(`  ${CYAN}${conn.id}${RESET}  ${conn.provider}  ${statusColor}${conn.status}${RESET}  ${DIM}${conn.display_name ?? ''}${RESET}`);
      }
    }

    // ─── Scopes Summary ──────────────────────────────────────
    if (scopes.length === 0) {
      console.log(`\n${YELLOW}No scopes found.${RESET}`);
      return;
    }

    console.log(`\n${BOLD}=== Scopes (${scopes.length}) ===${RESET}`);
    if (sourceType) {
      console.log(`${DIM}  (file analysis filtered to source_type=${sourceType})${RESET}`);
    }

    const STUCK_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes
    const now = Date.now();

    for (const scope of scopes) {
      const isStuck =
        scope.sync_status === 'syncing' &&
        (!scope.last_sync_at || now - new Date(scope.last_sync_at).getTime() > STUCK_THRESHOLD_MS);

      const statusColor =
        scope.sync_status === 'idle' ? GREEN :
        scope.sync_status === 'syncing' && !isStuck ? YELLOW :
        scope.sync_status === 'syncing' && isStuck ? RED :
        RED;

      const stuckLabel = isStuck ? ` ${RED}[STUCK]${RESET}` : '';
      const syncDate = scope.last_sync_at
        ? `${relativeTime(scope.last_sync_at)}  ${DIM}(${new Date(scope.last_sync_at).toISOString()})${RESET}`
        : 'never';

      console.log(
        `\n  ${BOLD}Scope:${RESET} ${CYAN}${scope.id}${RESET}` +
        `\n    Type:        ${scope.scope_type}` +
        `\n    Name:        ${scope.scope_display_name ?? '(unnamed)'}` +
        `\n    Path:        ${scope.scope_path ?? '(none)'}` +
        `\n    Status:      ${statusColor}${scope.sync_status}${RESET}${stuckLabel}` +
        `\n    Item count:  ${scope.item_count}` +
        `\n    Last sync:   ${syncDate}` +
        (scope.last_sync_error ? `\n    ${RED}Last error:  ${scope.last_sync_error}${RESET}` : '')
      );

      // ─── File Analysis per Scope ──────────────────────────
      // Build base file filter for this connection (optionally filtered by source_type)
      const fileBaseWhere: Record<string, unknown> = {
        connection_id: scope.connection_id,
        deletion_status: null,
        ...(sourceType ? { source_type: sourceType } : {}),
      };

      // Count actual files for this scope's connection
      const actualFileCount = await prisma.files.count({ where: fileBaseWhere });

      const rootFileCount = await prisma.files.count({
        where: { ...fileBaseWhere, parent_folder_id: null },
      });

      const folderCount = await prisma.files.count({
        where: { ...fileBaseWhere, is_folder: true },
      });

      // Count orphaned files (parent_folder_id points to non-existent parent)
      const orphanedResult = await prisma.$queryRaw<Array<{ count: number }>>`
        SELECT COUNT(*) as count
        FROM files f
        WHERE f.connection_id = ${scope.connection_id}
          AND f.deletion_status IS NULL
          AND f.parent_folder_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM files p
            WHERE p.id = f.parent_folder_id
              AND p.deletion_status IS NULL
          )
      `;
      const orphanedCount = orphanedResult[0]?.count ?? 0;

      const mismatch = actualFileCount !== scope.item_count;
      const mismatchLabel = mismatch
        ? ` ${YELLOW}(mismatch: scope says ${scope.item_count})${RESET}`
        : '';

      console.log(
        `    ${BOLD}Files:${RESET}       ${actualFileCount} total${mismatchLabel}` +
        `\n    Folders:     ${folderCount}` +
        `\n    Root items:  ${rootFileCount}` +
        (orphanedCount > 0 ? `\n    ${RED}Orphaned:    ${orphanedCount} (parent_folder_id points to missing parent)${RESET}` : '')
      );

      // ─── Pipeline status breakdown per scope ──────────────
      const pipelineFiles = await prisma.files.findMany({
        where: {
          connection_scope_id: scope.id,
          deletion_status: null,
          is_folder: false,
          ...(sourceType ? { source_type: sourceType } : {}),
        },
        select: { pipeline_status: true },
      });

      if (pipelineFiles.length > 0) {
        const distribution: Record<string, number> = {};
        for (const f of pipelineFiles) {
          const ps = f.pipeline_status ?? 'unknown';
          distribution[ps] = (distribution[ps] || 0) + 1;
        }
        const parts = Object.entries(distribution)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([s, n]) => {
            const color = s === 'ready' ? GREEN : s === 'failed' ? RED : YELLOW;
            return `${color}${s}${RESET}=${n}`;
          })
          .join('  ');
        console.log(`    Pipeline:    ${parts}`);
      }

      // ─── Verbose: list individual files ─────────────────────
      if (verbose) {
        const files = await prisma.files.findMany({
          where: {
            connection_id: scope.connection_id,
            deletion_status: null,
            ...(sourceType ? { source_type: sourceType } : {}),
          },
          select: {
            id: true,
            name: true,
            is_folder: true,
            parent_folder_id: true,
            source_type: true,
            external_id: true,
            pipeline_status: true,
          },
          orderBy: [{ is_folder: 'desc' }, { name: 'asc' }],
          take: 100,
        });

        if (files.length > 0) {
          console.log(`    ${DIM}─── Files (up to 100) ───${RESET}`);
          for (const file of files) {
            const typeIcon = file.is_folder ? '📁' : '📄';
            const parentLabel = file.parent_folder_id
              ? `parent:${file.parent_folder_id.substring(0, 8)}...`
              : 'root';
            const pipelineLabel = !file.is_folder
              ? `  ${DIM}[${file.pipeline_status ?? 'unknown'}]${RESET}`
              : '';
            console.log(`      ${typeIcon} ${file.name}  ${DIM}[${parentLabel}]  ${file.id.substring(0, 8)}...${RESET}${pipelineLabel}`);
          }
        }
      }
    }

    console.log(`\n${DIM}Done.${RESET}`);
  } finally {
    await prisma.$disconnect();
  }
}

// ─── Health Check (compact summary) ──────────────────────────────
async function runHealthCheck(
  prisma: ReturnType<typeof createPrisma>,
  userId: string | null,
  connectionId: string | null,
  sourceType: string | null,
): Promise<void> {
  console.log(`\n${BOLD}=== Sync Health Check ===${RESET}`);

  let connections: ConnectionRow[] = [];

  if (userId) {
    connections = await prisma.connections.findMany({
      where: { user_id: userId },
      select: { id: true, provider: true, status: true, display_name: true },
    }) as unknown as ConnectionRow[];
  } else if (connectionId) {
    connections = await prisma.connections.findMany({
      where: { id: connectionId },
      select: { id: true, provider: true, status: true, display_name: true },
    }) as unknown as ConnectionRow[];
  }

  if (connections.length === 0) {
    console.log(`  ${YELLOW}⚠${RESET} No connections found`);
    return;
  }

  // Connections
  console.log(`\n  ${BOLD}Connections (${connections.length})${RESET}`);
  for (const conn of connections) {
    const statusColor = conn.status === 'connected' ? GREEN : conn.status === 'expired' ? YELLOW : RED;
    console.log(`    ${conn.provider.padEnd(12)} ${statusColor}${conn.status}${RESET}  ${DIM}${conn.id}${RESET}`);
  }

  // Scopes
  const connectionIds = connections.map((c) => c.id);
  const scopes = await prisma.connection_scopes.findMany({
    where: { connection_id: { in: connectionIds } },
    select: { id: true, sync_status: true, scope_display_name: true, item_count: true, last_sync_at: true },
  });

  console.log(`\n  ${BOLD}Scopes (${scopes.length})${RESET}`);
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

  // Pipeline status for external files
  const fileWhere: Record<string, unknown> = {
    user_id: userId ?? undefined,
    source_type: sourceType ? sourceType : { in: ['onedrive', 'sharepoint'] },
    deletion_status: null,
    is_folder: false,
  };
  if (!userId && connectionId) {
    delete fileWhere.user_id;
    fileWhere.connection_id = connectionId;
  }

  const files = await prisma.files.findMany({
    where: fileWhere,
    select: { pipeline_status: true },
  });

  console.log(`\n  ${BOLD}Files (${files.length})${RESET}`);
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

  // Quick assessment
  console.log(`\n  ${BOLD}Assessment${RESET}`);
  const stuckScopes = scopes.filter((s) => s.sync_status === 'syncing');
  const errorScopes = scopes.filter((s) => s.sync_status === 'error');
  const failedFiles = files.filter((f) => f.pipeline_status === 'failed');

  if (stuckScopes.length === 0 && errorScopes.length === 0 && failedFiles.length === 0) {
    console.log(`  ${GREEN}✓${RESET} All systems healthy`);
  } else {
    if (stuckScopes.length > 0) console.log(`  ${YELLOW}⚠${RESET} ${stuckScopes.length} scope(s) stuck in syncing state`);
    if (errorScopes.length > 0) console.log(`  ${RED}✗${RESET} ${errorScopes.length} scope(s) in error state`);
    if (failedFiles.length > 0) console.log(`  ${RED}✗${RESET} ${failedFiles.length} file(s) in failed pipeline status`);
  }

  console.log();
}

main().catch((err) => {
  console.error(`${RED}Fatal error:${RESET}`, err);
  process.exit(1);
});
