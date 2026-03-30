/**
 * Fix Stuck Scopes
 *
 * Finds and resets connection scopes stuck in 'syncing' status.
 * A scope is considered stuck if last_sync_at is older than 10 minutes
 * or null while sync_status is 'syncing'.
 *
 * Usage:
 *   npx tsx scripts/connectors/fix-stuck-scopes.ts --userId <ID> --dry-run
 *   npx tsx scripts/connectors/fix-stuck-scopes.ts --userId <ID> --fix
 *   npx tsx scripts/connectors/fix-stuck-scopes.ts --userId <ID> --fix --reset-to-idle
 *   npx tsx scripts/connectors/fix-stuck-scopes.ts --connectionId <ID> --fix
 *   npx tsx scripts/connectors/fix-stuck-scopes.ts --help
 */

import 'dotenv/config';
import { createPrisma } from '../_shared/prisma';
import { getFlag, hasFlag } from '../_shared/args';
import { getTargetEnv, resolveEnvironment } from '../_shared/env-resolver';

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
${BOLD}fix-stuck-scopes.ts${RESET} — Reset scopes stuck in 'syncing' status

${BOLD}Usage:${RESET}
  npx tsx scripts/connectors/fix-stuck-scopes.ts --userId <ID> --dry-run
  npx tsx scripts/connectors/fix-stuck-scopes.ts --userId <ID> --fix
  npx tsx scripts/connectors/fix-stuck-scopes.ts --connectionId <ID> --fix

${BOLD}Flags:${RESET}
  --userId <ID>         Filter scopes by user
  --connectionId <ID>   Filter scopes by connection
  --dry-run             Preview stuck scopes without making changes
  --fix                 Reset stuck scopes to 'error' status
  --reset-to-idle       Reset to 'idle' instead of 'error' (for re-sync)
  --env dev|prod        Target environment (overrides .env)
  --help, -h            Show this help message

${BOLD}What counts as "stuck":${RESET}
  - sync_status = 'syncing'
  - last_sync_at is NULL or older than 10 minutes
`);
}

if (hasFlag('--help') || hasFlag('-h')) {
  printHelp();
  process.exit(0);
}

const STUCK_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

async function main(): Promise<void> {
  const targetEnv = getTargetEnv();
  if (targetEnv) await resolveEnvironment(targetEnv);

  const userId = getFlag('--userId')?.toUpperCase() ?? null;
  const connectionId = getFlag('--connectionId')?.toUpperCase() ?? null;
  const dryRun = hasFlag('--dry-run');
  const fix = hasFlag('--fix');
  const resetToIdle = hasFlag('--reset-to-idle');

  if (!userId && !connectionId) {
    console.error(`${RED}ERROR: Provide --userId or --connectionId${RESET}`);
    printHelp();
    process.exit(1);
  }

  if (!dryRun && !fix) {
    console.error(`${RED}ERROR: Provide --dry-run or --fix${RESET}`);
    process.exit(1);
  }

  const prisma = createPrisma();

  try {
    // Find connection IDs
    let connectionIds: string[];

    if (connectionId) {
      connectionIds = [connectionId];
    } else {
      const connections = await prisma.connections.findMany({
        where: { user_id: userId! },
        select: { id: true },
      });
      connectionIds = connections.map((c) => c.id);
    }

    if (connectionIds.length === 0) {
      console.log(`${YELLOW}No connections found.${RESET}`);
      return;
    }

    // Find stuck scopes
    const allSyncingScopes = await prisma.connection_scopes.findMany({
      where: {
        connection_id: { in: connectionIds },
        sync_status: 'syncing',
      },
    });

    const now = Date.now();
    const stuckScopes = allSyncingScopes.filter((scope) => {
      if (!scope.last_sync_at) return true; // Never synced but in syncing state
      return now - new Date(scope.last_sync_at).getTime() > STUCK_THRESHOLD_MS;
    });

    if (stuckScopes.length === 0) {
      console.log(`${GREEN}No stuck scopes found.${RESET}`);
      return;
    }

    console.log(`\n${BOLD}=== Stuck Scopes (${stuckScopes.length}) ===${RESET}\n`);

    for (const scope of stuckScopes) {
      const syncAge = scope.last_sync_at
        ? `${Math.round((now - new Date(scope.last_sync_at).getTime()) / 60000)} min ago`
        : 'never';

      console.log(
        `  ${CYAN}${scope.id}${RESET}` +
        `  ${(scope as unknown as { scope_display_name: string | null }).scope_display_name ?? '(unnamed)'}` +
        `  ${DIM}last sync: ${syncAge}${RESET}` +
        `  items: ${scope.item_count}`
      );
    }

    if (dryRun) {
      console.log(`\n${YELLOW}DRY RUN — no changes made. Use --fix to apply.${RESET}`);
      return;
    }

    // Apply fix
    const targetStatus = resetToIdle ? 'idle' : 'error';
    const errorMessage = resetToIdle
      ? null
      : 'Sync timed out \u2014 reset by fix-stuck-scopes script';

    console.log(`\n${BOLD}Resetting ${stuckScopes.length} scope(s) to '${targetStatus}'...${RESET}`);

    let fixed = 0;
    for (const scope of stuckScopes) {
      await prisma.connection_scopes.update({
        where: { id: scope.id },
        data: {
          sync_status: targetStatus,
          last_sync_error: errorMessage,
        },
      });
      fixed++;
      const name = (scope as unknown as { scope_display_name: string | null }).scope_display_name ?? scope.id;
      console.log(`  ${GREEN}\u2713${RESET} ${name} \u2192 ${targetStatus}`);
    }

    console.log(`\n${GREEN}Fixed ${fixed} scope(s).${RESET}`);

    if (targetStatus === 'error') {
      console.log(`${DIM}To re-sync, use the ConnectionWizard or run with --reset-to-idle.${RESET}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(`${RED}Fatal error:${RESET}`, err);
  process.exit(1);
});
