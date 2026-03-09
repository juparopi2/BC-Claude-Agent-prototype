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
  --userId <ID>         Show all connections and scopes for a user
  --connectionId <ID>   Show scopes for a specific connection
  --scopeId <ID>        Show details for a single scope
  --verbose             Show individual files per scope
  --help, -h            Show this help message
`);
}

if (hasFlag('--help') || hasFlag('-h')) {
  printHelp();
  process.exit(0);
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

  if (!userId && !connectionId && !scopeId) {
    console.error(`${RED}ERROR: Provide at least one of --userId, --connectionId, or --scopeId${RESET}`);
    printHelp();
    process.exit(1);
  }

  const prisma = createPrisma();

  try {
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
        ? new Date(scope.last_sync_at).toISOString()
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
      // Count actual files for this scope's connection
      const actualFileCount = await prisma.files.count({
        where: {
          connection_id: scope.connection_id,
          deletion_status: null,
          // We can't filter by scope directly (no scope_id FK on files),
          // so we count all files for this connection
        },
      });

      const rootFileCount = await prisma.files.count({
        where: {
          connection_id: scope.connection_id,
          deletion_status: null,
          parent_folder_id: null,
        },
      });

      const folderCount = await prisma.files.count({
        where: {
          connection_id: scope.connection_id,
          deletion_status: null,
          is_folder: true,
        },
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

      // ─── Verbose: list individual files ─────────────────────
      if (verbose) {
        const files = await prisma.files.findMany({
          where: {
            connection_id: scope.connection_id,
            deletion_status: null,
          },
          select: {
            id: true,
            name: true,
            is_folder: true,
            parent_folder_id: true,
            source_type: true,
            external_id: true,
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
            console.log(`      ${typeIcon} ${file.name}  ${DIM}[${parentLabel}]  ${file.id.substring(0, 8)}...${RESET}`);
          }
        }
      }
    }

    console.log(`\n${DIM}Done.${RESET}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(`${RED}Fatal error:${RESET}`, err);
  process.exit(1);
});
